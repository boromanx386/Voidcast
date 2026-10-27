import { describe, expect, it } from 'vitest'
import {
  buildLiteralSearchPatterns,
  CODING_SEARCH_CONTEXT_LINES,
  compileCodingSearchGlob,
  formatSearchResults,
  matchesCodingSearchGlob,
  mergeMatchRanges,
  rankSearchMatches,
  scoreSearchMatch,
  topFilesByMatchCount,
} from '../src/lib/codingSearch'

describe('scoreSearchMatch', () => {
  it('boosts filename matches over random paths', () => {
    const query = 'useChatAgent'
    const fileHit = scoreSearchMatch(
      'src/hooks/useChatAgent.ts',
      10,
      'export function useChatAgent()',
      query,
    )
    const noiseHit = scoreSearchMatch(
      'src/lib/utils.ts',
      10,
      'import { useChatAgent } from "../hooks/useChatAgent"',
      query,
    )
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

describe('compileCodingSearchGlob', () => {
  const matches = (glob: string, path: string) => {
    const g = compileCodingSearchGlob(glob)
    if (!g) throw new Error(`glob did not compile: ${glob}`)
    return matchesCodingSearchGlob(path, g)
  }

  it('matches a slash-free glob against the file name in any folder', () => {
    expect(matches('*.test.ts', 'electron-app/test/a.test.ts')).toBe(true)
    expect(matches('*.test.ts', 'electron-app/src/a.ts')).toBe(false)
  })

  it('anchors a glob with a slash at the project root', () => {
    expect(matches('src/**/*.tsx', 'src/components/chat/Composer.tsx')).toBe(true)
    expect(matches('src/**/*.tsx', 'src/App.tsx')).toBe(true)
    expect(matches('src/**/*.tsx', 'electron-app/src/App.tsx')).toBe(false)
    expect(matches('**/lib/*.ts', 'electron-app/src/lib/codingSearch.ts')).toBe(true)
  })

  it('supports brace alternatives, ? and case-insensitive matching', () => {
    expect(matches('*.{ts,tsx}', 'src/a.tsx')).toBe(true)
    expect(matches('*.{ts,tsx}', 'src/a.js')).toBe(false)
    expect(matches('file?.TS', 'src/file1.ts')).toBe(true)
  })

  it('inverts the result for a ! glob', () => {
    expect(matches('!*.test.ts', 'src/a.test.ts')).toBe(false)
    expect(matches('!*.test.ts', 'src/a.ts')).toBe(true)
  })

  it('treats dots literally and rejects broken globs', () => {
    expect(matches('*.ts', 'src/ats')).toBe(false)
    expect(compileCodingSearchGlob('*.{ts')).toBeNull()
    expect(compileCodingSearchGlob('!')).toBeNull()
  })
})

describe('formatSearchResults files_only', () => {
  it('lists files by match count without context blocks', () => {
    const text = formatSearchResults({
      query: 'use\w+',
      regex: true,
      glob: '*.ts',
      filesOnly: true,
      totalRawMatches: 4,
      totalFiles: 2,
      truncatedCollection: false,
      fileMatchCounts: { 'src/a.ts': 1, 'src/b.ts': 3 },
      blocks: [],
    })
    expect(text).toContain('Search "use\w+" (regex, glob *.ts): 4 raw matches in 2 files.')
    expect(text.indexOf('src/b.ts — 3')).toBeLessThan(text.indexOf('src/a.ts — 1'))
    expect(text).not.toContain('Matches:')
  })
})

describe('buildLiteralSearchPatterns', () => {
  it('expands a spaced query into snake, kebab and compact spellings', () => {
    expect(buildLiteralSearchPatterns('coding search')).toEqual([
      'coding search',
      'coding_search',
      'coding-search',
      'codingsearch',
    ])
  })

  it('splits camelCase, PascalCase and acronyms into words', () => {
    expect(buildLiteralSearchPatterns('codingSearch')).toEqual([
      'codingSearch',
      'coding_search',
      'coding-search',
    ])
    expect(buildLiteralSearchPatterns('HTMLParser')).toContain('html_parser')
    expect(buildLiteralSearchPatterns('snake_case_name')).toContain('snake-case-name')
  })

  it('does not duplicate a spelling that equals the query ignoring case', () => {
    expect(buildLiteralSearchPatterns('coding_search')).toEqual([
      'coding_search',
      'coding-search',
      'codingsearch',
    ])
  })

  it('leaves single words, punctuation and long phrases exactly as typed', () => {
    expect(buildLiteralSearchPatterns('search')).toEqual(['search'])
    expect(buildLiteralSearchPatterns('foo.bar baz')).toEqual(['foo.bar baz'])
    expect(buildLiteralSearchPatterns('error: file not found')).toEqual(['error: file not found'])
    expect(buildLiteralSearchPatterns('one two three four five')).toEqual([
      'one two three four five',
    ])
    expect(buildLiteralSearchPatterns('-m')).toEqual(['-m'])
  })

  it('returns nothing for an empty query', () => {
    expect(buildLiteralSearchPatterns('   ')).toEqual([])
  })
})
