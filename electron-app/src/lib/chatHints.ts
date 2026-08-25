import type { FileAttachmentSnapshot, UiMessage } from '@/types/chat'
import type { ImageVisionCache } from '@/lib/imageVisionCache'
import { imageCatalogKey } from '@/lib/imageVisionCache'
import type { PendingChatImage } from '@/lib/chatImageCatalog'
import { catalogItemKey } from '@/lib/chatImageCatalog'

export function deriveSessionTitle(messages: UiMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user')
  if (!firstUser) return 'UNTITLED_SESSION'
  const raw =
    firstUser.content.trim() ||
    (firstUser.images?.length
      ? '[image]'
      : firstUser.fileAttachments?.length
        ? `[file: ${firstUser.fileAttachments[0].name}]`
        : '')
  if (!raw) return 'UNTITLED_SESSION'
  const single = raw.replace(/\s+/g, ' ')
  return single.length > 60 ? `${single.slice(0, 60)}…` : single
}

export function isToday(ts: number): boolean {
  const d = new Date(ts)
  const n = new Date()
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  )
}

export function sanitizeForTts(input: string): string {
  return input
    .replace(/^\s*Generated image URL\(s\):\s*$/gim, ' ')
    .replace(/^\s*image_url:\s*https?:\/\/\S+\s*$/gim, ' ')
    .replace(/^\s*audio_url:\s*https?:\/\/\S+\s*$/gim, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/[*_#~]+/g, '')
    .replace(/https?:\/\/[^\s)]+/g, ' ')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildRuntimeTimeHint(now = new Date()): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
  const local = now.toLocaleString()
  const iso = now.toISOString()
  return [
    'Runtime clock context:',
    `- Local datetime: ${local}`,
    `- Timezone: ${tz}`,
    `- UTC ISO timestamp: ${iso}`,
    'Use this as current-time reference for queries about today/latest/current/recent.',
  ].join('\n')
}

const VISION_TRIGGER_RE =
  /\b(analyze|analyse|describe|what(?:'s| is) in|inspect|ocr|read(?: the)? text|caption|scan|classify|identify|opis[iu]|analiziraj|šta\s+(?:je\s+)?na|šta\s+vidiš|procitaj|pročitaj)\b/i

export function shouldUseVisionForText(text: string): boolean {
  return VISION_TRIGGER_RE.test(text)
}

export function dedupeNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.map((x) => x.trim()).filter(Boolean)))
}

export function toConversationTurns(
  messages: UiMessage[],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .map((m) => {
      let c = m.content
      if (m.role === 'user' && !c.trim() && m.images?.length) c = '[user attached image]'
      if (m.role === 'user' && !c.trim() && m.fileAttachments?.length) c = '[user attached file]'
      return { role: m.role, content: c }
    })
    .filter(
      (t): t is { role: 'user' | 'assistant'; content: string } =>
        (t.role === 'user' || t.role === 'assistant') && t.content.trim().length > 0,
    )
}

export function buildImageCatalogHint(
  catalog: PendingChatImage[],
  pendingCount = 0,
): string {
  if (!catalog.length) return ''
  const lines = catalog.map((item, i) => {
    const label = (item.path || item.name || '').trim() || '(unnamed image)'
    const kind =
      item.kind === 'generated'
        ? 'generated'
        : item.kind === 'pending'
          ? 'attached (this message)'
          : 'attached'
    return `- Index ${i + 1}: [${kind}] ${label}${item.path ? ` — ${item.path}` : ''}`
  })
  const currentAttachLead =
    pendingCount > 0
      ? `Images attached in THIS message are index 1${pendingCount > 1 ? `–${pendingCount}` : ''} — describe those, not older generated images unless the user explicitly asks about an older one.`
      : [
          'No image is attached to THIS message.',
          'Index 1 = most recent image earlier in the session (including generated).',
          'Do not describe or treat catalog images as newly attached unless the user explicitly asks about them — then call image_recall (or edit_image_runware) with the index/path.',
        ].join(' ')
  return [
    'Session image catalog for image_recall / edit_image_runware:',
    currentAttachLead,
    ...lines,
  ].join('\n')
}

export function buildQueuedImagePathHint(queued: PendingChatImage[]): string {
  if (!queued.length) return ''
  const lines: string[] = []
  for (let i = 0; i < queued.length; i++) {
    const q = queued[i]
    const label = (q.path || q.name || '').trim() || '(unnamed image)'
    lines.push(`- ${label}`)
  }
  return [
    'Images attached to this message (indexes are listed in the session catalog below when Runware image tools are on).',
    ...lines,
  ].join('\n')
}

