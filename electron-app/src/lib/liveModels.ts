import {
  setOpenCodeGoCatalogStyles,
  type CloudLlmApiStyle,
  type CloudLlmPreset,
} from '@/lib/cloudLlmPresets'
import { opencodeGoApiBaseUrl } from '@/lib/platform'

/**
 * Live model catalogs, so new upstream models show up in the pickers without a Voidcast
 * release. The curated presets stay the "Recommended" group and the offline fallback.
 */
export type LiveCatalogProvider = 'openrouter' | 'opencode-go'

export type LiveModel = {
  id: string
  label: string
  contextTokens?: number
  /** Unix seconds; newest first in the picker. */
  created?: number
  /** OpenCode Go only: the wire format the catalog names for this model. */
  apiStyle?: CloudLlmApiStyle
}

export type LiveCatalogState = {
  models: LiveModel[]
  fetchedAt: number
  loading: boolean
  error: string | null
}

export type LiveCatalogSource = {
  openrouterBaseUrl?: string
  ttsBaseUrl?: string
  opencodeGoApiKey?: string
}

const CACHE_PREFIX = 'voidcast.liveModels.v1.'
/** A day is fresh enough for a model list; the refresh button covers "it came out an hour ago". */
export const LIVE_CATALOG_TTL_MS = 24 * 60 * 60 * 1000

export const EMPTY_LIVE_CATALOG: LiveCatalogState = {
  models: [],
  fetchedAt: 0,
  loading: false,
  error: null,
}

export function formatContextTokens(tokens: number | undefined): string {
  if (!tokens || tokens <= 0) return ''
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000
    return `${Number.isInteger(m) ? m : m.toFixed(m < 10 ? 2 : 1).replace(/\.?0+$/, '')}M`
  }
  return `${Math.round(tokens / 1000)}K`
}

function liveLabel(name: string, contextTokens: number | undefined, extra?: string): string {
  const parts = [formatContextTokens(contextTokens) && `${formatContextTokens(contextTokens)} ctx`]
  if (extra) parts.push(extra)
  const suffix = parts.filter(Boolean).join(' · ')
  return suffix ? `${name} (${suffix})` : name
}

type OpenRouterCatalogEntry = {
  id?: unknown
  name?: unknown
  created?: unknown
  context_length?: unknown
  supported_parameters?: unknown
  architecture?: { output_modalities?: unknown }
}

/**
 * OpenRouter lists hundreds of models; only the ones that answer in text and accept tools can
 * run the agent loop, so the rest would just be traps in the picker.
 */
export function parseOpenRouterCatalog(body: unknown): LiveModel[] {
  const data = (body as { data?: unknown })?.data
  if (!Array.isArray(data)) return []
  const out: LiveModel[] = []
  for (const raw of data as OpenRouterCatalogEntry[]) {
    const id = typeof raw?.id === 'string' ? raw.id.trim() : ''
    if (!id) continue
    const params = Array.isArray(raw.supported_parameters) ? raw.supported_parameters : []
    if (!params.includes('tools')) continue
    const outputs = raw.architecture?.output_modalities
    if (Array.isArray(outputs) && !outputs.includes('text')) continue
    const contextTokens = typeof raw.context_length === 'number' ? raw.context_length : undefined
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id
    out.push({
      id,
      label: liveLabel(name, contextTokens),
      contextTokens,
      created: typeof raw.created === 'number' ? raw.created : undefined,
    })
  }
  return out
}

type OpenCodeGoCatalogEntry = {
  id?: unknown
  name?: unknown
  type?: unknown
  created?: unknown
  limit?: { context?: unknown }
  api?: Record<string, unknown>
  recommended_api?: unknown
}

const OPENCODE_API_STYLES: Record<string, CloudLlmApiStyle> = {
  'chat-completions': 'openai-chat',
  messages: 'anthropic-messages',
  responses: 'opencode-responses',
}

const OPENCODE_STYLE_TAG: Record<CloudLlmApiStyle, string> = {
  'openai-chat': '',
  'anthropic-messages': 'Anthropic Messages',
  'opencode-responses': 'Responses',
}

/**
 * The Go catalog names each model's API. Embeddings, "decision" models and Google-only APIs
 * are dropped: the app speaks chat-completions, messages and responses, nothing else.
 */
export function parseOpenCodeGoCatalog(body: unknown): LiveModel[] {
  const data = (body as { data?: unknown })?.data
  if (!Array.isArray(data)) return []
  const out: LiveModel[] = []
  for (const raw of data as OpenCodeGoCatalogEntry[]) {
    const id = typeof raw?.id === 'string' ? raw.id.trim() : ''
    if (!id) continue
    if (typeof raw.type === 'string' && raw.type !== 'chat') continue
    const apis = raw.api && typeof raw.api === 'object' ? Object.keys(raw.api) : []
    // An entry without `api` predates the field: keep it and let the static rules route it.
    let apiStyle: CloudLlmApiStyle | undefined
    if (apis.length > 0) {
      const recommended =
        typeof raw.recommended_api === 'string'
          ? OPENCODE_API_STYLES[raw.recommended_api]
          : undefined
      apiStyle =
        recommended ??
        (['chat-completions', 'messages', 'responses']
          .filter((k) => apis.includes(k))
          .map((k) => OPENCODE_API_STYLES[k])[0] as CloudLlmApiStyle | undefined)
      if (!apiStyle) continue
    }
    const ctx = raw.limit?.context
    const contextTokens = typeof ctx === 'number' && ctx > 0 ? ctx : undefined
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id
    out.push({
      id,
      label: liveLabel(name, contextTokens, apiStyle ? OPENCODE_STYLE_TAG[apiStyle] : ''),
      contextTokens,
      created: typeof raw.created === 'number' ? raw.created : undefined,
      apiStyle,
    })
  }
  return out
}

