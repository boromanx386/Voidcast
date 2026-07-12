import { normalizeCodingContextMemo } from '@/lib/codingContextMemo'
import { normalizeImageVisionCache } from '@/lib/imageVisionCache'
import { normalizePlanArtifact } from '@/lib/planArtifact'
import type { ChatSession, ChatSessionsState, UiMessage } from '@/types/chat'

/** Drop image payloads before localStorage — avoids quota blowups (MVP). */
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

const STORAGE_KEY = 'voidcast-chat-sessions-v1'

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

export function loadChatSessions(): ChatSessionsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...EMPTY_STATE }
    return normalizeState(JSON.parse(raw))
  } catch {
    return { ...EMPTY_STATE }
  }
}

export function saveChatSessions(state: ChatSessionsState): void {
  const payload: ChatSessionsState = {
    ...state,
    sessions: state.sessions.map((s) => ({
      ...s,
      messages: s.messages.map(stripImagesForPersistence),
    })),
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
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
