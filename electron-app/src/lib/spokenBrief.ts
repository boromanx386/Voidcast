/**
 * Spoken brief: a short, listenable version of an assistant reply for TTS.
 *
 * Same shape as `promptHint` — one tool-free `callSubAgentChat` on the coding sub-agent
 * model, so there is no extra model picker. Reading a long reply aloud (lists, paths, code)
 * is tiring even after `sanitizeForTts`; a rewrite for the ear is a different text, not a
 * truncated one.
 */

import { sanitizeForTts } from '@/lib/chatHints'
import { subAgentConfigForRole, type AppSettings, type SubAgentConfig } from '@/lib/settings'
import { callSubAgentChat, type SubAgentKeys } from '@/lib/subAgent'

/** Below this many spoken chars the reply is already short; read it as is. */
export const BRIEF_MIN_CHARS = 400
/** Cloud providers do not trim for us; a reply longer than this is cut from the end. */
const BRIEF_INPUT_MAX_CHARS = 16000
/**
 * ~60 words need ~100 tokens, but reasoning counts against max_tokens and some gateways
 * (OpenCode Go) cannot switch thinking off; 512 left DeepSeek with empty content at times.
 */
const BRIEF_MAX_OUTPUT_TOKENS = 4096

const BRIEF_RULES = [
  'You turn an assistant reply into a short version meant to be read aloud by text-to-speech.',
  'At most 60 words, plain sentences, the way a person would say it.',
  'Keep the main point, the outcome and any warning or question for the user.',
  'Never add facts that are not in the reply.',
  'No code, no file paths, no URLs, no markdown, no lists; describe them in words instead.',
]
const BRIEF_ANSWER_RULE = 'Answer with the spoken text alone. No preamble, no quotes.'

export const BRIEF_SYSTEM_PROMPT = [
  ...BRIEF_RULES,
  'Write in the same language as the reply.',
  BRIEF_ANSWER_RULE,
].join(' ')

/** For TTS voices that cannot speak the chat's language: translate while shortening. */
export const BRIEF_ENGLISH_SYSTEM_PROMPT = [
  ...BRIEF_RULES,
  'Always write in English, translating if the reply is in another language.',
  BRIEF_ANSWER_RULE,
].join(' ')

/** True when the reply is long enough that a brief is worth a model call. */
export function needsSpokenBrief(content: string): boolean {
  return sanitizeForTts(content).length >= BRIEF_MIN_CHARS
}

/** Strip what models wrap around an answer anyway, then the usual TTS cleanup. */
export function sanitizeSpokenBrief(raw: string): string | null {
  let text = (raw || '').trim()
  if (!text) return null
  const fenced = text.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/)
  if (fenced) text = fenced[1].trim()
  text = text.replace(/^["“„](.*)["”“]$/s, '$1').trim()
  const spoken = sanitizeForTts(text)
  return spoken || null
}

/**
 * Returns the brief, or null when no coding model is configured or the model returned
 * nothing usable. Callers fall back to reading the full reply on null.
 */
export async function generateSpokenBrief(opts: {
  content: string
  config: SubAgentConfig
  keys: SubAgentKeys
  signal?: AbortSignal
  /** Write the brief in English whatever the reply's language. */
  english?: boolean
}): Promise<string | null> {
  if (!opts.config.model?.trim()) return null
  const reply = (opts.content || '').trim()
  if (!reply) return null

  const raw = await callSubAgentChat({
    messages: [
      {
        role: 'system',
        content: opts.english ? BRIEF_ENGLISH_SYSTEM_PROMPT : BRIEF_SYSTEM_PROMPT,
      },
      { role: 'user', content: `Reply to shorten:\n${reply.slice(0, BRIEF_INPUT_MAX_CHARS)}` },
    ],
    config: opts.config,
    keys: opts.keys,
    signal: opts.signal,
    maxTokens: BRIEF_MAX_OUTPUT_TOKENS,
  })
  return sanitizeSpokenBrief(raw)
}

/** BRIEF is offered only when the coding sub-agent role resolves to a model. */
export function spokenBriefAvailable(settings: Pick<AppSettings, 'subAgent'>): boolean {
  return (subAgentConfigForRole(settings.subAgent, 'coding').model || '').trim().length > 0
}