export function buildHistoricalImageRecallHint(
  msg: UiMessage,
  catalog: PendingChatImage[],
  visionCache: ImageVisionCache = {},
): string {
  if (msg.role !== 'user' || !msg.images?.length) return ''
  const lines: string[] = []
  let hasVision = false
  for (let j = 0; j < msg.images.length; j++) {
    const b64 = (msg.images[j] || '').trim()
    if (!b64) continue
    const path = msg.imagePaths?.[j]?.trim()
    const key = path
      ? catalogItemKey({ base64: b64, mime: '', path })
      : catalogItemKey({ base64: b64, mime: '' })
    let oneBased: number | null = null
    let catalogItem: PendingChatImage | null = null
    for (let k = 0; k < catalog.length; k++) {
      const c = catalog[k]
      if (catalogItemKey(c) === key) {
        oneBased = k + 1
        catalogItem = c
        break
      }
    }
    const label = (path || msg.imageNames?.[j] || '').trim() || `attachment ${j + 1}`
    const desc = catalogItem ? visionCache[imageCatalogKey(catalogItem)] : undefined
    if (desc) hasVision = true
    if (oneBased != null) {
      lines.push(
        desc
          ? `- Index ${oneBased} (1-based catalog): ${label}${path ? ` — path: ${path}` : ''}\n  Vision analysis: ${desc}`
          : `- Index ${oneBased} (1-based catalog): ${label}${path ? ` — path: ${path}` : ''}`,
      )
    } else {
      lines.push(`- ${label} (could not match to current image catalog; try re-attaching if needed)`)
    }
  }
  if (!lines.length) return ''
  return [
    hasVision
      ? 'Images from this earlier turn (vision analysis included where available):'
      : 'Images were attached in this earlier turn. For pixel-accurate vision later, call image_recall with reference_image_indexes (1-based, same order as the internal catalog used by tools) and/or reference_image_paths using the paths below. Earlier turns do not resend raw image bytes in context.',
    ...lines,
  ].join('\n')
}

export function buildAssistantImageVisionHint(
  msg: UiMessage,
  visionCache: ImageVisionCache = {},
): string {
  if (msg.role !== 'assistant') return ''
  const paths = dedupeNonEmpty(msg.generatedImagePaths || [])
  if (!paths.length) return ''
  const lines: string[] = []
  for (const p of paths) {
    const desc = visionCache[imageCatalogKey({ path: p, base64: '' })]
    if (desc) {
      lines.push(`- ${p}\n  Vision analysis: ${desc}`)
    }
  }
  if (!lines.length) return ''
  return ['Generated image(s) from this turn:', ...lines].join('\n')
}

export function buildQueuedFilePathHint(queued: FileAttachmentSnapshot[]): string {
  if (!queued.length) return ''
  const lines = queued.map((f, idx) => {
    const tag = f.truncated ? ' (snapshot truncated)' : ''
    return `- ${idx + 1}: ${f.path || f.name}${tag}`
  })
  const contentBlocks = queued
    .map((f, idx) => {
      const text = (f.content || '').trim()
      if (!text) return ''
      const short = text.length > 12000 ? `${text.slice(0, 12000)}\n...[cut]` : text
      return [`File ${idx + 1} snapshot (${f.name}):`, '---', short, '---'].join('\n')
    })
    .filter((x) => x.length > 0)
  return [
    'Attached file references for this message:',
    ...lines,
    'Important: local file access is not needed for these attachments in this turn because their snapshot/path metadata is already included in chat context.',
    ...(contentBlocks.length > 0
      ? ['', 'Attached file snapshot text (use for analysis):', ...contentBlocks]
      : []),
    'When snapshot text exists, analyze it directly and do not claim missing tools for local PDF/DOCX access.',
    'Use these paths as primary source and snapshot content when present.',
  ].join('\n')
}

/**
 * Prefix injected into the model-facing user text when the user steers mid-turn.
 * Visible bubble keeps the raw user text (see `displayText` / `steered` on UiMessage).
 */
export function buildSteerCourseCorrectionText(userText: string): string {
  const body = userText.trim()
  const header = [
    '[Steer — mid-turn course correction]',
    'The previous assistant turn was interrupted before completion.',
    'Treat the message below as a hard redirect: drop conflicting intent from the incomplete prior turn, keep any useful progress already done.',
  ].join('\n')
  return body ? `${header}\n\n${body}` : header
}
