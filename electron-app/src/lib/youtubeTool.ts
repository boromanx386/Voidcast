import { normalizeBaseUrl } from '@/lib/settings'

/**
 * YouTube search / video info / captions via TTS server `POST /tools/youtube`.
 */
export async function invokeYoutubeTool(
  params: {
    query?: string
    video_url?: string
    get_transcript?: boolean
    max_results?: number
  },
  ttsBaseUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  const root = normalizeBaseUrl(ttsBaseUrl || 'http://127.0.0.1:8765')
  const res = await fetch(`${root}/tools/youtube`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: params.query?.trim() || null,
      video_url: params.video_url?.trim() || null,
      get_transcript: Boolean(params.get_transcript),
      max_results: params.max_results ?? 5,
    }),
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
  const err = data.detail ?? `HTTP ${res.status}`
  throw new Error(typeof err === 'string' ? err : String(err))
}
