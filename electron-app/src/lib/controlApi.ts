/**
 * Request handlers behind the local control API (read, stop, create, send).
 *
 * The agent loop lives in the renderer, so the main-process HTTP server only
 * relays a `{ method, params }` pair here. Everything is injected through
 * `ControlDeps` so the handlers stay unit-testable without React or Electron.
 */

import type { AgentChatMode, ChatSession, UiMessage } from '@/types/chat'
import type { SessionAgentSlot } from '@/lib/sessionAgentStore'
import type { SubAgentWorkerMetrics } from '@/lib/subAgentPanelState'
import type { TurnUsageTotals } from '@/lib/ollama'

export const CONTROL_TRANSCRIPT_DEFAULT_LIMIT = 50
export const CONTROL_TRANSCRIPT_MAX_LIMIT = 200
export const CONTROL_MESSAGE_DEFAULT_CHARS = 4_000
export const CONTROL_MESSAGE_MAX_CHARS = 20_000
const PREVIEW_CHARS = 200
const SUBAGENT_EVENTS = 12
const SUBAGENT_LINE_CHARS = 300

export type ControlResult =
  { ok: true; data: unknown } | { ok: false; status: number; error: string }

export const CONTROL_TEXT_MAX_CHARS = 100_000
const CONTROL_MODES: readonly AgentChatMode[] = ['agent', 'ask', 'plan', 'team']

export type ControlStartInput = {
  text: string
  /** '' = General (no coding folder). */
  projectPath: string
  mode: AgentChatMode
  /** Scoped `provider:modelId`, '' = follow Options. */
  model: string
  /** Keep the user's current chat on screen instead of switching to the new run. */
  background: boolean
}

export type ControlActionResult = { id: string } | { error: string; status: number }

export type ControlDeps = {
  listSessions: () => ChatSession[]
  /** Live runtime slot for a chat, if the store has ever touched it. */
  getSlot: (id: string) => SessionAgentSlot | undefined
  /** Same effect as the composer Stop button, for an arbitrary chat. */
  stop: (id: string) => void
  /** Whether the user allowed external callers to start agent turns. */
  sendAllowed?: () => boolean
  /** Create a chat and start its first turn; resolves once the run is live. */
  startChat?: (input: ControlStartInput) => Promise<ControlActionResult>
  /** Start a turn in an existing idle chat; resolves once the run is live. */
  sendToChat?: (id: string, text: string, background: boolean) => Promise<ControlActionResult>
}

export type ControlChatStatus = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  agentMode: AgentChatMode | null
  model: string | null
  busy: boolean
  error: string | null
  toolPhase: string | null
  codingProjectPath: string | null
  /**
   * What the last finished turn of the main agent cost, summed over its model rounds
   * (Team workers report their own in `subAgent.workers[].metrics`). `null` before any
   * turn ran this launch or when the provider reported no usage.
   */
  turnUsage: TurnUsageTotals | null
  /**
   * Team-worker / sub-agent card. It outlives the turn, so a caller can still read
   * why a worker batch ended (`workers[].lastLine`, `events`) after it finished.
   */
  subAgent: {
    busy: boolean
    kind: string
    title: string
    progress: string
    workers: Array<{
      id: string
      label: string
      status: string
      progress: string | null
      lastLine: string | null
      /** Cost of the worker (time, rounds, tokens); present once it finished. */
      metrics: SubAgentWorkerMetrics | null
    }>
    events: Array<{ at: number; level: string; text: string }>
  } | null
  messageCount: number
  lastMessage: { role: UiMessage['role']; preview: string } | null
}

const fail = (status: number, error: string): ControlResult => ({ ok: false, status, error })
const ok = (data: unknown): ControlResult => ({ ok: true, data })

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

/**
 * The live slot is authoritative while a chat is open or running; the persisted
 * session copy can lag behind the stream. A slot with no messages falls back to
 * the persisted history (a chat that was never opened this launch).
 */
function messagesFor(session: ChatSession, slot: SessionAgentSlot | undefined): UiMessage[] {
  return slot && slot.messages.length > 0 ? slot.messages : session.messages
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export function buildChatStatus(
  session: ChatSession,
  slot: SessionAgentSlot | undefined,
): ControlChatStatus {
  const messages = messagesFor(session, slot)
  const last = messages[messages.length - 1]
  const panel = slot?.subAgentPanel
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    agentMode: session.agentMode ?? null,
    model: session.model ?? null,
    busy: Boolean(slot?.busy),
    error: slot?.error ?? null,
    toolPhase: slot?.toolPhase ? String(slot.toolPhase) : null,
    codingProjectPath: slot?.codingProjectPath ?? session.codingProjectPath ?? null,
    turnUsage: slot?.contextUsageInfo?.turnTotals ?? null,
    subAgent:
      panel && panel.kind !== 'idle'
        ? {
            busy: panel.busy,
            kind: panel.kind,
            title: panel.title,
            progress: panel.progress,
            workers: panel.workers.map((w) => ({
              id: w.id,
              label: w.label,
              status: w.status,
              progress: w.progress ?? null,
              lastLine: w.lastLine ? clip(w.lastLine, SUBAGENT_LINE_CHARS) : null,
              metrics: w.metrics ?? null,
            })),
            events: panel.events.slice(-SUBAGENT_EVENTS).map((e) => ({
              at: e.at,
              level: e.level,
              text: clip(e.text, SUBAGENT_LINE_CHARS),
            })),
          }
        : null,
    messageCount: messages.length,
    lastMessage: last ? { role: last.role, preview: clip(last.content, PREVIEW_CHARS) } : null,
  }
}

