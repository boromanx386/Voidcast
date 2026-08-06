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
  const digests = [{ path: 'src/lib/foo.ts', digest: 'exports bar' }]
  const cachedPaths = ['src/hooks/useChat.ts']

  it('denies full re-read when path is in digests', () => {
    expect(
      shouldSoftDenyFullRead({
        path: 'src/lib/foo.ts',
        digests,
      }),
    ).toBe(true)
  })

  it('denies when path is only in cache', () => {
    expect(
      shouldSoftDenyFullRead({
        path: 'src/hooks/useChat.ts',
        cachedPaths,
      }),
    ).toBe(true)
  })

  it('matches windows-style path to digest', () => {
    expect(
      shouldSoftDenyFullRead({
        path: 'src\\lib\\foo.ts',
        digests,
      }),
    ).toBe(true)
  })

  it('allows range reads even when digested', () => {
    expect(
      shouldSoftDenyFullRead({
        path: 'src/lib/foo.ts',
        startLine: 10,
        endLine: 40,
        digests,
      }),
    ).toBe(false)
  })

  it('allows force:true', () => {
    expect(
      shouldSoftDenyFullRead({
        path: 'src/lib/foo.ts',
        force: true,
        digests,
      }),
    ).toBe(false)
  })

  it('allows unknown path', () => {
    expect(
      shouldSoftDenyFullRead({
        path: 'src/new.ts',
        digests,
        cachedPaths,
      }),
    ).toBe(false)
  })
})

describe('formatSoftDeniedReadResult', () => {
  it('includes path, digest, and force/range guidance', () => {
    const text = formatSoftDeniedReadResult('src/a.ts', 'function main')
    expect(text).toContain('[Already in context: src/a.ts]')
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
