import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type UIEvent as ReactUIEvent,
} from 'react'
import './App.css'
import { ChatMarkdown } from '@/components/ChatMarkdown'
import { BrainIcon } from '@/components/icons/BrainIcon'
import { CodeIcon } from '@/components/icons/CodeIcon'
import { RobotIcon } from '@/components/icons/RobotIcon'
import { startRecording, blobToBase64, transcribeWithOpenRouter } from '@/lib/stt'
import { GeneralOptionsPanel } from '@/components/options/GeneralOptionsPanel'
import { LlmOptionsPanel } from '@/components/options/LlmOptionsPanel'
import { RunwareOptionsPanel } from './components/options/RunwareOptionsPanel'
import { RunwareMusicOptionsPanel } from '@/components/options/RunwareMusicOptionsPanel'
import { ToolsOptionsPanel } from '@/components/options/ToolsOptionsPanel'
import { TtsOptionsPanel } from '@/components/options/TtsOptionsPanel'
import { SubAgentOptionsPanel } from '@/components/options/SubAgentOptionsPanel'
import { CodingPanel } from '@/components/CodingPanel'
import {
  buildOllamaMessages,
  resolveContextCompressedThroughIndex,
  sliceUiHistoryForContext,
  TOOLS_WEB_SEARCH_HINT,
  TOOLS_YOUTUBE_HINT,
  TOOLS_REDDIT_HINT,
  TOOLS_WEATHER_HINT,
  TOOLS_SCRAPE_HINT,
  TOOLS_PDF_HINT,
  TOOLS_RUNWARE_IMAGE_HINT,
  TOOLS_RUNWARE_MUSIC_HINT,
  TOOLS_CODING_CHAT_IMAGE_ASSETS_HINT,
  TOOLS_TRUTH_HINT,
  type HistoryTurn,
} from '@/lib/chatMessages'
import {
  MAX_CHAT_IMAGES,
  MAX_IMAGE_BYTES,
  CHAT_IMAGE_ACCEPT,
  readImageFileAsBase64,
  imageDataUrl,
  splitChatAttachmentFiles,
} from '@/lib/imageAttachment'
import {
  chatFileAcceptList,
  extFromName,
  isSupportedChatFileName,
} from '@/lib/fileAttachment'
import { runOllamaChatWithTools } from '@/lib/ollamaAgent'
import { anyToolEnabled } from '@/lib/toolDefinitions'
import { toolPhaseForAgentTool, type AgentToolUiPhase } from '@/lib/agentToolPhase'
import { streamOllamaChat, fetchOllamaModels, isThinkingUiEnabled } from '@/lib/ollama'
import { runOpenRouterChatWithTools } from '@/lib/openrouterAgent'
import { ollamaMessagesToOpenRouter, streamOpenRouterChat } from '@/lib/openrouter'
import { compressConversationContext } from '@/lib/contextCompress'
import {
  CONTEXT_COMPRESS_RATIO_RESET,
  estimateContextUsage,
  type ContextUsageInfo,
} from '@/lib/contextUsage'
import { extractLongMemoryCandidates } from '@/lib/longMemoryExtract'
import { detectSubAgentProvider, type SubAgentUiCallbacks } from '@/lib/subAgent'
import {
  deleteMemory,
  dedupeMemories,
  listMemories,
  searchMemories,
  touchMemoryUsage,
  updateMemoryText,
  upsertMemories,
} from '@/lib/longMemoryStorage'
import {
  addReminder,
  listReminders,
  deleteReminder,
  markReminderDone,
  listDueUnnotifiedReminders,
  markReminderNotified,
  type Reminder,
} from '@/lib/reminderStorage'
import { playNotificationSound } from '@/lib/notificationSounds'
import { bakeVoiceSample, checkTtsHealth, synthesizeSpeech } from '@/lib/tts'
import { splitIntoTtsChunks } from '@/lib/textChunks'
import { invokeSaveImageFromUrl } from '@/lib/saveImage'
import { invokeSaveAudioFromUrl } from '@/lib/saveAudio'
import { pushCloudSecretsToServer } from '@/lib/cloudSecrets'
import {
  fetchHostToolConfig,
  pushHostToolConfigToServer,
  resolvePdfOutputDir,
} from '@/lib/hostToolConfig'
import {
  recordMemoryDeleted,
  recordReminderDeleted,
  scheduleUserDataSync,
  syncUserDataNow,
} from '@/lib/userDataSync'
import { isElectron, isWebStandalone } from '@/lib/platform'
import {
  getAgentVisibleSettings,
  getRunwareMusicProfileForModel,
  getRunwareProfileForModel,
  loadSettings,
  saveSettings,
  type AppSettings,
} from '@/lib/settings'
import {
  buildCodingMemoHint,
  commandResultSnippet,
  emptyCodingContextMemo,
  getCodingProjectPath,
  isCodingToolFailure,
  normalizeCodingContextMemo,
  pushRecentCommand,
  pushRecentUnique,
  mergeCodingProjectPathIntoSettings,
  patchSessionCodingState,
  resolveMemoForNewChat,
  resolveMemoForSession,
  saveProjectCodingMemo,
  sessionCodingProjectPath,
  type CodingContextMemo,
} from '@/lib/codingContextMemo'
import {
  imageCatalogKey,
  mergeImageVisionCache,
  normalizeImageVisionCache,
  type ImageVisionCache,
} from '@/lib/imageVisionCache'
import { formatEditedFileMemoEntry } from '@/lib/codingEol'
import {
  clearCloneRef,
  loadCloneRef,
  saveCloneRef,
} from '@/lib/cloneRefStorage'
import {
  clearVoiceAnchor,
  loadVoiceAnchor,
  saveVoiceAnchor,
  type StoredVoiceAnchor,
} from '@/lib/voiceAnchorStorage'
import {
  deleteSessionById,
  loadChatSessions,
  saveChatSessions,
  upsertSession,
} from '@/lib/chatSessionsStorage'
import type { ChatSession, FileAttachmentSnapshot, UiMessage } from '@/types/chat'
import type { LongMemoryCandidate, LongMemoryItem } from '@/types/longMemory'
import type { TerminalLine } from '@/types/coding'

type Screen = 'chat' | 'options'
type OptionsTab = 'general' | 'llm' | 'runware' | 'runwareMusic' | 'tts' | 'tools' | 'subAgent'

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

type PendingChatImage = {
  base64: string
  mime: string
  name?: string
  path?: string
  /** Catalog source — used in index hints for image_recall / edit_image_runware. */
  kind?: 'attachment' | 'generated' | 'pending'
}

type PendingChatFile = FileAttachmentSnapshot

type LocalImagePreview = {
  base64: string
  mime: string
}

const EMPTY_STATE_VARIANTS = {
  dystopian: [
    'NEURAL INTERFACE READY. AWAITING INPUT.',
    'SYSTEM LINK STABLE. ENTER COMMAND.',
    'CHANNEL OPEN. FEED PROMPT TO CONTINUE.',
  ],
  minimal: [
    'Chat is ready. Type your first message.',
    'New session started. Ask anything.',
    'All set. Enter a prompt to continue.',
  ],
  matrix: [
    'Terminal link established. Awaiting input.',
    'Greenline channel open. Enter your prompt.',
    'System ready. Type to continue.',
  ],
  light: [
    'Workspace ready. Start with a prompt.',
    'You are all set. Ask anything.',
    'Session is ready. Type to continue.',
  ],
  'blood-moon': [
    'The void is listening. Feed it a prompt.',
    'Crimson channel open. Transmit when ready.',
    'Blood moon rising. Await your command.',
  ],
  obsidian: [
    'The archive is silent. Enter your query.',
    'Channel stable. Transmit when ready.',
    'Obsidian surface awaits your mark.',
  ],
} as const

function deriveSessionTitle(messages: UiMessage[]): string {
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

function isToday(ts: number): boolean {
  const d = new Date(ts)
  const n = new Date()
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  )
}

function sanitizeForTts(input: string): string {
  return input
    // Drop generated-image link markers/lines before speaking.
    .replace(/^\s*Generated image URL\(s\):\s*$/gim, ' ')
    .replace(/^\s*image_url:\s*https?:\/\/\S+\s*$/gim, ' ')
    .replace(/^\s*audio_url:\s*https?:\/\/\S+\s*$/gim, ' ')
    // Remove fenced code blocks so TTS skips code dumps.
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    // Remove inline code fragments.
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/[*_#~]+/g, '')
    // Remove bare URLs so TTS does not spell links.
    .replace(/https?:\/\/[^\s)]+/g, ' ')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildRuntimeTimeHint(now = new Date()): string {
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

function shouldUseVisionForText(text: string): boolean {
  return VISION_TRIGGER_RE.test(text)
}

function dedupeNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.map((x) => x.trim()).filter(Boolean)))
}

function toConversationTurns(messages: UiMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .map((m) => {
      let c = m.content
      if (m.role === 'user' && !c.trim() && m.images?.length) c = '[user attached image]'
      if (m.role === 'user' && !c.trim() && m.fileAttachments?.length) c = '[user attached file]'
      return { role: m.role, content: c }
    })
    .filter((t): t is { role: 'user' | 'assistant'; content: string } =>
      (t.role === 'user' || t.role === 'assistant') && t.content.trim().length > 0,
    )
}

function catalogItemKey(item: PendingChatImage): string {
  return imageCatalogKey(item)
}

function buildImageCatalogHint(
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
      : 'Index 1 = most recent image in the session (including generated).'
  return [
    'Session image catalog for image_recall / edit_image_runware:',
    currentAttachLead,
    ...lines,
  ].join('\n')
}

