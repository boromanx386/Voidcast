import { normalizeCodingContextMemo } from '@/lib/codingContextMemo'
import {
  idbDeleteSession,
  idbGetMeta,
  idbListSessions,
  idbPutSessionsAndMeta,
} from '@/lib/chatSessionsIndexedDb'
import { normalizeImageVisionCache } from '@/lib/imageVisionCache'
import { normalizePlanArtifact } from '@/lib/planArtifact'
import type { ChatSession, ChatSessionsState, UiMessage } from '@/types/chat'

/** Drop image payloads before persistence — avoids quota blowups (MVP). */
function stripImagesForPersistence(msg: UiMessage): UiMessage {
  let base =
    msg.role !== 'user' || (!msg.images?.length && !msg.imageMimes?.length)
      ? msg
      : (() => {
          const { images: _i, imageMimes: _m, ...rest } = msg
          return rest
        })()
  if (base.generatedImageUrls?.length) {
    const generatedImageUrls = base.generatedImageUrls.filter(
      (u) => !u.startsWith('data:image/'),
    )
    base =
      generatedImageUrls.length > 0
        ? { ...base, generatedImageUrls }
        : (() => {
            const { generatedImageUrls: _drop, ...rest } = base
            return rest
          })()
  }
  if (!base.fileAttachments?.length) return base
  return {
    ...base,
    fileAttachments: base.fileAttachments.map((f) => {
      if (!f.content || f.content.length <= 400 * 1024) return f
      return { ...f, content: f.content.slice(0, 400 * 1024), truncated: true }
    }),
  }
}

/** Legacy localStorage key — kept after migration for rollback safety. */
export const LEGACY_CHAT_SESSIONS_KEY = 'voidcast-chat-sessions-v1'

const SCHEMA_VERSION = 1
const SAVE_DEBOUNCE_MS = 400
const MIGRATED_FROM_LOCAL_STORAGE = 'localStorage-v1'

const EMPTY_STATE: ChatSessionsState = {
  sessions: [],
  activeSessionId: null,
}

function isSessionLike(v: unknown): v is ChatSession {
  if (!v || typeof v !== 'object') return false
  const s = v as Partial<ChatSession>
  return (
    typeof s.id === 'string' &&
    typeof s.title === 'string' &&
    typeof s.createdAt === 'number' &&
    typeof s.updatedAt === 'number' &&
    Array.isArray(s.messages)
  )
}

function normalizeMessage(msg: UiMessage): UiMessage {
  if (!msg.plan) return msg
  const plan = normalizePlanArtifact(msg.plan)
  if (!plan) {
    const { plan: _drop, ...rest } = msg
    return rest
  }
  // Interrupted Approve & Build must not stay locked after reload.
  if (plan.status === 'approved') {
    return { ...msg, plan: { ...plan, status: 'draft' } }
  }
  return { ...msg, plan }
}

function normalizeSession(raw: ChatSession): ChatSession {
  const projectPath = (raw.codingProjectPath ?? raw.codingContextMemo?.projectPath ?? '').trim()
  const imageVisionCache = normalizeImageVisionCache(raw.imageVisionCache)
  const hasVisionCache = Object.keys(imageVisionCache).length > 0
  const messages = Array.isArray(raw.messages) ? raw.messages.map(normalizeMessage) : raw.messages
  const base: ChatSession = { ...raw, messages }
  if (!raw.codingContextMemo) {
    return hasVisionCache ? { ...base, imageVisionCache } : base
  }
  return {
    ...base,
    codingProjectPath: projectPath || raw.codingProjectPath,
    codingContextMemo: normalizeCodingContextMemo(raw.codingContextMemo, projectPath),
    ...(hasVisionCache ? { imageVisionCache } : {}),
  }
}

function normalizeState(raw: unknown): ChatSessionsState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_STATE }
  const r = raw as Partial<ChatSessionsState>
  const sessions = Array.isArray(r.sessions)
    ? r.sessions.filter(isSessionLike).map(normalizeSession).sort((a, b) => b.updatedAt - a.updatedAt)
    : []
  const activeSessionId =
    typeof r.activeSessionId === 'string' && sessions.some((x) => x.id === r.activeSessionId)
      ? r.activeSessionId
      : null
  return { sessions, activeSessionId }
}

function stripStateForPersistence(state: ChatSessionsState): ChatSessionsState {
  return {
    ...state,
    sessions: state.sessions.map((s) => ({
      ...s,
      messages: s.messages.map(stripImagesForPersistence),
    })),
  }
}

