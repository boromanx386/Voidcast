import {
  normalizeBaseUrl,
  type Wan2gpModelConfig,
} from '@/lib/settings'

export type Wan2gpGenerateRequest = {
  prompt: string
  negativePrompt?: string
  width?: number
  height?: number
  steps?: number
  cfgScale?: number
  modelType?: string
  modelLabel?: string
  transformerQuantization?: string
  wan2gpHome: string
  /** Wan2GP init(output_dir) — uses Runware image folder when set, else Wan2GP/outputs. */
  outputDir?: string
  modelConfig?: Wan2gpModelConfig
}

export type Wan2gpGenerateResult = {
  ok: boolean
  generated_files?: string[]
  image_files?: string[]
  video_files?: string[]
  errors?: string[]
  text?: string
}

function toFileUrl(path: string): string {
  return path.replace(/\\/g, '/').replace(/^(?!file:\/\/)/, 'file:///')
}

function buildResolution(
  width: number | undefined,
  height: number | undefined,
  fallback: string,
): string {
  if (
    typeof width === 'number' &&
    width > 0 &&
    typeof height === 'number' &&
    height > 0
  ) {
    return `${Math.round(width)}x${Math.round(height)}`
  }
  return fallback
}

function buildWan2gpSettings(req: Wan2gpGenerateRequest): Record<string, unknown> {
  const cfg = req.modelConfig
  const resolution = buildResolution(
    req.width,
    req.height,
    cfg?.default_resolution ?? '1024x1024',
  )
  const settings: Record<string, unknown> = {
    model_type: req.modelType,
    prompt: req.prompt,
    resolution,
    image_mode: cfg?.image_mode ?? 1,
    num_inference_steps: req.steps,
    transformer_quantization: req.transformerQuantization,
  }
  if (req.negativePrompt?.trim()) {
    settings.negative_prompt = req.negativePrompt.trim()
  }
  if (typeof req.cfgScale === 'number' && Number.isFinite(req.cfgScale)) {
    const field = cfg?.cfg_field ?? 'guidance_scale'
    settings[field] = req.cfgScale
  }
  return settings
}

function formatWan2gpImageToolResult(payload: {
  imageFiles: string[]
  model: string
  prompt: string
  resolution: string
  steps?: number
  cfgScale?: number
}): string {
  if (payload.imageFiles.length === 0) {
    throw new Error(
      'Wan2GP finished but returned no image files. Check image_mode and model settings.',
    )
  }
  const lines = [
    'Wan2GP image generated successfully.',
    `model: ${payload.model}`,
    `size: ${payload.resolution}`,
  ]
  const compactPrompt = payload.prompt.replace(/\s+/g, ' ').trim()
  if (compactPrompt) lines.push(`prompt: ${compactPrompt}`)
  if (typeof payload.steps === 'number') lines.push(`steps: ${payload.steps}`)
  if (typeof payload.cfgScale === 'number') lines.push(`cfg_scale: ${payload.cfgScale}`)
  for (const f of payload.imageFiles) {
    lines.push(`Saved image: ${f}`)
  }
  return lines.join('\n')
}

function formatWan2gpVideoToolResult(payload: {
  videoFiles: string[]
  model: string
  prompt: string
}): string {
  if (payload.videoFiles.length === 0) {
    throw new Error('Wan2GP finished but returned no video files.')
  }
  const lines = [
    'Wan2GP video generated successfully.',
    `model: ${payload.model}`,
    `prompt: ${payload.prompt.replace(/\s+/g, ' ').trim()}`,
  ]
  for (const f of payload.videoFiles) {
    lines.push(`video_url: ${toFileUrl(f)}`)
  }
  return lines.join('\n')
}

/**
 * Call the Voidcast tools-server Wan2GP bridge.
 * The bridge spawns Wan2GP's venv Python as a subprocess.
 */
export async function invokeWan2gpGenerate(
  req: Wan2gpGenerateRequest,
  ttsBaseUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  const cfg = req.modelConfig
  const resolution = buildResolution(
    req.width,
    req.height,
    cfg?.default_resolution ?? '1024x1024',
  )
  const base = normalizeBaseUrl(ttsBaseUrl)
  const url = `${base}/tools/wan2gp`

  const outputDir =
    req.outputDir?.trim() ||
    `${req.wan2gpHome.replace(/[/\\]+$/, '')}\\outputs`

  const body: Record<string, unknown> = {
    wan2gp_home: req.wan2gpHome,
    output_dir: outputDir,
    settings: buildWan2gpSettings(req),
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Wan2GP bridge returned HTTP ${resp.status}: ${text}`)
  }

  const data: Wan2gpGenerateResult = await resp.json()
  const imageFiles = data.image_files ?? []

  if (!data.ok && imageFiles.length === 0) {
    const errors = data.errors?.join('; ') || data.text || 'Unknown Wan2GP error'
    throw new Error(`Wan2GP generation failed: ${errors}`)
  }
  const videoFiles = data.video_files ?? []
  const modelLabel = req.modelLabel?.trim() || req.modelType || 'wan2gp'
  const mediaKind = cfg?.media_kind ?? 'image'

  if (mediaKind === 'image') {
    return formatWan2gpImageToolResult({
      imageFiles,
      model: modelLabel,
      prompt: req.prompt,
      resolution,
      steps: req.steps,
      cfgScale: req.cfgScale,
    })
  }

  return formatWan2gpVideoToolResult({
    videoFiles,
    model: modelLabel,
    prompt: req.prompt,
  })
}
