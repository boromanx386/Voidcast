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

  const body = {
    content: opts.content,
    title: opts.title?.trim() || undefined,
    filename: opts.filename?.trim() || undefined,
    output_dir: opts.outputDir,
    images: opts.images?.length ? opts.images : undefined,
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