function buildQueuedImagePathHint(queued: PendingChatImage[]): string {
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

/** Text-only hint: maps earlier attachments to catalog indexes; includes stored vision analysis when available. */
function buildHistoricalImageRecallHint(
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
    const label =
      (path || msg.imageNames?.[j] || '').trim() || `attachment ${j + 1}`
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

function buildAssistantImageVisionHint(
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

function buildQueuedFilePathHint(queued: PendingChatFile[]): string {
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
      return [
        `File ${idx + 1} snapshot (${f.name}):`,
        '---',
        short,
        '---',
      ].join('\n')
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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function fetchCatalogImageFromUrl(
  url: string,
  name?: string,
): Promise<PendingChatImage | null> {
  const u = url.trim()
  if (!u.startsWith('http://') && !u.startsWith('https://')) return null
  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return null
    const mimeRaw = (res.headers.get('content-type') || 'image/png').split(';')[0].trim().toLowerCase()
    const mime = mimeRaw.startsWith('image/') ? mimeRaw : 'image/png'
    const buf = await res.arrayBuffer()
    if (buf.byteLength < 16) return null
    return {
      base64: arrayBufferToBase64(buf),
      mime,
      name: name?.trim() || u,
      kind: 'generated',
    }
  } catch {
    return null
  }
}

async function pushAssistantGeneratedImages(
  chronological: PendingChatImage[],
  msg: UiMessage,
): Promise<void> {
  const readImageFile = window.voidcast?.readImageFile
  const paths = msg.generatedImagePaths || []
  const urls = msg.generatedImageUrls || []
  const urlKeysAdded = new Set<string>()

  if (isElectron() && readImageFile) {
    for (let j = 0; j < paths.length; j++) {
      const p = (paths[j] || '').trim()
      if (!p) continue
      try {
        const res = await readImageFile({ path: p })
        if (!res.ok || !res.file?.base64?.trim()) continue
        chronological.push({
          base64: res.file.base64.replace(/\s+/g, ''),
          mime: res.file.mime || 'image/png',
          name: res.file.name || urls[j],
          path: res.file.path || p,
          kind: 'generated',
        })
        const pairedUrl = (urls[j] || '').trim()
        if (pairedUrl) urlKeysAdded.add(pairedUrl)
      } catch {
        // Ignore unreadable files; keep catalog build best-effort.
      }
    }
  }

  for (let j = 0; j < urls.length; j++) {
    const url = (urls[j] || '').trim()
    if (!url || urlKeysAdded.has(url)) continue
    urlKeysAdded.add(url)
    const fetched = await fetchCatalogImageFromUrl(url, paths[j] || url)
    if (fetched) chronological.push(fetched)
  }
}

function dedupeCatalogNewestFirst(items: PendingChatImage[]): PendingChatImage[] {
  const seen = new Set<string>()
  const out: PendingChatImage[] = []
  for (const item of items) {
    const key = catalogItemKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/** History only (no current-message queue): chat order old→new, returned newest-first. */
async function buildSessionImageCatalog(history: UiMessage[]): Promise<PendingChatImage[]> {
  const chronological: PendingChatImage[] = []

  for (const msg of history) {
    if (msg.role === 'user' && msg.images?.length) {
      for (let j = 0; j < msg.images.length; j++) {
        const base64 = (msg.images[j] || '').trim()
        if (!base64) continue
        chronological.push({
          base64,
          mime: (msg.imageMimes?.[j] || 'image/png').trim() || 'image/png',
          name: msg.imageNames?.[j],
          path: msg.imagePaths?.[j],
          kind: 'attachment',
        })
      }
    }
    if (msg.role === 'assistant') {
      await pushAssistantGeneratedImages(chronological, msg)
    }
  }

  const newestFirst: PendingChatImage[] = []
  for (let i = chronological.length - 1; i >= 0; i--) {
    newestFirst.push(chronological[i]!)
  }
  return dedupeCatalogNewestFirst(newestFirst)
}

/**
 * Tool catalog: current-message attachments first (index 1 = newest attach), then older session images.
 */
async function buildToolImageCatalog(
  history: UiMessage[],
  queued: PendingChatImage[],
): Promise<PendingChatImage[]> {
  const pendingNewestFirst = [...queued].reverse().map((q) => ({
    ...q,
    kind: 'pending' as const,
  }))
  const pendingKeys = new Set(pendingNewestFirst.map(catalogItemKey))
  const session = (await buildSessionImageCatalog(history)).filter(
    (item) => !pendingKeys.has(catalogItemKey(item)),
  )
  return [...pendingNewestFirst, ...session]
}

const RUNWARE_IMAGE_URL_LINE_RE = /^\s*image_url:\s*(https?:\/\/\S+)\s*$/gim
const RUNWARE_AUDIO_URL_LINE_RE = /^\s*audio_url:\s*(https?:\/\/\S+)\s*$/gim
const MARKDOWN_IMAGE_URL_RE = /!\[[^\]]*?\]\((https?:\/\/[^)\s]+)\)/gim
const SAVED_IMAGE_PATH_RE = /^\s*Saved image:\s*(.+)\s*$/gim
const SAVED_AUDIO_PATH_RE = /^\s*Saved audio:\s*(.+)\s*$/gim

function extractRunwareImageUrls(text: string): string[] {
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

function extractRunwareAudioUrls(text: string): string[] {
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

function stripRunwareAudioUrlLines(text: string): string {
  if (!text.trim()) return text
  RUNWARE_AUDIO_URL_LINE_RE.lastIndex = 0
  return text.replace(RUNWARE_AUDIO_URL_LINE_RE, '').replace(/\n{3,}/g, '\n\n').trim()
}

function stripGeneratedAudioLinkArtifacts(text: string, urls: string[]): string {
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

function stripGeneratedImageLinkArtifacts(text: string, urls: string[]): string {
  if (!text.trim()) return text
  let out = text
  for (const url of urls) {
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

function extractMarkdownImageUrls(text: string): string[] {
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

function extractSavedImagePaths(text: string): string[] {
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

function extractSavedAudioPaths(text: string): string[] {
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

type RunwareImageToolMeta = {
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

function parseRunwareImageToolMeta(text: string): RunwareImageToolMeta | null {
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

type RunwareAudioToolMeta = {
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

function parseRunwareAudioToolMeta(text: string): RunwareAudioToolMeta | null {
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

// CRT Overlay Component
function CrtOverlay() {
  return (
    <div className="crt-overlay" aria-hidden="true" />
  )
}

// Ambient Particles Component
function AmbientParticles() {
  return (
    <div className="ambient-particles" aria-hidden="true">
      {Array.from({ length: 20 }).map((_, i) => (
        <div
          key={i}
          className="particle"
          style={{
            left: `${Math.random() * 100}%`,
            animationDelay: `${Math.random() * 10}s`,
            animationDuration: `${10 + Math.random() * 10}s`,
          }}
        />
      ))}
    </div>
  )
}

// Glitch Text Component
function GlitchText({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`glitch-text ${className}`} data-text={children}>
      {children}
    </span>
  )
}

// Tool Phase Indicator Component
const TOOL_PHASE_UI: Record<
  AgentToolUiPhase,
  { icon: string; label: string; className: string }
> = {
  search: { icon: '⌕', label: 'SEARCHING_NET', className: 'search' },
  youtube: { icon: '▶', label: 'YOUTUBE_PROC', className: 'youtube' },
  reddit: { icon: '⬢', label: 'REDDIT_FEED', className: 'reddit' },
  weather: { icon: '◐', label: 'WEATHER_API', className: 'weather' },
  scrape: { icon: '⬡', label: 'SCRAPING', className: 'scrape' },
  pdf: { icon: '⬡', label: 'PDF_EXPORT', className: 'pdf' },
  image: { icon: '◌', label: 'RUNWARE_IMAGE', className: 'image' },
  vision: { icon: '◎', label: 'IMAGE_RECALL', className: 'vision' },
  music: { icon: '♫', label: 'RUNWARE_MUSIC', className: 'music' },
  coding_list: { icon: '⊢', label: 'CODING_FILES', className: 'coding' },
  coding_read: { icon: '◊', label: 'CODING_READ', className: 'coding' },
  coding_write: { icon: '▹', label: 'CODING_WRITE', className: 'coding' },
  coding_edit: { icon: '✎', label: 'CODING_EDIT', className: 'coding' },
  coding_search: { icon: '◇', label: 'CODING_FIND', className: 'coding' },
  coding_glob: { icon: '◎', label: 'CODING_GLOB', className: 'coding' },
  coding_git: { icon: '⎇', label: 'CODING_GIT', className: 'coding' },
  coding_shell: { icon: '$', label: 'CODING_SHELL', className: 'coding' },
  settings: { icon: '⚙', label: 'APP_SETTINGS', className: 'settings' },
  reminder: { icon: '⧗', label: 'REMINDER', className: 'reminder' },
  other: { icon: '◈', label: 'TOOL', className: 'other' },
}

function ToolIndicator({ phase }: { phase: AgentToolUiPhase | null }) {
  if (!phase) return null

  const tool = TOOL_PHASE_UI[phase]

  return (
    <div className={`tool-indicator ${tool.className}`}>
      <span className="opacity-70">{tool.icon}</span>
      <span>{tool.label}</span>
      <span className="ml-2 animate-pulse">_</span>
    </div>
  )
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  /** PDF folder on the PC running the tools server (from desktop push; used on LAN web). */
  const [hostPdfOutputDir, setHostPdfOutputDir] = useState('')
  const effectivePdfOutputDir = resolvePdfOutputDir(settings.pdfOutputDir, hostPdfOutputDir)
  const [appVersion, setAppVersion] = useState('2.6.1')
  const [screen, setScreen] = useState<Screen>('chat')
  const [optionsTab, setOptionsTab] = useState<OptionsTab>('general')
  const [menuOpen, setMenuOpen] = useState(false)
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [hiddenContextSummary, setHiddenContextSummary] = useState('')
  const [contextCompressedThroughIndex, setContextCompressedThroughIndex] = useState(0)
  const [contextUsageInfo, setContextUsageInfo] = useState<ContextUsageInfo | null>(null)
  const [contextWarnDismissed, setContextWarnDismissed] = useState(false)
  const [contextCompressBusy, setContextCompressBusy] = useState(false)
  const contextOverflowLatchRef = useRef(false)
  const [longMemoryBusy, setLongMemoryBusy] = useState(false)
  const [memoryCandidates, setMemoryCandidates] = useState<LongMemoryCandidate[]>([])
  const [memoryPreviewOpen, setMemoryPreviewOpen] = useState(false)
  const [subAgentPanelOpen, setSubAgentPanelOpen] = useState(false)
  const [subAgentPanelBusy, setSubAgentPanelBusy] = useState(false)
  const [subAgentPanelText, setSubAgentPanelText] = useState('')
  const [longMemories, setLongMemories] = useState<LongMemoryItem[]>([])
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [sessionDirty, setSessionDirty] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState({ today: false, older: false })
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [sessionsHydrated, setSessionsHydrated] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ttsOk, setTtsOk] = useState<boolean | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [sttPending, setSttPending] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const recorderRef = useRef<{ stop: () => Promise<Blob> } | null>(null)
  const recordingTimerRef = useRef<number | null>(null)
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [toolPhase, setToolPhase] = useState<AgentToolUiPhase | null>(null)
  const [showCodingPanel, setShowCodingPanel] = useState(false)
  const [codingTerminalFeed, setCodingTerminalFeed] = useState<TerminalLine[]>([])
  const [codingFileTreeNonce, setCodingFileTreeNonce] = useState(0)
  const [codingContextMemo, setCodingContextMemo] = useState<CodingContextMemo>(() =>
    emptyCodingContextMemo(getCodingProjectPath(loadSettings())),
  )
  const [imageVisionCache, setImageVisionCache] = useState<ImageVisionCache>({})
  const codingProjectPathForMemoRef = useRef(getCodingProjectPath(loadSettings()))
  const [toolResultBanner, setToolResultBanner] = useState<
    { kind: 'pdf'; text: string } | null
  >(null)
  const [assistantGeneratedImages, setAssistantGeneratedImages] = useState<Record<string, string[]>>({})
  const [assistantSavedImagePaths, setAssistantSavedImagePaths] = useState<Record<string, string[]>>({})
  const [localImagePreviews, setLocalImagePreviews] = useState<Record<string, LocalImagePreview>>({})
  const [assistantImageToolMeta, setAssistantImageToolMeta] = useState<
    Record<string, Record<string, RunwareImageToolMeta>>
  >({})
  const [assistantImageMessageMeta, setAssistantImageMessageMeta] = useState<
    Record<string, RunwareImageToolMeta>
  >({})
  const [assistantGeneratedAudios, setAssistantGeneratedAudios] = useState<Record<string, string[]>>({})
  const [assistantSavedAudioPaths, setAssistantSavedAudioPaths] = useState<Record<string, string[]>>({})
  const [assistantAudioToolMeta, setAssistantAudioToolMeta] = useState<
    Record<string, Record<string, RunwareAudioToolMeta>>
  >({})
  const [assistantAudioMessageMeta, setAssistantAudioMessageMeta] = useState<
    Record<string, RunwareAudioToolMeta>
  >({})
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [pendingImages, setPendingImages] = useState<PendingChatImage[]>([])
  const [pendingFiles, setPendingFiles] = useState<PendingChatFile[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounterRef = useRef(0)
  const [cloneRef, setCloneRef] = useState<{ blob: Blob; fileName: string } | null>(null)
  const [voiceAnchor, setVoiceAnchor] = useState<StoredVoiceAnchor | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editInputValue, setEditInputValue] = useState('')
  const editingHistoryRef = useRef<UiMessage[] | null>(null)
  const localPreviewLoadingRef = useRef<Set<string>>(new Set())
  const abortRef = useRef<AbortController | null>(null)
  const activeChatRunIdRef = useRef(0)
  const ttsAbortRef = useRef<AbortController | null>(null)
  const ttsRunIdRef = useRef(0)
  const ttsAudioCacheRef = useRef<Map<string, Blob>>(new Map())
  const ttsAudioCacheOrderRef = useRef<string[]>([])
  const onReadRef = useRef<(msg: UiMessage) => Promise<void>>(async () => {})
  const listEndRef = useRef<HTMLDivElement | null>(null)
  const chatMessagesRef = useRef<HTMLElement | null>(null)
  const savedChatScrollRef = useRef(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const chatAttachmentInputRef = useRef<HTMLInputElement | null>(null)
  const thinkingScrollRef = useRef<HTMLDivElement | null>(null)
  const [thinkingPinned, setThinkingPinned] = useState(true)

  const downloadImage = useCallback(async (url: string) => {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Image download failed: HTTP ${res.status}`)
      const blob = await res.blob()
      const objUrl = URL.createObjectURL(blob)
      const fileFromUrl = (() => {
        try {
          const p = new URL(url).pathname.split('/').pop() || ''
          return p.trim()
        } catch {
          return ''
        }
      })()
      const safeName = fileFromUrl || `runware-${Date.now()}.jpg`
      const a = document.createElement('a')
      a.href = objUrl
      a.download = safeName
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(objUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const openLocalImage = useCallback(async (filePath: string) => {
    try {
      const vc = window.voidcast?.openPath
      if (!vc) throw new Error('Open image is available only in Electron app.')
      const r: unknown = await vc(filePath)
      if (typeof r === 'string') return
      const obj = r as { ok?: boolean; text?: string }
      if (obj.ok === false) throw new Error(obj.text || 'Failed to open image.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // Save settings on change
  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  /**
   * Prevent the browser from opening a file when a drop misses our drop target.
   * Without this the renderer navigates to the dropped image and the chat session is lost.
   */
  useEffect(() => {
    const preventDefault = (e: Event) => {
      const types = (e as globalThis.DragEvent).dataTransfer?.types
      if (!types) return
      for (let i = 0; i < types.length; i++) {
        if (types[i] === 'Files') {
          e.preventDefault()
          return
        }
      }
    }
    window.addEventListener('dragover', preventDefault)
    window.addEventListener('drop', preventDefault)
    return () => {
      window.removeEventListener('dragover', preventDefault)
      window.removeEventListener('drop', preventDefault)
    }
  }, [])

  const codingPanelAvailable = isElectron() && settings.toolsEnabled.coding

  useEffect(() => {
    if (!codingPanelAvailable) setShowCodingPanel(false)
  }, [codingPanelAvailable])

  // Keep UI state in sync when settings are changed outside React state (for example via agent tool).
  useEffect(() => {
    const interval = window.setInterval(() => {
      const stored = loadSettings()
      setSettings((prev) => {
        const changed =
          prev.llmSystemPrompt !== stored.llmSystemPrompt ||
          prev.llmNumCtx !== stored.llmNumCtx ||
          prev.llmTemperature !== stored.llmTemperature ||
          prev.uiTheme !== stored.uiTheme ||
          prev.runwareWidth !== stored.runwareWidth ||
          prev.runwareHeight !== stored.runwareHeight ||
          prev.runwareImageModel !== stored.runwareImageModel ||
          prev.runwareEditModel !== stored.runwareEditModel
        return changed ? stored : prev
      })
    }, 1000)
    return () => {
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (!isElectron()) return
    const getVersion = window.voidcast?.getAppVersion
    if (!getVersion) return
    void getVersion()
      .then((v) => {
        const version = String(v || '').trim()
        if (version) setAppVersion(version)
      })
      .catch(() => {
        // Keep fallback version text if IPC call fails.
      })
  }, [])

  useEffect(() => {
    if (!isElectron()) return
    const bridge = window.voidcast
    if (!bridge) return
    void bridge.setAutoUpdateEnabled(Boolean(settings.autoUpdate)).catch(() => {
      // Best-effort setting sync.
    })
    if (!settings.autoUpdate) return
    void bridge.checkForUpdates().catch(() => {
      // Best-effort automatic check.
    })
  }, [settings.autoUpdate])

  // Register cloud API keys on the local TTS server for LAN web proxy (keys never sent to phone).
  useEffect(() => {
    if (!isElectron()) return
    const root = settings.ttsBaseUrl.trim().replace(/\/+$/, '')
    if (!root) return
    const push = () =>
      void pushCloudSecretsToServer(root, {
        openrouterApiKey: settings.openrouterApiKey,
        runwareApiKey: settings.runwareApiKey,
        nvidiaApiKey: settings.nvidiaApiKey,
      }).catch(() => {
        // Best-effort; web client shows 503 if keys were not registered.
      })
    const timer = window.setTimeout(push, 250)
    const heartbeat = window.setInterval(push, 30000)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(heartbeat)
    }
  }, [
    settings.ttsBaseUrl,
    settings.openrouterApiKey,
    settings.runwareApiKey,
    settings.nvidiaApiKey,
  ])

  useEffect(() => {
    if (!isElectron()) return
    const root = settings.ttsBaseUrl.trim().replace(/\/+$/, '')
    if (!root || !settings.toolsEnabled.pdf) return
    const push = () =>
      void pushHostToolConfigToServer(root, {
        pdfOutputDir: settings.pdfOutputDir,
      }).catch(() => {})
    const timer = window.setTimeout(push, 300)
    const heartbeat = window.setInterval(push, 30000)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(heartbeat)
    }
  }, [settings.ttsBaseUrl, settings.toolsEnabled.pdf, settings.pdfOutputDir])

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-ui-theme', settings.uiTheme)
  }, [settings.uiTheme])

  // Load sessions from storage
  useEffect(() => {
    const state = loadChatSessions()
    let sessionsMigrated = false
    const sessions = state.sessions.map((s) => {
      if (!s.hiddenContextSummary?.trim()) return s
      const through = resolveContextCompressedThroughIndex(
        s.hiddenContextSummary,
        s.contextCompressedThroughIndex,
        s.messages.length,
      )
      if ((s.contextCompressedThroughIndex ?? 0) === through) return s
      sessionsMigrated = true
      return { ...s, contextCompressedThroughIndex: through }
    })
    setSessions(sessions)
    if (sessionsMigrated) {
      saveChatSessions({ sessions, activeSessionId: state.activeSessionId })
    }
    setActiveSessionId(state.activeSessionId)
    const active = state.activeSessionId
      ? sessions.find((s) => s.id === state.activeSessionId)
      : null
    setMessages(active?.messages ?? [])
    setAssistantGeneratedImages({})
    setAssistantSavedImagePaths({})
    setAssistantImageToolMeta({})
    setAssistantImageMessageMeta({})
    setAssistantGeneratedAudios({})
    setAssistantSavedAudioPaths({})
    setAssistantAudioToolMeta({})
    setAssistantAudioMessageMeta({})
    setHiddenContextSummary(active?.hiddenContextSummary ?? '')
    setContextCompressedThroughIndex(
      resolveContextCompressedThroughIndex(
        active?.hiddenContextSummary,
        active?.contextCompressedThroughIndex,
        active?.messages.length ?? 0,
      ),
    )
    const baseSettings = loadSettings()
    const fallbackPath = getCodingProjectPath(baseSettings)
    const projectPath = sessionCodingProjectPath(active ?? undefined, fallbackPath)
    if (projectPath !== fallbackPath) {
      setSettings(mergeCodingProjectPathIntoSettings(baseSettings, projectPath))
    }
    codingProjectPathForMemoRef.current = projectPath
    setCodingContextMemo(resolveMemoForSession(active ?? undefined, projectPath))
    setImageVisionCache(normalizeImageVisionCache(active?.imageVisionCache))
    setContextUsageInfo(null)
    setContextWarnDismissed(false)
    setSessionDirty(false)
    setSessionsHydrated(true)
  }, [])

  // Persist sessions
  useEffect(() => {
    if (!sessionsHydrated) return
    saveChatSessions({ sessions, activeSessionId })
  }, [sessions, activeSessionId, sessionsHydrated])

  // Auto-update sessions in state. When autoSaveChat is ON, auto-create new sessions too.
  // When OFF and no session ID, remains an unsaved draft until user clicks SAVE.
  useEffect(() => {
    if (!sessionsHydrated) return
    if (messages.length === 0) return

    // AutoSave OFF + no session ID → nothing to auto-update (manual save needed)
    if (!settings.autoSaveChat && !activeSessionId) return

    // AutoSave ON + no session ID yet → auto-create the session on first message
    if (!activeSessionId && settings.autoSaveChat) {
      const newId = uid()
      const now = Date.now()
      const projectPath = getCodingProjectPath(settings)
      const newSession: ChatSession = {
        id: newId,
        title: deriveSessionTitle(messages),
        createdAt: now,
        updatedAt: now,
        messages,
        hiddenContextSummary: hiddenContextSummary.trim() || undefined,
        contextCompressedThroughIndex: hiddenContextSummary.trim()
          ? contextCompressedThroughIndex
          : undefined,
        codingContextMemo: normalizeCodingContextMemo(codingContextMemo, projectPath),
        codingProjectPath: projectPath || undefined,
        imageVisionCache: normalizeImageVisionCache(imageVisionCache),
      }
      setSessions((prev) => [...prev, newSession].sort((a, b) => b.updatedAt - a.updatedAt))
      setActiveSessionId(newId)
      setSessionDirty(false)
      return
    }

    // activeSessionId exists — update existing session
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === activeSessionId)
      if (idx < 0) return prev
      const current = prev[idx]
      const nextHiddenContextSummary = hiddenContextSummary.trim() || undefined
      const nextCompressedThrough = nextHiddenContextSummary
        ? contextCompressedThroughIndex
        : undefined
      const projectPath = getCodingProjectPath(settings)
      const nextMemo = normalizeCodingContextMemo(codingContextMemo, projectPath)
      const sameMessagesRef = current.messages === messages
      const sameHiddenSummary =
        (current.hiddenContextSummary ?? '') === (nextHiddenContextSummary ?? '')
      const sameCompressedThrough =
        (current.contextCompressedThroughIndex ?? 0) === (nextCompressedThrough ?? 0)
      const sameMemo =
        JSON.stringify(current.codingContextMemo ?? null) === JSON.stringify(nextMemo)
      const sameCodingPath = (current.codingProjectPath ?? '') === projectPath
      const nextVisionCache = normalizeImageVisionCache(imageVisionCache)
      const sameVisionCache =
        JSON.stringify(current.imageVisionCache ?? null) === JSON.stringify(nextVisionCache)
      if (sameMessagesRef && sameHiddenSummary && sameCompressedThrough && sameMemo && sameCodingPath && sameVisionCache)
        return prev

      const next = [...prev]
      next[idx] = {
        ...current,
        updatedAt: Date.now(),
        messages,
        hiddenContextSummary: nextHiddenContextSummary,
        contextCompressedThroughIndex: nextCompressedThrough,
        codingContextMemo: nextMemo,
        codingProjectPath: projectPath || undefined,
        imageVisionCache: nextVisionCache,
      }
      next.sort((a, b) => b.updatedAt - a.updatedAt)
      return next
    })
    setSessionDirty(false)
  }, [
    messages,
    hiddenContextSummary,
    contextCompressedThroughIndex,
    codingContextMemo,
    imageVisionCache,
    activeSessionId,
    sessionsHydrated,
    settings.coding.projectPath,
    settings.codingProjectPath,
    settings.autoSaveChat,
  ])

  // Persist cross-session project snapshot (failures, files, commands) for new chats on same repo.
  useEffect(() => {
    const projectPath = getCodingProjectPath(settings)
    if (!projectPath) return
    const t = window.setTimeout(() => {
      saveProjectCodingMemo(projectPath, codingContextMemo)
    }, 400)
    return () => window.clearTimeout(t)
  }, [codingContextMemo, settings.coding.projectPath, settings.codingProjectPath])

  // TTS health check
  const refreshTts = useCallback(async () => {
    console.log('[VOIDCAST] Checking TTS at:', settings.ttsBaseUrl)
    try {
      const h = await checkTtsHealth({
        ttsBaseUrl: settings.ttsBaseUrl,
        ttsProvider: settings.ttsProvider,
        openrouterApiKey: settings.openrouterApiKey,
        runwareApiKey: settings.runwareApiKey,
      })
      console.log('[VOIDCAST] TTS health result:', h)
      setTtsOk(h.ok)
    } catch (e) {
      console.error('[VOIDCAST] TTS health check failed:', e)
      setTtsOk(false)
    }
  }, [settings.ttsBaseUrl, settings.ttsProvider, settings.openrouterApiKey, settings.runwareApiKey])

  useEffect(() => {
    void refreshTts()
    const t = window.setInterval(() => void refreshTts(), 15000)
    return () => window.clearInterval(t)
  }, [refreshTts])

  // Load Ollama models (sub-agent + LLM when provider is Ollama). Not gated on llmProvider
  // so SUB tab can list local vision models while main chat uses OpenRouter/NVIDIA.
  const loadOllamaModels = useCallback(async () => {
    setModelsError(null)
    setModelsLoading(true)
    try {
      const names = await fetchOllamaModels(settings.ollamaBaseUrl)
      setOllamaModels(names)
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : String(e))
      setOllamaModels([])
    } finally {
      setModelsLoading(false)
    }
  }, [settings.ollamaBaseUrl])

  const loadModels = loadOllamaModels

  useEffect(() => { void loadOllamaModels() }, [loadOllamaModels])

  useEffect(() => {
    void loadCloneRef().then((r) => { if (r) setCloneRef(r) })
  }, [])

  useEffect(() => {
    void loadVoiceAnchor().then((r) => { if (r) setVoiceAnchor(r) })
  }, [])

  useEffect(() => {
    if (screen === 'options' && (optionsTab === 'llm' || optionsTab === 'subAgent')) void loadOllamaModels()
  }, [screen, optionsTab, loadOllamaModels])

  // Save/restore chat scroll when switching between chat ↔ options.
  // The chat <main> is unmounted while options is shown, so we can't capture
  // scrollTop from a screen-change effect (ref is already null by then). Instead
  // we track it continuously via onScroll on the <main> and only restore here.
  useLayoutEffect(() => {
    if (screen === 'chat' && chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = savedChatScrollRef.current
    }
  }, [screen])

  const onChatScroll = useCallback((e: ReactUIEvent<HTMLElement>) => {
    savedChatScrollRef.current = e.currentTarget.scrollTop
  }, [])

  // Auto-scroll to bottom only when a new message is added (not during streaming)
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Auto-scroll to bottom when agent finishes (busy goes from true → false)
  useEffect(() => {
    if (!busy) {
      listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [busy])

  // Auto-scroll thinking div to bottom during streaming (when pinned)
  useEffect(() => {
    if (thinkingPinned && thinkingScrollRef.current) {
      thinkingScrollRef.current.scrollTop = thinkingScrollRef.current.scrollHeight
    }
  }, [messages])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (menuOpen) setMenuOpen(false)
        else if (screen === 'options') setScreen('chat')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen, screen])

  // Cleanup audio URL
  useEffect(() => {
    return () => { if (audioUrl) URL.revokeObjectURL(audioUrl) }
  }, [audioUrl])

  const canSend = useMemo(
    () => (!!input.trim() || pendingImages.length > 0 || pendingFiles.length > 0) && !busy,
    [input, pendingImages.length, pendingFiles.length, busy],
  )
  const activeSessionUseLongMemory = settings.longMemoryDefaultEnabled
  const canStop = busy
  const canSaveSession = settings.autoSaveChat
    ? false
    : messages.length > 0 && !busy && sessionDirty
  const todaySessions = useMemo(() => sessions.filter((s) => isToday(s.updatedAt)), [sessions])
  const olderSessions = useMemo(() => sessions.filter((s) => !isToday(s.updatedAt)), [sessions])
  const desktopRuntime = isElectron()
  const [emptyStateSeed] = useState(() => Math.floor(Math.random() * 1_000_000))
  const assistantRenderCache = useMemo(() => {
    const out: Record<
      string,
      {
        markdownContent: string
        inlineImageUrls: string[]
        localImagePaths: string[]
      }
    > = {}
    for (const m of messages) {
      if (m.role !== 'assistant') continue
      // Only URLs confirmed by a real generate_image / edit_image_runware tool result.
      // Do not trust image_url: lines copied into assistant text without a tool call.
      const trustedImageUrls = dedupeNonEmpty([
        ...(m.generatedImageUrls || []),
        ...(assistantGeneratedImages[m.id] || []),
      ])
      const trustedAudioUrls = dedupeNonEmpty([...(assistantGeneratedAudios[m.id] || [])])
      const markdownContent = desktopRuntime
        ? stripGeneratedAudioLinkArtifacts(
            stripGeneratedImageLinkArtifacts(
              m.content,
              trustedImageUrls,
            ),
            trustedAudioUrls,
          )
        : stripGeneratedAudioLinkArtifacts(
            stripGeneratedImageLinkArtifacts(
              stripRunwareAudioUrlLines(m.content),
              trustedImageUrls,
            ),
            trustedAudioUrls,
          )
      const markdownImageUrls = new Set(extractMarkdownImageUrls(m.content))
      const inlineImageUrls = trustedImageUrls.filter((u) => !markdownImageUrls.has(u))
      const localImagePaths = desktopRuntime
        ? dedupeNonEmpty([
            ...(m.generatedImagePaths || []),
            ...(assistantSavedImagePaths[m.id] || []),
          ])
        : []
      out[m.id] = { markdownContent, inlineImageUrls, localImagePaths }
    }
    return out
  }, [messages, assistantGeneratedImages, assistantGeneratedAudios, assistantSavedImagePaths, desktopRuntime])

  useEffect(() => {
    const readImageFile = window.voidcast?.readImageFile
    if (!desktopRuntime || !readImageFile) return
    const candidates = new Set<string>()
    for (const msg of messages) {
      if (msg.role !== 'assistant' || !msg.generatedImagePaths?.length) continue
      for (const p of msg.generatedImagePaths) {
        const path = (p || '').trim()
        if (path) candidates.add(path)
      }
    }
    for (const p of candidates) {
      if (localImagePreviews[p] || localPreviewLoadingRef.current.has(p)) continue
      localPreviewLoadingRef.current.add(p)
      void readImageFile({ path: p })
        .then((res) => {
          if (!res.ok || !res.file?.base64?.trim()) return
          setLocalImagePreviews((prev) => ({
            ...prev,
            [p]: {
              base64: res.file.base64.replace(/\s+/g, ''),
              mime: (res.file.mime || 'image/png').trim() || 'image/png',
            },
          }))
        })
        .finally(() => {
          localPreviewLoadingRef.current.delete(p)
        })
    }
  }, [desktopRuntime, localImagePreviews, messages])

  const syncCodingProjectPathToSettings = useCallback((path: string) => {
    const trimmed = path.trim()
    codingProjectPathForMemoRef.current = trimmed
    setSettings((s) => mergeCodingProjectPathIntoSettings(s, trimmed))
  }, [])

  /** User picked a new folder — reset memo for the new project. */
  const applyCodingProjectPath = useCallback((path: string) => {
    const trimmed = path.trim()
    if (codingProjectPathForMemoRef.current !== trimmed) {
      codingProjectPathForMemoRef.current = trimmed
      setCodingContextMemo(emptyCodingContextMemo(trimmed))
    }
    setSettings((s) => mergeCodingProjectPathIntoSettings(s, trimmed))
  }, [])

  const restoreCodingContextForSession = useCallback(
    (session: ChatSession, options?: { flushActiveSessionId?: string | null }) => {
      const fallbackPath = getCodingProjectPath(settings)
      const path = sessionCodingProjectPath(session, fallbackPath)
      const memo = resolveMemoForSession(session, path)

      const flushId = options?.flushActiveSessionId
      if (flushId) {
        setSessions((prev) => {
          const patched = patchSessionCodingState(
            prev,
            flushId,
            getCodingProjectPath(settings),
            codingContextMemo,
          )
          const idx = patched.findIndex((s) => s.id === flushId)
          if (idx < 0) return patched
          const cur = patched[idx]!
          const nextVisionCache = normalizeImageVisionCache(imageVisionCache)
          if (
            JSON.stringify(cur.imageVisionCache ?? null) === JSON.stringify(nextVisionCache)
          ) {
            return patched
          }
          const next = [...patched]
          next[idx] = { ...cur, updatedAt: Date.now(), imageVisionCache: nextVisionCache }
          return next
        })
      }

      syncCodingProjectPathToSettings(path)
      setCodingContextMemo(memo)
      setImageVisionCache(normalizeImageVisionCache(session.imageVisionCache))
    },
    [settings, codingContextMemo, imageVisionCache, syncCodingProjectPathToSettings],
  )

  // === Session Actions ===
  const newChat = () => {
    abortRef.current?.abort()
    ttsAbortRef.current?.abort()
    setMessages([])
    setAssistantGeneratedImages({})
    setAssistantSavedImagePaths({})
    setAssistantImageToolMeta({})
    setAssistantImageMessageMeta({})
    setAssistantGeneratedAudios({})
    setAssistantSavedAudioPaths({})
    setAssistantAudioToolMeta({})
    setAssistantAudioMessageMeta({})
    setHiddenContextSummary('')
    setContextCompressedThroughIndex(0)
    contextOverflowLatchRef.current = false
    setContextUsageInfo(null)
    setContextWarnDismissed(false)
    setActiveSessionId(null)
    setSessionDirty(false)
    setPendingDeleteId(null)
    setRenamingSessionId(null)
    setRenameValue('')
    setInput('')
    setPendingImages([])
    setError(null)
    setToolResultBanner(null)
    setCodingContextMemo(resolveMemoForNewChat(getCodingProjectPath(settings)))
    setImageVisionCache({})
    setMenuOpen(false)
  }

  const openSession = (session: ChatSession) => {
    abortRef.current?.abort()
    ttsAbortRef.current?.abort()
    const flushId =
      activeSessionId && activeSessionId !== session.id ? activeSessionId : null
    restoreCodingContextForSession(session, { flushActiveSessionId: flushId })
    setMessages(session.messages)
    setAssistantGeneratedImages({})
    setAssistantSavedImagePaths({})
    setAssistantImageToolMeta({})
    setAssistantImageMessageMeta({})
    setAssistantGeneratedAudios({})
    setAssistantSavedAudioPaths({})
    setAssistantAudioToolMeta({})
    setAssistantAudioMessageMeta({})
    const through = resolveContextCompressedThroughIndex(
      session.hiddenContextSummary,
      session.contextCompressedThroughIndex,
      session.messages.length,
    )
    setHiddenContextSummary(session.hiddenContextSummary ?? '')
    setContextCompressedThroughIndex(through)
    if (
      session.hiddenContextSummary?.trim() &&
      (session.contextCompressedThroughIndex ?? 0) !== through
    ) {
      const updated = { ...session, contextCompressedThroughIndex: through, updatedAt: Date.now() }
      setSessions((prev) => {
        const next = prev.map((s) => (s.id === session.id ? updated : s))
        saveChatSessions({ sessions: next, activeSessionId: session.id })
        return next
      })
    }
    setContextUsageInfo(null)
    setContextWarnDismissed(false)
    setActiveSessionId(session.id)
    setSessionDirty(false)
    setToolResultBanner(null)
    setPendingDeleteId(null)
    setRenamingSessionId(null)
    setRenameValue('')
    setMenuOpen(false)
    setPendingImages([])
  }

  const forkSession = (session: ChatSession) => {
    const now = Date.now()
    const forked: ChatSession = {
      id: uid(),
      title: `${session.title} (fork)`,
      createdAt: now,
      updatedAt: now,
      messages: session.messages,
      hiddenContextSummary: session.hiddenContextSummary,
      contextCompressedThroughIndex: session.contextCompressedThroughIndex,
      codingContextMemo: session.codingContextMemo,
      codingProjectPath: session.codingProjectPath,
      imageVisionCache: session.imageVisionCache,
    }
    const nextState = upsertSession({ sessions, activeSessionId }, forked)
    setSessions(nextState.sessions)
    setActiveSessionId(forked.id)
    saveChatSessions(nextState)
    setMessages(forked.messages)
    setAssistantGeneratedImages({})
    setAssistantSavedImagePaths({})
    setAssistantImageToolMeta({})
    setAssistantImageMessageMeta({})
    setAssistantGeneratedAudios({})
    setAssistantSavedAudioPaths({})
    setAssistantAudioToolMeta({})
    setAssistantAudioMessageMeta({})
    setHiddenContextSummary(forked.hiddenContextSummary ?? '')
    setContextCompressedThroughIndex(
      resolveContextCompressedThroughIndex(
        forked.hiddenContextSummary,
        forked.contextCompressedThroughIndex,
        forked.messages.length,
      ),
    )
    setContextUsageInfo(null)
    setContextWarnDismissed(false)
    setSessionDirty(false)
    setToolResultBanner(null)
    setPendingDeleteId(null)
    setRenamingSessionId(null)
    setRenameValue('')
    setMenuOpen(false)
    setPendingImages([])
    restoreCodingContextForSession(forked, {
      flushActiveSessionId:
        activeSessionId && activeSessionId !== forked.id ? activeSessionId : null,
    })
  }

  const exportSessionToMarkdown = (session: ChatSession) => {
    const lines: string[] = []
    lines.push(`# ${session.title}`)
    lines.push('')
    lines.push(`_Exported: ${new Date().toLocaleString()}_`)
    lines.push('')
    for (const m of session.messages) {
      const role = m.role === 'user' ? 'User' : 'Assistant'
      lines.push(`## ${role}`)
      lines.push('')
      if (m.content.trim()) {
        lines.push(m.content)
        lines.push('')
      }
      if (m.images?.length) {
        lines.push(`_(${m.images.length} image(s) attached)_`)
        lines.push('')
      }
      if (m.fileAttachments?.length) {
        for (const f of m.fileAttachments) {
          lines.push(`- **File:** ${f.name}`)
        }
        lines.push('')
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${session.title.replace(/[^a-z0-9\u0400-\u04FF\-]/gi, '_').slice(0, 60) || 'chat'}.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const setUseLongMemoryForActiveChat = (enabled: boolean) => {
    setSettings((prev) => ({ ...prev, longMemoryDefaultEnabled: enabled }))
  }

  const saveOrUpdateSession = () => {
    if (messages.length === 0) return
    const now = Date.now()
    const existing = activeSessionId ? sessions.find((s) => s.id === activeSessionId) : null
    const next: ChatSession = {
      id: existing?.id ?? uid(),
      title: existing?.title || deriveSessionTitle(messages),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      messages,
      hiddenContextSummary: hiddenContextSummary.trim() || undefined,
      contextCompressedThroughIndex: hiddenContextSummary.trim()
        ? contextCompressedThroughIndex
        : undefined,
      codingContextMemo: normalizeCodingContextMemo(
        codingContextMemo,
        getCodingProjectPath(settings),
      ),
      codingProjectPath: getCodingProjectPath(settings) || undefined,
      imageVisionCache: normalizeImageVisionCache(imageVisionCache),
    }
    const nextState = upsertSession({ sessions, activeSessionId }, next)
    setSessions(nextState.sessions)
    setActiveSessionId(nextState.activeSessionId)
    saveChatSessions(nextState)
    setSessionDirty(false)
  }

  const deleteSession = (sessionId: string) => {
    const state = deleteSessionById({ sessions, activeSessionId }, sessionId)
    setSessions(state.sessions)
    setActiveSessionId(state.activeSessionId)
    if (state.activeSessionId) {
      const next = state.sessions.find((s) => s.id === state.activeSessionId)
      setMessages(next?.messages ?? [])
      setAssistantGeneratedImages({})
      setAssistantSavedImagePaths({})
      setAssistantImageToolMeta({})
      setAssistantImageMessageMeta({})
      setAssistantGeneratedAudios({})
      setAssistantSavedAudioPaths({})
      setAssistantAudioToolMeta({})
      setAssistantAudioMessageMeta({})
      setHiddenContextSummary(next?.hiddenContextSummary ?? '')
      setContextCompressedThroughIndex(
        resolveContextCompressedThroughIndex(
          next?.hiddenContextSummary,
          next?.contextCompressedThroughIndex,
          next?.messages.length ?? 0,
        ),
      )
      if (next) restoreCodingContextForSession(next)
    } else {
      setMessages([])
      setAssistantGeneratedImages({})
      setAssistantSavedImagePaths({})
      setAssistantImageToolMeta({})
      setAssistantImageMessageMeta({})
      setAssistantGeneratedAudios({})
      setAssistantSavedAudioPaths({})
      setAssistantAudioToolMeta({})
      setAssistantAudioMessageMeta({})
      setHiddenContextSummary('')
      setContextCompressedThroughIndex(0)
      contextOverflowLatchRef.current = false
      setCodingContextMemo(resolveMemoForNewChat(getCodingProjectPath(settings)))
      setImageVisionCache({})
    }
    setContextUsageInfo(null)
    setContextWarnDismissed(false)
    saveChatSessions(state)
    setSessionDirty(false)
    setPendingDeleteId(null)
    if (renamingSessionId === sessionId) {
      setRenamingSessionId(null)
      setRenameValue('')
    }
  }

  const startRenameSession = (session: ChatSession) => {
    setPendingDeleteId(null)
    setRenamingSessionId(session.id)
    setRenameValue(session.title)
  }

  const cancelRenameSession = () => {
    setRenamingSessionId(null)
    setRenameValue('')
  }

  const commitRenameSession = (sessionId: string) => {
    const nextTitle = renameValue.trim().replace(/\s+/g, ' ')
    if (!nextTitle) return
    const updated = sessions.map((s) =>
      s.id === sessionId ? { ...s, title: nextTitle, updatedAt: Date.now() } : s
    )
    setSessions(updated)
    saveChatSessions({ sessions: updated, activeSessionId })
    setRenamingSessionId(null)
    setRenameValue('')
  }

  const openOptions = (tab: OptionsTab = 'general') => {
    setOptionsTab(tab)
    setScreen('options')
    setMenuOpen(false)
  }

  // Context summarization
  const summarizeContextNow = useCallback(async () => {
    if (busy || contextCompressBusy) return
    const turns = toConversationTurns(messages)
    if (turns.length === 0) return

    setContextCompressBusy(true)
    setError(null)
    try {
      const compressed = await compressConversationContext({
        provider: settings.llmProvider,
        ollamaBaseUrl: settings.ollamaBaseUrl,
        ollamaModel: settings.ollamaModel,
        openrouterBaseUrl: settings.openrouterBaseUrl,
        openrouterApiKey: settings.openrouterApiKey,
        openrouterModel: settings.openrouterModel,
        nvidiaBaseUrl: settings.nvidiaBaseUrl,
        nvidiaApiKey: settings.nvidiaApiKey,
        nvidiaModel: settings.nvidiaModel,
        turns,
        existingSummary: hiddenContextSummary,
        modelOptions: { temperature: settings.llmTemperature, num_ctx: settings.llmNumCtx },
      })
      const nextSummary = compressed.trim()
      if (!nextSummary) return
      const throughIndex = messages.length
      setHiddenContextSummary(nextSummary)
      setContextCompressedThroughIndex(throughIndex)
      setContextWarnDismissed(true)

      if (activeSessionId) {
        setSessions((prev) => {
          const updated = prev.map((s) =>
            s.id === activeSessionId
              ? {
                  ...s,
                  hiddenContextSummary: nextSummary,
                  contextCompressedThroughIndex: throughIndex,
                  updatedAt: Date.now(),
                }
              : s,
          )
          saveChatSessions({ sessions: updated, activeSessionId })
          return updated
        })
      }
    } catch (e) {
      contextOverflowLatchRef.current = false
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setContextCompressBusy(false)
    }
  }, [activeSessionId, busy, contextCompressBusy, hiddenContextSummary, messages, settings])

  useEffect(() => {
    if (!contextUsageInfo) return
    if (contextUsageInfo.ratio < CONTEXT_COMPRESS_RATIO_RESET) {
      contextOverflowLatchRef.current = false
      return
    }
    if (!contextUsageInfo.shouldCompress) return
    if (!settings.contextAutoCompress) return
    if (busy || contextCompressBusy || contextOverflowLatchRef.current) return
    if (messages.length < 4) return

    contextOverflowLatchRef.current = true
    void summarizeContextNow()
  }, [
    busy,
    contextCompressBusy,
    contextUsageInfo,
    messages.length,
    settings.contextAutoCompress,
    summarizeContextNow,
  ])

  const subAgentUi = useMemo<SubAgentUiCallbacks>(
    () => ({
      onStart: (imageCount) => {
        setSubAgentPanelOpen(true)
        setSubAgentPanelBusy(true)
        setSubAgentPanelText(`SUB_AGENT: analyzing ${imageCount} image(s)…`)
      },
      onProgress: (current, total) => {
        setSubAgentPanelText(`SUB_AGENT: image ${current}/${total}…`)
      },
      onDone: (formatted) => {
        setSubAgentPanelBusy(false)
        setSubAgentPanelText(formatted || '[Sub-agent returned no descriptions.]')
      },
    }),
    [],
  )

  const extractLongMemoryNow = useCallback(async () => {
    if (busy || longMemoryBusy) return
    const turns = toConversationTurns(messages)
    if (turns.length === 0) return
    setLongMemoryBusy(true)
    setError(null)
    try {
      const useSub = settings.subAgent.enabled
      const subModel = settings.subAgent.model
      const subProvider = detectSubAgentProvider(subModel)
      const memLlmProvider = useSub
        ? subProvider === 'ollama'
          ? 'ollama'
          : 'openrouter'
        : settings.llmProvider
      const candidates = await extractLongMemoryCandidates({
        provider: memLlmProvider,
        ollamaBaseUrl: settings.ollamaBaseUrl,
        ollamaModel: useSub && subProvider === 'ollama' ? subModel : settings.ollamaModel,
        openrouterBaseUrl: settings.openrouterBaseUrl,
        openrouterApiKey: settings.openrouterApiKey,
        openrouterModel: useSub && subProvider !== 'ollama' ? subModel : settings.openrouterModel,
        nvidiaBaseUrl: settings.nvidiaBaseUrl,
        nvidiaApiKey: settings.nvidiaApiKey,
        nvidiaModel: settings.nvidiaModel,
        modelOptions: {
          temperature: settings.llmTemperature,
          num_ctx: useSub ? (settings.subAgent.contextTokens ?? 8192) : settings.llmNumCtx,
        },
        turns,
      })
      if (candidates.length === 0) {
        setError('No stable long-memory items found in this chat.')
        return
      }
      setMemoryCandidates(candidates)
      setMemoryPreviewOpen(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLongMemoryBusy(false)
    }
  }, [busy, longMemoryBusy, messages, settings.subAgent, settings.llmProvider, settings])

  const confirmSaveLongMemory = useCallback(async () => {
    if (!memoryCandidates.length) {
      setMemoryPreviewOpen(false)
      return
    }
    setLongMemoryBusy(true)
    setError(null)
    try {
      await upsertMemories(memoryCandidates, activeSessionId ?? 'draft')
      await dedupeMemories()
      scheduleUserDataSync(settings.ttsBaseUrl)
      setLongMemories(await listMemories(100))
      setMemoryPreviewOpen(false)
      setMemoryCandidates([])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLongMemoryBusy(false)
    }
  }, [activeSessionId, memoryCandidates])

  const refreshLongMemories = useCallback(async () => {
    try {
      setLongMemories(await listMemories(100))
    } catch {
      // ignore
    }
  }, [])

  const refreshReminders = useCallback(async () => {
    try {
      setReminders(await listReminders())
    } catch {
      // ignore
    }
  }, [])

  const syncUserDataAndRefresh = useCallback(async () => {
    await syncUserDataNow(settings.ttsBaseUrl)
    if (isWebStandalone()) {
      setHostPdfOutputDir(await fetchHostToolConfig(settings.ttsBaseUrl))
    }
    await refreshLongMemories()
    await refreshReminders()
  }, [settings.ttsBaseUrl, refreshLongMemories, refreshReminders])

  useEffect(() => {
    void syncUserDataAndRefresh()
    const heartbeat = window.setInterval(() => scheduleUserDataSync(settings.ttsBaseUrl), 30_000)
    return () => window.clearInterval(heartbeat)
  }, [settings.ttsBaseUrl, syncUserDataAndRefresh])

  /**
   * Desktop notifications for due reminders.
   *
   * Renderer-side polling (every 30s). Notifications use the browser
   * `Notification` API which Electron forwards to the OS as native toasts
   * on Windows. We persist `notifiedAt` on the reminder so a refresh /
   * restart does not refire the same one. Closed-app notifications would
   * require OS-level scheduling and are explicitly out of scope.
   */
  useEffect(() => {
    if (!settings.reminderNotificationsEnabled) return
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return

    let cancelled = false
    let timer: number | null = null

    const tick = async () => {
      if (cancelled) return
      if (Notification.permission !== 'granted') return
      try {
        const due = await listDueUnnotifiedReminders(Date.now())
        if (cancelled || due.length === 0) return
        let firedAny = false
        for (const r of due) {
          try {
            const n = new Notification('VOIDCAST reminder', {
              body: r.text,
              tag: r.id,
              requireInteraction: false,
            })
            n.onclick = () => {
              try {
                window.focus()
                setScreen('options')
                setOptionsTab('general')
              } catch {
                // ignore focus errors
              }
              n.close()
            }
            const notifiedTs = Date.now()
            await markReminderNotified(r.id, notifiedTs)
            scheduleUserDataSync(settings.ttsBaseUrl)
            firedAny = true
          } catch {
            // single failure shouldn't block other reminders
          }
        }
        if (firedAny) {
          void refreshReminders()
        }
      } catch {
        // ignore tick errors
      }
    }

    void tick()
    timer = window.setInterval(() => void tick(), 30_000)
    return () => {
      cancelled = true
      if (timer != null) window.clearInterval(timer)
    }
  }, [settings.reminderNotificationsEnabled, settings.ttsBaseUrl, refreshReminders])

  const deleteLongMemoryById = useCallback(async (id: string) => {
    await deleteMemory(id)
    recordMemoryDeleted(id)
    scheduleUserDataSync(settings.ttsBaseUrl)
    await refreshLongMemories()
  }, [refreshLongMemories, settings.ttsBaseUrl])

  const updateLongMemoryById = useCallback(async (id: string, text: string) => {
    await updateMemoryText(id, text)
    scheduleUserDataSync(settings.ttsBaseUrl)
    await refreshLongMemories()
  }, [refreshLongMemories, settings.ttsBaseUrl])

  useEffect(() => {
    if (screen === 'options' && optionsTab === 'general') {
      void syncUserDataAndRefresh()
    }
  }, [optionsTab, screen, syncUserDataAndRefresh])

  // === Send Message ===
  const onSend = async (opts?: { text?: string; history?: UiMessage[]; skipAddUserMsg?: boolean }) => {
    const isEdit = Boolean(opts?.skipAddUserMsg)
    const text = isEdit ? (opts?.text ?? '') : input.trim()
    const activeHistory = opts?.history ?? messages
    const queued = isEdit ? [] : pendingImages
    const queuedFiles = isEdit ? [] : pendingFiles
    if ((!text && queued.length === 0 && queuedFiles.length === 0) || busy) return
    setError(null)
    if (!isEdit) {
      setPendingImages([])
      setPendingFiles([])
      setInput('')
    }

    const imagesBase64 = queued.map((q) => q.base64)
    const imageMimes = queued.map((q) => q.mime)
    const imageNames = queued.map((q) => (q.name || '').trim())
    const imagePaths = queued.map((q) => (q.path || '').trim())
    const toolImageCatalog = await buildToolImageCatalog(activeHistory, queued)
    const hasCurrentAttach = imagesBase64.length > 0
    // When sub-agent is enabled, NEVER send images to the main model —
    // it delegates vision to the sub-agent via image_recall tool.
    const useVisionForCurrentMessage =
      !settings.subAgent.enabled &&
      (hasCurrentAttach || shouldUseVisionForText(text))
    const visionImagesForCurrentMessage = useVisionForCurrentMessage
      ? hasCurrentAttach
        ? imagesBase64
        : toolImageCatalog.slice(0, 1).map((x) => x.base64)
      : []
    const attachedImageHint = buildQueuedImagePathHint(queued)
    const imageCatalogHint =
      settings.toolsEnabled.runwareImage && toolImageCatalog.length > 0
        ? buildImageCatalogHint(toolImageCatalog, queued.length)
        : ''
    const attachedFileHint = buildQueuedFilePathHint(queuedFiles)
    const ollamaUserText = [text, attachedImageHint, imageCatalogHint, attachedFileHint]
      .filter((x) => x.trim().length > 0)
      .join('\n\n')
    let userMsg: UiMessage | undefined
    if (!isEdit) {
      userMsg = {
        id: uid(),
        role: 'user',
        content: text,
        ...(imagesBase64.length > 0
          ? { images: imagesBase64, imageMimes, imageNames, imagePaths }
          : {}),
        ...(queuedFiles.length > 0
          ? {
              fileAttachments: queuedFiles.map((f) => ({
                id: f.id,
                name: f.name,
                path: f.path,
                mime: f.mime,
                size: f.size,
                ext: f.ext,
                content: f.content,
                truncated: f.truncated,
              })),
            }
          : {}),
      }
    }
    const asstId = uid()
    const runId = activeChatRunIdRef.current + 1
    activeChatRunIdRef.current = runId
    const asstMsg: UiMessage = { id: asstId, role: 'assistant', content: '' }
    if (isEdit) {
      setMessages(() => [...activeHistory, asstMsg])
    } else {
      setMessages((m) => [...m, userMsg!, asstMsg])
    }
    setSessionDirty(true)
    setBusy(true)
    setToolPhase(null)
    setToolResultBanner(null)

    const historyForApi: UiMessage[] = sliceUiHistoryForContext(
      activeHistory,
      hiddenContextSummary,
      contextCompressedThroughIndex,
    )
    const priorHistory: HistoryTurn[] = historyForApi.reduce<HistoryTurn[]>((acc, x) => {
      if (x.role === 'user') {
        const fileHint = x.fileAttachments?.length
          ? [
              'Attached files in this user turn:',
              ...x.fileAttachments.map((f, idx) => `- ${idx + 1}: ${f.path || f.name}`),
              'File snapshots are stored in the original attachment turn.',
            ].join('\n')
          : ''
        const imageRecallHint = buildHistoricalImageRecallHint(x, toolImageCatalog, imageVisionCache)
        const t: HistoryTurn = {
          role: 'user',
          content: [x.content, fileHint, imageRecallHint].filter((v) => v.trim().length > 0).join('\n\n') ||
            (x.images?.length
              ? 'Attached image(s) were provided in this message.'
              : x.fileAttachments?.length
                ? 'Attached file(s) were provided in this message.'
                : ''),
        }
        acc.push(t)
        return acc
      }
      // Some providers reject empty assistant turns (common right after abort).
      if (!x.content.trim() && !x.thinking?.trim()) return acc
      const imageVisionHint = buildAssistantImageVisionHint(x, imageVisionCache)
      acc.push({
        role: 'assistant',
        content: [x.content, imageVisionHint].filter((v) => v.trim().length > 0).join('\n\n'),
        ...(x.thinking?.trim() ? { thinking: x.thinking } : {}),
      })
      return acc
    }, [])

    const useTools = anyToolEnabled(settings.toolsEnabled)
    const runtimeTimeHint = buildRuntimeTimeHint()
    const toolsHintParts: string[] = []
    if (useTools) toolsHintParts.push(TOOLS_TRUTH_HINT)
    if (settings.toolsEnabled.webSearch) toolsHintParts.push(TOOLS_WEB_SEARCH_HINT)
    if (settings.toolsEnabled.youtube) toolsHintParts.push(TOOLS_YOUTUBE_HINT)
    if (settings.toolsEnabled.reddit) toolsHintParts.push(TOOLS_REDDIT_HINT)
    if (settings.toolsEnabled.weather) toolsHintParts.push(TOOLS_WEATHER_HINT)
    if (settings.toolsEnabled.scrape) toolsHintParts.push(TOOLS_SCRAPE_HINT)
    if (settings.toolsEnabled.pdf) toolsHintParts.push(TOOLS_PDF_HINT)
    if (settings.toolsEnabled.runwareImage) toolsHintParts.push(TOOLS_RUNWARE_IMAGE_HINT)
    if (settings.toolsEnabled.runwareMusic) toolsHintParts.push(TOOLS_RUNWARE_MUSIC_HINT)
    if (settings.toolsEnabled.coding) {
      toolsHintParts.push(
        [
          'Coding tools are available for local project operations.',
          `Coding project path: ${settings.coding.projectPath || settings.codingProjectPath || '(not set)'}`,
          'Use glob_files or list_directory to find paths; git_status / git_diff for repo changes; read_file with start_line/end_line or max_chars on large files; search_files accepts path_prefix.',
        ].join('\n'),
      )
      toolsHintParts.push(TOOLS_CODING_CHAT_IMAGE_ASSETS_HINT)
      if (settings.toolsEnabled.runwareImage) {
        toolsHintParts.push(
          'image_recall can load vision bytes from image files inside the coding project folder (use reference_image_paths with a project-relative path such as demos/name.png).',
        )
      }
      toolsHintParts.push(buildCodingMemoHint(codingContextMemo))
    }
    if (useTools) {
      const visible = getAgentVisibleSettings(settings)
      const settingsHint = [
        'You have an update_settings tool for app configuration.',
        'Allowed fields: llmSystemPrompt, llmNumCtx, llmTemperature, uiTheme, longMemoryAdd, autoVoice, runwareResolution, runwareWidth, runwareHeight, runwareImageModel, runwareEditModel.',
        `Current llmSystemPrompt: ${JSON.stringify(String(visible.llmSystemPrompt ?? ''))}`,
        `Current llmNumCtx: ${String(visible.llmNumCtx ?? '')}`,
        `Current llmTemperature: ${String(visible.llmTemperature ?? '')}`,
        `Current uiTheme: ${String(visible.uiTheme ?? '')}`,
        `Current autoVoice: ${String(visible.autoVoice ?? '')}`,
        `Current runwareWidth: ${String(visible.runwareWidth ?? '')}`,
        `Current runwareHeight: ${String(visible.runwareHeight ?? '')}`,
        `Current runwareImageModel: ${String(visible.runwareImageModel ?? '')}`,
        `Current runwareEditModel: ${String(visible.runwareEditModel ?? '')}`,
        'Sensitive keys are hidden; never ask to reveal API keys.',
      ].join('\n')
      toolsHintParts.push(settingsHint)
      const remindersHint = [
        'You have reminder tools: add_reminder (set a note or scheduled reminder), list_reminders (show what is coming up), delete_reminder (cancel/remove), and update_reminder (reschedule or edit text/tags).',
        'For add_reminder, pass ISO datetime in "when" for scheduled, or omit for general.',
        'For list_reminders, use "today", "tomorrow", or date ranges like "next 3 days" in from/to.',
        'For delete_reminder and update_reminder, pass search_text to find the reminder by its text.',
      ].join('\n')
      toolsHintParts.push(remindersHint)
    }
    const retrievedLongMemory = activeSessionUseLongMemory
      ? await searchMemories({
          query: [text, hiddenContextSummary].filter(Boolean).join('\n'),
          limit: 8,
          minConfidence: 0.35,
        })
      : []
    const longMemoryContext = retrievedLongMemory.length > 0
      ? retrievedLongMemory
          .map((m, idx) => `- ${idx + 1}. [${m.kind}] ${m.text}`)
          .join('\n')
          .slice(0, 1200)
      : undefined
    const history = buildOllamaMessages(
      priorHistory,
      ollamaUserText,
      {
        systemPrompt: settings.llmSystemPrompt,
        runtimeSystemHint: runtimeTimeHint,
        hiddenContextSummary: hiddenContextSummary.trim() || undefined,
        longTermMemoryContext: longMemoryContext,
        toolsSystemHint: useTools && toolsHintParts.length > 0 ? toolsHintParts.join('\n\n') : undefined,
        newUserImages: visionImagesForCurrentMessage.length > 0
          ? visionImagesForCurrentMessage
          : undefined,
        includeThinkingInHistory: isThinkingUiEnabled(settings.llmThinkLevel),
      },
    )
    const activeRunwareProfile = getRunwareProfileForModel(
      settings,
      settings.runwareImageModel,
    )
    const activeRunwareEditProfile = getRunwareProfileForModel(
      settings,
      settings.runwareEditModel,
    )
    const activeRunwareMusicProfile = getRunwareMusicProfileForModel(
      settings,
      settings.runwareMusicModel,
    )

    const ac = new AbortController()
    abortRef.current = ac
    const isRunActive = () => activeChatRunIdRef.current === runId && !ac.signal.aborted
    let replyText = ''
    let usage: { prompt_eval_count?: number; eval_count?: number } | undefined

    try {
      if (useTools) {
        const commonToolParams = {
          initialMessages: history,
          rawUserText: text,
          modelOptions: { temperature: settings.llmTemperature, num_ctx: settings.llmNumCtx },
          toolsEnabled: settings.toolsEnabled,
          ttsBaseUrl: settings.ttsBaseUrl,
          pdfOutputDir: effectivePdfOutputDir,
          runware: {
            apiBaseUrl: settings.runwareApiBaseUrl,
            apiKey: settings.runwareApiKey,
            proxyBaseUrl: settings.ttsBaseUrl,
            model: settings.runwareImageModel,
            editModel: settings.runwareEditModel,
            width: activeRunwareProfile.width,
            height: activeRunwareProfile.height,
            steps: activeRunwareProfile.steps,
            cfgScale: activeRunwareProfile.cfgScale,
            gptQuality: activeRunwareProfile.gptQuality,
            editDefaults: {
              width: activeRunwareEditProfile.width,
              height: activeRunwareEditProfile.height,
              steps: activeRunwareEditProfile.steps,
              cfgScale: activeRunwareEditProfile.cfgScale,
              gptQuality: activeRunwareEditProfile.gptQuality,
            },
            negativePrompt: settings.runwareNegativePrompt,
            musicDefaults: {
              model: settings.runwareMusicModel,
              outputFormat: activeRunwareMusicProfile.outputFormat,
              durationSec: activeRunwareMusicProfile.durationSec,
              steps: activeRunwareMusicProfile.steps,
              cfgScale: activeRunwareMusicProfile.cfgScale,
              guidanceType: settings.runwareMusicGuidanceType,
              vocalLanguage: settings.runwareMusicVocalLanguage,
              seed: activeRunwareMusicProfile.seed ?? undefined,
            },
          },
          userImages: toolImageCatalog.map((x) => x.base64),
          userImageMimes: toolImageCatalog.map((x) => x.mime),
          userImagePaths: toolImageCatalog.map((x) => x.path || ''),
          codingProjectPath: settings.coding.projectPath || settings.codingProjectPath,
          subAgent: settings.subAgent,
          ollamaBaseUrlForSubAgent: settings.ollamaBaseUrl,
          openrouterBaseUrlForSubAgent: settings.openrouterBaseUrl,
          openrouterApiKeyForSubAgent: settings.openrouterApiKey,
          subAgentUi:
            settings.subAgent.enabled && settings.subAgent.showAnalysisWindow !== false
              ? subAgentUi
              : undefined,
          onImageVisionCacheUpdate: (entries: ImageVisionCache) => {
            setImageVisionCache((prev) => mergeImageVisionCache(prev, entries))
          },
          signal: ac.signal,
          onThinkingDelta: isThinkingUiEnabled(settings.llmThinkLevel)
            ? (thinking: string) => {
                if (!isRunActive()) return
                setMessages((prev) =>
                  prev.map((m) => (m.id === asstId ? { ...m, thinking } : m)),
                )
              }
            : undefined,
          onDelta: (full: string) => {
            if (!isRunActive()) return
            setMessages((prev) => prev.map((m) => m.id === asstId ? { ...m, content: full } : m))
          },
          // Agent calls onToolPhase(null) between tool batches and the next model stream; if we
          // cleared here, the UI would flash real phases for ms then fall back to PROCESSING...
          // Keep the last non-null phase until the turn ends (finally clears).
          onToolPhase: (phase: AgentToolUiPhase | null) => {
            if (!isRunActive()) return
            if (phase !== null) setToolPhase(phase)
          },
          onToolResult: ({ name, result, args }: { name: string; result: string; args?: Record<string, unknown> }) => {
            if (!isRunActive()) return
            setToolPhase(toolPhaseForAgentTool(name))
            if (name === 'add_reminder' || name === 'list_reminders' || name === 'delete_reminder' || name === 'update_reminder') {
              void refreshReminders()
              scheduleUserDataSync(settings.ttsBaseUrl)
            }
            if (name === 'update_settings') {
              setSettings(loadSettings())
              void refreshLongMemories()
              scheduleUserDataSync(settings.ttsBaseUrl)
            }
            if (
              name === 'list_directory' ||
              name === 'read_file' ||
              name === 'write_file' ||
              name === 'edit_code' ||
              name === 'search_files' ||
              name === 'glob_files' ||
              name === 'git_status' ||
              name === 'git_diff' ||
              name === 'git_log' ||
              name === 'git_show' ||
              name === 'execute_command'
            ) {
              setCodingContextMemo((prev) => {
                const next = { ...prev }
                if (name === 'list_directory') {
                  const p = typeof args?.path === 'string' ? args.path : ''
                  next.lastDirectory = p || '.'
                } else if (name === 'glob_files') {
                  const p = typeof args?.path_prefix === 'string' ? args.path_prefix : ''
                  if (p) next.lastDirectory = p
                } else if (name === 'read_file' || name === 'write_file' || name === 'edit_code') {
                  const p = typeof args?.path === 'string' ? args.path : ''
                  let entry = p
                  if (name === 'read_file' && entry) {
                    const s = typeof args?.start_line === 'number' ? args.start_line : undefined
                    const e = typeof args?.end_line === 'number' ? args.end_line : undefined
                    if (s !== undefined && e !== undefined) entry = `${entry} (lines ${s}-${e})`
                    else if (s !== undefined) entry = `${entry} (from line ${s})`
                    else if (e !== undefined) entry = `${entry} (to line ${e})`
                  } else if (name === 'edit_code' && entry) {
                    entry = formatEditedFileMemoEntry(entry, result)
                  } else if (name === 'write_file' && entry) {
                    entry = `${entry} (written)`
                  }
                  if (entry) next.recentFiles = pushRecentUnique(next.recentFiles, entry)
                } else if (name === 'search_files') {
                  const q = typeof args?.query === 'string' ? args.query : ''
                  next.recentSearches = pushRecentUnique(next.recentSearches, q, 6)
                } else if (name === 'git_status' || name === 'git_diff' || name === 'git_log' || name === 'git_show') {
                  let label = name
                  if (name === 'git_log') {
                    const p = typeof args?.path === 'string' ? args.path : ''
                    label = p ? `git_log -- ${p}` : 'git_log'
                  } else if (name === 'git_show') {
                    const ref = typeof args?.ref === 'string' ? args.ref : ''
                    const p = typeof args?.path === 'string' ? args.path : ''
                    label = p ? `git_show ${ref || 'HEAD'} -- ${p}` : `git_show ${ref || 'HEAD'}`
                  } else if (name === 'git_diff') {
                    const p = typeof args?.path === 'string' ? args.path : ''
                    const staged = args?.staged === true
                    label = p ? `git_diff${staged ? ' --staged' : ''} -- ${p}` : `git_diff${staged ? ' --staged' : ''}`
                  }
                  next.recentGitOps = pushRecentUnique(next.recentGitOps, label, 6)
                } else if (name === 'execute_command') {
                  const c = typeof args?.command === 'string' ? args.command : ''
                  const ok = !isCodingToolFailure('execute_command', result)
                  next.recentCommands = pushRecentCommand(
                    next.recentCommands,
                    { command: c, ok, snippet: commandResultSnippet(result) },
                    6,
                  )
                }

                if (isCodingToolFailure(name, result)) {
                  let failureLabel = name
                  if (name === 'edit_code' || name === 'read_file' || name === 'write_file') {
                    const p = typeof args?.path === 'string' ? args.path : ''
                    if (p) failureLabel = `${name} (${p})`
                  } else if (name === 'execute_command') {
                    const c = typeof args?.command === 'string' ? args.command : ''
                    if (c) failureLabel = `${name}: ${c.split(' ')[0]}`
                  }
                  const failureEntry = `${failureLabel}: ${result.slice(0, 120)}`
                  next.recentFailures = pushRecentUnique(next.recentFailures, failureEntry, 6)
                }

                return normalizeCodingContextMemo(next, getCodingProjectPath(settings))
              })
            }

            if (name === 'execute_command') {
              const cmd = typeof args?.command === 'string' ? args.command : ''
              const raw = String(result ?? '').trimEnd()
              const MAX = 120_000
              const body =
                raw.length > MAX
                  ? `${raw.slice(0, MAX)}\n\n… [truncated ${(raw.length - MAX).toLocaleString()} chars]`
                  : raw
              const ts = Date.now()
              const idBase = `${ts}-${Math.random().toString(36).slice(2, 9)}`
              setCodingTerminalFeed((prev) =>
                [
                  ...prev,
                  {
                    id: `exec-cmd-${idBase}`,
                    stream: 'system' as const,
                    text: `$ ${cmd || '(empty command)'}`,
                    ts,
                  },
                  ...(body
                    ? ([
                        {
                          id: `exec-out-${idBase}`,
                          stream: 'stdout' as const,
                          text: body,
                          ts,
                        },
                      ] as const)
                    : []),
                ].slice(-80),
              )
            }
            if (name === 'write_file' || name === 'edit_code' || name === 'execute_command') {
              setCodingFileTreeNonce((n) => n + 1)
            }
            if (name === 'save_pdf') {
              setToolResultBanner({ kind: 'pdf', text: result })
            }
            if (name === 'generate_image' || name === 'edit_image_runware') {
              const urls = extractRunwareImageUrls(result)
              const meta = parseRunwareImageToolMeta(result)
              if (meta) {
                setAssistantImageMessageMeta((prev) => ({ ...prev, [asstId]: meta }))
              }
              if (urls.length > 0) {
                setMessages((prev) =>
                  prev.map((m) => {
                    if (m.id !== asstId) return m
                    return {
                      ...m,
                      generatedImageUrls: dedupeNonEmpty([
                        ...(m.generatedImageUrls || []),
                        ...urls,
                      ]),
                    }
                  }),
                )
                setAssistantGeneratedImages((prev) => {
                  const cur = prev[asstId] || []
                  const next = Array.from(new Set([...cur, ...urls]))
                  return { ...prev, [asstId]: next }
                })
                if (meta) {
                  setAssistantImageToolMeta((prev) => {
                    const cur = prev[asstId] || {}
                    const next = { ...cur }
                    for (const u of urls) next[u] = meta
                    return { ...prev, [asstId]: next }
                  })
                }
                if (settings.runwareAutoSaveImages && settings.runwareImageOutputDir.trim()) {
                  void (async () => {
                    const saved: string[] = []
                    for (const u of urls) {
                      const txt = await invokeSaveImageFromUrl({
                        imageUrl: u,
                        outputDir: settings.runwareImageOutputDir,
                      }).catch((e) => (e instanceof Error ? e.message : String(e)))
                      saved.push(txt)
                    }
                    if (saved.length > 0) {
                      const savedPaths = extractSavedImagePaths(saved.join('\n'))
                      if (savedPaths.length > 0) {
                        setMessages((prev) =>
                          prev.map((m) => {
                            if (m.id !== asstId) return m
                            return {
                              ...m,
                              generatedImagePaths: dedupeNonEmpty([
                                ...(m.generatedImagePaths || []),
                                ...savedPaths,
                              ]),
                              generatedImageUrls: dedupeNonEmpty([
                                ...(m.generatedImageUrls || []),
                                ...urls,
                              ]),
                            }
                          }),
                        )
                        setAssistantSavedImagePaths((prev) => {
                          const cur = prev[asstId] || []
                          const next = Array.from(new Set([...cur, ...savedPaths]))
                          return { ...prev, [asstId]: next }
                        })
                      }
                    }
                  })()
                }
              }
            }
            if (name === 'generate_music_runware') {
              const urls = extractRunwareAudioUrls(result)
              const meta = parseRunwareAudioToolMeta(result)
              if (meta) {
                setAssistantAudioMessageMeta((prev) => ({ ...prev, [asstId]: meta }))
              }
              if (urls.length > 0) {
                setAssistantGeneratedAudios((prev) => {
                  const cur = prev[asstId] || []
                  const next = Array.from(new Set([...cur, ...urls]))
                  return { ...prev, [asstId]: next }
                })
                if (meta) {
                  setAssistantAudioToolMeta((prev) => {
                    const cur = prev[asstId] || {}
                    const next = { ...cur }
                    for (const u of urls) next[u] = meta
                    return { ...prev, [asstId]: next }
                  })
                }
              }
              if (urls.length > 0 && settings.runwareAutoSaveMusic && settings.runwareMusicOutputDir.trim()) {
                void (async () => {
                  const saved: string[] = []
                  for (const u of urls) {
                    const txt = await invokeSaveAudioFromUrl({
                      audioUrl: u,
                      outputDir: settings.runwareMusicOutputDir,
                    }).catch((e) => (e instanceof Error ? e.message : String(e)))
                    saved.push(txt)
                  }
                  if (saved.length > 0) {
                    const savedPaths = extractSavedAudioPaths(saved.join('\n'))
                    if (savedPaths.length > 0) {
                      setAssistantSavedAudioPaths((prev) => {
                        const cur = prev[asstId] || []
                        const next = Array.from(new Set([...cur, ...savedPaths]))
                        return { ...prev, [asstId]: next }
                      })
                    }
                  }
                })()
              }
            }
          },
        }
        const out = settings.llmProvider === 'openrouter' || settings.llmProvider === 'nvidia'
          ? await runOpenRouterChatWithTools({
              baseUrl: settings.llmProvider === 'nvidia' ? settings.nvidiaBaseUrl : settings.openrouterBaseUrl,
              apiKey: settings.llmProvider === 'nvidia' ? settings.nvidiaApiKey : settings.openrouterApiKey,
              model: settings.llmProvider === 'nvidia' ? settings.nvidiaModel : settings.openrouterModel,
              ...commonToolParams,
            })
          : await runOllamaChatWithTools({
              baseUrl: settings.ollamaBaseUrl,
              model: settings.ollamaModel,
              thinkLevel: settings.llmThinkLevel,
              ...commonToolParams,
            })
        replyText = out.content
        usage = out.usage
      } else {
        const out = settings.llmProvider === 'openrouter' || settings.llmProvider === 'nvidia'
          ? await streamOpenRouterChat({
              baseUrl: settings.llmProvider === 'nvidia' ? settings.nvidiaBaseUrl : settings.openrouterBaseUrl,
              apiKey: settings.llmProvider === 'nvidia' ? settings.nvidiaApiKey : settings.openrouterApiKey,
              model: settings.llmProvider === 'nvidia' ? settings.nvidiaModel : settings.openrouterModel,
              messages: ollamaMessagesToOpenRouter(history),
              modelOptions: { temperature: settings.llmTemperature, num_ctx: settings.llmNumCtx },
              signal: ac.signal,
              onThinkingDelta: isThinkingUiEnabled(settings.llmThinkLevel)
                ? (thinking) => {
                    if (!isRunActive()) return
                    setMessages((prev) =>
                      prev.map((m) => (m.id === asstId ? { ...m, thinking } : m)),
                    )
                  }
                : undefined,
              onDelta: (full) => {
                if (!isRunActive()) return
                setMessages((prev) => prev.map((m) => m.id === asstId ? { ...m, content: full } : m))
              },
            })
          : await streamOllamaChat({
              baseUrl: settings.ollamaBaseUrl,
              model: settings.ollamaModel,
              messages: history,
              modelOptions: { temperature: settings.llmTemperature, num_ctx: settings.llmNumCtx },
              signal: ac.signal,
              thinkLevel: settings.llmThinkLevel,
              onThinkingDelta: isThinkingUiEnabled(settings.llmThinkLevel)
                ? (thinking) => {
                    if (!isRunActive()) return
                    setMessages((prev) =>
                      prev.map((m) => (m.id === asstId ? { ...m, thinking } : m)),
                    )
                  }
                : undefined,
              onDelta: (full) => {
                if (!isRunActive()) return
                setMessages((prev) => prev.map((m) => m.id === asstId ? { ...m, content: full } : m))
              },
            })
        replyText = out.content
        usage = out.usage
      }

      if (!isRunActive()) return

      const usageInfo = estimateContextUsage(usage, settings.llmNumCtx)
      setContextUsageInfo(usageInfo)
      if (usageInfo?.shouldWarn && !settings.contextAutoCompress) setContextWarnDismissed(false)
      // Audio is rendered in a dedicated chat bubble from tool results,
      // so we don't append raw audio_url lines into assistant markdown content.
      if (retrievedLongMemory.length > 0) {
        void touchMemoryUsage(retrievedLongMemory.map((m) => m.id))
      }
    } catch (e) {
      if (!isRunActive()) return
      if ((e as Error).name === 'AbortError') return
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setMessages((prev) => prev.map((m) => m.id === asstId && !m.content.trim() ? { ...m, content: `(ERR: ${msg})` } : m))
      if (settings.notificationSoundsEnabled) {
        void playNotificationSound('error', { volume: settings.notificationSoundVolume })
      }
    } finally {
      if (activeChatRunIdRef.current === runId) {
        setToolPhase(null)
        setBusy(false)
        abortRef.current = null
      }
    }

    if (replyText.trim()) {
      const willAutoSpeak = loadSettings().autoVoice && ttsOk !== false
      if (settings.notificationSoundsEnabled && !willAutoSpeak) {
        void playNotificationSound('reply', { volume: settings.notificationSoundVolume })
      }
      if (willAutoSpeak) {
        void onRead({ id: asstId, role: 'assistant', content: replyText })
      }
    }
  }

  const onStop = () => {
    activeChatRunIdRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    setToolPhase(null)
    setBusy(false)
  }

  const startEdit = (msg: UiMessage) => {
    if (busy) return
    setEditingMessageId(msg.id)
    setEditInputValue(msg.content)
  }

  const cancelEdit = () => {
    setEditingMessageId(null)
    setEditInputValue('')
  }

  const commitEdit = (msgId: string) => {
    const idx = messages.findIndex((m) => m.id === msgId)
    if (idx < 0) return
    const trimmed = editInputValue.trim()
    if (!trimmed) return
    const edited: UiMessage = { ...messages[idx], content: trimmed }
    const truncated = messages.slice(0, idx + 1).map((m, i) => (i === idx ? edited : m))
    setMessages(truncated)
    setEditingMessageId(null)
    setEditInputValue('')
    void onSend({ text: trimmed, history: truncated, skipAddUserMsg: true })
  }

  const removePendingImage = (index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index))
  }

  const processChatAttachmentFiles = useCallback(async (rawList: File[]) => {
    if (rawList.length === 0) return
    const { imageFiles, nonImageFiles } = await splitChatAttachmentFiles(rawList)
    const newImages: PendingChatImage[] = []
    const newFiles: PendingChatFile[] = []

    for (const file of imageFiles) {
      if (file.size > MAX_IMAGE_BYTES) {
        setError(`Image too large (max ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB): ${file.name || 'image'}`)
        continue
      }
      try {
        const { base64, mime } = await readImageFileAsBase64(file)
        if (!base64.trim()) {
          setError(`Could not read image: ${file.name || 'attachment'}`)
          continue
        }
        newImages.push({ base64, mime, name: file.name || 'image' })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }
    for (const file of nonImageFiles) {
      if (!isSupportedChatFileName(file.name)) {
        setError(`Unsupported file type: ${file.name}`)
        continue
      }
      const ext = extFromName(file.name)
      const isText =
        ext === 'txt' || ext === 'md' || ext === 'csv' || ext === 'json' ||
        ext === 'js' || ext === 'ts' || ext === 'py' || ext === 'java' ||
        ext === 'cs' || ext === 'html' || ext === 'css'
      let content: string | undefined
      let truncated = false
      if (isText) {
        const raw = await file.text()
        if (raw.length > 400 * 1024) {
          content = raw.slice(0, 400 * 1024)
          truncated = true
        } else {
          content = raw
        }
      }
      newFiles.push({
        id: uid(),
        name: file.name,
        path: file.name,
        mime: file.type || 'application/octet-stream',
        size: file.size,
        ext,
        content,
        truncated,
      })
    }

    if (newImages.length === 0 && newFiles.length === 0) {
      if (rawList.length > 0) {
        setError('Could not load attachment. On phone use Gallery and JPEG/PNG screenshots.')
      }
      return
    }
    setError(null)
    if (newImages.length > 0) {
      setPendingImages((prev) => {
        const merged = [...prev]
        for (const item of newImages) {
          if (merged.length >= MAX_CHAT_IMAGES) break
          merged.push(item)
        }
        return merged
      })
    }
    if (newFiles.length > 0) {
      setPendingFiles((prev) => [...prev, ...newFiles].slice(0, 8))
    }
  }, [])

  const onPickChatAttachments = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target
    const picked = input.files
    if (!picked || picked.length === 0) return
    // Snapshot before reset — Android gallery can drop File refs after input.value = ''.
    const files: File[] = []
    for (let i = 0; i < picked.length; i++) {
      const f = picked[i]!
      const name = f.name?.trim() || `image-${Date.now()}.jpg`
      const type = f.type?.trim() || 'image/jpeg'
      try {
        const buf = await f.arrayBuffer()
        files.push(new File([buf], name, { type, lastModified: f.lastModified }))
      } catch {
        files.push(f)
      }
    }
    input.value = ''
    await processChatAttachmentFiles(files)
  }

  const dragContainsFiles = useCallback((e: ReactDragEvent<HTMLDivElement>) => {
    const types = e.dataTransfer?.types
    if (!types) return false
    for (let i = 0; i < types.length; i++) {
      if (types[i] === 'Files') return true
    }
    return false
  }, [])

  const onChatDragEnter = useCallback(
    (e: ReactDragEvent<HTMLDivElement>) => {
      if (busy || editingMessageId) return
      if (!dragContainsFiles(e)) return
      e.preventDefault()
      dragCounterRef.current += 1
      setIsDragOver(true)
    },
    [busy, editingMessageId, dragContainsFiles],
  )

  const onChatDragOver = useCallback(
    (e: ReactDragEvent<HTMLDivElement>) => {
      if (busy || editingMessageId) return
      if (!dragContainsFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    },
    [busy, editingMessageId, dragContainsFiles],
  )

  const onChatDragLeave = useCallback(
    (e: ReactDragEvent<HTMLDivElement>) => {
      if (!dragContainsFiles(e)) return
      e.preventDefault()
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
      if (dragCounterRef.current === 0) setIsDragOver(false)
    },
    [dragContainsFiles],
  )

  const onChatDrop = useCallback(
    async (e: ReactDragEvent<HTMLDivElement>) => {
      if (!dragContainsFiles(e)) return
      e.preventDefault()
      dragCounterRef.current = 0
      setIsDragOver(false)
      if (busy || editingMessageId) return
      const files = e.dataTransfer?.files
      if (!files?.length) return
      await processChatAttachmentFiles(Array.from(files))
    },
    [busy, editingMessageId, dragContainsFiles, processChatAttachmentFiles],
  )

  const removePendingFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const openChatAttachmentPicker = useCallback(async () => {
    if (busy) return
    const native = window.voidcast?.pickChatAttachments
    if (native) {
      try {
        const res = await native()
        if (!res.ok) {
          if ('error' in res && res.error) setError(res.error)
          return
        }
        if (res.images?.length) {
          const addedImages: PendingChatImage[] = res.images.map((f) => ({
            base64: f.base64.replace(/\s+/g, ''),
            mime: f.mime,
            name: f.name,
            path: f.path,
          }))
          setPendingImages((prev) => [...prev, ...addedImages].slice(0, MAX_CHAT_IMAGES))
        }
        if (res.files?.length) {
          const addedFiles: PendingChatFile[] = res.files.map((f) => ({
            id: uid(),
            name: f.name,
            path: f.path,
            mime: f.mime,
            size: f.size,
            ext: f.ext,
            content: f.content,
            truncated: f.truncated,
          }))
          setPendingFiles((prev) => [...prev, ...addedFiles].slice(0, 8))
        }
        setError(null)
        return
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }
    if (!isWebStandalone()) {
      chatAttachmentInputRef.current?.click()
    }
  }, [busy])

  // === Audio Playback ===
  const playBlobUrl = (url: string, signal: AbortSignal): Promise<void> => {
    return new Promise((resolve, reject) => {
      const el = audioRef.current
      if (!el) { resolve(); return }
      const cleanup = () => signal.removeEventListener('abort', onAbort)
      const onAbort = () => { el.pause(); el.removeAttribute('src'); cleanup(); resolve() }
      if (signal.aborted) { resolve(); return }
      signal.addEventListener('abort', onAbort)
      el.onended = () => { cleanup(); resolve() }
      el.onerror = () => { cleanup(); reject(new Error('Audio playback failed')) }
      el.src = url
      void el.play().catch((e) => { cleanup(); reject(e) })
    })
  }

  // === TTS Read ===
  const onRead = async (msg: UiMessage) => {
    if (msg.role !== 'assistant' || !msg.content.trim()) return
    const spoken = sanitizeForTts(msg.content)
    if (!spoken) return
    const ttsVoiceMode =
      settings.ttsProvider === 'local'
        ? (isWebStandalone() ? 'design' : settings.voiceMode)
        : 'design'
    if (ttsVoiceMode === 'clone' && (!cloneRef?.blob || cloneRef.blob.size === 0)) {
      setError('VOICE_CLONE: Load reference audio in Settings → TTS/STT')
      return
    }
    ttsAbortRef.current?.abort()
    const ac = new AbortController()
    ttsRunIdRef.current += 1
    const runId = ttsRunIdRef.current
    ttsAbortRef.current = ac
    const signal = ac.signal

    setError(null)
    setPlayingId(msg.id)
    try {
      if (audioUrl) URL.revokeObjectURL(audioUrl)

      const maxC = Math.min(2000, Math.max(80, Math.round(settings.ttsChunkMaxChars) || 300))
      const chunks = splitIntoTtsChunks(spoken, maxC)
      const multi = chunks.length > 1
      const durationForChunk = multi ? null : settings.ttsDurationSec

      const cloneRefKey =
        !isWebStandalone() && cloneRef
          ? `${cloneRef.fileName || ''}:${cloneRef.blob.size}:${cloneRef.blob.type}`
          : 'none'
      const voiceAnchorKey = voiceAnchor
        ? `${voiceAnchor.refText}:${voiceAnchor.sourceMode}:${voiceAnchor.instructSnapshot || ''}:${voiceAnchor.blob.size}`
        : 'none'
      const baseCacheKey = [
        `provider=${settings.ttsProvider}`,
        `ttsBaseUrl=${settings.ttsBaseUrl}`,
        `runwareBase=${settings.runwareApiBaseUrl}`,
        `runwareModel=${settings.runwareTtsModel}`,
        `runwareVoice=${settings.runwareXaiVoice}`,
        `runwareLang=${settings.runwareXaiLanguage}`,
        `voiceMode=${ttsVoiceMode}`,
        `instruct=${settings.voiceInstruct}`,
        `speed=${settings.ttsSpeed}`,
        `numStep=${settings.ttsNumStep}`,
        `duration=${durationForChunk == null ? 'null' : String(durationForChunk)}`,
        `cloneRef=${cloneRefKey}`,
        `cloneRefText=${isWebStandalone() ? '' : settings.cloneRefText || ''}`,
        `voiceAnchor=${voiceAnchorKey}`,
      ].join('|')

      const synth = (text: string) => {
        const cacheKey = `${baseCacheKey}|text=${text}`
        const cached = ttsAudioCacheRef.current.get(cacheKey)
        if (cached) return Promise.resolve(cached)
        return synthesizeSpeech({
          ttsBaseUrl: settings.ttsBaseUrl,
          ttsProvider: settings.ttsProvider,
          openrouterApiKey: settings.openrouterApiKey,
          openrouterTtsModel: settings.openrouterTtsModel,
          openrouterTtsVoice: settings.openrouterTtsVoice,
          runwareApiBaseUrl: settings.runwareApiBaseUrl,
          runwareApiKey: settings.runwareApiKey,
          runwareTtsModel: settings.runwareTtsModel,
          runwareXaiVoice: settings.runwareXaiVoice,
          runwareXaiLanguage: settings.runwareXaiLanguage,
          text,
          voiceMode: ttsVoiceMode,
          instruct: settings.voiceInstruct || undefined,
          speed: settings.ttsSpeed,
          numStep: settings.ttsNumStep,
          durationSec: durationForChunk,
          cloneRef: isWebStandalone() ? null : cloneRef ?? null,
          cloneRefText: isWebStandalone() ? null : settings.cloneRefText || null,
          voiceAnchor: voiceAnchor ?? null,
          signal,
        }).then((blob) => {
          ttsAudioCacheRef.current.set(cacheKey, blob)
          ttsAudioCacheOrderRef.current.push(cacheKey)
          const maxEntries = 64
          while (ttsAudioCacheOrderRef.current.length > maxEntries) {
            const oldest = ttsAudioCacheOrderRef.current.shift()
            if (!oldest) break
            ttsAudioCacheRef.current.delete(oldest)
          }
          return blob
        })
      }

      let pending = synth(chunks[0])
      for (let i = 0; i < chunks.length; i++) {
        let blob: Blob
        try { blob = await pending }
        catch (e) { if ((e as Error).name === 'AbortError' || signal.aborted) break; throw e }
        if (signal.aborted) break
        if (i + 1 < chunks.length) pending = synth(chunks[i + 1])
        const url = URL.createObjectURL(blob)
        setAudioUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url })
        try { await playBlobUrl(url, signal) }
        catch (e) { if (signal.aborted) break; throw e }
        if (signal.aborted) break
      }
    } catch (e) {
      if (!signal.aborted) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (ttsAbortRef.current === ac) ttsAbortRef.current = null
      if (ttsRunIdRef.current === runId) setPlayingId(null)
    }
  }

  onReadRef.current = onRead

  // IPC clipboard TTS listener
  useEffect(() => {
    const bridge = window.voidcast
    if (!bridge) return
    return bridge.onClipboardTts((text) => {
      const t = String(text ?? '').trim()
      if (!t) return
      void onReadRef.current({ id: '_clipboard-tts', role: 'assistant', content: t })
    })
  }, [])

  // Voice clone file picker
  const onPickCloneFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const data = { blob: f, fileName: f.name }
    setCloneRef(data)
    try { await saveCloneRef(data) }
    catch { setError('Failed to save reference sample (IndexedDB)') }
  }

  const onClearClone = async () => {
    setCloneRef(null)
    try { await clearCloneRef() }
    catch { /* ignore */ }
  }

  const onBakeVoiceAnchor = async () => {
    if (settings.ttsProvider !== 'local') {
      setError('VOICE_ANCHOR is available only with local OmniVoice TTS.')
      return
    }
    const mode = settings.voiceMode
    if (mode !== 'design') return
    const phrase = settings.voiceBakePhrase.trim()
    if (!phrase) {
      setError('VOICE_ANCHOR: Enter a short bake phrase first')
      return
    }
    setError(null)
    try {
      const blob = await bakeVoiceSample({
        ttsBaseUrl: settings.ttsBaseUrl,
        sourceMode: mode,
        text: phrase,
        instruct: settings.voiceInstruct || undefined,
        speed: settings.ttsSpeed,
        numStep: settings.ttsNumStep,
        durationSec: null,
      })
      const data: StoredVoiceAnchor = {
        blob,
        refText: phrase,
        sourceMode: mode,
        instructSnapshot: mode === 'design' ? settings.voiceInstruct.trim() : undefined,
      }
      await saveVoiceAnchor(data)
      setVoiceAnchor(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const onClearVoiceAnchor = async () => {
    setVoiceAnchor(null)
    try { await clearVoiceAnchor() }
    catch { /* ignore */ }
  }

  const uiDystopian = settings.uiTheme === 'dystopian'
  const emptyStateMessage = useMemo(() => {
    const variants =
      settings.uiTheme === 'dystopian'
        ? EMPTY_STATE_VARIANTS.dystopian
        : settings.uiTheme === 'matrix'
          ? EMPTY_STATE_VARIANTS.matrix
          : settings.uiTheme === 'light'
            ? EMPTY_STATE_VARIANTS.light
            : settings.uiTheme === 'blood-moon'
              ? EMPTY_STATE_VARIANTS['blood-moon']
              : settings.uiTheme === 'obsidian'
                ? EMPTY_STATE_VARIANTS.obsidian
                : EMPTY_STATE_VARIANTS.minimal
    return variants[emptyStateSeed % variants.length]
  }, [settings.uiTheme, emptyStateSeed])

  // === OPTIONS SCREEN ===
  if (screen === 'options') {
    return (
      <div className={`voidcast-app${uiDystopian ? ' grid-bg' : ''}`}>
        {uiDystopian && (
          <>
            <CrtOverlay />
            <AmbientParticles />
          </>
        )}
        
        {/* Header */}
        <header className="voidcast-header">
          <button
            type="button"
            onClick={() => setScreen('chat')}
            className="cyber-btn text-sm"
          >
            ← RETURN
          </button>
          
          <GlitchText className="voidcast-logo text-xl">
            SETTINGS
          </GlitchText>
          
          <div className="w-24" /> {/* Spacer */}
        </header>

        {/* Tabs */}
        <div className="flex border-b border-void-muted/30 bg-void-dark/50">
          {(['general', 'llm', 'runware', 'runwareMusic', 'tts', 'tools', 'subAgent'] as OptionsTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setOptionsTab(tab)}
              title={tab === 'tts' ? 'Text-to-speech & speech-to-text' : undefined}
              className={`option-tab flex-1 ${optionsTab === tab ? 'active' : ''}`}
            >
              {tab === 'general' && '◆ GENERAL'}
              {tab === 'llm' && '◇ LLM'}
              {tab === 'runware' && '◌ IMAGE'}
              {tab === 'runwareMusic' && '♫ MUSIC'}
              {tab === 'tts' && (isWebStandalone() ? '◉ TTS' : '◉ TTS/STT')}
              {tab === 'tools' && '⬡ TOOLS'}
              {tab === 'subAgent' && '⬢ SUB'}
            </button>
          ))}
        </div>

        {/* Content */}
        <main className="options-panel flex-1 overflow-y-auto">
          <div className="cyber-panel p-6 max-w-2xl mx-auto">
            <div className="corner-tl" />
            <div className="corner-tr" />
            <div className="corner-bl" />
            <div className="corner-br" />
            
            {optionsTab === 'general' ? (
              <GeneralOptionsPanel
                settings={settings}
                setSettings={setSettings}
                useLongMemoryInActiveChat={activeSessionUseLongMemory}
                onToggleUseLongMemoryInActiveChat={setUseLongMemoryForActiveChat}
                longMemories={longMemories}
                onDeleteLongMemory={deleteLongMemoryById}
                onUpdateLongMemory={updateLongMemoryById}
                reminders={reminders}
                onDeleteReminder={async (id) => {
                  await deleteReminder(id)
                  recordReminderDeleted(id)
                  scheduleUserDataSync(settings.ttsBaseUrl)
                  await refreshReminders()
                }}
                onMarkDoneReminder={async (id) => {
                  await markReminderDone(id)
                  scheduleUserDataSync(settings.ttsBaseUrl)
                  await refreshReminders()
                }}
              />
            ) : optionsTab === 'llm' ? (
              <LlmOptionsPanel
                settings={settings}
                setSettings={setSettings}
                loadModels={loadModels}
                modelsLoading={modelsLoading}
                ollamaModels={ollamaModels}
                modelsError={modelsError}
              />
            ) : optionsTab === 'tts' ? (
              <TtsOptionsPanel
                settings={settings}
                setSettings={setSettings}
                refreshTts={refreshTts}
                cloneRef={cloneRef}
                onPickCloneFile={onPickCloneFile}
                onClearClone={onClearClone}
                voiceAnchor={voiceAnchor}
                onBakeVoiceAnchor={onBakeVoiceAnchor}
                onClearVoiceAnchor={onClearVoiceAnchor}
              />
            ) : optionsTab === 'runware' ? (
              <RunwareOptionsPanel settings={settings} setSettings={setSettings} />
            ) : optionsTab === 'runwareMusic' ? (
              <RunwareMusicOptionsPanel settings={settings} setSettings={setSettings} />
            ) : optionsTab === 'subAgent' ? (
              <SubAgentOptionsPanel
                settings={settings}
                setSettings={setSettings}
                loadModels={loadModels}
                modelsLoading={modelsLoading}
                ollamaModels={ollamaModels}
                modelsError={modelsError}
              />
            ) : (
              <ToolsOptionsPanel
                settings={settings}
                setSettings={setSettings}
                onCodingProjectPathApplied={applyCodingProjectPath}
                effectivePdfOutputDir={effectivePdfOutputDir}
              />
            )}
          </div>
        </main>

        <audio ref={audioRef} className="hidden" />
      </div>
    )
  }

  // === MAIN CHAT SCREEN ===
  return (
    <div
      className={`voidcast-app${uiDystopian ? ' grid-bg' : ''}`}
      onDragEnter={onChatDragEnter}
      onDragOver={onChatDragOver}
      onDragLeave={onChatDragLeave}
      onDrop={onChatDrop}
    >
      {uiDystopian && (
        <>
          <CrtOverlay />
          <AmbientParticles />
        </>
      )}
      {isDragOver && (
        <div
          className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center
            bg-void-black/70 backdrop-blur-sm border-2 border-dashed border-neon-cyan/60"
          aria-hidden
        >
          <div className="px-6 py-4 font-mono text-sm uppercase tracking-wider text-neon-cyan
            border border-neon-cyan/40 bg-void-dark/85 rounded">
            ⬇ DROP FILES TO ATTACH
            <div className="mt-1 text-[11px] normal-case tracking-normal text-void-dim">
              Images (PNG / JPEG / WebP …) and supported files (TXT, MD, PDF, DOCX, CSV, JSON, code).
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="voidcast-header min-w-0">
        {/* Menu Button */}
        <button
          type="button"
          aria-label="Open sessions menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className="group relative flex h-8 w-8 shrink-0 items-center justify-center
            bg-void-mid border border-void-dim/50 hover:border-neon-cyan/50
            transition-all duration-300 hover:shadow-[0_0_12px_rgba(var(--ui-accent-rgb),0.25)]"
          style={{ clipPath: 'polygon(3px 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%, 0 3px)' }}
        >
          <span
            className="font-mono text-lg text-neon-cyan transition-colors group-hover:text-neon-cyan"
            aria-hidden
          >
            ⌘
          </span>
        </button>

        {/* Status & Actions */}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1 sm:gap-3">
          {codingPanelAvailable && (
            <button
              type="button"
              onClick={() => setShowCodingPanel((v) => !v)}
              className={`cyber-btn flex h-8 w-8 shrink-0 items-center justify-center p-0 ${showCodingPanel ? 'border-neon-cyan/60 text-neon-cyan' : ''}`}
              title={showCodingPanel ? 'Hide coding panel' : 'Show coding panel'}
              aria-label={showCodingPanel ? 'Hide coding panel' : 'Show coding panel'}
            >
              <CodeIcon className="h-4 w-4 text-current" />
            </button>
          )}
          <button
            type="button"
            disabled={busy || longMemoryBusy || messages.length === 0}
            onClick={() => void extractLongMemoryNow()}
            className="cyber-btn flex h-8 w-8 shrink-0 items-center justify-center p-0 disabled:opacity-50"
            title="Summarize this chat and save relevant long-term memory"
            aria-label={
              longMemoryBusy ? 'Saving long-term memory…' : 'Save long-term memory'
            }
          >
            {longMemoryBusy ? (
              <span
                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-void-dim border-t-neon-cyan"
                aria-hidden
              />
            ) : (
              <BrainIcon className="h-4 w-4 text-current" />
            )}
          </button>

          {/* Save Button */}
          {canSaveSession && (
            <button
              type="button"
              onClick={saveOrUpdateSession}
              className="cyber-btn flex h-8 w-8 shrink-0 items-center justify-center p-0"
              title="Save chat session"
              aria-label="Save chat session"
            >
              <svg
                className="h-4 w-4 text-current"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
            </button>
          )}

          {/* Stop Button */}
          {canStop && (
            <button
              type="button"
              onClick={onStop}
              className="cyber-btn cyber-btn-danger shrink-0 px-2 text-[11px] sm:px-3 sm:text-xs"
            >
              ABORT
            </button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 w-full flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* Sidebar Menu */}
      {menuOpen && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 bg-void-black/80 backdrop-blur-sm"
            onClick={() => setMenuOpen(false)}
          />
          <nav 
            className="fixed left-0 top-0 z-50 flex h-full w-72 max-w-[85vw] flex-col 
              bg-void-dark/95 border-r border-neon-cyan/20 shadow-[4px_0_30px_rgba(var(--ui-accent-rgb),0.1)]
              backdrop-blur-xl"
          >
            {/* Menu Header */}
            <div className="px-4 py-4 border-b border-void-muted/30">
              <div className="flex items-center gap-3">
                <span className="text-neon-cyan font-mono text-lg">⌘</span>
                <span className="font-display text-sm tracking-widest text-void-light uppercase">NAVIGATION</span>
              </div>
            </div>

            {/* Menu Items */}
            <div className="flex flex-col gap-1 p-2">
              <button
                type="button"
                onClick={() => openOptions('general')}
                className="flex items-center gap-3 rounded px-4 py-3 text-left
                  text-void-light hover:text-neon-cyan hover:bg-neon-cyan/5
                  border border-transparent hover:border-neon-cyan/20 transition-all"
              >
                <span className="text-neon-cyan">⚙</span>
                <span className="font-mono text-sm">SETTINGS</span>
              </button>
              
              <div className="h-px bg-void-muted/30 my-2" />
              
              <button
                type="button"
                onClick={newChat}
                className="flex items-center gap-3 rounded px-4 py-3 text-left
                  text-void-light hover:text-neon-cyan hover:bg-neon-cyan/5
                  border border-transparent hover:border-neon-cyan/20 transition-all"
              >
                <span className="text-neon-green">+</span>
                <span className="font-mono text-sm">NEW_SESSION</span>
              </button>
            </div>

            {/* Sessions List */}
            <div className="flex-1 border-t border-void-muted/30 overflow-y-auto p-2">
              <div className="px-2 py-2 text-xs font-mono text-void-dim uppercase tracking-wider">
                CHAT_HISTORY
              </div>
              
              {/* Today */}
              <button
                type="button"
                onClick={() => setSidebarCollapsed((p) => ({ ...p, today: !p.today }))}
                className="flex w-full items-center justify-between px-3 py-2 text-xs font-mono text-void-dim hover:text-void-light"
              >
                <span>TODAY [{todaySessions.length}]</span>
                <span>{sidebarCollapsed.today ? '▶' : '▼'}</span>
              </button>
              
              {!sidebarCollapsed.today && (
                <div className="space-y-1 mt-1">
                  {todaySessions.length === 0 && (
                    <div className="px-3 py-2 text-xs font-mono text-void-dim/50">NO_SESSIONS</div>
                  )}
                  {todaySessions.map((s) => (
                    <SessionItem
                      key={s.id}
                      session={s}
                      isActive={s.id === activeSessionId}
                      isRenaming={renamingSessionId === s.id}
                      isPendingDelete={pendingDeleteId === s.id}
                      renameValue={renameValue}
                      onOpen={() => openSession(s)}
                      onStartRename={() => startRenameSession(s)}
                      onRenameChange={(v) => setRenameValue(v)}
                      onCommitRename={() => commitRenameSession(s.id)}
                      onCancelRename={cancelRenameSession}
                      onStartDelete={() => setPendingDeleteId(s.id)}
                      onConfirmDelete={() => deleteSession(s.id)}
                      onCancelDelete={() => setPendingDeleteId(null)}
                      onFork={() => forkSession(s)}
                      onExport={() => exportSessionToMarkdown(s)}
                    />
                  ))}
                </div>
              )}

              {/* Older */}
              <button
                type="button"
                onClick={() => setSidebarCollapsed((p) => ({ ...p, older: !p.older }))}
                className="flex w-full items-center justify-between px-3 py-2 mt-2 text-xs font-mono text-void-dim hover:text-void-light"
              >
                <span>ARCHIVE [{olderSessions.length}]</span>
                <span>{sidebarCollapsed.older ? '▶' : '▼'}</span>
              </button>
              
              {!sidebarCollapsed.older && (
                <div className="space-y-1 mt-1">
                  {olderSessions.length === 0 && (
                    <div className="px-3 py-2 text-xs font-mono text-void-dim/50">NO_ARCHIVE</div>
                  )}
                  {olderSessions.map((s) => (
                    <SessionItem
                      key={s.id}
                      session={s}
                      isActive={s.id === activeSessionId}
                      isRenaming={renamingSessionId === s.id}
                      isPendingDelete={pendingDeleteId === s.id}
                      renameValue={renameValue}
                      onOpen={() => openSession(s)}
                      onStartRename={() => startRenameSession(s)}
                      onRenameChange={(v) => setRenameValue(v)}
                      onCommitRename={() => commitRenameSession(s.id)}
                      onCancelRename={cancelRenameSession}
                      onStartDelete={() => setPendingDeleteId(s.id)}
                      onConfirmDelete={() => deleteSession(s.id)}
                      onCancelDelete={() => setPendingDeleteId(null)}
                      onFork={() => forkSession(s)}
                      onExport={() => exportSessionToMarkdown(s)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-void-muted/30">
              <div className="text-xs font-mono text-void-dim/50 text-center">
                {`VOIDCAST_NEXUS // BUILD_${appVersion}`}
              </div>
            </div>
          </nav>
        </>
      )}

      {/* Chat Messages */}
      <main
        ref={chatMessagesRef}
        onScroll={onChatScroll}
        className="voidcast-messages min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto max-w-3xl flex flex-col gap-4">
          {/* Empty State */}
          {messages.length === 0 && (
            <div
              className={`relative overflow-hidden rounded-lg p-8 text-center animate-fade-in-up ${
                uiDystopian
                  ? 'border border-neon-cyan/20 bg-void-dark/80'
                  : 'border border-void-muted/50 bg-void-mid/70'
              }`}
            >
              {uiDystopian && (
                <>
                  {/* Decorative glow */}
                  <div className="absolute -right-20 -top-20 h-48 w-48 rounded-full bg-neon-cyan/10 blur-3xl" aria-hidden />
                  <div className="absolute -left-20 -bottom-20 h-48 w-48 rounded-full bg-neon-magenta/10 blur-3xl" aria-hidden />
                </>
              )}
              
              <div className="relative">
                <p className="text-void-text text-sm mb-6 font-mono animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
                  {emptyStateMessage}
                  {uiDystopian && <span className="animate-cursor-blink ml-1">_</span>}
                </p>
              </div>
            </div>
          )}

          {/* Messages */}
          {messages.map((m, index) => (
            <div 
              key={m.id} 
              className={`message-container ${m.role === 'user' ? 'user' : 'assistant'} animate-message-in group`}
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              <div className={`message-bubble ${m.role === 'user' ? 'message-user' : 'message-assistant'}`}>
                {/* Role indicator */}
                <div className="message-meta">
                  <span className={`message-role ${m.role === 'user' ? 'text-neon-purple' : 'text-neon-cyan'}`}>
                    {m.role === 'user' ? 'USER' : 'Void Agent'}
                  </span>
                </div>
                
                {/* Content */}
                {m.role === 'assistant' ? (
                  <div className="min-w-0 space-y-3">
                    {(() => {
                      const cached = assistantRenderCache[m.id]
                      const trustedAudio = dedupeNonEmpty([...(assistantGeneratedAudios[m.id] || [])])
                      const markdownContent = cached?.markdownContent || stripGeneratedAudioLinkArtifacts(
                        stripRunwareAudioUrlLines(m.content),
                        trustedAudio,
                      )
                      const inlineImageUrls = cached?.inlineImageUrls || []
                      const localImagePaths = cached?.localImagePaths || []
                      const renderItems = localImagePaths.length > 0
                        ? localImagePaths.map((p, i) => ({
                            key: `${m.id}-local-${i}`,
                            src: localImagePreviews[p]
                              ? imageDataUrl(localImagePreviews[p].base64, localImagePreviews[p].mime)
                              : '',
                            url: inlineImageUrls[i] || '',
                            localPath: p,
                            hasPreview: Boolean(localImagePreviews[p]),
                          }))
                        : desktopRuntime
                          ? []
                          : inlineImageUrls.map((url, i) => ({
                              key: `${m.id}-url-${i}`,
                              src: url,
                              url,
                              localPath: '',
                              hasPreview: true,
                            }))
                      return (
                        <>
                          {m.thinking?.trim() ? (
                            <details
                              className="rounded border border-neon-cyan/25 bg-void-black/40"
                              open={busy && index === messages.length - 1}
                            >
                              <summary className="cursor-pointer px-3 py-2 text-[11px] font-mono text-neon-cyan/90 hover:text-neon-cyan flex items-center gap-2">
                                <span>THINKING</span>
                                {busy && index === messages.length - 1 ? (
                                  <button
                                    type="button"
                                    className="ml-auto text-[10px] px-1.5 py-0.5 rounded border border-neon-cyan/30 hover:bg-neon-cyan/10 transition-colors"
                                    title={thinkingPinned ? 'Auto-scroll: ON' : 'Auto-scroll: OFF'}
                                    onClick={(e) => {
                                      e.preventDefault()
                                      setThinkingPinned((p) => !p)
                                    }}
                                  >
                                    {thinkingPinned ? '📌 FOLLOW ON' : '📍 FOLLOW OFF'}
                                  </button>
                                ) : null}
                              </summary>
                              <div
                                ref={thinkingScrollRef}
                                className="max-h-64 overflow-y-auto border-t border-void-muted/30 px-3 py-2 text-xs font-mono text-void-dim whitespace-pre-wrap break-words"
                              >
                                {m.thinking}
                              </div>
                            </details>
                          ) : null}
                          <ChatMarkdown content={markdownContent} />
                          {renderItems.length > 0 ? (
                            <div className="flex flex-wrap gap-3">
                              {renderItems.map((item) => (
                                <div
                                  key={item.key}
                                  className="rounded border border-void-muted/40 p-2 bg-void-black/30"
                                >
                                  <a
                                    href={item.localPath || item.url || item.src}
                                    target={item.localPath ? undefined : '_blank'}
                                    rel={item.localPath ? undefined : 'noreferrer'}
                                    className="block"
                                    onClick={item.localPath ? (e) => {
                                      e.preventDefault()
                                      void openLocalImage(item.localPath)
                                    } : undefined}
                                  >
                                    {item.hasPreview ? (
                                      <img
                                        src={item.src}
                                        alt="Generated"
                                        loading="lazy"
                                        referrerPolicy="no-referrer"
                                        className="max-h-64 max-w-full rounded border border-void-muted/40 object-contain"
                                      />
                                    ) : (
                                      <div className="max-h-64 w-[220px] rounded border border-void-muted/40 bg-void-black/40 px-3 py-2 text-xs font-mono text-void-dim">
                                        Loading local image preview...
                                      </div>
                                    )}
                                  </a>
                                  <div className="mt-2 flex gap-2">
                                    {!item.localPath && !settings.runwareAutoSaveImages ? (
                                      <button
                                        type="button"
                                        onClick={() => void downloadImage(item.url)}
                                        className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono
                                          border border-neon-green/30 text-neon-green
                                          hover:bg-neon-green/10 hover:border-neon-green/50
                                          transition-all"
                                      >
                                        ⬇ DOWNLOAD
                                      </button>
                                    ) : !item.localPath ? (
                                      <span className="text-xs font-mono text-void-dim">
                                        Local image unavailable on this platform.
                                      </span>
                                    ) : null}
                                  </div>
                                  {assistantImageToolMeta[m.id]?.[item.url] ? (
                                  <details className="mt-2 border border-void-muted/30 rounded bg-void-black/30">
                                    <summary className="cursor-pointer px-2 py-1 text-[11px] font-mono text-neon-cyan/80 hover:text-neon-cyan">
                                      IMAGE_INFO
                                    </summary>
                                    <div className="px-2 pb-2 pt-1 text-[11px] font-mono text-void-dim whitespace-pre-wrap break-all">
                                      {(() => {
                                        const meta =
                                          assistantImageToolMeta[m.id]?.[item.url]
                                          || assistantImageMessageMeta[m.id]
                                          || parseRunwareImageToolMeta(m.content)
                                        if (!meta) return ''
                                        const lines: string[] = []
                                        if (meta.model) lines.push(`model: ${meta.model}`)
                                        if (meta.size) lines.push(`size: ${meta.size}`)
                                        if (meta.prompt) lines.push(`prompt: ${meta.prompt}`)
                                        if (typeof meta.steps === 'number') lines.push(`steps: ${meta.steps}`)
                                        if (typeof meta.cfgScale === 'number') lines.push(`cfg_scale: ${meta.cfgScale}`)
                                        if (typeof meta.seed === 'number') lines.push(`seed: ${meta.seed}`)
                                        if (typeof meta.costUsd === 'number') lines.push(`cost_usd: ${meta.costUsd.toFixed(6)}`)
                                        if (typeof meta.elapsedMs === 'number') lines.push(`elapsed_ms: ${meta.elapsedMs}`)
                                        if (meta.taskUuid) lines.push(`task_uuid: ${meta.taskUuid}`)
                                        if (meta.imageUuid) lines.push(`image_uuid: ${meta.imageUuid}`)
                                        return lines.join('\n')
                                      })()}
                                    </div>
                                  </details>
                                ) : (
                                  assistantImageMessageMeta[m.id] || parseRunwareImageToolMeta(m.content)
                                ) ? (
                                  <details className="mt-2 border border-void-muted/30 rounded bg-void-black/30">
                                    <summary className="cursor-pointer px-2 py-1 text-[11px] font-mono text-neon-cyan/80 hover:text-neon-cyan">
                                      IMAGE_INFO
                                    </summary>
                                    <div className="px-2 pb-2 pt-1 text-[11px] font-mono text-void-dim whitespace-pre-wrap break-all">
                                      {(() => {
                                        const meta = assistantImageMessageMeta[m.id] || parseRunwareImageToolMeta(m.content)
                                        if (!meta) return ''
                                        const lines: string[] = []
                                        if (meta.model) lines.push(`model: ${meta.model}`)
                                        if (meta.size) lines.push(`size: ${meta.size}`)
                                        if (meta.prompt) lines.push(`prompt: ${meta.prompt}`)
                                        if (typeof meta.steps === 'number') lines.push(`steps: ${meta.steps}`)
                                        if (typeof meta.cfgScale === 'number') lines.push(`cfg_scale: ${meta.cfgScale}`)
                                        if (typeof meta.seed === 'number') lines.push(`seed: ${meta.seed}`)
                                        if (typeof meta.costUsd === 'number') lines.push(`cost_usd: ${meta.costUsd.toFixed(6)}`)
                                        if (typeof meta.elapsedMs === 'number') lines.push(`elapsed_ms: ${meta.elapsedMs}`)
                                        if (meta.taskUuid) lines.push(`task_uuid: ${meta.taskUuid}`)
                                        if (meta.imageUuid) lines.push(`image_uuid: ${meta.imageUuid}`)
                                        return lines.join('\n')
                                      })()}
                                    </div>
                                  </details>
                                ) : null}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </>
                      )
                    })()}
                    {(() => {
                      // Only URLs confirmed by a real generate_music_runware tool result.
                      const inlineAudioUrls = dedupeNonEmpty([
                        ...(assistantGeneratedAudios[m.id] || []),
                      ])
                      return inlineAudioUrls.length > 0 ? (
                        <div className="space-y-2">
                          {inlineAudioUrls.map((url, i) => {
                            const savedPath = assistantSavedAudioPaths[m.id]?.[i]
                            return (
                              <div
                                key={`${m.id}-runware-audio-${i}`}
                                className="rounded border border-void-muted/40 p-2 bg-void-black/30"
                              >
                                <div className="mb-2 text-[11px] font-mono text-neon-cyan/80">
                                  GENERATED_AUDIO_{i + 1}
                                  {savedPath ? ' (local)' : ' (url)'}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {savedPath && (
                                    <button
                                      type="button"
                                      onClick={() => void openLocalImage(savedPath)}
                                      className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono
                                        border border-neon-green/30 text-neon-green
                                        hover:bg-neon-green/10 hover:border-neon-green/50
                                        transition-all"
                                    >
                                      ▶ OPEN_LOCAL
                                    </button>
                                  )}
                                  {!savedPath && (
                                    <span className="text-xs font-mono text-void-dim">
                                      Enable auto-save to open local file.
                                    </span>
                                  )}
                                </div>
                                {(assistantAudioToolMeta[m.id]?.[url] ||
                                  assistantAudioMessageMeta[m.id] ||
                                  parseRunwareAudioToolMeta(m.content)) ? (
                                  <details className="mt-2 border border-void-muted/30 rounded bg-void-black/30">
                                    <summary className="cursor-pointer px-2 py-1 text-[11px] font-mono text-neon-cyan/80 hover:text-neon-cyan">
                                      AUDIO_INFO
                                    </summary>
                                    <div className="px-2 pb-2 pt-1 text-[11px] font-mono text-void-dim whitespace-pre-wrap break-all">
                                      {(() => {
                                        const meta =
                                          assistantAudioToolMeta[m.id]?.[url]
                                          || assistantAudioMessageMeta[m.id]
                                          || parseRunwareAudioToolMeta(m.content)
                                        if (!meta) return ''
                                        const lines: string[] = []
                                        if (meta.model) lines.push(`model: ${meta.model}`)
                                        if (meta.prompt) lines.push(`prompt: ${meta.prompt}`)
                                        if (meta.outputFormat) lines.push(`output_format: ${meta.outputFormat}`)
                                        if (typeof meta.durationSec === 'number') lines.push(`duration_sec: ${meta.durationSec}`)
                                        if (typeof meta.steps === 'number') lines.push(`steps: ${meta.steps}`)
                                        if (typeof meta.cfgScale === 'number') lines.push(`cfg_scale: ${meta.cfgScale}`)
                                        if (meta.guidanceType) lines.push(`guidance_type: ${meta.guidanceType}`)
                                        if (meta.vocalLanguage) lines.push(`vocal_language: ${meta.vocalLanguage}`)
                                        if (typeof meta.seed === 'number') lines.push(`seed: ${meta.seed}`)
                                        if (typeof meta.costUsd === 'number') lines.push(`cost_usd: ${meta.costUsd.toFixed(6)}`)
                                        if (typeof meta.elapsedMs === 'number') lines.push(`elapsed_ms: ${meta.elapsedMs}`)
                                        if (meta.taskUuid) lines.push(`task_uuid: ${meta.taskUuid}`)
                                        if (meta.audioUuid) lines.push(`audio_uuid: ${meta.audioUuid}`)
                                        return lines.join('\n')
                                      })()}
                                    </div>
                                  </details>
                                ) : null}
                              </div>
                            )
                          })}
                        </div>
                      ) : null
                    })()}
                  </div>
                ) : editingMessageId === m.id ? (
                  <div className="space-y-2">
                    <textarea
                      className="voidcast-textarea w-full"
                      rows={3}
                      value={editInputValue}
                      onChange={(e) => setEditInputValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          commitEdit(m.id)
                        } else if (e.key === 'Escape') {
                          cancelEdit()
                        }
                      }}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => commitEdit(m.id)}
                        className="cyber-btn text-xs"
                      >
                        RESEND
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="px-3 py-1 text-xs font-mono text-void-dim hover:text-void-light"
                      >
                        CANCEL
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="min-w-0 max-w-full overflow-hidden text-void-white whitespace-pre-wrap break-words [overflow-wrap:anywhere] space-y-2 rounded px-1 -mx-1"
                  >
                    {m.images && m.images.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {m.images.map((b64, i) => (
                          <img
                            key={`${m.id}-img-${i}`}
                            src={imageDataUrl(b64, m.imageMimes?.[i] ?? 'image/png')}
                            alt=""
                            className="max-h-48 max-w-full rounded border border-void-muted/40 object-contain"
                          />
                        ))}
                      </div>
                    )}
                    {m.fileAttachments && m.fileAttachments.length > 0 && (
                      <div className="space-y-1 rounded border border-void-muted/40 bg-void-black/20 p-2 text-xs font-mono">
                        {m.fileAttachments.map((f) => (
                          <div key={f.id} className="text-void-dim">
                            FILE: {f.name} ({f.ext || 'unknown'}) {f.truncated ? '[truncated]' : ''}
                            <div className="break-all text-[10px] text-void-dim/80">{f.path}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {m.content.length > 0 ? (
                      m.content
                    ) : m.images?.length ? (
                      <span className="text-void-dim text-xs font-mono">(no caption)</span>
                    ) : m.fileAttachments?.length ? (
                      <span className="text-void-dim text-xs font-mono">(file attached)</span>
                    ) : (
                      <span className="text-void-dim text-xs font-mono">
                        (no text content)
                      </span>
                    )}
                  </div>
                )}
                
                {/* Actions for user */}
                {m.role === 'user' && !editingMessageId && (
                  <div className="mt-2 flex flex-wrap gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => startEdit(m)}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono
                        border border-void-muted/50 text-void-dim
                        hover:border-neon-cyan/50 hover:text-neon-cyan
                        transition-all"
                    >
                      ✎ EDIT
                    </button>
                  </div>
                )}
                
                {/* Actions for assistant */}
                {m.role === 'assistant' && m.content.trim().length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-void-muted/30 pt-3">
                    <button
                      type="button"
                      disabled={ttsOk === false}
                      onClick={() => {
                        if (playingId === m.id) {
                          ttsAbortRef.current?.abort()
                          setPlayingId(null)
                          return
                        }
                        void onRead(m)
                      }}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono
                        border border-neon-cyan/30 text-neon-cyan
                        hover:bg-neon-cyan/10 hover:border-neon-cyan/50
                        disabled:opacity-40 disabled:cursor-not-allowed
                        transition-all"
                    >
                      <span className={playingId === m.id ? 'animate-pulse' : ''}>
                        {playingId === m.id ? '◼' : '▶'}
                      </span>
                      {playingId === m.id ? 'STOP' : 'SPEAK'}
                    </button>
                    {dedupeNonEmpty([...(m.generatedImagePaths || []), ...(assistantSavedImagePaths[m.id] || [])]).length > 0 ? (
                      <button
                        type="button"
                        onClick={() =>
                          void openLocalImage(
                            dedupeNonEmpty([
                              ...(m.generatedImagePaths || []),
                              ...(assistantSavedImagePaths[m.id] || []),
                            ]).slice(-1)[0],
                          )
                        }
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono
                          border border-neon-green/30 text-neon-green
                          hover:bg-neon-green/10 hover:border-neon-green/50
                          transition-all"
                      >
                        🖼 OPEN IMG
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Busy Indicator */}
          {busy && (
            <div className="flex items-center gap-3 px-4 py-3 bg-void-dark/80 border border-void-muted/30 rounded">
              <div className="typing-dots">
                <span />
                <span />
                <span />
              </div>
              <span className="text-void-text text-sm font-mono">
                {toolPhase ? (
                  <ToolIndicator phase={toolPhase} />
                ) : (
                  'PROCESSING...'
                )}
              </span>
            </div>
          )}

          <div ref={listEndRef} />
        </div>
      </main>

      {/* Tool Result Banner */}
      {toolResultBanner && (
        <div className="tool-result-banner mx-4 my-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-mono text-neon-green/70 uppercase tracking-wider">
                PDF_EXPORT_RESULT
              </div>
              <div className="mt-1 whitespace-pre-wrap break-all text-xs font-mono">
                {toolResultBanner.text}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setToolResultBanner(null)}
              className="text-neon-green/50 hover:text-neon-green px-2 py-1 text-xs font-mono"
            >
              DISMISS
            </button>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="error-banner mx-4 my-2 flex items-center gap-3">
          <span className="text-neon-red">⚠</span>
          <span className="flex-1">{error}</span>
        </div>
      )}

      {/* Context: manual warning with COMPRESS, or auto-compress status only */}
      {contextUsageInfo?.shouldWarn &&
        !settings.contextAutoCompress &&
        !contextWarnDismissed && (
        <div className="border-t border-neon-yellow/30 bg-neon-yellow/5 px-4 py-3 mx-4 my-2 rounded">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-mono text-neon-yellow">
              <span className="opacity-70">CONTEXT_WARNING:</span>
              {' '}CTX_USAGE {Math.round(contextUsageInfo.ratio * 100)}%
              ({contextUsageInfo.promptTokens}/{contextUsageInfo.maxTokens})
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy || contextCompressBusy}
                onClick={() => void summarizeContextNow()}
                className="cyber-btn text-xs"
              >
                {contextCompressBusy ? 'COMPRESSING...' : 'COMPRESS'}
              </button>
              <button
                type="button"
                onClick={() => setContextWarnDismissed(true)}
                className="px-3 py-1 text-xs font-mono text-void-dim hover:text-void-light"
              >
                IGNORE
              </button>
            </div>
          </div>
          <div className="context-bar mt-2">
            <div
              className={`context-fill ${contextUsageInfo.ratio > 0.9 ? 'danger' : contextUsageInfo.ratio > 0.7 ? 'warning' : ''}`}
              style={{ width: `${Math.min(100, contextUsageInfo.ratio * 100)}%` }}
            />
          </div>
        </div>
      )}
      {settings.contextAutoCompress &&
        contextUsageInfo?.shouldCompress &&
        (contextCompressBusy || busy) && (
        <div className="border-t border-neon-cyan/25 bg-neon-cyan/5 px-4 py-2 mx-4 my-2 rounded">
          <div className="text-sm font-mono text-neon-cyan">
            <span className="opacity-70">CONTEXT:</span>
            {' '}CTX {Math.round(contextUsageInfo.ratio * 100)}%
            {contextCompressBusy ? ' · auto-compressing…' : ' · auto-compress when idle'}
          </div>
        </div>
      )}

      {subAgentPanelOpen &&
        settings.subAgent.enabled &&
        settings.subAgent.showAnalysisWindow !== false && (
        <div
          className="fixed right-4 top-20 z-[65] w-[min(22rem,calc(100vw-2rem))] max-h-[min(70vh,32rem)] flex flex-col rounded border border-neon-cyan/40 bg-void-dark/95 shadow-lg backdrop-blur-sm"
          role="dialog"
          aria-label="Sub-agent vision analysis"
        >
          <div className="flex items-center justify-between gap-2 border-b border-void-muted/30 px-3 py-2">
            <div className="text-xs font-mono text-neon-cyan">
              {subAgentPanelBusy ? 'SUB_AGENT · WORKING' : 'SUB_AGENT · ANALYSIS'}
            </div>
            <button
              type="button"
              onClick={() => {
                setSubAgentPanelOpen(false)
                setSubAgentPanelBusy(false)
                setSubAgentPanelText('')
              }}
              className="px-2 py-0.5 text-[10px] font-mono text-void-dim hover:text-void-light"
            >
              CLOSE
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2">
            {subAgentPanelBusy ? (
              <div className="flex items-center gap-2 text-xs font-mono text-void-dim">
                <span
                  className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-void-dim border-t-neon-cyan"
                  aria-hidden
                />
                {subAgentPanelText}
              </div>
            ) : (
              <pre className="whitespace-pre-wrap break-words text-xs font-mono text-void-light">
                {subAgentPanelText}
              </pre>
            )}
          </div>
        </div>
      )}

      {memoryPreviewOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-void-black/80 p-4">
          <div className="w-full max-w-2xl rounded border border-neon-cyan/30 bg-void-dark p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-mono text-neon-cyan">LONG_MEMORY_PREVIEW</div>
              <button
                type="button"
                onClick={() => setMemoryPreviewOpen(false)}
                className="px-2 py-1 text-xs font-mono text-void-dim hover:text-void-light"
              >
                CLOSE
              </button>
            </div>
            <div className="max-h-[50vh] overflow-y-auto space-y-2">
              {memoryCandidates.map((m, idx) => (
                <div key={`${m.kind}-${idx}`} className="rounded border border-void-muted/30 bg-void-black/30 p-2">
                  <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-neon-green/80">
                    <span>{m.kind.toUpperCase()} · conf {(m.confidence ?? 0).toFixed(2)} · imp {(m.importance ?? 0).toFixed(2)}</span>
                    <button
                      type="button"
                      className="px-2 py-0.5 text-[10px] text-neon-red/80 hover:text-neon-red"
                      onClick={() => setMemoryCandidates((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      REMOVE
                    </button>
                  </div>
                  <div className="mt-1 text-xs text-void-light">{m.text}</div>
                  {!!m.tags?.length && (
                    <div className="mt-1 text-[10px] text-void-dim">{m.tags.join(', ')}</div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setMemoryPreviewOpen(false)
                  setMemoryCandidates([])
                }}
                className="px-3 py-1 text-xs font-mono text-void-dim hover:text-void-light"
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={() => void confirmSaveLongMemory()}
                className="cyber-btn text-xs"
                disabled={longMemoryBusy || memoryCandidates.length === 0}
              >
                CONFIRM_SAVE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Input Area */}
      <footer className="voidcast-input-area">
        <div className="mx-auto max-w-3xl">
          <input
            id="voidcast-chat-attach-input"
            ref={chatAttachmentInputRef}
            type="file"
            accept={
              isWebStandalone()
                ? CHAT_IMAGE_ACCEPT
                : `${CHAT_IMAGE_ACCEPT},${chatFileAcceptList()}`
            }
            multiple
            className={
              isWebStandalone()
                ? 'sr-only'
                : 'hidden'
            }
            aria-hidden={!isWebStandalone()}
            onChange={(e) => void onPickChatAttachments(e)}
          />
          {pendingImages.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2" aria-live="polite">
              {pendingImages.map((p, i) => (
                <div
                  key={`pending-${i}-${p.base64.slice(0, 8)}`}
                  className="relative shrink-0"
                >
                  <img
                    src={imageDataUrl(p.base64, p.mime)}
                    alt=""
                    className="h-12 w-12 rounded border border-void-muted/60 object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removePendingImage(i)}
                    className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded border border-void-muted bg-void-black text-[9px] text-void-dim hover:border-neon-red/50 hover:text-neon-red"
                    aria-label="Remove image"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {pendingFiles.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2" aria-live="polite">
              {pendingFiles.map((f, i) => (
                <div
                  key={f.id}
                  className="relative rounded border border-void-muted/60 bg-void-black/30 px-2 py-1 text-xs font-mono text-void-dim"
                >
                  <div>{f.name}{f.truncated ? ' [truncated]' : ''}</div>
                  <button
                    type="button"
                    onClick={() => removePendingFile(i)}
                    className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded border border-void-muted bg-void-black text-[9px] text-void-dim hover:border-neon-red/50 hover:text-neon-red"
                    aria-label="Remove file"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="input-wrapper">
            {isWebStandalone() ? (
              <label
                htmlFor="voidcast-chat-attach-input"
                className={`shrink-0 px-3 py-3 mb-px text-xs font-mono border border-void-muted bg-void-black/80 text-neon-cyan hover:border-neon-cyan/50 hover:bg-neon-cyan/5 transition-colors inline-flex items-center justify-center cursor-pointer ${busy ? 'opacity-40 pointer-events-none' : ''}`}
                style={{
                  clipPath:
                    'polygon(0 6px, 6px 0, calc(100% - 6px) 0, 100% 6px, 100% calc(100% - 6px), calc(100% - 6px) 100%, 6px 100%, 0 calc(100% - 6px))',
                }}
                title="Attach image from gallery"
                aria-label="Attach image from gallery"
              >
                +
              </label>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void openChatAttachmentPicker()}
                className="shrink-0 px-3 py-3 mb-px text-xs font-mono border border-void-muted bg-void-black/80 text-neon-cyan hover:border-neon-cyan/50 hover:bg-neon-cyan/5 transition-colors disabled:opacity-40"
                style={{
                  clipPath:
                    'polygon(0 6px, 6px 0, calc(100% - 6px) 0, 100% 6px, 100% calc(100% - 6px), calc(100% - 6px) 100%, 6px 100%, 0 calc(100% - 6px))',
                }}
                title="Attach image or file"
                aria-label="Attach files and images"
              >
                +
              </button>
            )}
            {settings.sttProvider === 'openrouter' && !isWebStandalone() && (
              <button
                type="button"
                disabled={busy || sttPending}
                onClick={async () => {
                  if (isRecording) {
                    setIsRecording(false)
                    if (recordingTimerRef.current) {
                      window.clearInterval(recordingTimerRef.current)
                      recordingTimerRef.current = null
                    }
                    const blob = await recorderRef.current?.stop()
                    recorderRef.current = null
                    if (!blob || blob.size === 0) return
                    setSttPending(true)
                    try {
                      const base64 = await blobToBase64(blob)
                      const text = await transcribeWithOpenRouter({
                        apiKey: settings.openrouterApiKey,
                        model: settings.openrouterSttModel,
                        audioBase64: base64,
                        format: 'webm',
                        ttsBaseUrl: settings.ttsBaseUrl,
                      })
                      if (text.trim()) {
                        setInput((prev) => (prev ? prev + ' ' : '') + text.trim())
                      }
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e))
                    } finally {
                      setSttPending(false)
                      setRecordingDuration(0)
                    }
                  } else {
                    try {
                      const recorder = await startRecording()
                      recorderRef.current = recorder
                      setIsRecording(true)
                      setRecordingDuration(0)
                      recordingTimerRef.current = window.setInterval(() => {
                        setRecordingDuration((d) => d + 1)
                      }, 1000)
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e))
                    }
                  }
                }}
                className={`shrink-0 px-3 py-3 mb-px text-xs font-mono border transition-colors disabled:opacity-40 ${
                  isRecording
                    ? 'border-neon-red bg-neon-red/10 text-neon-red animate-pulse'
                    : 'border-void-muted bg-void-black/80 text-neon-green hover:border-neon-green/50 hover:bg-neon-green/5'
                }`}
                style={{
                  clipPath:
                    'polygon(0 6px, 6px 0, calc(100% - 6px) 0, 100% 6px, 100% calc(100% - 6px), calc(100% - 6px) 100%, 6px 100%, 0 calc(100% - 6px))',
                }}
                title={isRecording ? `Recording ${recordingDuration}s (click to stop)` : sttPending ? 'Transcribing...' : 'Voice input'}
                aria-label={isRecording ? 'Stop recording' : sttPending ? 'Transcribing' : 'Start voice input'}
              >
                {sttPending ? (
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                ) : isRecording ? (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                )}
              </button>
            )}
            <textarea
              className="voidcast-textarea"
              rows={2}
              placeholder="Type a message..."
              value={input}
              disabled={busy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void onSend()
                }
              }}
            />
            
            <button
              type="button"
              disabled={!canSend}
              onClick={() => void onSend()}
              className="send-btn"
              aria-label="Send message"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" />
              </svg>
            </button>
          </div>
          
          {/* Input hints (attachments + unsaved only; model list lives in LLM options) */}
          {(pendingImages.length > 0 ||
            pendingFiles.length > 0) && (
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs font-mono text-void-dim">
              <span>
                {pendingImages.length > 0 && (
                  <span className="text-neon-cyan/70">
                    {pendingImages.length} image{pendingImages.length === 1 ? '' : 's'}{' '}
                    attached
                  </span>
                )}
                {pendingFiles.length > 0 && (
                  <span
                    className={
                      pendingImages.length > 0
                        ? 'ml-2 text-neon-green/70'
                        : 'text-neon-green/70'
                    }
                  >
                    {pendingFiles.length} file{pendingFiles.length === 1 ? '' : 's'} attached
                  </span>
                )}
              </span>
              
            </div>
          )}
        </div>
      </footer>
      </div>
      {showCodingPanel && codingPanelAvailable && (
        <CodingPanel
          settings={settings}
          fileTreeRevision={codingFileTreeNonce}
          agentShellFeed={codingTerminalFeed}
          onCodingUiChange={(patch) =>
            setSettings((s) => ({ ...s, coding: { ...s.coding, ...patch } }))
          }
          onUpdateProjectPath={applyCodingProjectPath}
        />
      )}
      </div>

      {/* System Status */}
      <div className="system-status">
        <div className="status-item min-w-0 shrink gap-2">
          <RobotIcon className="h-3.5 w-3.5 text-void-dim/70 shrink-0" />
          <span
            className="truncate text-void-text/80"
            title={`${settings.llmProvider}: ${settings.llmProvider === 'ollama' ? settings.ollamaModel : settings.llmProvider === 'nvidia' ? settings.nvidiaModel : settings.openrouterModel}`}
          >
            {settings.llmProvider === 'ollama'
              ? settings.ollamaModel
              : settings.llmProvider === 'nvidia'
                ? settings.nvidiaModel
                : settings.openrouterModel}
          </span>
          <span className="text-void-dim/30 select-none">|</span>
          <span className="text-void-dim/60 text-[10px]">{isWebStandalone() ? 'TTS' : 'TTS/STT'}</span>
          <span
            className={`dot ${ttsOk === true ? 'online' : ttsOk === false ? 'offline' : 'busy'}`}
            title={`TTS service ${ttsOk === true ? 'READY' : ttsOk === false ? 'OFFLINE' : 'CHECKING'}`}
          />
        </div>
        <div className="footer-context-readout flex min-w-0 max-w-[min(100%,22rem)] flex-col items-end gap-0.5 text-right font-mono">
          {contextUsageInfo ? (
            <>
              <span className="text-[11px] leading-tight text-void-dim tabular-nums">
                <span className="text-void-dim/60">CTX </span>
                <span className="text-void-text">{contextUsageInfo.promptTokens}</span>
                <span className="text-void-dim/50">/</span>
                <span>{contextUsageInfo.maxTokens}</span>
                <span className="ml-1.5 text-void-dim/70">
                  {Math.round(contextUsageInfo.ratio * 100)}%
                </span>
              </span>
              <span className="text-[10px] leading-tight text-void-dim/70 tabular-nums">
                <span className="text-void-dim/50">OUT </span>
                <span>{contextUsageInfo.outputTokens}</span>
              </span>
              <div
                className="h-1 w-full max-w-[14rem] overflow-hidden rounded-sm bg-void-muted/70"
                title={`Context window usage: ${contextUsageInfo.promptTokens} / ${contextUsageInfo.maxTokens} prompt tokens`}
              >
                <div
                  className={`h-full transition-[width] duration-500 ${
                    contextUsageInfo.ratio > 0.9
                      ? 'bg-neon-red/90'
                      : contextUsageInfo.ratio > 0.7
                        ? 'bg-neon-yellow/85'
                        : 'bg-neon-cyan/75'
                  }`}
                  style={{
                    width: `${Math.min(100, contextUsageInfo.ratio * 100)}%`,
                  }}
                />
              </div>
            </>
          ) : (
            <span className="text-[11px] text-void-dim/45 tabular-nums">CTX —</span>
          )}
        </div>
      </div>

      <audio ref={audioRef} className="hidden" />
    </div>
  )
}

// Session Item Sub-Component
function SessionItem({
  session,
  isActive,
  isRenaming,
  isPendingDelete,
  renameValue,
  onOpen,
  onStartRename,
  onRenameChange,
  onCommitRename,
  onCancelRename,
  onStartDelete,
  onConfirmDelete,
  onCancelDelete,
  onFork,
  onExport,
}: {
  session: ChatSession
  isActive: boolean
  isRenaming: boolean
  isPendingDelete: boolean
  renameValue: string
  onOpen: () => void
  onStartRename: () => void
  onRenameChange: (v: string) => void
  onCommitRename: () => void
  onCancelRename: () => void
  onStartDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
  onFork: () => void
  onExport: () => void
}) {
  return (
    <div className={`session-item ${isActive ? 'active' : ''}`}>
      {isRenaming ? (
        <div className="space-y-2">
          <input
            type="text"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitRename()
              else if (e.key === 'Escape') onCancelRename()
            }}
            className="w-full px-2 py-1 bg-void-black border border-void-dim text-void-light text-xs font-mono"
            autoFocus
          />
          <div className="flex gap-1">
            <button onClick={onCommitRename} className="px-2 py-0.5 text-xs bg-neon-green/20 text-neon-green border border-neon-green/30">
              SAVE
            </button>
            <button onClick={onCancelRename} className="px-2 py-0.5 text-xs text-void-dim border border-void-dim/30">
              CXL
            </button>
          </div>
        </div>
      ) : isPendingDelete ? (
        <div className="space-y-1">
          <div className="text-xs text-neon-red font-mono">CONFIRM_DELETE?</div>
          <div className="flex gap-1">
            <button onClick={onConfirmDelete} className="px-2 py-0.5 text-xs bg-neon-red/20 text-neon-red border border-neon-red/30">
              YES
            </button>
            <button onClick={onCancelDelete} className="px-2 py-0.5 text-xs text-void-dim border border-void-dim/30">
              NO
            </button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" className="w-full text-left" onClick={onOpen}>
            <div className="text-xs text-void-light truncate font-mono">{session.title}</div>
            <div className="text-[10px] text-void-dim mt-0.5">
              {new Date(session.updatedAt).toLocaleDateString()} {new Date(session.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </button>
          <div className="flex gap-1 mt-1">
            <button onClick={onFork} className="px-1.5 py-0.5 text-[10px] text-void-dim hover:text-neon-green border border-transparent hover:border-void-dim/30">
              FORK
            </button>
            <button onClick={onExport} className="px-1.5 py-0.5 text-[10px] text-void-dim hover:text-neon-cyan border border-transparent hover:border-void-dim/30">
              EXP
            </button>
            <button onClick={onStartRename} className="px-1.5 py-0.5 text-[10px] text-void-dim hover:text-neon-cyan border border-transparent hover:border-void-dim/30">
              REN
            </button>
            <button onClick={onStartDelete} className="px-1.5 py-0.5 text-[10px] text-void-dim hover:text-neon-red border border-transparent hover:border-void-dim/30">
              DEL
            </button>
          </div>
        </>
      )}
    </div>
  )
}
