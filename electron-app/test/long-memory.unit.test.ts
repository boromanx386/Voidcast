import { describe, expect, test } from 'vitest'
import {
  buildLongMemoryExtractPrompt,
  extractJsonArray,
  sanitizeCandidate,
} from '../src/lib/longMemoryExtract'
import { scoreMemoryForQuery } from '../src/lib/longMemoryStorage'

describe('long memory extraction parsing', () => {
  test('extractJsonArray parses fenced json payload', () => {
    const raw =
      '```json\n[{"kind":"project","text":"User builds an Electron app","importance":0.8,"confidence":0.9}]\n```'
    const out = extractJsonArray(raw)
    expect(Array.isArray(out)).toBe(true)
    expect(out).toHaveLength(1)
  })

  test('sanitizeCandidate filters secrets and low confidence', () => {
    const secret = sanitizeCandidate({
      kind: 'fact',
      text: 'User API key is sk-secret-123456',
      confidence: 0.9,
    })
    const lowConfidence = sanitizeCandidate({
      kind: 'fact',
      text: 'Maybe user likes dark mode',
      confidence: 0.2,
    })
    const valid = sanitizeCandidate({
      kind: 'preference',
      text: 'User prefers concise answers in Serbian.',
      confidence: 0.88,
      importance: 0.72,
      tags: ['Style', 'Language'],
    })
    expect(secret).toBeNull()
    expect(lowConfidence).toBeNull()
    expect(valid?.kind).toBe('preference')
    expect(valid?.tags).toEqual(['style', 'language'])
  })
})

describe('long memory extraction prompt', () => {
  test('existing memories and the transcript are passed in their own tags', () => {
    const { system, user } = buildLongMemoryExtractPrompt(
      [
        { role: 'user', content: 'odgovaraj na srpskom' },
        { role: 'assistant', content: 'Važi.' },
      ],
      ['User prefers concise answers.', '  '],
    )
    expect(system).toContain('ASSISTANT turns are context')
    expect(system).toContain('Return []')
    expect(user).toContain(
      '<existing_memories>\n- User prefers concise answers.\n</existing_memories>',
    )
    expect(user).toContain(
      '<transcript>\nUSER: odgovaraj na srpskom\n\nASSISTANT: Važi.\n</transcript>',
    )
  })

  test('no existing memories is stated, not left blank', () => {
    const { user } = buildLongMemoryExtractPrompt([{ role: 'user', content: 'hi there' }])
    expect(user).toContain('<existing_memories>\n(none)\n</existing_memories>')
  })

  test('a long transcript keeps its end, not its start', () => {
    const turns = [
      { role: 'user' as const, content: `OLDEST ${'x'.repeat(30000)}` },
      { role: 'user' as const, content: 'NEWEST always answer in Serbian' },
    ]
    const { user } = buildLongMemoryExtractPrompt(turns)
    expect(user).toContain('[earlier turns omitted]')
    expect(user).toContain('NEWEST always answer in Serbian')
    expect(user).not.toContain('OLDEST')
  })
})

describe('long memory ranking score', () => {
  test('score favors relevant and fresh memory', () => {
    const now = Date.now()
    const relevant = scoreMemoryForQuery(
      'electron app user preferences',
      {
        text: 'User works on an Electron desktop app.',
        tags: ['electron', 'desktop'],
        importance: 0.8,
        confidence: 0.9,
        updatedAt: now - 60_000,
        lastUsedAt: now - 30_000,
      },
      now,
    )
    const weak = scoreMemoryForQuery(
      'electron app user preferences',
      {
        text: 'User once asked about weather.',
        tags: ['weather'],
        importance: 0.3,
        confidence: 0.4,
        updatedAt: now - 1000 * 60 * 60 * 24 * 40,
        lastUsedAt: 0,
      },
      now,
    )
    expect(relevant).toBeGreaterThan(weak)
  })
})
