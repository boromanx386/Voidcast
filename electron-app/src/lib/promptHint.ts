/**
 * Prompt hints: the user asks, the coding sub-agent rewrites their draft.
 *
 * Same shape as `chatTitle` — one tool-free `callSubAgentChat`, so the model is whatever
 * Options has set for the sub-agent coding role, and the temperature is already low inside
 * the provider helper. The difference is the input: a title gets one exchange, a hint gets
 * the whole text conversation, because "make this draft sharper" only means something in
 * context.
 */

import type { SubAgentConfig } from '@/lib/settings'
import { callSubAgentChat, type SubAgentKeys } from '@/lib/subAgent'
import type { UiMessage } from '@/types/chat'

/** Char budget for the transcript. Cloud providers do not trim for us, so we must. */
export const HINT_CONTEXT_MAX_CHARS = 12000
/** A rewritten prompt may legitimately be long; the cap only stops runaways. */
const HINT_MAX_OUTPUT_TOKENS = 2048

export const HINT_SYSTEM_PROMPT = [
  'You rewrite the prompt a user is about to send to a coding agent.',
  'Keep their intent exactly; never invent requirements they did not state.',
  'Make it specific and actionable: name files, behaviour and constraints only when the conversation already mentions them.',
  'Write in the same language as their draft.',
  'Answer with the rewritten prompt alone. No preamble, no quotes, no markdown fence, no explanation.',
].join(' ')

function attachmentLabel(m: UiMessage): string {
  const count = (m.images?.length ?? 0) + (m.fileAttachments?.length ?? 0)
  if (count === 0) return ''
  return `[${count} attachment${count === 1 ? '' : 's'}]`
}

/**
 * Text-only transcript: every user message and every agent reply between them, in order.
 * Tool output is deliberately absent — tool results live in `subAgentActivity` /
 * `codingTurnEvidence` / `agentProgress`, never in `content`, so filtering on role alone
 * keeps the noisy payloads out. Whole turns are dropped from the front once the budget is
 * exceeded: the tail is what the next prompt is about.
 */
export function buildHintTranscript(
  messages: UiMessage[],
  maxChars: number = HINT_CONTEXT_MAX_CHARS,
): string {
  const turns: string[] = []
  for (const m of messages) {
    const content = (m.content || '').trim()
    const text = content || attachmentLabel(m)
    if (!text) continue
    turns.push(`${m.role === 'user' ? 'User' : 'Assistant'}: ${text}`)
  }

  const kept: string[] = []
  let used = 0
  for (let i = turns.length - 1; i >= 0; i--) {
    const cost = turns[i].length + 2
    // Always keep the last turn, even if it alone blows the budget.
    if (kept.length > 0 && used + cost > maxChars) break
    kept.unshift(turns[i])
    used += cost
  }
  return kept.join('\n\n')
}

export function buildHintUserMessage(transcript: string, draft: string): string {
  const context = transcript.trim()
  const draftBlock = `Draft to rewrite:\n${draft.trim()}`
  return context ? `Conversation so far:\n${context}\n\n${draftBlock}` : draftBlock
}

/**
 * Strip what models wrap around an answer anyway. Returns null when there is nothing
 * usable left, and also when the model handed the draft straight back — the caller must
 * not tell the user "done" when nothing changed.
 */
export function sanitizePromptHint(raw: string, draft: string): string | null {
  let text = (raw || '').trim()
  if (!text) return null

  const fenced = text.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/)
  if (fenced) text = fenced[1].trim()

  text = text
    .replace(
      /^\s*(?:improved|rewritten|new|updated|unapredjeni|unapređeni|novi)\s+prompt\s*[:\-–—]\s*/i,
      '',
    )
    .trim()

  if (!text) return null
  if (text === draft.trim()) return null
  return text
}

/**
 * One tool-free sub-agent call. Returns the rewritten prompt, or null when there is
 * nothing to do (no draft, no model configured) or the model changed nothing.
 */
export async function generatePromptHint(opts: {
  messages: UiMessage[]
  draft: string
  config: SubAgentConfig
  keys: SubAgentKeys
  signal?: AbortSignal
}): Promise<string | null> {
  const draft = (opts.draft || '').trim()
  if (!draft) return null
  if (!opts.config.model?.trim()) return null

  const raw = await callSubAgentChat({
    messages: [
      { role: 'system', content: HINT_SYSTEM_PROMPT },
      { role: 'user', content: buildHintUserMessage(buildHintTranscript(opts.messages), draft) },
    ],
    config: opts.config,
    keys: opts.keys,
    signal: opts.signal,
    maxTokens: HINT_MAX_OUTPUT_TOKENS,
  })
  return sanitizePromptHint(raw, draft)
}
