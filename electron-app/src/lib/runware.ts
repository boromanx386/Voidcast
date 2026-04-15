import { normalizeBaseUrl } from '@/lib/settings'

export type RunwareImageConfig = {
  apiBaseUrl: string
  apiKey: string
  /** Optional local proxy base URL (e.g. TTS server) for CORS-safe forwarding. */
  proxyBaseUrl?: string
  model: string
  width: number
  height: number
  steps: number
  cfgScale: number
  negativePrompt?: string
}

export type RunwareImageRequest = {
  prompt: string
  negativePrompt?: string
  width?: number
  height?: number
  steps?: number
  cfgScale?: number
  model?: string
}

type RunwareInferenceResult = {
  imageURL?: string
  seed?: number
  taskUUID?: string
  imageUUID?: string
  cost?: number
}

type RunwareModelSearchResult = {
  air?: string
  model?: string
  name?: string
  category?: string
  type?: string
  architecture?: string
  tags?: string[]
  capabilities?: string[] | string
}

export type RunwareModelOption = {
  id: string
  label: string
}

function normalizeStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim())
      .filter(Boolean)
  }
  if (typeof v === 'string' && v.trim()) return [v.trim()]
  return []
}

function isDesiredImageBaseModel(item: RunwareModelSearchResult): boolean {
  const id = (item.air || item.model || '').trim().toLowerCase()
  const name = (item.name || '').trim().toLowerCase()
  const category = (item.category || '').trim().toLowerCase()
  const type = (item.type || '').trim().toLowerCase()
  const architecture = (item.architecture || '').trim().toLowerCase()
  const tags = normalizeStringArray(item.tags).join(' ').toLowerCase()
  const capabilities = normalizeStringArray(item.capabilities).join(' ').toLowerCase()
  const hay = [id, name, category, type, architecture, tags, capabilities].join(' ')

  if (id.startsWith('civitai:')) return false

  const rejectTerms = [
    'lora',
    'lycoris',
    'embedding',
    'textual inversion',
    'controlnet',
    'vae',
    'upscale',
    'caption',
    'remove background',
  ]
  if (rejectTerms.some((t) => hay.includes(t))) return false

  if (capabilities.includes('text to image')) return true
  if (capabilities.includes('image generation')) return true
  if (type === 'base') return true
  if (category === 'checkpoint') return true

  const preferredHints = [
    'qwen-image',
    'z-image',
    'flux',
    'imagen',
    'gpt image',
    'ideogram',
    'seedream',
    'hidream',
    'recraft',
  ]
  return preferredHints.some((t) => hay.includes(t))
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function asFiniteNumber(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return v
}

function makeTaskUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `rw-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

type RunwareApiBody = {
  data?: Array<{
    results?: RunwareModelSearchResult[]
    imageURL?: string
    seed?: number
    taskUUID?: string
    imageUUID?: string
    cost?: number
  }>
  errors?: Array<{ message?: string }>
  message?: string
  error?: string
}

function readRunwareError(body: RunwareApiBody, status?: number): string {
  return (
    body.errors?.[0]?.message ||
    body.message ||
    body.error ||
    (typeof status === 'number' ? `Runware HTTP ${status}` : 'Runware request failed')
  )
}

function looksLikeNetworkFetchError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const msg = e.message.toLowerCase()
  return msg.includes('failed to fetch') || msg.includes('networkerror')
}

async function postRunwareTasks(args: {
  apiBaseUrl: string
  apiKey: string
  tasks: unknown[]
  signal?: AbortSignal
  proxyBaseUrl?: string
}): Promise<RunwareApiBody> {
  const directRoot = normalizeBaseUrl(args.apiBaseUrl || 'https://api.runware.ai/v1')
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${args.apiKey}`,
  }
  const bodyText = JSON.stringify(args.tasks)

  try {
    const res = await fetch(directRoot, {
      method: 'POST',
      headers,
      body: bodyText,
      signal: args.signal,
    })
    const body = (await res.json().catch(() => ({}))) as RunwareApiBody
    if (!res.ok) throw new Error(readRunwareError(body, res.status))
    return body
  } catch (e) {
    if (!args.proxyBaseUrl || !looksLikeNetworkFetchError(e)) {
      throw e instanceof Error ? e : new Error(String(e))
    }
    const proxyRoot = normalizeBaseUrl(args.proxyBaseUrl)
    const proxyRes = await fetch(`${proxyRoot}/tools/runware_proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_base_url: directRoot,
        api_key: args.apiKey,
        tasks: args.tasks,
      }),
      signal: args.signal,
    })
    const proxyBody = (await proxyRes.json().catch(() => ({}))) as {
      ok?: boolean
      data?: RunwareApiBody
      detail?: string
    }
    if (!proxyRes.ok || !proxyBody.ok || !proxyBody.data) {
      const detail = proxyBody.detail || `Runware proxy HTTP ${proxyRes.status}`
      throw new Error(detail)
    }
    return proxyBody.data
  }
}

function extractModelIdsFromRunwareBody(body: RunwareApiBody): string[] {
  const dataItems = Array.isArray(body.data) ? body.data : []
  const nestedResults = dataItems.flatMap((d) =>
    Array.isArray(d.results) ? d.results : [],
  )
  const directResults = dataItems as RunwareModelSearchResult[]
  const allCandidates = [...nestedResults, ...directResults].filter(isDesiredImageBaseModel)
  const ids = allCandidates
    .map((x) => (x.air || x.model || '').trim())
    .filter((x) => x.length > 0)
  return Array.from(new Set(ids))
}

function extractModelOptionsFromRunwareBody(body: RunwareApiBody): RunwareModelOption[] {
  const dataItems = Array.isArray(body.data) ? body.data : []
  const nestedResults = dataItems.flatMap((d) =>
    Array.isArray(d.results) ? d.results : [],
  )
  const directResults = dataItems as RunwareModelSearchResult[]
  const allCandidates = [...nestedResults, ...directResults].filter(isDesiredImageBaseModel)
  const byId = new Map<string, RunwareModelOption>()
  for (const item of allCandidates) {
    const id = (item.air || item.model || '').trim()
    if (!id) continue
    const name = (item.name || '').trim()
    const label = name ? `${name} (${id})` : id
    if (!byId.has(id)) byId.set(id, { id, label })
  }
  return Array.from(byId.values())
}

export async function fetchRunwareImageModels(options: {
  apiBaseUrl: string
  apiKey: string
  proxyBaseUrl?: string
  search?: string
  limit?: number
  signal?: AbortSignal
}): Promise<string[]> {
  const apiKey = (options.apiKey || '').trim()
  if (!apiKey) {
    throw new Error('Runware API key is required to load models.')
  }
  const root = normalizeBaseUrl(options.apiBaseUrl || 'https://api.runware.ai/v1')
  const search = (options.search || 'image').trim()
  const limit = clamp(Math.round(options.limit ?? 100), 1, 100)
  const queries = Array.from(
    new Set(
      [
        search,
        'qwen-image',
        'z-image',
        'flux',
        'imagen',
        'gpt image',
        'ideogram',
        'runware',
      ].filter(Boolean),
    ),
  )
  const merged: string[] = []

  for (const q of queries) {
    const taskVariants: Array<Record<string, unknown>> = [
      {
        taskType: 'modelSearch',
        taskUUID: makeTaskUuid(),
        search: q,
        type: 'base',
        limit,
        offset: 0,
      },
      {
        taskType: 'modelSearch',
        taskUUID: makeTaskUuid(),
        search: q,
        category: 'checkpoint',
        limit,
        offset: 0,
      },
      {
        taskType: 'modelSearch',
        taskUUID: makeTaskUuid(),
        search: q,
        category: 'checkpoint',
        visibility: 'public',
        limit,
        offset: 0,
      },
    ]

    for (const task of taskVariants) {
      try {
        const body = await postRunwareTasks({
          apiBaseUrl: root,
          apiKey,
          tasks: [task],
          signal: options.signal,
          proxyBaseUrl: options.proxyBaseUrl,
        })
        merged.push(...extractModelIdsFromRunwareBody(body))
        if (merged.length >= 80) break
      } catch {
        // Try next variant/query; we intentionally avoid failing fast here.
      }
    }
    if (merged.length >= 80) break
  }
  return Array.from(new Set(merged))
}

export async function fetchRunwareImageModelOptions(options: {
  apiBaseUrl: string
  apiKey: string
  proxyBaseUrl?: string
  search?: string
  limit?: number
  signal?: AbortSignal
}): Promise<RunwareModelOption[]> {
  const apiKey = (options.apiKey || '').trim()
  if (!apiKey) {
    throw new Error('Runware API key is required to load models.')
  }
  const root = normalizeBaseUrl(options.apiBaseUrl || 'https://api.runware.ai/v1')
  const search = (options.search || 'image').trim()
  const limit = clamp(Math.round(options.limit ?? 100), 1, 100)
  const queries = Array.from(
    new Set(
      [
        search,
        'qwen-image',
        'z-image',
        'flux',
        'imagen',
        'gpt image',
        'ideogram',
        'runware',
      ].filter(Boolean),
    ),
  )
  const merged: RunwareModelOption[] = []
  const seen = new Set<string>()

  for (const q of queries) {
    const taskVariants: Array<Record<string, unknown>> = [
      {
        taskType: 'modelSearch',
        taskUUID: makeTaskUuid(),
        search: q,
        type: 'base',
        limit,
        offset: 0,
      },
      {
        taskType: 'modelSearch',
        taskUUID: makeTaskUuid(),
        search: q,
        category: 'checkpoint',
        limit,
        offset: 0,
      },
      {
        taskType: 'modelSearch',
        taskUUID: makeTaskUuid(),
        search: q,
        category: 'checkpoint',
        visibility: 'public',
        limit,
        offset: 0,
      },
    ]
    for (const task of taskVariants) {
      try {
        const body = await postRunwareTasks({
          apiBaseUrl: root,
          apiKey,
          tasks: [task],
          signal: options.signal,
          proxyBaseUrl: options.proxyBaseUrl,
        })
        const optionsFromBody = extractModelOptionsFromRunwareBody(body)
        for (const opt of optionsFromBody) {
          if (!seen.has(opt.id)) {
            seen.add(opt.id)
            merged.push(opt)
          }
        }
        if (merged.length >= 80) break
      } catch {
        // Ignore one variant and continue to maximize chance of success.
      }
    }
    if (merged.length >= 80) break
  }
  return merged
}

function formatRunwareToolResult(payload: {
  imageUrl: string
  model: string
  width: number
  height: number
  steps: number
  cfgScale: number
  seed?: number
  taskUUID?: string
  imageUUID?: string
  cost?: number
}): string {
  const lines = [
    'Runware image generated successfully.',
    `image_url: ${payload.imageUrl}`,
    `model: ${payload.model}`,
    `size: ${payload.width}x${payload.height}`,
    `steps: ${payload.steps}`,
    `cfg_scale: ${payload.cfgScale}`,
  ]
  if (typeof payload.seed === 'number') lines.push(`seed: ${payload.seed}`)
  if (payload.taskUUID) lines.push(`task_uuid: ${payload.taskUUID}`)
  if (payload.imageUUID) lines.push(`image_uuid: ${payload.imageUUID}`)
  if (typeof payload.cost === 'number' && Number.isFinite(payload.cost)) {
    lines.push(`cost_usd: ${payload.cost.toFixed(6)}`)
  }
  return lines.join('\n')
}

export async function invokeRunwareImage(
  req: RunwareImageRequest,
  config: RunwareImageConfig,
  signal?: AbortSignal,
): Promise<string> {
  const prompt = (req.prompt || '').trim()
  if (!prompt) throw new Error('Runware generate_image requires a non-empty prompt.')
  const apiKey = (config.apiKey || '').trim()
  if (!apiKey) throw new Error('Runware API key is not set. Configure it in Options -> Runware.')

  const root = normalizeBaseUrl(config.apiBaseUrl || 'https://api.runware.ai/v1')
  const model = (req.model || config.model || '').trim()
  if (!model) throw new Error('Runware model is not set. Configure it in Options -> Runware.')

  const width = clamp(Math.round(asFiniteNumber(req.width) ?? config.width), 256, 2048)
  const height = clamp(Math.round(asFiniteNumber(req.height) ?? config.height), 256, 2048)
  const steps = clamp(Math.round(asFiniteNumber(req.steps) ?? config.steps), 1, 80)
  const cfgScale = clamp(asFiniteNumber(req.cfgScale) ?? config.cfgScale, 0, 30)
  const negativePrompt = (req.negativePrompt ?? config.negativePrompt ?? '').trim()
  const taskUUID = makeTaskUuid()

  const payload: Record<string, unknown> = {
    taskType: 'imageInference',
    taskUUID,
    includeCost: true,
    model,
    positivePrompt: prompt,
    width,
    height,
    steps,
    CFGScale: cfgScale,
  }
  if (negativePrompt) payload.negativePrompt = negativePrompt

  const body = await postRunwareTasks({
    apiBaseUrl: root,
    apiKey,
    tasks: [payload],
    signal,
    proxyBaseUrl: config.proxyBaseUrl,
  })

  const first = Array.isArray(body.data) ? body.data[0] : undefined
  const imageUrl = first?.imageURL?.trim()
  if (!imageUrl) {
    const errMessage = readRunwareError(body) || 'Runware returned no image URL.'
    throw new Error(errMessage)
  }

  return formatRunwareToolResult({
    imageUrl,
    model,
    width,
    height,
    steps,
    cfgScale,
    seed: first?.seed,
    taskUUID: first?.taskUUID,
    imageUUID: first?.imageUUID,
    cost: first?.cost,
  })
}
