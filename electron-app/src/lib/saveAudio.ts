import { isElectron } from '@/lib/platform'

export type SaveAudioResult = { ok: boolean; text: string }

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
