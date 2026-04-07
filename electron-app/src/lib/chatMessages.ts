import type { ChatMessage } from '@/lib/ollama'

export type HistoryTurn = { role: 'user' | 'assistant'; content: string }

/**
 * Build Ollama messages: optional system, trimmed history, new user turn.
 * `maxHistoryMessages` = 0 means no limit (all prior messages).
 */
export function buildOllamaMessages(
  priorMessages: HistoryTurn[],
  newUserContent: string,
  opts: { systemPrompt: string; maxHistoryMessages: number },
): ChatMessage[] {
  const max = opts.maxHistoryMessages
  const slice =
    max > 0 && priorMessages.length > max
      ? priorMessages.slice(-max)
      : priorMessages

  const out: ChatMessage[] = []
  const sys = opts.systemPrompt.trim()
  if (sys) {
    out.push({ role: 'system', content: sys })
  }
  for (const m of slice) {
    out.push({ role: m.role, content: m.content })
  }
  out.push({ role: 'user', content: newUserContent })
  return out
}
