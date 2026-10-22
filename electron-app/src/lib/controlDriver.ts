/**
 * Drives the on-screen chat UI on behalf of the local control API.
 *
 * Per-chat turn context (system prompt preset, compressed history summary,
 * coding memo, agent mode, model) is derived from the VIEWED chat, so a turn can
 * only be started safely from the chat that owns it. Starting one therefore
 * means: navigate to the target chat, send exactly like the composer would, and
 * (optionally) navigate back — the run keeps going in the background, which the
 * multi-chat runtime already supports. Actions are serialised because each one
 * moves the shared view.
 */

import type { AgentChatMode, ChatSession } from '@/types/chat'
import type { ControlActionResult, ControlStartInput } from '@/lib/controlApi'

export const CONTROL_STEP_TIMEOUT_MS = 5_000
const POLL_MS = 25
/** One React commit after a navigation call so the refs the send path reads are current. */
const SETTLE_MS = 100

export type ControlDriverEnv = {
  getActiveSessionId: () => string | null
  getSession: (id: string) => ChatSession | undefined
  isBusy: (id: string) => boolean
  messageCount: (id: string) => number
  slotError: (id: string) => string | null
  newChatForProject: (projectPath: string) => void
  setPendingMode: (mode: AgentChatMode) => void
  openSession: (session: ChatSession) => void
  setModelForSession: (id: string, model: string) => void
  /** Same entry point as the composer; resolves when the WHOLE turn ends. */
  send: (opts: {
    text: string
    forceAgentMode?: AgentChatMode
    forceModel?: string
  }) => Promise<void>
  sleep?: (ms: number) => Promise<void>
}

export function createControlDriver(env: ControlDriverEnv) {
  const sleep = env.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task, task)
    chain = run.catch(() => undefined)
    return run
  }

  async function waitFor(
    cond: () => boolean,
    timeoutMs = CONTROL_STEP_TIMEOUT_MS,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (!cond()) {
      if (Date.now() >= deadline) return false
      await sleep(POLL_MS)
    }
    return true
  }

  /**
   * Fire the turn without awaiting it, then wait until the run is observable:
   * busy, or already answered. `failure` carries a send() rejection / early return.
   */
  async function sendAndConfirm(
    id: string | null,
    run: () => Promise<void>,
    baseCount: number,
  ): Promise<{ id: string } | { error: string; status: number }> {
    let settled = false
    let failure: string | null = null
    void run()
      .catch((error: unknown) => {
        failure = error instanceof Error ? error.message : String(error)
      })
      .finally(() => {
        settled = true
      })

    let resolvedId = id
    const started = () =>
      resolvedId !== null &&
      (env.isBusy(resolvedId) || env.messageCount(resolvedId) > baseCount + 1)
    await waitFor(() => {
      resolvedId = resolvedId ?? env.getActiveSessionId()
      return failure !== null || started() || settled
    })
    if (failure) return { error: failure, status: 500 }
    if (!resolvedId || !started()) {
      return {
        error:
          (resolvedId ? env.slotError(resolvedId) : null) ??
          'The turn did not start (agent limit reached?).',
        status: 409,
      }
    }
    return { id: resolvedId }
  }

  function startChat(input: ControlStartInput): Promise<ControlActionResult> {
    return serial(async () => {
      const previousId = env.getActiveSessionId()
      env.newChatForProject(input.projectPath)
      env.setPendingMode(input.mode)
      await sleep(SETTLE_MS)
      const result = await sendAndConfirm(
        null,
        () =>
          env.send({
            text: input.text,
            forceAgentMode: input.mode,
            ...(input.model ? { forceModel: input.model } : {}),
          }),
        0,
      )
      if ('error' in result) return result
      // Persist the pin so follow-up sends on this chat keep the same model.
      if (input.model) env.setModelForSession(result.id, input.model)
      // Returning to a previous *draft* would hand it the new chat's composer
      // stash, so only a real chat is restored.
      if (input.background && previousId && previousId !== result.id) {
        const previous = env.getSession(previousId)
        if (previous) env.openSession(previous)
      }
      return result
    })
  }

  function sendToChat(id: string, text: string, background: boolean): Promise<ControlActionResult> {
    return serial(async () => {
      const target = env.getSession(id)
      if (!target) return { error: 'Unknown chat id.', status: 404 }
      const previousId = env.getActiveSessionId()
      if (previousId !== id) {
        env.openSession(target)
        if (!(await waitFor(() => env.getActiveSessionId() === id))) {
          return { error: 'Could not switch to the chat.', status: 409 }
        }
      }
      await sleep(SETTLE_MS)
      const result = await sendAndConfirm(id, () => env.send({ text }), env.messageCount(id))
      if ('error' in result) return result
      if (background && previousId && previousId !== id) {
        const previous = env.getSession(previousId)
        if (previous) env.openSession(previous)
      }
      return result
    })
  }

  return { startChat, sendToChat }
}
