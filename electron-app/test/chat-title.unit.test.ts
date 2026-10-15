import { describe, expect, test } from 'vitest'
import { deriveSessionTitle } from '../src/lib/chatHints'
import {
  buildTitleSeedText,
  isAutoSessionTitle,
  sanitizeGeneratedTitle,
} from '../src/lib/chatTitle'

describe('sanitizeGeneratedTitle', () => {
  test('strips surrounding quotes', () => {
    expect(sanitizeGeneratedTitle('"Fix OAuth redirect"')).toBe('Fix OAuth redirect')
  })

  test('strips a Title: prefix and the trailing period', () => {
    expect(sanitizeGeneratedTitle('Title: Sub-agent title generation.')).toBe(
      'Sub-agent title generation',
    )
  })

  test('keeps the first non-empty line of a fenced reply', () => {
    expect(sanitizeGeneratedTitle('```text\nRefactor sidebar\n```')).toBe('Refactor sidebar')
    expect(sanitizeGeneratedTitle('Debugging the worker pool\nExtra explanation here')).toBe(
      'Debugging the worker pool',
    )
  })

  test('keeps non-ASCII titles intact', () => {
    expect(sanitizeGeneratedTitle('„Popravka baga u sidebaru"')).toBe('Popravka baga u sidebaru')
  })

  test('caps words at 12', () => {
    const long = Array.from({ length: 15 }, (_, i) => `w${i}`).join(' ')
    expect(sanitizeGeneratedTitle(long)).toBe(
      Array.from({ length: 12 }, (_, i) => `w${i}`).join(' '),
    )
  })

  test('caps characters at 60', () => {
    const title = sanitizeGeneratedTitle('a'.repeat(80))
    expect(title).toBe('a'.repeat(60))
  })

  test('returns null for empty or punctuation-only output', () => {
    expect(sanitizeGeneratedTitle('')).toBeNull()
    expect(sanitizeGeneratedTitle('   \n  ')).toBeNull()
    expect(sanitizeGeneratedTitle('""')).toBeNull()
  })
})

describe('buildTitleSeedText', () => {
  test('returns null when there is no user turn', () => {
    expect(buildTitleSeedText([])).toBeNull()
    expect(buildTitleSeedText([{ id: '1', role: 'assistant', content: 'hi' }])).toBeNull()
  })

  test('returns the user turn alone before the first reply lands', () => {
    expect(buildTitleSeedText([{ id: '1', role: 'user', content: 'Fix the login bug' }])).toBe(
      'User: Fix the login bug',
    )
  })

  test('appends the head of the first assistant reply', () => {
    const seed = buildTitleSeedText([
      { id: '1', role: 'user', content: 'Fix the login bug' },
      { id: '2', role: 'assistant', content: 'Looking at the auth hook now.' },
    ])
    expect(seed).toContain('User: Fix the login bug')
    expect(seed).toContain('Assistant: Looking at the auth hook now.')
  })

  test('drops code blocks and urls from the seed', () => {
    const seed = buildTitleSeedText([
      { id: '1', role: 'user', content: 'See ```const a = 1``` and https://example.com/docs' },
      { id: '2', role: 'assistant', content: 'Got it.' },
    ])
    expect(seed).not.toContain('const a = 1')
    expect(seed).not.toContain('https://example.com/docs')
    expect(seed).toContain('See')
  })

  test('falls back to an attachment placeholder for an empty first message', () => {
    expect(buildTitleSeedText([{ id: '1', role: 'user', content: '', images: ['abc'] }])).toBe(
      'User: [user attached an image]',
    )
  })
})

describe('isAutoSessionTitle', () => {
  const messages = [{ id: '1', role: 'user', content: 'Fix the login bug' }]

  test('true while the title is the derived placeholder', () => {
    expect(isAutoSessionTitle(deriveSessionTitle(messages), messages)).toBe(true)
    expect(isAutoSessionTitle('', messages)).toBe(true)
    expect(isAutoSessionTitle('UNTITLED_SESSION', messages)).toBe(true)
  })

  test('true for the shell placeholders written before the derived title', () => {
    // autoSaveChat off: the row is claimed as a placeholder and stays `unsaved` until Save.
    expect(isAutoSessionTitle('New chat', messages)).toBe(true)
    expect(isAutoSessionTitle('Unsaved', messages)).toBe(true)
  })

  test('false after a rename', () => {
    expect(isAutoSessionTitle('Login bug hunt', messages)).toBe(false)
  })
})
