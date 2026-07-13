import { describe, expect, it } from 'vitest'
import {
  CODING_SEARCH_CONTEXT_LINES,
  formatSearchResults,
  mergeMatchRanges,
  rankSearchMatches,
  scoreSearchMatch,
  topFilesByMatchCount,
} from '../src/lib/codingSearch'

describe('scoreSearchMatch', () => {
  it('boosts filename matches over random paths', () => {
    const query = 'useChatAgent'
    const fileHit = scoreSearchMatch('src/hooks/useChatAgent.ts', 10, 'export function useChatAgent()', query)
    const noiseHit = scoreSearchMatch('src/lib/utils.ts', 10, 'import { useChatAgent } from "../hooks/useChatAgent"', query)
    expect(fileHit).toBeGreaterThan(noiseHit)
  })

  it('boosts recent files', () => {
    const query = 'foo'
    const base = scoreSearchMatch('src/a.ts', 5, 'const foo = 1', query)
    const boosted = scoreSearchMatch('src/a.ts', 5, 'const foo = 1', query, ['src/a.ts'])
    expect(boosted).toBeGreaterThan(base)
  })
})

describe('rankSearchMatches', () => {
  it('caps matches per file and prefers higher scores', () => {
    const matches = [
      { path: 'src/a.ts', line: 1, text: 'import foo' },
      { path: 'src/a.ts', line: 2, text: 'import bar' },
      { path: 'src/a.ts', line: 3, text: 'import baz' },
      { path: 'src/a.ts', line: 4, text: 'import qux' },
      { path: 'src/a.ts', line: 5, text: 'import zap' },
      { path: 'src/a.ts', line: 6, text: 'import zip' },
      { path: 'src/useChatAgent.ts', line: 10, text: 'export function useChatAgent()' },
    ]
    const ranked = rankSearchMatches(matches, 'useChatAgent', { maxPerFile: 2, maxBlocks: 10 })
    const perFile = ranked.reduce<Record<string, number>>((acc, m) => {
      acc[m.path] = (acc[m.path] ?? 0) + 1
      return acc
    }, {})
    expect(perFile['src/a.ts']).toBe(2)
    expect(ranked.some((m) => m.path === 'src/useChatAgent.ts')).toBe(true)
  })
})

describe('mergeMatchRanges', () => {
  it('merges overlapping ranges in the same file', () => {
    const ranked = rankSearchMatches(
      [
        { path: 'src/a.ts', line: 10, text: 'alpha' },
        { path: 'src/a.ts', line: 12, text: 'beta' },
      ],
      'alpha',
      { maxPerFile: 5, maxBlocks: 5 },
    )
    const merged = mergeMatchRanges(ranked, CODING_SEARCH_CONTEXT_LINES)
    const ranges = merged.get('src/a.ts') ?? []
    expect(ranges).toHaveLength(1)
    expect(ranges[0]?.start).toBe(8)
    expect(ranges[0]?.end).toBe(14)
    expect(ranges[0]?.matchLines.has(10)).toBe(true)
    expect(ranges[0]?.matchLines.has(12)).toBe(true)
  })
})

describe('formatSearchResults', () => {
  it('includes summary and contextual blocks', () => {
    const text = formatSearchResults({
      query: 'foo',
      totalRawMatches: 3,
      totalFiles: 2,
      truncatedCollection: false,
      fileMatchCounts: { 'src/a.ts': 2, 'src/b.ts': 1 },
      blocks: [
        {
          path: 'src/a.ts',
          startLine: 4,
          endLine: 6,
          lines: [
            { line: 4, text: 'before', isMatch: false },
            { line: 5, text: 'const foo = 1', isMatch: true },
            { line: 6, text: 'after', isMatch: false },
          ],
        },
      ],
    })
    expect(text).toContain('3 raw matches in 2 files')
    expect(text).toContain('Top files by match count')
    expect(text).toContain('>>>    5| const foo = 1')
    expect(text).toContain('Use read_file')
  })
})

describe('topFilesByMatchCount', () => {
  it('sorts by count descending', () => {
    expect(topFilesByMatchCount({ b: 1, a: 3, c: 2 })).toEqual([
      { path: 'a', matchCount: 3 },
      { path: 'c', matchCount: 2 },
      { path: 'b', matchCount: 1 },
    ])
  })
})
