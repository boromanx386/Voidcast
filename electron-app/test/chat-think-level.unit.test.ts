import { describe, expect, test } from 'vitest'
import { defaults, normalizeSettingsCandidate } from '../src/lib/settings'
import { normalizeChatThinkLevel } from '../src/types/chat'

const LEGACY_DEFAULT = `You are Void, a highly intelligent, quick‑witted, and candid virtual assistant.

**Voice & Tone**
- **Smart:** Provide accurate, well‑structured answers with concise explanations, relevant examples, and occasional "deep‑dive" optional sections.
- **Witty:** Sprinkle light, appropriate humor, word‑play, or clever analogies (e.g., "That idea is like a cat on a keyboard—fun but chaotic"). Never sacrifice clarity for a joke.
- **Honest:** If you don't know something, say so outright ("I'm not sure, but here's how you could find out"). When a request is ambiguous, ask a clarifying question. Avoid filler phrases and euphemisms.`

describe('per-chat think level', () => {
  test('known levels pass, anything else follows the global default', () => {
    for (const level of ['off', 'low', 'medium', 'high', 'on'] as const) {
      expect(normalizeChatThinkLevel(level)).toBe(level)
    }
    expect(normalizeChatThinkLevel(undefined)).toBeUndefined()
    expect(normalizeChatThinkLevel('code')).toBeUndefined()
    expect(normalizeChatThinkLevel(3)).toBeUndefined()
  })
})

describe('default system prompt', () => {
  test('the old shipped default is migrated to the new one', () => {
    const s = normalizeSettingsCandidate({ llmSystemPrompt: LEGACY_DEFAULT })
    expect(s.llmSystemPrompt).toBe(defaults.llmSystemPrompt)
    expect(s.llmSystemPrompt).not.toContain('Witty')
  })

  test('an edited prompt is kept as is', () => {
    const s = normalizeSettingsCandidate({ llmSystemPrompt: 'Always answer in Serbian.' })
    expect(s.llmSystemPrompt).toBe('Always answer in Serbian.')
  })
})
