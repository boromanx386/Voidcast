import { describe, expect, it } from 'vitest'
import {
  formatPlanHandoffUserBlock,
  formatSoftDeniedReadResult,
  normalizeCodingReadPath,
  shouldSoftDenyFullRead,
} from '../src/lib/codingReadGuard'

describe('normalizeCodingReadPath', () => {
  it('trims and unifies slashes', () => {
    expect(normalizeCodingReadPath('  src\\lib\\foo.ts  ')).toBe('src/lib/foo.ts')
  })
})

describe('shouldSoftDenyFullRead', () => {
  const cachedPaths = ['src/hooks/useChat.ts', 'src/lib/foo.ts']

  it('denies a full re-read of a path already read this turn', () => {
    expect(
      shouldSoftDenyFullRead({
        path: 'src/hooks/useChat.ts',
        cachedPaths,
      }),
    ).toBe(true)
  })

  it('matches windows-style path to cached path', () => {
    expect(
      shouldSoftDenyFullRead({
        path: 'src\\lib\\foo.ts',
        cachedPaths,
      }),
    ).toBe(true)
  })

  it('allows a full read of a file from an earlier turn (not in the turn cache)', () => {
    expect(
      shouldSoftDenyFullRead({
        path: 'src/lib/earlier.ts',
        cachedPaths,
      }),
    ).toBe(false)
  })

  it('allows range reads even when read this turn', () => {
    expect(
      shouldSoftDenyFullRead({
        path: 'src/lib/foo.ts',
        startLine: 10,
        endLine: 40,
        cachedPaths,
      }),
    ).toBe(false)
  })

  it('allows force:true', () => {
    expect(
      shouldSoftDenyFullRead({
        path: 'src/lib/foo.ts',
        force: true,
        cachedPaths,
      }),
    ).toBe(false)
  })
})

describe('formatSoftDeniedReadResult', () => {
  it('includes path, digest, and force/range guidance', () => {
    const text = formatSoftDeniedReadResult('src/a.ts', 'function main')
    expect(text).toContain('[Already read this turn: src/a.ts]')
    expect(text).toContain('Digest: function main')
    expect(text).toContain('force:true')
    expect(text).toContain('start_line/end_line')
  })
})

describe('formatPlanHandoffUserBlock', () => {
  it('returns empty for blank context', () => {
    expect(formatPlanHandoffUserBlock('  ')).toBe('')
  })

  it('wraps handoff context with stable header', () => {
    const block = formatPlanHandoffUserBlock('File digests:\n- a.ts: hi')
    expect(block).toContain('---')
    expect(block).toContain('[Plan handoff — prior agent exploration for this same request]')
    expect(block).toContain('File digests:')
    expect(block).toContain('a.ts: hi')
  })
})