function findSession(deps: ControlDeps, params: Record<string, unknown>): ChatSession | null {
  const id = typeof params.id === 'string' ? params.id.trim() : ''
  if (!id) return null
  return deps.listSessions().find((s) => s.id === id) ?? null
}

function parseText(raw: unknown): string | ControlResult {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return fail(400, '`text` is required.')
  if (text.length > CONTROL_TEXT_MAX_CHARS) {
    return fail(400, `\`text\` is limited to ${CONTROL_TEXT_MAX_CHARS} characters.`)
  }
  return text
}

function parseBackground(raw: unknown): boolean {
  return !(raw === false || raw === 'false')
}

function actionResult(res: ControlActionResult): ControlResult {
  return 'error' in res ? fail(res.status, res.error) : ok({ id: res.id, started: true })
}

export async function handleControlRequest(
  method: string,
  params: Record<string, unknown>,
  deps: ControlDeps,
): Promise<ControlResult> {
  switch (method) {
    case 'chats.list': {
      const chats = deps
        .listSessions()
        .map((s) => buildChatStatus(s, deps.getSlot(s.id)))
        .sort((a, b) => b.updatedAt - a.updatedAt)
      return ok({ chats })
    }

    case 'chats.get': {
      const session = findSession(deps, params)
      if (!session) return fail(404, 'Unknown chat id.')
      return ok(buildChatStatus(session, deps.getSlot(session.id)))
    }

    case 'chats.transcript': {
      const session = findSession(deps, params)
      if (!session) return fail(404, 'Unknown chat id.')
      const all = messagesFor(session, deps.getSlot(session.id))
      const limit = clampInt(
        params.limit,
        CONTROL_TRANSCRIPT_DEFAULT_LIMIT,
        1,
        CONTROL_TRANSCRIPT_MAX_LIMIT,
      )
      const maxChars = clampInt(
        params.maxChars,
        CONTROL_MESSAGE_DEFAULT_CHARS,
        1,
        CONTROL_MESSAGE_MAX_CHARS,
      )
      // `since` is a message index (the caller's last `total`), so polling only
      // fetches what is new. Past the end is simply an empty page.
      const from = clampInt(params.since, 0, 0, all.length)
      // Opt-in: the intermediate drafts an agent wrote between tool rounds.
      const withProgress =
        params.progress === true || params.progress === '1' || params.progress === 'true'
      const page = all.slice(from, from + limit)
      return ok({
        total: all.length,
        from,
        // Raw base64 images are deliberately not part of the payload.
        messages: page.map((m, i) => ({
          index: from + i,
          id: m.id,
          role: m.role,
          content: clip(m.content, maxChars),
          truncated: m.content.length > maxChars,
          ...(withProgress && m.agentProgress?.length
            ? {
                progress: m.agentProgress.map((b) => ({
                  round: b.round,
                  content: clip(b.content, maxChars),
                })),
              }
            : {}),
          turnStartedAt: m.turnStartedAt ?? null,
          turnEndedAt: m.turnEndedAt ?? null,
        })),
      })
    }

    case 'chats.stop': {
      const session = findSession(deps, params)
      if (!session) return fail(404, 'Unknown chat id.')
      if (!deps.getSlot(session.id)?.busy) return ok({ stopped: false })
      deps.stop(session.id)
      return ok({ stopped: true })
    }

    case 'chats.create': {
      if (!deps.sendAllowed?.() || !deps.startChat) {
        return fail(403, 'Starting turns is disabled in Options → General.')
      }
      const text = parseText(params.text)
      if (typeof text !== 'string') return text
      const mode = (params.mode ?? 'agent') as AgentChatMode
      if (!CONTROL_MODES.includes(mode))
        return fail(400, '`mode` must be agent, ask, plan or team.')
      const projectPath = typeof params.projectPath === 'string' ? params.projectPath.trim() : ''
      const model = typeof params.model === 'string' ? params.model.trim() : ''
      if (projectPath.length > 1024 || model.length > 200) return fail(400, 'Value too long.')
      return actionResult(
        await deps.startChat({
          text,
          projectPath,
          mode,
          model,
          background: parseBackground(params.background),
        }),
      )
    }

    case 'chats.send': {
      if (!deps.sendAllowed?.() || !deps.sendToChat) {
        return fail(403, 'Starting turns is disabled in Options → General.')
      }
      const session = findSession(deps, params)
      if (!session) return fail(404, 'Unknown chat id.')
      const text = parseText(params.text)
      if (typeof text !== 'string') return text
      if (deps.getSlot(session.id)?.busy) {
        return fail(409, 'Chat is busy. Wait for it to finish or stop it first.')
      }
      return actionResult(
        await deps.sendToChat(session.id, text, parseBackground(params.background)),
      )
    }

    default:
      return fail(404, `Unknown control method "${method}".`)
  }
}
