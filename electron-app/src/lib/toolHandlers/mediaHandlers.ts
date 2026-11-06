import {
  invokeRunwareEditImage,
  invokeRunwareGenerateImage,
  invokeRunwareGenerateMusic,
} from '@/lib/runware'
import { invokeOpenRouterEditImage, invokeOpenRouterGenerateImage } from '@/lib/openrouterImage'
import { cacheEntriesFromDescribeResults } from '@/lib/imageVisionCache'
import { describeImagesWithSubAgent, formatSubAgentResultsForAgent } from '@/lib/subAgent'
import { resolveImageRecallRequest } from '@/lib/toolHandlers/imageRecall'
import {
  loadProjectImageRecalls,
  MAX_PROJECT_IMAGE_B64_CHARS,
  resolveLocalImagePath,
} from '@/lib/imageProjectRecall'
import { prepareBase64ImageForUpload } from '@/lib/imageAttachment'
import { imageCatalogId } from '@/lib/imageVisionCache'
import {
  parseImageIds,
  parseImageIndexes,
  parseImagePaths,
  pickImageByOneBasedIndex,
  registerTurnCatalogImages,
  resolveCatalogImageByOneBasedIndex,
  resolveReferenceImageIndexes,
  userRequestedCfgOverride,
  userRequestedStepsOverride,
  type ImageRecallToolResult,
} from '@/lib/toolHandlers/helpers'
import type { ToolHandlerFn, ToolHandlerRegistry } from '@/lib/toolExecTypes'
import { synthesizeSpeech } from '@/lib/tts'
import { invokeSaveAudioBytes } from '@/lib/saveAudio'
import { extensionFromAudioMime, validateProjectRelativeAudioPath } from '@/lib/generatedAssetPath'
import { isElectron, isWebStandalone } from '@/lib/platform'
import { extractRunwareImageUrls, extractSavedImagePaths } from '@/lib/runwareMessageMeta'
import { invokeSaveImageFromUrl, isDataImageUrl } from '@/lib/saveImage'
import { sanitizeForTts } from '@/lib/chatHints'

const MAX_TTS_TOOL_CHARS = 8_000

/**
 * Coerce an agent-supplied width/height (number, or a numeric string as some
 * models emit) into a finite number. `undefined` means "no override" — the
 * configured resolution stays in charge.
 */
const readDimension = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return Number(v)
  }
  return undefined
}

/**
 * Coerce an agent-supplied boolean (true/false, or "true"/"1"/"yes" as some
 * models emit) into a boolean. `undefined` means "no override" — the
 * configured profile default stays in charge.
 */
const readBoolean = (v: unknown): boolean | undefined => {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === 'true' || s === '1' || s === 'yes') return true
    if (s === 'false' || s === '0' || s === 'no') return false
  }
  return undefined
}

