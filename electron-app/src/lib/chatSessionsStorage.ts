import { normalizeCodingContextMemo } from '@/lib/codingContextMemo'
import {
  idbDeleteSession,
  idbGetMeta,
  idbListSessions,
  idbPutSessionsAndMeta,
} from '@/lib/chatSessionsIndexedDb'
import { normalizeImageVisionCache } from '@/lib/imageVisionCache'
import { normalizePlanArtifact } from '@/lib/planArtifact'
import { normalizeSubAgentActivity } from '@/lib/subAgentPanelState'
import type { ChatSession, ChatSessionsState, UiMessage } from '@/types/chat'
import { normalizeChatThinkLevel } from '@/types/chat'

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
    const generatedImageUrls = base.generatedImageUrls.filter((u) => !u.startsWith('data:image/'))
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
  let next = msg
  if (msg.plan) {
    const plan = normalizePlanArtifact(msg.plan)
    if (!plan) {
      const { plan: _drop, ...rest } = msg
      next = rest
    } else if (plan.status === 'approved') {
      // Interrupted Approve & Build must not stay locked after reload.
      next = { ...msg, plan: { ...plan, status: 'draft' } }
    } else {
      next = { ...msg, plan }
    }
  }
  if (next.subAgentActivity) {
    const activity = normalizeSubAgentActivity(next.subAgentActivity)
    if (!activity) {
      const { subAgentActivity: _drop, ...rest } = next
      next = rest
    } else {
      next = { ...next, subAgentActivity: activity }
    }
  }
  return next
}

function normalizeSession(raw: ChatSession): ChatSession {
  const projectPath = (raw.codingProjectPath ?? raw.codingContextMemo?.projectPath ?? '').trim()
  const imageVisionCache = normalizeImageVisionCache(raw.imageVisionCache)
  const hasVisionCache = Object.keys(imageVisionCache).length > 0
  const messages = Array.isArray(raw.messages) ? raw.messages.map(normalizeMessage) : raw.messages
  // Chats saved before presets were removed still carry `systemPromptPreset`; drop it.
  const { systemPromptPreset: _legacyPreset, ...rest } = raw as ChatSession & {
    systemPromptPreset?: unknown
  }
  const base: ChatSession = {
    ...rest,
    messages,
    thinkLevel: normalizeChatThinkLevel(raw.thinkLevel),
  }
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
    ? r.sessions
        .filter(isSessionLike)
        .map(normalizeSession)
        .sort((a, b) => b.updatedAt - a.updatedAt)
    : []
  const activeSessionId =
    typeof r.activeSessionId === 'string' && sessions.some((x) => x.id === r.activeSessionId)
      ? r.activeSessionId
      : null
  return { sessions, activeSessionId }
}

function stripStateForPersistence(state: ChatSessionsState): ChatSessionsState {
  // Sticky unsaved sessions (auto-save off) stay in memory only until Save.
  const sessions = state.sessions
    .filter((s) => !s.unsaved)
    .map((s) => {
      const { unsaved: _drop, ...rest } = s
      return {
        ...rest,
        messages: rest.messages.map(stripImagesForPersistence),
      }
    })
  const activeSessionId =
    typeof state.activeSessionId === 'string' &&
    sessions.some((x) => x.id === state.activeSessionId)
      ? state.activeSessionId
      : null
  return { sessions, activeSessionId }
}

function loadLegacyLocalStorage(): ChatSessionsState {
  // A read error may be temporary, so it propagates and the caller can retry.
  const raw = localStorage.getItem(LEGACY_CHAT_SESSIONS_KEY)
  if (raw === null) return { ...EMPTY_STATE }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    // Unparseable content never heals, so retrying it would block startup forever.
    console.warn('[voidcast] Ignoring unreadable legacy chat history.', err)
    return { ...EMPTY_STATE }
  }
  return normalizeState(parsed)
}

/**
 * Loads chat history from IndexedDB, running the one-time localStorage → IndexedDB
 * migration first if it has not committed yet. The legacy key is left in place for
 * rollback. Rejects on storage errors instead of falling back, so autosave never
 * replaces a history it could not read.
 */
export async function loadChatSessions(): Promise<ChatSessionsState> {
  const meta = await idbGetMeta()
  if (meta && (meta.migratedFrom || meta.schemaVersion >= SCHEMA_VERSION)) {
    return normalizeState({
      sessions: await idbListSessions(),
      activeSessionId: meta.activeSessionId,
    })
  }

  // Autosave replaces the full history. Only a committed migration is safe to edit.
  const payload = stripStateForPersistence(loadLegacyLocalStorage())
  await idbPutSessionsAndMeta(payload.sessions, {
    activeSessionId: payload.activeSessionId,
    migratedFrom: MIGRATED_FROM_LOCAL_STORAGE,
    schemaVersion: SCHEMA_VERSION,
  })
  return payload
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

export function deleteSessionById(state: ChatSessionsState, sessionId: string): ChatSessionsState {
  return deleteSessionsByIds(state, [sessionId])
}

/** Bulk delete in one pass; active falls back to the newest survivor only if it was removed. */
export function deleteSessionsByIds(
  state: ChatSessionsState,
  sessionIds: Iterable<string>,
): ChatSessionsState {
  const drop = new Set(sessionIds)
  const sessions = state.sessions.filter((s) => !drop.has(s.id))
  const activeSessionId =
    state.activeSessionId && drop.has(state.activeSessionId)
      ? (sessions[0]?.id ?? null)
      : state.activeSessionId
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

let persistenceEnabled = true

/**
 * Turns autosave on or off for this app run. Off is for running without a history that
 * failed to load: every save replaces the full stored history, so it must not run.
 */
export function setChatSessionsPersistence(enabled: boolean): void {
  persistenceEnabled = enabled
  if (enabled) return
  pendingSave = null
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
}

export function scheduleSaveChatSessions(state: ChatSessionsState): void {
  if (!persistenceEnabled) return
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
