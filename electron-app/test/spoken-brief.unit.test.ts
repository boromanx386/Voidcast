import { describe, expect, test } from 'vitest'
import {
  BRIEF_ENGLISH_SYSTEM_PROMPT,
  BRIEF_MIN_CHARS,
  BRIEF_SYSTEM_PROMPT,
  generateSpokenBrief,
  needsSpokenBrief,
  sanitizeSpokenBrief,
  spokenBriefAvailable,
} from '../src/lib/spokenBrief'
import type { SubAgentConfig } from '../src/lib/settings'

describe('needsSpokenBrief', () => {
  test('short replies are read as is', () => {
    expect(needsSpokenBrief('Done, the file is saved.')).toBe(false)
  })

  test('long replies get a brief', () => {
    expect(needsSpokenBrief('word '.repeat(BRIEF_MIN_CHARS))).toBe(true)
  })
})

describe('sanitizeSpokenBrief', () => {
  test('strips a markdown fence and surrounding quotes', () => {
    expect(sanitizeSpokenBrief('```\n"I fixed the bug."\n```')).toBe('I fixed the bug.')
  })

  test('null for an empty answer', () => {
    expect(sanitizeSpokenBrief('   ')).toBeNull()
  })
})

describe('spokenBriefAvailable', () => {
  const base = { enabled: false, codingEnabled: false, model: '' } as SubAgentConfig

  test('false without any model', () => {
    expect(spokenBriefAvailable({ subAgent: base })).toBe(false)
  })

  test('true when the coding role has a model', () => {
    expect(spokenBriefAvailable({ subAgent: { ...base, codingModel: 'some-model' } })).toBe(true)
  })
})

describe('generateSpokenBrief gates', () => {
  test('null without a configured model (no request made)', async () => {
    const out = await generateSpokenBrief({
      content: 'long reply',
      config: { enabled: false, codingEnabled: false, model: '' } as SubAgentConfig,
      keys: { opencodeSessionId: 'rt-1' },
    })
    expect(out).toBeNull()
  })
})

describe('brief prompts', () => {
  test('default keeps the reply language, English mode forces English', () => {
    expect(BRIEF_SYSTEM_PROMPT).toContain('same language as the reply')
    expect(BRIEF_ENGLISH_SYSTEM_PROMPT).toContain('Always write in English')
    expect(BRIEF_ENGLISH_SYSTEM_PROMPT).not.toContain('same language')
  })
})
