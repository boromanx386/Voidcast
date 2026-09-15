import {
  invokeRunwareEditImage,
  invokeRunwareGenerateImage,
  invokeRunwareGenerateMusic,
} from "@/lib/runware";
import {
  invokeOpenRouterEditImage,
  invokeOpenRouterGenerateImage,
} from "@/lib/openrouterImage";
import { cacheEntriesFromDescribeResults } from "@/lib/imageVisionCache";
import {
  describeImagesWithSubAgent,
  formatSubAgentResultsForAgent,
} from "@/lib/subAgent";
import { resolveImageRecallRequest } from "@/lib/toolHandlers/imageRecall";
import {
  parseImageIndexes,
  parseImagePaths,
  pickImageByOneBasedIndex,
  resolveReferenceImageIndexes,
  userRequestedCfgOverride,
  userRequestedStepsOverride,
  type ImageRecallToolResult,
} from "@/lib/toolHandlers/helpers";
import type { ToolHandlerFn, ToolHandlerRegistry } from "@/lib/toolExecTypes";
import { synthesizeSpeech } from "@/lib/tts";
import { invokeSaveAudioBytes } from "@/lib/saveAudio";
import {
  extensionFromAudioMime,
  validateProjectRelativeAudioPath,
} from "@/lib/generatedAssetPath";
import { isElectron, isWebStandalone } from "@/lib/platform";
import { sanitizeForTts } from "@/lib/chatHints";

const MAX_TTS_TOOL_CHARS = 8_000;

