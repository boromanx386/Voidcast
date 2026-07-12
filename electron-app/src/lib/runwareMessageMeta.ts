const RUNWARE_IMAGE_URL_LINE_RE =
  /^\s*image_url:\s*((?:https?:\/\/|data:image\/[a-zA-Z0-9.+-]+;base64,)\S+)\s*$/gim
const RUNWARE_AUDIO_URL_LINE_RE = /^\s*audio_url:\s*(https?:\/\/\S+)\s*$/gim
const MARKDOWN_IMAGE_URL_RE = /!\[[^\]]*?\]\((https?:\/\/[^)\s]+)\)/gim
const SAVED_IMAGE_PATH_RE = /^\s*Saved image:\s*(.+)\s*$/gim
const SAVED_AUDIO_PATH_RE = /^\s*Saved audio:\s*(.+)\s*$/gim

export type RunwareImageToolMeta = {
  model?: string
  size?: string
  prompt?: string
  steps?: number
  cfgScale?: number
  seed?: number
  costUsd?: number
  taskUuid?: string
  imageUuid?: string
  elapsedMs?: number
}

export type RunwareAudioToolMeta = {
  model?: string
  prompt?: string
  outputFormat?: string
  durationSec?: number
  steps?: number
  cfgScale?: number
  guidanceType?: string
  vocalLanguage?: string
  seed?: number
  costUsd?: number
  taskUuid?: string
  audioUuid?: string
  elapsedMs?: number
}

export function extractRunwareImageUrls(text: string): string[] {
  const out: string[] = []
  if (!text.trim()) return out
  RUNWARE_IMAGE_URL_LINE_RE.lastIndex = 0
  MARKDOWN_IMAGE_URL_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = RUNWARE_IMAGE_URL_LINE_RE.exec(text)) !== null) {
    const u = (match[1] || '').trim()
    if (u) out.push(u)
  }
  while ((match = MARKDOWN_IMAGE_URL_RE.exec(text)) !== null) {
    const u = (match[1] || '').trim()
    if (u) out.push(u)
  }
  return Array.from(new Set(out))
}

export function extractRunwareAudioUrls(text: string): string[] {
  const out: string[] = []
  if (!text.trim()) return out
  RUNWARE_AUDIO_URL_LINE_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = RUNWARE_AUDIO_URL_LINE_RE.exec(text)) !== null) {
    const u = (match[1] || '').trim()
    if (u) out.push(u)
  }
  return Array.from(new Set(out))
}

export function stripRunwareAudioUrlLines(text: string): string {
  if (!text.trim()) return text
  RUNWARE_AUDIO_URL_LINE_RE.lastIndex = 0
  return text.replace(RUNWARE_AUDIO_URL_LINE_RE, '').replace(/\n{3,}/g, '\n\n').trim()
}

