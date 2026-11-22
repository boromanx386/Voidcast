import { describe, expect, test } from 'vitest'
import {
  buildLongMemoryExtractPrompt,
  extractJsonArray,
  sanitizeCandidate,
} from '../src/lib/longMemoryExtract'
import {
  formatLongMemoryContext,
  mergeMemoryCandidates,
  rankMemoriesForQuery,
  scoreMemoryForQuery,
} from '../src/lib/longMemoryStorage'
import type { LongMemoryItem } from '../src/types/longMemory'

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
      text: 'User API key is sk-proj-a8F3kd92LmQx7Zp1Vb',
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

  test.each([
    'User API key is sk-proj-a8F3kd92LmQx7Zp1Vb',
    'User GitHub token ghp_a8F3kd92LmQx7Zp1VbN4',
    'User AWS key AKIAIOSFODNN7EXAMPLE',
    'User sends Authorization: Bearer abc123def456ghi789jkl',
    'User database password: hunter22',
    'User api_key=a8f3kd92lmqx',
    'User session id a8F3kd92LmQx7Zp1VbN4cE6tR0yU2wS5',
    'User key starts with -----BEGIN RSA PRIVATE KEY-----',
  ])('drops a secret-shaped value: %s', (text) => {
    expect(sanitizeCandidate({ kind: 'fact', text, confidence: 0.9 })).toBeNull()
  })

  test.each([
    'User is building a tokenizer for Voidcast.',
    'User wants token-efficient answers.',
    'User uses Bitwarden as a password manager.',
    'User keeps the API key in the OS keychain, never in config files.',
    'User works on the task-list in the sidebar.',
    'User plays Secret Santa with the team every December.',
    'User sets the token limit to 4096.',
    'User ships voidcast-tools-server-linux-x64 in the AppImage.',
  ])('keeps an ordinary memory that mentions a credential word: %s', (text) => {
    expect(sanitizeCandidate({ kind: 'fact', text, confidence: 0.9 })).not.toBeNull()
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

function mem(over: Partial<LongMemoryItem>): LongMemoryItem {
  return {
    id: over.id ?? over.text ?? 'id',
    kind: 'fact',
    text: 'x',
    tags: [],
    importance: 0.5,
    confidence: 0.8,
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: 0,
    sourceSessionId: 's',
    ...over,
  }
}

describe('long memory retrieval', () => {
  test('Serbian words with diacritics match whole', () => {
    const rows = [mem({ text: 'Korisnik pravi aplikaciju za čitanje vesti.' })]
    expect(
      rankMemoriesForQuery(rows, 'koja je ona za čitanje', { limit: 8, minConfidence: 0.3 }),
    ).toHaveLength(1)
  })

  test('an unrelated fact is not retrieved just for being important', () => {
    const rows = [mem({ text: 'User owns a red bicycle.', importance: 1, confidence: 1 })]
    expect(
      rankMemoriesForQuery(rows, 'fix the electron build', { limit: 8, minConfidence: 0.3 }),
    ).toHaveLength(0)
  })

  test('preferences apply to every query', () => {
    const rows = [mem({ kind: 'preference', text: 'User prefers answers in Serbian.' })]
    expect(
      rankMemoriesForQuery(rows, 'fix the electron build', { limit: 8, minConfidence: 0.3 }),
    ).toHaveLength(1)
  })

  test('the prompt block drops whole items instead of cutting one', () => {
    const rows = [mem({ text: 'a'.repeat(50) }), mem({ id: '2', text: 'b'.repeat(50) })]
    const out = formatLongMemoryContext(rows, 80)
    expect(out).toBe(`- 1. [fact] ${'a'.repeat(50)}`)
  })
})

describe('long memory merge', () => {
  test('saving an existing text refreshes it instead of adding a copy', () => {
    const existing = [mem({ id: 'old', text: 'User prefers  dark mode.', importance: 0.4 })]
    const out = mergeMemoryCandidates(
      existing,
      [{ kind: 'preference', text: 'user prefers dark mode.', importance: 0.9, tags: ['UI'] }],
      'agent-tool',
      100,
    )
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('old')
    expect(out[0].importance).toBe(0.9)
    expect(out[0].tags).toEqual(['ui'])
    expect(out[0].updatedAt).toBe(100)
  })

  test('two copies in one batch become one row', () => {
    const out = mergeMemoryCandidates(
      [],
      [
        { kind: 'fact', text: 'User lives in Novi Sad.' },
        { kind: 'fact', text: 'user lives in novi sad.' },
      ],
      's',
    )
    expect(out).toHaveLength(1)
  })
})