export const handleGenerateImage: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.runwareImage) {
    return "Error: generate_image tool is disabled in settings.";
  }
  if (!ctx.runware) {
    return "Error: image settings are missing.";
  }
  const prompt =
    typeof args.prompt === "string"
      ? args.prompt.trim()
      : typeof args.positivePrompt === "string"
        ? args.positivePrompt.trim()
        : "";
  if (!prompt) return "Error: missing prompt parameter for generate_image.";
  const canOverrideSteps = userRequestedStepsOverride(ctx.userText || "");
  const canOverrideCfg = userRequestedCfgOverride(ctx.userText || "");
  try {
    if (ctx.runware.imageProvider === "openrouter") {
      const or = ctx.runware.openrouter;
      if (!or) return "Error: OpenRouter image settings are missing.";
      return await invokeOpenRouterGenerateImage(
        { prompt },
        {
          apiKey: or.apiKey,
          baseUrl: or.baseUrl,
          model: or.model,
          width: ctx.runware.width,
          height: ctx.runware.height,
          gptQuality: ctx.runware.gptQuality,
          proxyBaseUrl: ctx.runware.proxyBaseUrl || ctx.ttsBaseUrl,
        },
        ctx.signal,
      );
    }
    return await invokeRunwareGenerateImage(
      {
        prompt,
        negativePrompt:
          typeof args.negative_prompt === "string"
            ? args.negative_prompt
            : typeof args.negativePrompt === "string"
              ? args.negativePrompt
              : undefined,
        width: typeof args.width === "number" ? args.width : undefined,
        height: typeof args.height === "number" ? args.height : undefined,
        steps:
          canOverrideSteps && typeof args.steps === "number"
            ? args.steps
            : undefined,
        cfgScale:
          canOverrideCfg && typeof args.cfg_scale === "number"
            ? args.cfg_scale
            : canOverrideCfg && typeof args.cfgScale === "number"
              ? args.cfgScale
              : undefined,
        model: typeof args.model === "string" ? args.model : undefined,
      },
      ctx.runware,
      ctx.signal,
    );
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

export const handleEditImageRunware: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.runwareImage) {
    return "Error: edit_image_runware tool is disabled in settings.";
  }
  if (!ctx.runware) {
    return "Error: image settings are missing.";
  }
  const prompt =
    typeof args.prompt === "string"
      ? args.prompt.trim()
      : typeof args.positivePrompt === "string"
        ? args.positivePrompt.trim()
        : "";
  if (!prompt) return "Error: missing prompt parameter for edit_image_runware.";
  const canOverrideSteps = userRequestedStepsOverride(ctx.userText || "");
  const canOverrideCfg = userRequestedCfgOverride(ctx.userText || "");
  const selected = resolveReferenceImageIndexes(args, ctx.userImagePaths);
  const indexes = selected.indexes;
  if (!indexes.length) {
    return 'Error: missing image references for edit_image_runware. Provide reference_image_indexes (e.g. "1" or "1,2") and/or reference_image_paths.';
  }
  const refs = indexes
    .map((i) => pickImageByOneBasedIndex(ctx.userImages, ctx.userImageMimes, i))
    .filter((x): x is string => typeof x === "string" && x.length > 0);
  if (!refs.length) {
    const max = ctx.userImages?.length ?? 0;
    const missing = selected.missingPaths.length
      ? ` Missing paths: ${selected.missingPaths.join(" | ")}.`
      : "";
    return `Error: no valid reference images resolved from provided indexes/paths. Available image count: ${max}.${missing}`;
  }
  try {
    if (ctx.runware.imageProvider === "openrouter") {
      const or = ctx.runware.openrouter;
      if (!or) return "Error: OpenRouter image settings are missing.";
      const editW = ctx.runware.editDefaults?.width ?? ctx.runware.width;
      const editH = ctx.runware.editDefaults?.height ?? ctx.runware.height;
      return await invokeOpenRouterEditImage(
        { prompt, referenceImages: refs },
        {
          apiKey: or.apiKey,
          baseUrl: or.baseUrl,
          model: or.model,
          width: editW,
          height: editH,
          gptQuality:
            ctx.runware.editDefaults?.gptQuality ?? ctx.runware.gptQuality,
          proxyBaseUrl: ctx.runware.proxyBaseUrl || ctx.ttsBaseUrl,
        },
        ctx.signal,
      );
    }
    return await invokeRunwareEditImage(
      {
        prompt,
        referenceImages: refs,
        negativePrompt:
          typeof args.negative_prompt === "string"
            ? args.negative_prompt
            : typeof args.negativePrompt === "string"
              ? args.negativePrompt
              : undefined,
        width: typeof args.width === "number" ? args.width : undefined,
        height: typeof args.height === "number" ? args.height : undefined,
        steps:
          canOverrideSteps && typeof args.steps === "number"
            ? args.steps
            : undefined,
        cfgScale:
          canOverrideCfg && typeof args.cfg_scale === "number"
            ? args.cfg_scale
            : canOverrideCfg && typeof args.cfgScale === "number"
              ? args.cfgScale
              : undefined,
        model: typeof args.model === "string" ? args.model : undefined,
      },
      ctx.runware,
      ctx.signal,
    );
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

export const handleImageRecall: ToolHandlerFn = async (args, ctx) => {
  const selected = resolveReferenceImageIndexes(args, ctx.userImagePaths);
  const requestedPaths = parseImagePaths(args.reference_image_paths);
  if (
    !selected.indexes.length &&
    !requestedPaths.length &&
    !parseImageIndexes(args.reference_image_indexes).length
  ) {
    return "Error: missing image references for image_recall. Provide reference_image_indexes and/or reference_image_paths.";
  }
  const recall = await resolveImageRecallRequest(args, ctx, {
    codingEnabled: ctx.toolsEnabled.coding,
  });
  if (!recall.recalled.length) {
    const max = recall.maxAvailable;
    const detail = recall.errors.length ? ` ${recall.errors.join(" ")}` : "";
    return `Error: image_recall could not resolve any requested images. Available catalog image count: ${max}.${detail}`;
  }

  // ── Sub-agent (Predlog 1): describe images via separate model ──
  const subAgentConfig = ctx.subAgent;
  const useSubAgent =
    subAgentConfig?.enabled &&
    recall.purpose !== "edit" && // edit needs actual base64
    recall.recalled.length > 0;

  if (useSubAgent) {
    const recalledForCache = recall.recalled.map((img) => ({
      base64: img.base64,
      mime: img.mime,
      path: img.path,
      index: img.index,
    }));
    const descriptions = await describeImagesWithSubAgent(
      recalledForCache,
      subAgentConfig,
      {
        ollamaBaseUrl: ctx.ollamaBaseUrl || "http://localhost:11434",
        openrouterBaseUrl:
          ctx.openrouterBaseUrl || "https://openrouter.ai/api/v1",
        openrouterApiKey: ctx.openrouterApiKey || "",
        deepseekBaseUrl: ctx.deepseekBaseUrl || "https://api.deepseek.com",
        deepseekApiKey: ctx.deepseekApiKey || "",
        openaiBaseUrl: ctx.openaiBaseUrl || "https://api.openai.com/v1",
        openaiApiKey: ctx.openaiApiKey || "",
        nvidiaBaseUrl: ctx.nvidiaBaseUrl || "https://integrate.api.nvidia.com/v1",
        nvidiaApiKey: ctx.nvidiaApiKey || "",
        opencodeGoApiKey: ctx.opencodeGoApiKey || "",
        ttsBaseUrl: ctx.ttsBaseUrl,
      },
      ctx.userText,
      ctx.signal,
      ctx.subAgentUi,
      ctx.imageVisionCache,
      recall.focus,
    );
    const newEntries = cacheEntriesFromDescribeResults(
      recalledForCache,
      descriptions,
      recall.focus,
    );
    if (Object.keys(newEntries).length > 0) {
      ctx.onImageVisionCacheUpdate?.(newEntries);
    }
    const formatted = formatSubAgentResultsForAgent(descriptions);
    const hasCatalog = recall.recalled.some(
      (x) => x.recallSource === "catalog",
    );
    const hasProject = recall.recalled.some(
      (x) => x.recallSource === "project_file",
    );
    const source: ImageRecallToolResult["source"] =
      hasCatalog && hasProject
        ? "mixed"
        : hasProject
          ? "project_file"
          : "internal_catalog";
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
    };
    const subNote = formatted
      ? `\n\n${formatted}`
      : "\n\n[Sub-agent returned no descriptions.]";
    return JSON.stringify(payload) + subNote;
  }

  // ── Standard path: return metadata (base64 handled by collectRecalledImages) ──
  const hasCatalog = recall.recalled.some((x) => x.recallSource === "catalog");
  const hasProject = recall.recalled.some(
    (x) => x.recallSource === "project_file",
  );
  const source: ImageRecallToolResult["source"] =
    hasCatalog && hasProject
      ? "mixed"
      : hasProject
        ? "project_file"
        : "internal_catalog";
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
  };
  return JSON.stringify(payload);
};

