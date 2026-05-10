import { normalizeBaseUrl } from '@/lib/settings'

/**
 * Reddit read-only tool via TTS server `POST /tools/reddit`
 * (public Reddit JSON endpoints, no auth).
 */
export type RedditToolParams = {
  subreddit?: string
  sort?: 'hot' | 'new' | 'top' | 'rising' | 'controversial' | 'best'
  time?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all'
  limit?: number
  query?: string
  post_url?: string
  max_comments?: number
}

export async function invokeRedditTool(
  params: RedditToolParams,
  ttsBaseUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  const root = normalizeBaseUrl(ttsBaseUrl || 'http://127.0.0.1:8765')
  const body: Record<string, unknown> = {}
  if (params.subreddit?.trim()) body.subreddit = params.subreddit.trim()
  if (params.sort) body.sort = params.sort
  if (params.time) body.time = params.time
  if (typeof params.limit === 'number' && Number.isFinite(params.limit)) {
    body.limit = params.limit
  }
  if (params.query?.trim()) body.query = params.query.trim()
  if (params.post_url?.trim()) body.post_url = params.post_url.trim()
  if (
    typeof params.max_comments === 'number' &&
    Number.isFinite(params.max_comments)
  ) {
    body.max_comments = params.max_comments
  }

  const res = await fetch(`${root}/tools/reddit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    text?: string
    detail?: string
  }
  if (res.ok && data.ok && typeof data.text === 'string') {
    return data.text
  }
  if (res.ok && data.ok === false && typeof data.text === 'string') {
    // Tool-level error (bad sub / 404 / 429) — surface message to the model.
    return `Reddit tool error: ${data.text}`
  }
  const err = data.detail ?? `HTTP ${res.status}`
  throw new Error(typeof err === 'string' ? err : String(err))
}
