import { isElectron } from '@/lib/platform'

export type SaveImageResult = { ok: boolean; text: string }

export async function invokeSaveImageFromUrl(opts: {
  imageUrl: string
  outputDir: string
  filename?: string
}): Promise<string> {
  if (!isElectron()) {
    throw new Error(
      'Auto-save images is only available in the desktop app (Electron).',
    )
  }
  const vc = window.voidcast?.saveImageFromUrl
  if (!vc) {
    throw new Error('Run Voidcast in Electron to save generated images.')
  }
  const r: unknown = await vc(opts)
  if (typeof r === 'string') return r
  const obj = r as SaveImageResult | { text?: string; ok?: boolean }
  if (obj && typeof obj === 'object' && 'text' in obj && typeof obj.text === 'string') {
    return obj.text
  }
  return String(r)
}
