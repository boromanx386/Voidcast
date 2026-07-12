import { isElectron } from '@/lib/platform'
import type { AppSettings } from '@/lib/settings'

export type SaveImageResult = { ok: boolean; text: string }

export function isDataImageUrl(url: string): boolean {
  return (url || '').trim().startsWith('data:image/')
}

/** User output dir when auto-save is on; empty lets Electron use its cache folder. */
export function resolveGeneratedImageOutputDir(settings: AppSettings): string {
  if (settings.runwareAutoSaveImages && settings.runwareImageOutputDir.trim()) {
    return settings.runwareImageOutputDir.trim()
  }
  return ''
}

export function dataUrlToBlobUrl(dataUrl: string): string {
  const trimmed = (dataUrl || '').trim()
  const commaIdx = trimmed.indexOf(',')
  if (commaIdx < 0) throw new Error('Invalid data URL for image')
  const header = trimmed.slice(0, commaIdx)
  const encoded = trimmed.slice(commaIdx + 1)
  const mimeMatch = /^data:(image\/[a-zA-Z0-9.+-]+)/.exec(header)
  const mime = mimeMatch?.[1] || 'image/png'
  const binary = atob(encoded.replace(/\s+/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: mime }))
}

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
