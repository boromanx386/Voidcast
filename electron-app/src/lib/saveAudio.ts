import { isElectron } from '@/lib/platform'

export type SaveAudioResult = { ok: boolean; text: string; path?: string; relativePath?: string }

export async function invokeSaveAudioFromUrl(opts: {
  audioUrl: string
  outputDir: string
  filename?: string
}): Promise<string> {
  if (!isElectron()) {
    throw new Error(
      'Auto-save music is only available in the desktop app (Electron).',
    )
  }
  const vc = window.voidcast?.saveAudioFromUrl
  if (!vc) {
    throw new Error('Run Voidcast in Electron to save generated music.')
  }
  const r: unknown = await vc(opts)
  if (typeof r === 'string') return r
  const obj = r as SaveAudioResult | { text?: string; ok?: boolean }
  if (obj && typeof obj === 'object' && 'text' in obj && typeof obj.text === 'string') {
    return obj.text
  }
  return String(r)
}

export async function invokeSaveAudioBytes(opts: {
  bytes: ArrayBuffer
  mime?: string
  filename?: string
  outputDir?: string
  projectPath?: string
  relativePath?: string
}): Promise<SaveAudioResult> {
  if (!isElectron()) {
    throw new Error('Saving TTS audio is only available in the desktop app (Electron).')
  }
  const vc = window.voidcast?.saveAudioBytes
  if (!vc) {
    throw new Error('Run Voidcast in Electron to save generated TTS audio.')
  }
  const r = await vc(opts)
  if (!r || typeof r !== 'object') {
    return { ok: false, text: 'Unexpected saveAudioBytes response' }
  }
  if (r.ok) {
    return {
      ok: true,
      text: r.text,
      path: r.path,
      relativePath: r.relativePath,
    }
  }
  return {
    ok: false,
    text: r.text || r.error || 'Failed to save audio',
  }
}