function loadLegacyLocalStorage(): ChatSessionsState {
  try {
    if (typeof localStorage === 'undefined') return { ...EMPTY_STATE }
    const raw = localStorage.getItem(LEGACY_CHAT_SESSIONS_KEY)
    if (!raw) return { ...EMPTY_STATE }
    return normalizeState(JSON.parse(raw))
  } catch {
    return { ...EMPTY_STATE }
  }
}

async function loadFromIndexedDb(): Promise<ChatSessionsState> {
  const [meta, rawSessions] = await Promise.all([idbGetMeta(), idbListSessions()])
  const sessions = rawSessions
    .filter(isSessionLike)
    .map(normalizeSession)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const activeSessionId =
    typeof meta?.activeSessionId === 'string' && sessions.some((x) => x.id === meta.activeSessionId)
      ? meta.activeSessionId
      : null
  return { sessions, activeSessionId }
}

/**
 * One-time migration from localStorage blob → IndexedDB.
 * Legacy key is left in place for rollback. Idempotent via meta.migratedFrom.
 */
async function migrateFromLocalStorageIfNeeded(): Promise<ChatSessionsState> {
  const meta = await idbGetMeta()
  if (meta?.migratedFrom || (meta?.schemaVersion ?? 0) >= SCHEMA_VERSION) {
    return loadFromIndexedDb()
  }

  const legacy = loadLegacyLocalStorage()
  const payload = stripStateForPersistence(legacy)
  try {
    await idbPutSessionsAndMeta(payload.sessions, {
      activeSessionId: payload.activeSessionId,
      migratedFrom: MIGRATED_FROM_LOCAL_STORAGE,
      schemaVersion: SCHEMA_VERSION,
    })
    return payload
  } catch (err) {
    console.warn(
      '[voidcast] Chat sessions IndexedDB migration failed; using localStorage fallback.',
      err,
    )
    return legacy
  }
}

export async function loadChatSessions(): Promise<ChatSessionsState> {
  try {
    return await migrateFromLocalStorageIfNeeded()
  } catch (err) {
    console.warn('[voidcast] Chat sessions IndexedDB load failed; using localStorage fallback.', err)
    return loadLegacyLocalStorage()
  }
}

export async function saveChatSessions(state: ChatSessionsState): Promise<void> {
  const payload = stripStateForPersistence(state)
  const existingMeta = await idbGetMeta().catch(() => undefined)
  await idbPutSessionsAndMeta(payload.sessions, {
    activeSessionId: payload.activeSessionId,
    migratedFrom: existingMeta?.migratedFrom ?? MIGRATED_FROM_LOCAL_STORAGE,
    schemaVersion: SCHEMA_VERSION,
  })
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  await idbDeleteSession(sessionId)
}

export function upsertSession(
  state: ChatSessionsState,
  session: ChatSession,
  setActive = true,
): ChatSessionsState {
  const idx = state.sessions.findIndex((s) => s.id === session.id)
  const sessions = [...state.sessions]
  if (idx >= 0) sessions[idx] = session
  else sessions.unshift(session)
  sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  return {
    sessions,
    activeSessionId: setActive ? session.id : state.activeSessionId,
  }
}

export function deleteSessionById(
  state: ChatSessionsState,
  sessionId: string,
): ChatSessionsState {
  const sessions = state.sessions.filter((s) => s.id !== sessionId)
  const activeSessionId =
    state.activeSessionId === sessionId ? sessions[0]?.id ?? null : state.activeSessionId
  return { sessions, activeSessionId }
}

// --- Debounced persist -------------------------------------------------------

let pendingSave: ChatSessionsState | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let flushListenersBound = false
let saveInFlight: Promise<void> | null = null

function logSaveError(err: unknown): void {
  console.warn('[voidcast] Failed to persist chat sessions to IndexedDB.', err)
}

async function runPendingSave(): Promise<void> {
  if (!pendingSave) return
  const toSave = pendingSave
  pendingSave = null
  try {
    await saveChatSessions(toSave)
  } catch (err) {
    logSaveError(err)
  }
}

export function scheduleSaveChatSessions(state: ChatSessionsState): void {
  pendingSave = state
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveInFlight = runPendingSave().finally(() => {
      saveInFlight = null
    })
  }, SAVE_DEBOUNCE_MS)
  ensureFlushListeners()
}

export async function flushSaveChatSessions(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (saveInFlight) await saveInFlight
  await runPendingSave()
}

function ensureFlushListeners(): void {
  if (flushListenersBound || typeof window === 'undefined') return
  flushListenersBound = true
  const flush = () => {
    void flushSaveChatSessions()
  }
  window.addEventListener('beforeunload', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}
