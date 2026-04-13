import type { OllamaApiMessage, OllamaModelOptions } from '@/lib/ollama'
import { normalizeBaseUrl } from '@/lib/settings'

type ContextTurn = { role: 'user' | 'assistant'; content: string }

function compactModelOptions(
  o: OllamaModelOptions | undefined,
): Record<string, number> | undefined {
  if (!o) return undefined
  const out: Record<string, number> = {}
  if (o.temperature !== undefined) out.temperature = o.temperature
  if (o.num_ctx !== undefined) out.num_ctx = o.num_ctx
  return Object.keys(out).length ? out : undefined
}

function buildTranscript(turns: ContextTurn[]): string {
  return turns
    .map((t) => `${t.role === 'user' ? 'USER' : 'ASSISTANT'}: ${t.content.trim()}`)
    .join('\n\n')
}

/**
 * Build a compact hidden summary used as internal memory when context is near full.
 * This summary is never shown as a chat message.
 */
export async function compressConversationContext(params: {
  baseUrl: string
  model: string
  turns: ContextTurn[]
  existingSummary?: string
  modelOptions?: OllamaModelOptions
  signal?: AbortSignal
}): Promise<string> {
  const root = normalizeBaseUrl(params.baseUrl)
  const transcript = buildTranscript(params.turns)
  if (!transcript.trim()) return params.existingSummary?.trim() ?? ''

  const system =
    'You are compressing conversation context for an assistant memory buffer. Produce a concise, factual summary for future turns. Keep critical user preferences, constraints, unresolved tasks, concrete facts, and recent decisions. Use short bullet lines. Do not include meta commentary.'
  const userPrompt = [
    'Existing memory summary (may be empty):',
    params.existingSummary?.trim() || '(none)',
    '',
    'Conversation transcript to compress:',
    transcript,
    '',
    'Return only the updated compressed memory.',
  ].join('\n')
  const messages: OllamaApiMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: userPrompt },
  ]

  const body: Record<string, unknown> = {
    model: params.model,
    messages,
    stream: false,
  }
  const opts = compactModelOptions(params.modelOptions)
  if (opts) body.options = { ...opts, temperature: 0.2 }

  const res = await fetch(`${root}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: params.signal,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Ollama /api/chat ${res.status}: ${errText || res.statusText}`)
  }
  const data = (await res.json()) as {
    message?: { content?: string }
  }
  return data.message?.content?.trim() ?? ''
}