export const handleGenerateMusicRunware: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.runwareMusic) {
    return "Error: generate_music_runware tool is disabled in settings.";
  }
  if (!ctx.runware) {
    return "Error: Runware settings are missing.";
  }
  const prompt =
    typeof args.prompt === "string"
      ? args.prompt.trim()
      : typeof args.positivePrompt === "string"
        ? args.positivePrompt.trim()
        : "";
  if (!prompt)
    return "Error: missing prompt parameter for generate_music_runware.";
  try {
    // Audio engine tuning (steps, cfg_scale, output_format, seed, guidance_type) is intentionally
    // sourced from settings only; any values the model attempts to send in tool args are ignored.
    return await invokeRunwareGenerateMusic(
      {
        prompt,
        negativePrompt:
          typeof args.negative_prompt === "string"
            ? args.negative_prompt
            : typeof args.negativePrompt === "string"
              ? args.negativePrompt
              : undefined,
        lyrics: typeof args.lyrics === "string" ? args.lyrics : undefined,
        durationSec:
          typeof args.duration_sec === "number"
            ? args.duration_sec
            : typeof args.durationSec === "number"
              ? args.durationSec
              : undefined,
        bpm: typeof args.bpm === "number" ? args.bpm : undefined,
        keyScale:
          typeof args.key_scale === "string"
            ? args.key_scale
            : typeof args.keyScale === "string"
              ? args.keyScale
              : undefined,
        vocalLanguage:
          typeof args.vocal_language === "string"
            ? args.vocal_language
            : typeof args.vocalLanguage === "string"
              ? args.vocalLanguage
              : undefined,
      },
      ctx.runware,
      ctx.signal,
    );
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

export const handleGenerateTts: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.tts) {
    return "Error: generate_tts tool is disabled in settings.";
  }
  if (!isElectron()) {
    return "Error: generate_tts is only available in the desktop app (Electron).";
  }
  const tts = ctx.tts;
  if (!tts) {
    return "Error: TTS settings are missing for this turn.";
  }
  const rawText =
    typeof args.text === "string"
      ? args.text
      : typeof args.prompt === "string"
        ? args.prompt
        : "";
  const spoken = sanitizeForTts(rawText).trim();
  if (!spoken) return "Error: missing text parameter for generate_tts.";
  if (spoken.length > MAX_TTS_TOOL_CHARS) {
    return `Error: text is too long for generate_tts (max ${MAX_TTS_TOOL_CHARS} characters).`;
  }

  const outputPathRaw =
    typeof args.output_path === "string"
      ? args.output_path.trim()
      : typeof args.outputPath === "string"
        ? args.outputPath.trim()
        : "";
  const filenameRaw =
    typeof args.filename === "string"
      ? args.filename.trim()
      : typeof args.file_name === "string"
        ? args.file_name.trim()
        : "";
  const voiceInstructOverride =
    typeof args.voice_instruct === "string"
      ? args.voice_instruct.trim()
      : typeof args.voiceInstruct === "string"
        ? args.voiceInstruct.trim()
        : "";

  let relativePath: string | undefined;
  if (outputPathRaw) {
    const projectPath = (ctx.codingProjectPath || "").trim();
    if (!projectPath) {
      return "Error: output_path requires a coding project folder (Options → Tools).";
    }
    const validated = validateProjectRelativeAudioPath(outputPathRaw);
    if (!validated.ok) return `Error: ${validated.error}`;
    relativePath = validated.relativePath;
  }

  const voiceMode =
    tts.ttsProvider === "local"
      ? isWebStandalone()
        ? "design"
        : tts.voiceMode
      : "design";
  if (
    voiceMode === "clone" &&
    (!tts.cloneRef?.blob || tts.cloneRef.blob.size === 0)
  ) {
    return "Error: VOICE_CLONE is selected but no reference audio is loaded (Options → TTS/STT).";
  }

  const instruct =
    voiceInstructOverride ||
    (voiceMode === "design" ? tts.voiceInstruct : undefined) ||
    undefined;
  const positivePrompt =
    voiceInstructOverride || tts.runwarePositivePrompt || undefined;

  const started = Date.now();
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
      cloneRef: isWebStandalone() ? null : tts.cloneRef ?? null,
      cloneRefText: isWebStandalone() ? null : tts.cloneRefText ?? null,
      voiceAnchor: tts.voiceAnchor ?? null,
      signal: ctx.signal,
    });
    if (!blob || blob.size === 0) {
      return "Error: TTS returned empty audio.";
    }
    const mime = blob.type || "audio/mpeg";
    const bytes = await blob.arrayBuffer();
    const projectPath = (ctx.codingProjectPath || "").trim();
    const saved = await invokeSaveAudioBytes({
      bytes,
      mime,
      filename: filenameRaw || undefined,
      ...(relativePath
        ? { projectPath, relativePath }
        : {}),
    });
    if (!saved.ok || !saved.path) {
      return `Error: failed to save TTS audio. ${saved.text || ""}`.trim();
    }
    const elapsedMs = Date.now() - started;
    const model =
      tts.ttsProvider === "openrouter-tts"
        ? tts.openrouterTtsModel || ""
        : tts.ttsProvider === "runware-xai"
          ? tts.runwareTtsModel || ""
          : "local-omnivoice";
    const compact = spoken.replace(/\s+/g, " ").trim();
    const promptPreview =
      compact.length > 240 ? `${compact.slice(0, 240)}…` : compact;
    const lines = [
      "TTS audio generated successfully.",
      `audio_path: ${saved.path}`,
      `provider: ${tts.ttsProvider}`,
      `output_format: ${extensionFromAudioMime(mime).replace(".", "").toUpperCase()}`,
    ];
    if (saved.relativePath) lines.push(`audio_rel_path: ${saved.relativePath}`);
    if (model) lines.push(`model: ${model}`);
    if (promptPreview) lines.push(`prompt: ${promptPreview}`);
    lines.push(`elapsed_ms: ${Math.max(0, Math.round(elapsedMs))}`);
    return lines.join("\n");
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

export const mediaHandlersRegistry: ToolHandlerRegistry = {
  ["generate_image"]: handleGenerateImage,
  ["edit_image_runware"]: handleEditImageRunware,
  ["image_recall"]: handleImageRecall,
  ["generate_music_runware"]: handleGenerateMusicRunware,
  ["generate_tts"]: handleGenerateTts,
};
