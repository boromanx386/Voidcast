/**
 * Prompt hints: the user asks, the coding sub-agent rewrites their draft — or, when the
 * composer field is empty but a conversation exists, proposes the next prompt to send.
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

export const HINT_SUGGEST_SYSTEM_PROMPT = [
  'You propose the next prompt for a user in an ongoing chat with a coding agent.',
  'Read the conversation and write the single most useful next request they should send.',
  'Ground it in what the conversation already established; never invent requirements it did not state.',
  'Write it in the same language as the conversation.',
  'Answer with the prompt alone. No preamble, no quotes, no markdown fence, no explanation.',
].join(' ')

function attachmentLabel(m: UiMessage): string {
  const count = (m.images?.length ?? 0) + (m.fileAttachments?.length ?? 0)
  if (count === 0) return ''
  return `[${count} attachment${count === 1 ? '' : 's'}]`
}

function hasTranscriptText(messages: UiMessage[]): boolean {
  return messages.some((m) => (m.content || '').trim().length > 0 || attachmentLabel(m).length > 0)
}

export type HintMode = 'rewrite' | 'suggest'

/**
 * What the hint button can offer right now: a draft gets rewritten, an empty field with a
 * conversation behind it gets a proposal for the next prompt, and with neither there is
 * nothing to ask for. Exported so the composer's disabled state and the engine cannot drift
 * apart — the UI must not promise a mode the call would refuse.
 */
export function resolveHintMode(draft: string, messages: UiMessage[]): HintMode | null {
  if (draft.trim()) return 'rewrite'
  return hasTranscriptText(messages) ? 'suggest' : null
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

export function buildHintUserMessage(
  transcript: string,
  draft: string,
  mode: HintMode = 'rewrite',
): string {
  const context = transcript.trim()
  if (mode === 'suggest') {
    return context
      ? `Conversation so far:\n${context}\n\nWrite the next prompt the user should send.`
      : ''
  }
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
 * One tool-free sub-agent call. Returns the rewritten prompt or the proposed next prompt, or
 * null when there is nothing to do (no draft and no conversation, no model configured) or the
 * model changed nothing. The mode is resolved here, not by the caller, so an empty draft is
 * only ever a no-op when there is also no conversation to read.
 */
export async function generatePromptHint(opts: {
  messages: UiMessage[]
  draft: string
  config: SubAgentConfig
  keys: SubAgentKeys
  signal?: AbortSignal
}): Promise<string | null> {
  const draft = (opts.draft || '').trim()
  const mode = resolveHintMode(draft, opts.messages)
  if (!mode) return null
  if (!opts.config.model?.trim()) return null

  const userContent = buildHintUserMessage(buildHintTranscript(opts.messages), draft, mode)
  if (!userContent.trim()) return null

  const raw = await callSubAgentChat({
    messages: [
      {
        role: 'system',
        content: mode === 'suggest' ? HINT_SUGGEST_SYSTEM_PROMPT : HINT_SYSTEM_PROMPT,
      },
      { role: 'user', content: userContent },
    ],
    config: opts.config,
    keys: opts.keys,
    signal: opts.signal,
    maxTokens: HINT_MAX_OUTPUT_TOKENS,
  })
  return sanitizePromptHint(raw, draft)
}