export function stripGeneratedAudioLinkArtifacts(text: string, urls: string[]): string {
  let out = stripRunwareAudioUrlLines(text)
  for (const url of urls) {
    const esc = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const mdLink = new RegExp(`\\[([^\\]]+)\\]\\(${esc}\\)`, 'g')
    const plain = new RegExp(esc, 'g')
    out = out.replace(mdLink, '$1')
    out = out.replace(plain, '')
  }
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

export function stripGeneratedImageLinkArtifacts(text: string, urls: string[]): string {
  if (!text.trim()) return text
  let out = text
  for (const url of urls) {
    if (url.startsWith('data:image/')) continue
    const esc = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const mdImage = new RegExp(`!\\[[^\\]]*\\]\\(${esc}\\)`, 'g')
    const mdLink = new RegExp(`\\[([^\\]]+)\\]\\(${esc}\\)`, 'g')
    const plain = new RegExp(esc, 'g')
    out = out.replace(mdImage, '')
    out = out.replace(mdLink, '$1')
    out = out.replace(plain, '')
  }
  RUNWARE_IMAGE_URL_LINE_RE.lastIndex = 0
  out = out.replace(RUNWARE_IMAGE_URL_LINE_RE, '')
  out = out.replace(/^\s*Generated image URL\(s\):\s*$/gim, '')
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

export function extractMarkdownImageUrls(text: string): string[] {
  if (!text.trim()) return []
  MARKDOWN_IMAGE_URL_RE.lastIndex = 0
  const out: string[] = []
  let match: RegExpExecArray | null
  while ((match = MARKDOWN_IMAGE_URL_RE.exec(text)) !== null) {
    const u = (match[1] || '').trim().replace(/[),.;!?]+$/g, '')
    if (u) out.push(u)
  }
  return Array.from(new Set(out))
}

export function extractSavedImagePaths(text: string): string[] {
  if (!text.trim()) return []
  SAVED_IMAGE_PATH_RE.lastIndex = 0
  const out: string[] = []
  let match: RegExpExecArray | null
  while ((match = SAVED_IMAGE_PATH_RE.exec(text)) !== null) {
    const p = (match[1] || '').trim()
    if (p) out.push(p)
  }
  return Array.from(new Set(out))
}

export function extractSavedAudioPaths(text: string): string[] {
  if (!text.trim()) return []
  SAVED_AUDIO_PATH_RE.lastIndex = 0
  const out: string[] = []
  let match: RegExpExecArray | null
  while ((match = SAVED_AUDIO_PATH_RE.exec(text)) !== null) {
    const p = (match[1] || '').trim()
    if (p) out.push(p)
  }
  return Array.from(new Set(out))
}

export function parseRunwareImageToolMeta(text: string): RunwareImageToolMeta | null {
  const out: RunwareImageToolMeta = {}
  const lines = text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
  for (const line of lines) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (!value) continue
    if (key === 'model') out.model = value
    else if (key === 'size') out.size = value
    else if (key === 'prompt') out.prompt = value
    else if (key === 'steps') {
      const n = Number(value)
      if (Number.isFinite(n)) out.steps = Math.round(n)
    } else if (key === 'cfg_scale') {
      const n = Number(value)
      if (Number.isFinite(n)) out.cfgScale = n
    } else if (key === 'seed') {
      const n = Number(value)
      if (Number.isFinite(n)) out.seed = Math.round(n)
    } else if (key === 'cost_usd') {
      const n = Number(value)
      if (Number.isFinite(n)) out.costUsd = n
    } else if (key === 'task_uuid') out.taskUuid = value
    else if (key === 'image_uuid') out.imageUuid = value
    else if (key === 'elapsed_ms') {
      const n = Number(value)
      if (Number.isFinite(n)) out.elapsedMs = Math.round(n)
    }
  }
  return Object.keys(out).length > 0 ? out : null
}

export function parseRunwareAudioToolMeta(text: string): RunwareAudioToolMeta | null {
  const out: RunwareAudioToolMeta = {}
  const lines = text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
  for (const line of lines) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (!value) continue
    if (key === 'model') out.model = value
    else if (key === 'prompt') out.prompt = value
    else if (key === 'output_format') out.outputFormat = value
    else if (key === 'duration_sec') {
      const n = Number(value)
      if (Number.isFinite(n)) out.durationSec = n
    } else if (key === 'steps') {
      const n = Number(value)
      if (Number.isFinite(n)) out.steps = Math.round(n)
    } else if (key === 'cfg_scale') {
      const n = Number(value)
      if (Number.isFinite(n)) out.cfgScale = n
    } else if (key === 'guidance_type') out.guidanceType = value
    else if (key === 'vocal_language') out.vocalLanguage = value
    else if (key === 'seed') {
      const n = Number(value)
      if (Number.isFinite(n)) out.seed = Math.round(n)
    } else if (key === 'cost_usd') {
      const n = Number(value)
      if (Number.isFinite(n)) out.costUsd = n
    } else if (key === 'task_uuid') out.taskUuid = value
    else if (key === 'audio_uuid') out.audioUuid = value
    else if (key === 'elapsed_ms') {
      const n = Number(value)
      if (Number.isFinite(n)) out.elapsedMs = Math.round(n)
    }
  }
  return Object.keys(out).length > 0 ? out : null
}
