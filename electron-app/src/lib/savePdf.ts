import { normalizeBaseUrl } from '@/lib/settings'

export type SavePdfResult = {
  ok: boolean
  text: string
  file_path?: string
}

export type SavePdfOptions = {
  ttsBaseUrl: string
  content: string
  title?: string
  filename?: string
  outputDir: string
  /** Base64 + optional MIME; from the current user message when saving chat images. */
  images?: { mime?: string; base64: string }[]
  /**
   * Public http(s) URLs of additional images to embed (PNG/JPEG/WebP). Used for
   * AI-generated images that only exist as a CDN URL in this turn (e.g. the
   * `image_url:` line returned by `generate_image` / `edit_image_runware`).
   */
  imageUrls?: string[]
  /** Absolute local image paths (read on the tools server host). */
  imagePaths?: string[]
  signal?: AbortSignal
}

/**
 * POST `${ttsBaseUrl}/tools/pdf` and return a user-facing message string.
 *
 * The PDF is rendered by the Python tools server (ReportLab) and written
 * directly into `outputDir` on the host where that server is running.
 */
export async function invokeSavePdf(opts: SavePdfOptions): Promise<string> {
  const root = normalizeBaseUrl(opts.ttsBaseUrl || 'http://127.0.0.1:8765')

  if (!opts.content?.trim()) {
    throw new Error('Empty content')
  }
  if (!opts.outputDir?.trim()) {
    throw new Error(
      'No PDF folder configured. Set it in Options → Tools → Save as PDF (folder path).',
    )
  }

  const cleanUrls = opts.imageUrls
    ?.map((u) => (typeof u === 'string' ? u.trim() : ''))
    .filter((u) => /^https?:\/\//i.test(u))

  const cleanPaths = opts.imagePaths
    ?.map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)

  const body = {
    content: opts.content,
    title: opts.title?.trim() || undefined,
    filename: opts.filename?.trim() || undefined,
    output_dir: opts.outputDir,
    images: opts.images?.length ? opts.images : undefined,
    image_urls: cleanUrls?.length ? cleanUrls : undefined,
    image_paths: cleanPaths?.length ? cleanPaths : undefined,
  }

  let res: Response
  try {
    res = await fetch(`${root}/tools/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    })
  } catch (e) {
    throw new Error(
      `Could not reach the tools server at ${root}/tools/pdf. ` +
        'Start the Voidcast tools server (or check the TTS base URL in Options). ' +
        `Underlying error: ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  let data: SavePdfResult & { detail?: string } = { ok: false, text: '' }
  try {
    data = (await res.json()) as typeof data
  } catch {
    /* fall through with empty data */
  }

  if (!res.ok) {
    const detail =
      (typeof data?.detail === 'string' && data.detail) ||
      (typeof data?.text === 'string' && data.text) ||
      `HTTP ${res.status}`
    throw new Error(`PDF render failed: ${detail}`)
  }

  if (!data?.ok) {
    return data?.text || 'PDF render failed.'
  }
  return data.text || 'PDF saved.'
}
