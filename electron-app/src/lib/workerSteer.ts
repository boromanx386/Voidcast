/**
 * Mid-run steering for Team-mode coding workers.
 *
 * The main agent is blocked while `run_coding_workers` awaits its workers, so a
 * steer cannot be handed to the parent loop. Instead the user's message is
 * queued here; every worker drains the queue before its next round and injects
 * it as a course-correction user message. One queue object per running turn
 * (stored on the chat's session agent slot) so the composer reaches the exact
 * run it belongs to.
 */

export type WorkerSteerQueue = {
  pending: string[]
}

/** Cap so a burst of typing cannot stall the workers. */
export const WORKER_STEER_MAX_PENDING = 4
export const WORKER_STEER_MAX_CHARS = 600

export function createWorkerSteerQueue(): WorkerSteerQueue {
  return { pending: [] }
}

/**
 * Queue a course correction. Returns false when the text is empty, already
 * queued, or the queue is full — the caller then decides whether to hard-steer.
 */
export function pushWorkerSteer(queue: WorkerSteerQueue, text: string): boolean {
  const message = text.trim().slice(0, WORKER_STEER_MAX_CHARS)
  if (!message) return false
  if (queue.pending.length >= WORKER_STEER_MAX_PENDING) return false
  if (queue.pending.includes(message)) return false
  queue.pending.push(message)
  return true
}

/** Take everything queued so far (a worker drains before its next round). */
export function drainWorkerSteer(queue: WorkerSteerQueue): string[] {
  return queue.pending.splice(0, queue.pending.length)
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
