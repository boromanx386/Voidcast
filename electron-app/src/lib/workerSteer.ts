/**
 * Mid-run steering for Team-mode coding workers.
 *
 * The main agent is blocked while `run_coding_workers` awaits its workers, so a
 * steer cannot be handed to the parent loop. Instead the user's message is
 * queued here; every worker drains the queue before its next round and injects
 * it as a course-correction user message. One queue object per running turn
 * (stored on the chat's session agent slot) so the composer reaches the exact
 * run it belongs to.
 *
 * The queue is an append-only log and every worker keeps its own read cursor,
 * so a steer reaches ALL workers of the batch (a shared "drain" would hand it
 * to whichever worker asked first and starve its sibling).
 */

export type WorkerSteerQueue = {
  entries: string[]
}

/** Cap per turn so a burst of typing cannot flood the workers. */
export const WORKER_STEER_MAX_ENTRIES = 8
export const WORKER_STEER_MAX_CHARS = 600

export type WorkerSteerPush = 'queued' | 'duplicate' | 'full' | 'empty'

export function createWorkerSteerQueue(): WorkerSteerQueue {
  return { entries: [] }
}

/**
 * Queue a course correction. The verdict lets the caller tell "already queued"
 * (swallow it) from "queue full" (tell the user) — neither should abort the run.
 */
export function pushWorkerSteer(queue: WorkerSteerQueue, text: string): WorkerSteerPush {
  const message = text.trim().slice(0, WORKER_STEER_MAX_CHARS)
  if (!message) return 'empty'
  if (queue.entries.includes(message)) return 'duplicate'
  if (queue.entries.length >= WORKER_STEER_MAX_ENTRIES) return 'full'
  queue.entries.push(message)
  return 'queued'
}

/**
 * Steers a worker has not seen yet. `cursor` is how many entries it already
 * consumed; start a batch at `queue.entries.length` so it ignores older steers.
 */
export function readWorkerSteer(
  queue: WorkerSteerQueue,
  cursor: number,
): { messages: string[]; nextCursor: number } {
  const from = Math.max(0, cursor)
  return { messages: queue.entries.slice(from), nextCursor: queue.entries.length }
}

/** Model-facing wrapper so a steer is unambiguous against the original goal. */
export function formatWorkerSteerMessage(text: string): string {
  const body = text.trim().slice(0, WORKER_STEER_MAX_CHARS)
  return [
    '[Steer — user course correction while you work]',
    body,
    'Apply this to your remaining work; do not restart work that is already done.',
  ].join('\n')
}
