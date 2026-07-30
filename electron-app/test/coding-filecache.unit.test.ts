import { describe, expect, it } from 'vitest'
import {
  buildWorkingSetHint,
  emptyCodingFileCache,
  invalidateCodingFileCache,
  updateCodingFileCacheAfterEdit,
  upsertCodingFileCache,
  CODING_FILE_CACHE_MAX_FILES,
  CODING_FILE_CACHE_MAX_PER_FILE_CHARS,
  CODING_FILE_CACHE_MAX_TOTAL_CHARS,
} from '../src/lib/codingContextMemo'

describe('emptyCodingFileCache', () => {
  it('returns an empty cache', () => {
    const c = emptyCodingFileCache()
    expect(c.entries).toEqual([])
  })
})

describe('upsertCodingFileCache', () => {
  it('adds a new entry at the front', () => {
    const c = emptyCodingFileCache()
    const next = upsertCodingFileCache(c, '/a.ts', 'hello')
    expect(next.entries).toHaveLength(1)
    expect(next.entries[0].path).toBe('/a.ts')
    expect(next.entries[0].content).toBe('hello')
  })

  it('promotes an existing entry to the front', () => {
    let c = emptyCodingFileCache()
    c = upsertCodingFileCache(c, '/a.ts', 'A')
    c = upsertCodingFileCache(c, '/b.ts', 'B')
    c = upsertCodingFileCache(c, '/a.ts', 'A-new')
    expect(c.entries).toHaveLength(2)
    expect(c.entries[0].path).toBe('/a.ts')
    expect(c.entries[0].content).toBe('A-new')
    expect(c.entries[1].path).toBe('/b.ts')
  })

  it('caps per-file content at CODING_FILE_CACHE_MAX_PER_FILE_CHARS', () => {
    const long = 'x'.repeat(CODING_FILE_CACHE_MAX_PER_FILE_CHARS + 500)
    const next = upsertCodingFileCache(emptyCodingFileCache(), '/big.ts', long)
    expect(next.entries[0].content.length).toBeLessThanOrEqual(CODING_FILE_CACHE_MAX_PER_FILE_CHARS)
  })

  it('evicts oldest when exceeding CODING_FILE_CACHE_MAX_FILES', () => {
    let c = emptyCodingFileCache()
    for (let i = 0; i < CODING_FILE_CACHE_MAX_FILES + 3; i++) {
      c = upsertCodingFileCache(c, `/f${i}.ts`, `content${i}`)
    }
    expect(c.entries.length).toBeLessThanOrEqual(CODING_FILE_CACHE_MAX_FILES)
    // Most recent (highest i) should be at front.
    expect(c.entries[0].path).toMatch(/f\d+\.ts$/)
  })

  it('evicts by total char budget (oldest first)', () => {
    const big = 'x'.repeat(CODING_FILE_CACHE_MAX_PER_FILE_CHARS) // exactly max per file
    let c = emptyCodingFileCache()
    // 5 files at max each = 15000 chars — exactly budget. One more forces eviction.
    for (let i = 0; i < 5; i++) {
      c = upsertCodingFileCache(c, `/f${i}.ts`, big)
    }
    c = upsertCodingFileCache(c, '/overflow.ts', big)
    // overflow + 4 of the originals = budget exhausted, oldest dropped.
    expect(c.entries.length).toBeLessThanOrEqual(5)
    expect(c.entries[0].path).toBe('/overflow.ts')
  })

  it('ignores empty path or content', () => {
    const c = emptyCodingFileCache()
    expect(upsertCodingFileCache(c, '', 'x').entries).toHaveLength(0)
    expect(upsertCodingFileCache(c, '/x.ts', '').entries).toHaveLength(0)
  })
})

describe('invalidateCodingFileCache', () => {
  it('removes a path from cache', () => {
    const c = emptyCodingFileCache()
    c.entries.push({ path: '/a.ts', content: 'A' })
    c.entries.push({ path: '/b.ts', content: 'B' })
    const next = invalidateCodingFileCache(c, '/a.ts')
    expect(next.entries.map((e) => e.path)).toEqual(['/b.ts'])
  })

  it('no-ops on unknown path', () => {
    const c = emptyCodingFileCache()
    c.entries.push({ path: '/a.ts', content: 'A' })
    const next = invalidateCodingFileCache(c, '/nonexistent.ts')
    expect(next.entries.map((e) => e.path)).toEqual(['/a.ts'])
  })
})

describe('updateCodingFileCacheAfterEdit', () => {
  it('patches cached content after a successful in-memory edit', () => {
    let c = upsertCodingFileCache(
      emptyCodingFileCache(),
      'src/a.ts',
      'const x = 1\nconst y = 2\n',
    )
    c = updateCodingFileCacheAfterEdit(c, 'src/a.ts', 'const x = 1', 'const x = 99')
    expect(c.entries[0]?.content).toContain('const x = 99')
    expect(c.entries[0]?.content).toContain('const y = 2')
  })

  it('retries without line anchors when cache is a range slice', () => {
    let c = upsertCodingFileCache(
      emptyCodingFileCache(),
      'src/a.ts',
      'function foo() {\n  return 1\n}\n',
    )
    c = updateCodingFileCacheAfterEdit(c, 'src/a.ts', 'return 1', 'return 2', {
      startLine: 100,
      endLine: 110,
    })
    expect(c.entries[0]?.content).toContain('return 2')
  })

  it('invalidates when snippet is not in the cached text', () => {
    let c = upsertCodingFileCache(emptyCodingFileCache(), 'src/a.ts', 'hello only')
    c = updateCodingFileCacheAfterEdit(c, 'src/a.ts', 'missing snippet', 'x')
    expect(c.entries.find((e) => e.path === 'src/a.ts')).toBeUndefined()
  })

  it('no-ops when path was never cached', () => {
    const c = emptyCodingFileCache()
    const next = updateCodingFileCacheAfterEdit(c, 'src/a.ts', 'a', 'b')
    expect(next.entries).toHaveLength(0)
  })
})

describe('buildWorkingSetHint', () => {
  it('returns empty string for empty cache', () => {
    expect(buildWorkingSetHint(emptyCodingFileCache(), [])).toBe('')
  })

  it('returns a hint with file contents', () => {
    const c = emptyCodingFileCache()
    c.entries.push({ path: '/a.ts', content: 'export const a = 1' })
    const hint = buildWorkingSetHint(c, [])
    expect(hint).toContain('[Working memory')
    expect(hint).toContain('/a.ts')
    expect(hint).toContain('export const a = 1')
  })

  it('skips entries whose path is already uncleared', () => {
    const c = emptyCodingFileCache()
    c.entries.push({ path: '/a.ts', content: 'AA' })
    c.entries.push({ path: '/b.ts', content: 'BB' })
    const hint = buildWorkingSetHint(c, ['/a.ts'])
    expect(hint).not.toContain('AA')
    expect(hint).toContain('BB')
  })

  it('returns empty string when all entries are uncleared', () => {
    const c = emptyCodingFileCache()
    c.entries.push({ path: '/x.ts', content: 'X' })
    expect(buildWorkingSetHint(c, ['/x.ts'])).toBe('')
  })

  it('marks truncated entries', () => {
    const c = emptyCodingFileCache()
    const long = 'y'.repeat(CODING_FILE_CACHE_MAX_PER_FILE_CHARS)
    c.entries.push({ path: '/big.ts', content: long })
    const hint = buildWorkingSetHint(c, [])
    expect(hint).toContain('first')
    expect(hint).toContain('cached')
  })
})