/**
 * Curated presets first, under their hand-written labels; every live model the presets do not
 * already cover follows, newest first. A curated id the catalog no longer lists stays: the
 * catalog can lag, and the OpenCode feed is known to omit some models.
 */
export function mergeModelLists(
  curated: CloudLlmPreset[],
  live: LiveModel[],
): { recommended: CloudLlmPreset[]; more: CloudLlmPreset[] } {
  const known = new Set(curated.map((m) => m.id))
  const more = live
    .filter((m) => !known.has(m.id))
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || a.id.localeCompare(b.id))
    .map((m) => ({ id: m.id, label: m.label }))
  return { recommended: curated, more }
}

// ---------------------------------------------------------------------------------------------
// Store: one shared snapshot per provider, so the Agent tab, the sub-agent tab and the chat
// switcher all read the same list and a refresh in one shows up in the others.

const states = new Map<LiveCatalogProvider, LiveCatalogState>()
const listeners = new Set<() => void>()
const inflight = new Map<LiveCatalogProvider, Promise<void>>()

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function applySideEffects(provider: LiveCatalogProvider, models: LiveModel[]): void {
  if (provider !== 'opencode-go') return
  const styles = new Map<string, CloudLlmApiStyle>()
  for (const m of models) if (m.apiStyle) styles.set(m.id, m.apiStyle)
  setOpenCodeGoCatalogStyles(styles)
}

function hydrate(provider: LiveCatalogProvider): LiveCatalogState {
  const existing = states.get(provider)
  if (existing) return existing
  let state = EMPTY_LIVE_CATALOG
  const raw = storage()?.getItem(CACHE_PREFIX + provider)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { models?: LiveModel[]; fetchedAt?: number }
      if (Array.isArray(parsed.models) && typeof parsed.fetchedAt === 'number') {
        state = { ...EMPTY_LIVE_CATALOG, models: parsed.models, fetchedAt: parsed.fetchedAt }
      }
    } catch {
      // A corrupt cache only costs one refetch.
    }
  }
  states.set(provider, state)
  applySideEffects(provider, state.models)
  return state
}

function setState(provider: LiveCatalogProvider, next: LiveCatalogState): void {
  states.set(provider, next)
  for (const fn of listeners) fn()
}

export function getLiveCatalog(provider: LiveCatalogProvider): LiveCatalogState {
  return hydrate(provider)
}

export function subscribeLiveCatalogs(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Context window the live catalog reports, from memory or the on-disk cache. */
export function liveContextTokens(
  provider: LiveCatalogProvider,
  modelId: string,
): number | undefined {
  return hydrate(provider).models.find((m) => m.id === modelId)?.contextTokens
}

async function fetchCatalog(
  provider: LiveCatalogProvider,
  source: LiveCatalogSource,
  signal?: AbortSignal,
): Promise<LiveModel[]> {
  if (provider === 'openrouter') {
    const base = (source.openrouterBaseUrl || 'https://openrouter.ai/api/v1')
      .trim()
      .replace(/\/+$/, '')
    const res = await fetch(`${base}/models`, { signal })
    if (!res.ok) throw new Error(`GET /models ${res.status}`)
    return parseOpenRouterCatalog(await res.json())
  }
  // No CORS upstream: through the tools proxy, which lets the public catalog through keyless.
  const key = (source.opencodeGoApiKey || '').trim()
  const res = await fetch(`${opencodeGoApiBaseUrl(source.ttsBaseUrl)}/models`, {
    headers: key ? { Authorization: `Bearer ${key}` } : undefined,
    signal,
  })
  if (!res.ok) throw new Error(`GET /models ${res.status}`)
  return parseOpenCodeGoCatalog(await res.json())
}

/** Fetch unless the cached list is still fresh. Concurrent callers share one request. */
export function loadLiveCatalog(
  provider: LiveCatalogProvider,
  source: LiveCatalogSource,
  opts: { force?: boolean } = {},
): Promise<void> {
  const current = hydrate(provider)
  if (!opts.force && current.fetchedAt && Date.now() - current.fetchedAt < LIVE_CATALOG_TTL_MS) {
    return Promise.resolve()
  }
  const pending = inflight.get(provider)
  if (pending) return pending

  setState(provider, { ...current, loading: true, error: null })
  const run = (async () => {
    try {
      const models = await fetchCatalog(provider, source)
      if (models.length === 0) throw new Error('catalog listed no usable models')
      const fetchedAt = Date.now()
      storage()?.setItem(CACHE_PREFIX + provider, JSON.stringify({ models, fetchedAt }))
      applySideEffects(provider, models)
      setState(provider, { models, fetchedAt, loading: false, error: null })
    } catch (e) {
      // Keep the last good list; the curated presets still cover an empty one.
      setState(provider, {
        ...hydrate(provider),
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      })
    } finally {
      inflight.delete(provider)
    }
  })()
  inflight.set(provider, run)
  return run
}

export function liveCatalogProviderFor(provider: string): LiveCatalogProvider | null {
  return provider === 'openrouter' || provider === 'opencode-go' ? provider : null
}
