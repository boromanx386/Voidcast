import type { AgentLoopDebugEvent } from '@/lib/agentToolLoop'

/** One JSONL file per chat; turns append to it, each opened by a `turn-start` line. */
export function agentDebugFileName(chatKey: string): string {
  const safe = chatKey.replace(/[^\w.-]+/g, '_').slice(0, 100) || 'chat'
  return `${safe}.jsonl`
}

/**
 * Buffers loop events and appends them to ~/.voidcast/agent-debug/ once per round,
 * in order. Returns undefined outside Electron, so callers can pass it straight through.
 */
export function createAgentDebugSink(meta: {
  chatKey: string
  model: string
  agentMode?: string
  projectPath?: string
}): ((event: AgentLoopDebugEvent) => void) | undefined {
  const append = typeof window !== 'undefined' ? window.voidcast?.agentDebugAppend : undefined
  if (!append) return undefined
  const file = agentDebugFileName(meta.chatKey)
  let pending: string[] = [
    JSON.stringify({ t: 'turn-start', at: new Date().toISOString(), ...meta }),
  ]
  let chain: Promise<unknown> = Promise.resolve()
  const flush = () => {
    if (pending.length === 0) return
    const lines = pending
    pending = []
    // Serialize writes so lines land in event order.
    chain = chain.then(() => append({ file, lines })).catch(() => undefined)
  }
  return (event) => {
    pending.push(JSON.stringify({ ...event, at: new Date().toISOString() }))
    // A round line closes the model call; tool lines of that round follow, and the next
    // round line flushes them. Reprompts end a turn, so flush those immediately too.
    if (event.t === 'round' || event.t === 'reprompt') flush()
  }
}