export const handleGenerateImage: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.runwareImage) {
    return 'Error: generate_image tool is disabled in settings.'
  }
  if (!ctx.runware) {
    return 'Error: image settings are missing.'
  }
  const prompt =
    typeof args.prompt === 'string'
      ? args.prompt.trim()
      : typeof args.positivePrompt === 'string'
        ? args.positivePrompt.trim()
        : ''
  if (!prompt) return 'Error: missing prompt parameter for generate_image.'
  const canOverrideSteps = userRequestedStepsOverride(ctx.userText || '')
  const canOverrideCfg = userRequestedCfgOverride(ctx.userText || '')
  const overrideW = readDimension(args.width)
  const overrideH = readDimension(args.height)
  const overrideTransparent = readBoolean(args.transparent_background)
  try {
    if (ctx.runware.imageProvider === 'openrouter') {
      const or = ctx.runware.openrouter
      if (!or) return 'Error: OpenRouter image settings are missing.'
      return await invokeOpenRouterGenerateImage(
        {
          prompt,
          width: overrideW,
          height: overrideH,
          transparentBackground: overrideTransparent,
        },
        {
          apiKey: or.apiKey,
          baseUrl: or.baseUrl,
          model: or.model,
          width: ctx.runware.width,
          height: ctx.runware.height,
          gptQuality: ctx.runware.gptQuality,
          transparentBackground: ctx.runware.transparentBackground,
          proxyBaseUrl: ctx.runware.proxyBaseUrl || ctx.ttsBaseUrl,
        },
        ctx.signal,
      )
    }
    return await invokeRunwareGenerateImage(
      {
        prompt,
        negativePrompt:
          typeof args.negative_prompt === 'string'
            ? args.negative_prompt
            : typeof args.negativePrompt === 'string'
              ? args.negativePrompt
              : undefined,
        width: overrideW,
        height: overrideH,
        steps: canOverrideSteps && typeof args.steps === 'number' ? args.steps : undefined,
        cfgScale:
          canOverrideCfg && typeof args.cfg_scale === 'number'
            ? args.cfg_scale
            : canOverrideCfg && typeof args.cfgScale === 'number'
              ? args.cfgScale
              : undefined,
        model: typeof args.model === 'string' ? args.model : undefined,
        transparentBackground: overrideTransparent,
      },
      ctx.runware,
      ctx.signal,
    )
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

export const handleEditImageRunware: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.runwareImage) {
    return 'Error: edit_image_runware tool is disabled in settings.'
  }
  if (!ctx.runware) {
    return 'Error: image settings are missing.'
  }
  const prompt =
    typeof args.prompt === 'string'
      ? args.prompt.trim()
      : typeof args.positivePrompt === 'string'
        ? args.positivePrompt.trim()
        : ''
  if (!prompt) return 'Error: missing prompt parameter for edit_image_runware.'
  const canOverrideSteps = userRequestedStepsOverride(ctx.userText || '')
  const canOverrideCfg = userRequestedCfgOverride(ctx.userText || '')
  const overrideW = readDimension(args.width)
  const overrideH = readDimension(args.height)
  const overrideTransparent = readBoolean(args.transparent_background)
  const selected = resolveReferenceImageIndexes(args, ctx.userImagePaths, ctx.userImages)
  const indexes = selected.indexes
  // Project images are read from disk by image_recall, so they never enter the
  // session catalog. Resolve those paths here the same way image_recall does.
  const projectRoot = (ctx.codingProjectPath || '').trim()
  const canReadProjectPaths =
    !!ctx.toolsEnabled.coding && !!projectRoot && selected.missingPaths.length > 0
  if (!indexes.length && !canReadProjectPaths) {
    const unknown = selected.missingIds.length
      ? ` Unknown ids: ${selected.missingIds.join(' | ')}.`
      : ''
    return `Error: missing image references for edit_image_runware. Provide reference_image_ids (e.g. "img_1a2b3c4d"), reference_image_indexes (e.g. "1" or "1,2"), and/or reference_image_paths.${unknown}`
  }
  const refs = indexes
    .map((i) => pickImageByOneBasedIndex(ctx.userImages, ctx.userImageMimes, i))
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
  const projectErrors: string[] = []
  if (canReadProjectPaths) {
    const project = await loadProjectImageRecalls(projectRoot, selected.missingPaths)
    for (const img of project.recalled) {
      refs.push(`data:${img.mime};base64,${img.base64}`)
    }
    for (const err of project.errors) projectErrors.push(err)
  }
  if (!refs.length) {
    const max = ctx.userImages?.length ?? 0
    const missing = [
      selected.missingPaths.length ? ` Missing paths: ${selected.missingPaths.join(' | ')}.` : '',
      selected.missingIds.length ? ` Unknown ids: ${selected.missingIds.join(' | ')}.` : '',
      projectErrors.length ? ` ${projectErrors.join(' ')}` : '',
    ].join('')
    return `Error: no valid reference images resolved from provided ids/indexes/paths. Available image count: ${max}.${missing}`
  }
  try {
    if (ctx.runware.imageProvider === 'openrouter') {
      const or = ctx.runware.openrouter
      if (!or) return 'Error: OpenRouter image settings are missing.'
      const editW = ctx.runware.editDefaults?.width ?? ctx.runware.width
      const editH = ctx.runware.editDefaults?.height ?? ctx.runware.height
      return await invokeOpenRouterEditImage(
        {
          prompt,
          referenceImages: refs,
          width: overrideW,
          height: overrideH,
          transparentBackground: overrideTransparent,
        },
        {
          apiKey: or.apiKey,
          baseUrl: or.baseUrl,
          model: or.model,
          width: editW,
          height: editH,
          gptQuality: ctx.runware.editDefaults?.gptQuality ?? ctx.runware.gptQuality,
          transparentBackground: ctx.runware.editDefaults?.transparentBackground,
          proxyBaseUrl: ctx.runware.proxyBaseUrl || ctx.ttsBaseUrl,
        },
        ctx.signal,
      )
    }
    return await invokeRunwareEditImage(
      {
        prompt,
        referenceImages: refs,
        negativePrompt:
          typeof args.negative_prompt === 'string'
            ? args.negative_prompt
            : typeof args.negativePrompt === 'string'
              ? args.negativePrompt
              : undefined,
        width: overrideW,
        height: overrideH,
        steps: canOverrideSteps && typeof args.steps === 'number' ? args.steps : undefined,
        cfgScale:
          canOverrideCfg && typeof args.cfg_scale === 'number'
            ? args.cfg_scale
            : canOverrideCfg && typeof args.cfgScale === 'number'
              ? args.cfgScale
              : undefined,
        model: typeof args.model === 'string' ? args.model : undefined,
        transparentBackground: overrideTransparent,
      },
      ctx.runware,
      ctx.signal,
    )
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

export const handleImageRecall: ToolHandlerFn = async (args, ctx) => {
  const selected = resolveReferenceImageIndexes(args, ctx.userImagePaths, ctx.userImages)
  const requestedPaths = parseImagePaths(args.reference_image_paths)
  if (
    !selected.indexes.length &&
    !requestedPaths.length &&
    !parseImageIndexes(args.reference_image_indexes).length &&
    !parseImageIds(args.reference_image_ids).length
  ) {
    return 'Error: missing image references for image_recall. Provide reference_image_ids, reference_image_indexes, and/or reference_image_paths.'
  }
  const recall = await resolveImageRecallRequest(args, ctx, {
    codingEnabled: ctx.toolsEnabled.coding,
  })
  if (!recall.recalled.length) {
    const max = recall.maxAvailable
    const detail = recall.errors.length ? ` ${recall.errors.join(' ')}` : ''
    return `Error: image_recall could not resolve any requested images. Available catalog image count: ${max}.${detail}`
  }

  // ── Sub-agent (Predlog 1): describe images via separate model ──
  const subAgentConfig = ctx.subAgent
  const useSubAgent =
    subAgentConfig?.enabled &&
    recall.purpose !== 'edit' && // edit needs actual base64
    recall.recalled.length > 0

  if (useSubAgent) {
    const recalledForCache = recall.recalled.map((img) => ({
      base64: img.base64,
      mime: img.mime,
      path: img.path,
      index: img.index,
    }))
    const descriptions = await describeImagesWithSubAgent(
      recalledForCache,
      subAgentConfig,
      {
        ollamaBaseUrl: ctx.ollamaBaseUrl || 'http://localhost:11434',
        openrouterBaseUrl: ctx.openrouterBaseUrl || 'https://openrouter.ai/api/v1',
        openrouterApiKey: ctx.openrouterApiKey || '',
        deepseekBaseUrl: ctx.deepseekBaseUrl || 'https://api.deepseek.com',
        deepseekApiKey: ctx.deepseekApiKey || '',
        openaiBaseUrl: ctx.openaiBaseUrl || 'https://api.openai.com/v1',
        openaiApiKey: ctx.openaiApiKey || '',
        nvidiaBaseUrl: ctx.nvidiaBaseUrl || 'https://integrate.api.nvidia.com/v1',
        nvidiaApiKey: ctx.nvidiaApiKey || '',
        opencodeGoApiKey: ctx.opencodeGoApiKey || '',
        ttsBaseUrl: ctx.ttsBaseUrl,
        opencodeSessionId: ctx.opencodeSessionId,
      },
      ctx.userText,
      ctx.signal,
      ctx.subAgentUi,
      ctx.imageVisionCache,
      recall.focus,
    )
    const newEntries = cacheEntriesFromDescribeResults(recalledForCache, descriptions, recall.focus)
    if (Object.keys(newEntries).length > 0) {
      ctx.onImageVisionCacheUpdate?.(newEntries)
    }
    const formatted = formatSubAgentResultsForAgent(descriptions)
    const hasCatalog = recall.recalled.some((x) => x.recallSource === 'catalog')
    const hasProject = recall.recalled.some((x) => x.recallSource === 'project_file')
    const source: ImageRecallToolResult['source'] =
      hasCatalog && hasProject ? 'mixed' : hasProject ? 'project_file' : 'internal_catalog'
    const payload: ImageRecallToolResult = {
      ok: true,
      source,
      purpose: recall.purpose,
      recalled_images: recall.recalled.map((x) => ({
        index: x.index,
        mime: x.mime,
        path: x.path,
        source: x.recallSource,
      })),
      ...(recall.errors.length > 0 ? { errors: recall.errors } : {}),
    }
    const subNote = formatted ? `\n\n${formatted}` : '\n\n[Sub-agent returned no descriptions.]'
    return JSON.stringify(payload) + subNote
  }

  // ── Standard path: return metadata (base64 handled by collectRecalledImages) ──
  const hasCatalog = recall.recalled.some((x) => x.recallSource === 'catalog')
  const hasProject = recall.recalled.some((x) => x.recallSource === 'project_file')
  const source: ImageRecallToolResult['source'] =
    hasCatalog && hasProject ? 'mixed' : hasProject ? 'project_file' : 'internal_catalog'
  const payload: ImageRecallToolResult = {
    ok: true,
    source,
    purpose: recall.purpose,
    recalled_images: recall.recalled.map((x) => ({
      index: x.index,
      mime: x.mime,
      path: x.path,
      source: x.recallSource,
    })),
    ...(recall.errors.length > 0 ? { errors: recall.errors } : {}),
    note: 'The image pixels arrive in the next message and are visible for one round only. Look at them then and write down what you need; afterwards only your notes remain.',
  }
  return JSON.stringify(payload)
}

export const handleGenerateMusicRunware: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.runwareMusic) {
    return 'Error: generate_music_runware tool is disabled in settings.'
  }
  if (!ctx.runware) {
    return 'Error: Runware settings are missing.'
  }
  const prompt =
    typeof args.prompt === 'string'
      ? args.prompt.trim()
      : typeof args.positivePrompt === 'string'
        ? args.positivePrompt.trim()
        : ''
  if (!prompt) return 'Error: missing prompt parameter for generate_music_runware.'
  try {
    // Audio engine tuning (steps, cfg_scale, output_format, seed, guidance_type) is intentionally
    // sourced from settings only; any values the model attempts to send in tool args are ignored.
    return await invokeRunwareGenerateMusic(
      {
        prompt,
        negativePrompt:
          typeof args.negative_prompt === 'string'
            ? args.negative_prompt
            : typeof args.negativePrompt === 'string'
              ? args.negativePrompt
              : undefined,
        lyrics: typeof args.lyrics === 'string' ? args.lyrics : undefined,
        durationSec:
          typeof args.duration_sec === 'number'
            ? args.duration_sec
            : typeof args.durationSec === 'number'
              ? args.durationSec
              : undefined,
        bpm: typeof args.bpm === 'number' ? args.bpm : undefined,
        keyScale:
          typeof args.key_scale === 'string'
            ? args.key_scale
            : typeof args.keyScale === 'string'
              ? args.keyScale
              : undefined,
        vocalLanguage:
          typeof args.vocal_language === 'string'
            ? args.vocal_language
            : typeof args.vocalLanguage === 'string'
              ? args.vocalLanguage
              : undefined,
      },
      ctx.runware,
      ctx.signal,
    )
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

export const handleGenerateTts: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.tts) {
    return 'Error: generate_tts tool is disabled in settings.'
  }
  if (!isElectron()) {
    return 'Error: generate_tts is only available in the desktop app (Electron).'
  }
  const tts = ctx.tts
  if (!tts) {
    return 'Error: TTS settings are missing for this turn.'
  }
  if (tts.ttsProvider === 'none') {
    return 'Error: TTS is disabled in Options -> TTS.'
  }
  const rawText =
    typeof args.text === 'string' ? args.text : typeof args.prompt === 'string' ? args.prompt : ''
  const spoken = sanitizeForTts(rawText).trim()
  if (!spoken) return 'Error: missing text parameter for generate_tts.'
  if (spoken.length > MAX_TTS_TOOL_CHARS) {
    return `Error: text is too long for generate_tts (max ${MAX_TTS_TOOL_CHARS} characters).`
  }

  const outputPathRaw =
    typeof args.output_path === 'string'
      ? args.output_path.trim()
      : typeof args.outputPath === 'string'
        ? args.outputPath.trim()
        : ''
  const filenameRaw =
    typeof args.filename === 'string'
      ? args.filename.trim()
      : typeof args.file_name === 'string'
        ? args.file_name.trim()
        : ''
  const voiceInstructOverride =
    typeof args.voice_instruct === 'string'
      ? args.voice_instruct.trim()
      : typeof args.voiceInstruct === 'string'
        ? args.voiceInstruct.trim()
        : ''

  let relativePath: string | undefined
  if (outputPathRaw) {
    const projectPath = (ctx.codingProjectPath || '').trim()
    if (!projectPath) {
      return 'Error: output_path requires a coding project folder (Options → Tools).'
    }
    const validated = validateProjectRelativeAudioPath(outputPathRaw)
    if (!validated.ok) return `Error: ${validated.error}`
    relativePath = validated.relativePath
  }

  const voiceMode =
    tts.ttsProvider === 'local' ? (isWebStandalone() ? 'design' : tts.voiceMode) : 'design'
  if (voiceMode === 'clone' && (!tts.cloneRef?.blob || tts.cloneRef.blob.size === 0)) {
    return 'Error: VOICE_CLONE is selected but no reference audio is loaded (Options → TTS/STT).'
  }

  const instruct =
    voiceInstructOverride || (voiceMode === 'design' ? tts.voiceInstruct : undefined) || undefined
  const positivePrompt = voiceInstructOverride || tts.runwarePositivePrompt || undefined

  const started = Date.now()
  try {
    const blob = await synthesizeSpeech({
      ttsBaseUrl: tts.ttsBaseUrl,
      ttsProvider: tts.ttsProvider,
      openrouterApiKey: tts.openrouterApiKey,
      openrouterTtsModel: tts.openrouterTtsModel,
      openrouterTtsVoice: tts.openrouterTtsVoice,
      runwareApiBaseUrl: tts.runwareApiBaseUrl,
      runwareApiKey: tts.runwareApiKey,
      runwareTtsModel: tts.runwareTtsModel,
      runwareXaiVoice: tts.runwareXaiVoice,
      runwareXaiLanguage: tts.runwareXaiLanguage,
      runwarePositivePrompt: positivePrompt,
      runwareTtsSpeed: tts.runwareTtsSpeed,
      text: spoken,
      voiceMode,
      instruct,
      speed: tts.ttsSpeed,
      numStep: tts.ttsNumStep,
      durationSec: tts.ttsDurationSec ?? null,
      cloneRef: isWebStandalone() ? null : (tts.cloneRef ?? null),
      cloneRefText: isWebStandalone() ? null : (tts.cloneRefText ?? null),
      voiceAnchor: tts.voiceAnchor ?? null,
      signal: ctx.signal,
    })
    if (!blob || blob.size === 0) {
      return 'Error: TTS returned empty audio.'
    }
    const mime = blob.type || 'audio/mpeg'
    const bytes = await blob.arrayBuffer()
    const projectPath = (ctx.codingProjectPath || '').trim()
    const saved = await invokeSaveAudioBytes({
      bytes,
      mime,
      filename: filenameRaw || undefined,
      ...(relativePath ? { projectPath, relativePath } : {}),
    })
    if (!saved.ok || !saved.path) {
      return `Error: failed to save TTS audio. ${saved.text || ''}`.trim()
    }
    const elapsedMs = Date.now() - started
    const model =
      tts.ttsProvider === 'openrouter-tts'
        ? tts.openrouterTtsModel || ''
        : tts.ttsProvider === 'runware-xai'
          ? tts.runwareTtsModel || ''
          : 'local-omnivoice'
    const compact = spoken.replace(/\s+/g, ' ').trim()
    const promptPreview = compact.length > 240 ? `${compact.slice(0, 240)}…` : compact
    const lines = [
      'TTS audio generated successfully.',
      `audio_path: ${saved.path}`,
      `provider: ${tts.ttsProvider}`,
      `output_format: ${extensionFromAudioMime(mime).replace('.', '').toUpperCase()}`,
    ]
    if (saved.relativePath) lines.push(`audio_rel_path: ${saved.relativePath}`)
    if (model) lines.push(`model: ${model}`)
    if (promptPreview) lines.push(`prompt: ${promptPreview}`)
    lines.push(`elapsed_ms: ${Math.max(0, Math.round(elapsedMs))}`)
    return lines.join('\n')
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

/**
 * Saves the generated image before the result reaches the model, so the model
 * knows the file path in the same turn (it can copy it into the project).
 * applyAgentToolResult reuses these "Saved image:" lines instead of saving again.
 */
const withSavedImagePaths =
  (handler: ToolHandlerFn): ToolHandlerFn =>
  async (args, ctx) => {
    const result = await handler(args, ctx)
    if (!isElectron()) return result
    const outputDir = (ctx.runware?.outputDir ?? '').trim()
    const saved: string[] = []
    for (const url of extractRunwareImageUrls(result)) {
      // Remote URLs are only saved when the user turned auto-save on.
      if (!isDataImageUrl(url) && !outputDir) continue
      const txt = await invokeSaveImageFromUrl({ imageUrl: url, outputDir }).catch(() => '')
      saved.push(txt)
    }
    const paths = extractSavedImagePaths(saved.join('\n'))
    if (paths.length === 0) return result
    await registerTurnCatalogImages(paths, ctx)
    return `${result}\n${paths.map((p) => `Saved image: ${p}`).join('\n')}`
  }

/** Save bytes as a new file in the image output folder; returns its path or the failure text. */
async function saveShownImage(
  base64: string,
  mime: string,
  outputDir: string,
  filename?: string,
): Promise<{ path: string } | { error: string }> {
  const text = await invokeSaveImageFromUrl({
    imageUrl: `data:${mime};base64,${base64}`,
    outputDir,
    filename,
  }).catch((e) => (e instanceof Error ? e.message : String(e)))
  const path = extractSavedImagePaths(text)[0]
  return path ? { path } : { error: text }
}

export const handleShowImage: ToolHandlerFn = async (args, ctx) => {
  const readImageFile = isElectron() ? window.voidcast?.readImageFile : undefined
  if (!readImageFile) return 'Error: show_image is only available in the desktop app.'
  const selected = resolveReferenceImageIndexes(args, ctx.userImagePaths, ctx.userImages)
  const errors = selected.missingIds.map((id) => `Unknown id: ${id}.`)
  if (!selected.indexes.length && !selected.missingPaths.length) {
    const detail = errors.length ? ` ${errors.join(' ')}` : ''
    return `Error: missing image references for show_image. Provide reference_image_paths, reference_image_ids and/or reference_image_indexes.${detail}`
  }
  const outputDir = (ctx.runware?.outputDir ?? '').trim()
  const shown: string[] = []

  for (const index of selected.indexes) {
    const hit = resolveCatalogImageByOneBasedIndex(
      ctx.userImages,
      ctx.userImageMimes,
      ctx.userImagePaths,
      index,
    )
    if (!hit) {
      errors.push(`Catalog index ${index} not found.`)
    } else if (hit.path) {
      shown.push(hit.path)
    } else {
      const saved = await saveShownImage(hit.base64, hit.mime, outputDir)
      if ('path' in saved) shown.push(saved.path)
      else errors.push(`Could not save catalog image ${index}: ${saved.error}`)
    }
  }

  const projectRoot = (ctx.codingProjectPath || '').trim()
  for (const raw of selected.missingPaths) {
    const abs = resolveLocalImagePath(projectRoot, raw)
    if (!abs) {
      errors.push(
        `Not a usable image path: ${raw} (PNG/JPEG/WebP/GIF/BMP; a relative path needs a project folder).`,
      )
      continue
    }
    const res = await readImageFile({ path: abs }).catch(() => null)
    if (!res?.ok || !res.file?.base64?.trim()) {
      errors.push(`Could not read image: ${abs}.`)
      continue
    }
    let base64 = res.file.base64.replace(/\s+/g, '')
    let mime = res.file.mime || 'image/png'
    // Keep the original pixels unless the file would be refused once it is recalled or edited.
    if (base64.length > MAX_PROJECT_IMAGE_B64_CHARS) {
      const prepared = await prepareBase64ImageForUpload(base64, mime)
      base64 = prepared.base64
      mime = prepared.mime
    }
    if (base64.length > MAX_PROJECT_IMAGE_B64_CHARS) {
      errors.push(`Image is too large to show: ${abs}.`)
      continue
    }
    // A copy, so the chat keeps this image after a script overwrites or deletes the original.
    const baseName = (res.file.name || '').replace(/\.[^.]+$/, '')
    const saved = await saveShownImage(base64, mime, outputDir, baseName || undefined)
    if ('path' in saved) shown.push(saved.path)
    else errors.push(`Could not save a copy of ${abs}: ${saved.error}`)
  }

  if (shown.length === 0) {
    return `Error: show_image could not show any image. ${errors.join(' ')}`
  }
  await registerTurnCatalogImages(shown, ctx)
  return [
    'The image(s) are now visible to the user in the chat. Do not repeat the path as an image link.',
    ...shown.flatMap((p) => [
      `Saved image: ${p}`,
      `image_id: ${imageCatalogId({ path: p, base64: '' })}`,
    ]),
    ...errors,
  ].join('\n')
}

export const mediaHandlersRegistry: ToolHandlerRegistry = {
  ['generate_image']: withSavedImagePaths(handleGenerateImage),
  ['edit_image_runware']: withSavedImagePaths(handleEditImageRunware),
  ['image_recall']: handleImageRecall,
  ['show_image']: handleShowImage,
  ['generate_music_runware']: handleGenerateMusicRunware,
  ['generate_tts']: handleGenerateTts,
}
