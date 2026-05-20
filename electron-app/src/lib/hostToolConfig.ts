import { isElectron } from '@/lib/platform'
import { normalizeBaseUrl } from '@/lib/settings'

export type HostToolConfigSnapshot = {
  ok?: boolean
  pdf_output_dir?: string
}

/** Folder on the PC where `save_pdf` writes files (pushed from desktop). */
export async function fetchHostToolConfig(ttsBaseUrl: string): Promise<string> {
  const root = normalizeBaseUrl(ttsBaseUrl.trim() || 'http://127.0.0.1:8765')
  try {
    const res = await fetch(`${root}/tools/host-tool-config`)
    if (!res.ok) return ''
    const data = (await res.json()) as HostToolConfigSnapshot
    return typeof data.pdf_output_dir === 'string' ? data.pdf_output_dir.trim() : ''
  } catch {
    return ''
  }
}

export function resolvePdfOutputDir(localDir: string, hostDir: string): string {
  const local = localDir.trim()
  if (local) return local
  return hostDir.trim()
}

/** Push PDF folder from desktop so the phone web UI does not need a local path. */
export async function pushHostToolConfigToServer(
  ttsBaseUrl: string,
  config: { pdfOutputDir: string },
): Promise<void> {
  if (!isElectron()) return
  const dir = config.pdfOutputDir.trim()
  if (!dir) return
  const root = normalizeBaseUrl(ttsBaseUrl.trim() || 'http://127.0.0.1:8765')
  await fetch(`${root}/tools/host-tool-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdfOutputDir: dir }),
  })
}
