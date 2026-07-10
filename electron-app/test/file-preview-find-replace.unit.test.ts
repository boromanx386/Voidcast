import { describe, expect, it } from 'vitest'
import {
  countMatches,
  findAllMatchRanges,
  findNextFromSelection,
  findNextMatch,
  findPrevMatch,
  replaceAllInText,
  selectionMatchesFind,
} from '@/lib/filePreviewFindReplace'

describe('filePreviewFindReplace', () => {
  const text = 'foo bar Foo BAR'

  it('finds next match with wrap', () => {
    expect(findNextMatch(text, 'foo', 0, false)).toEqual({ start: 0, end: 3 })
    expect(findNextMatch(text, 'foo', 1, false)).toEqual({ start: 8, end: 11 })
    expect(findNextMatch(text, 'foo', 9, false)).toEqual({ start: 0, end: 3 })
  })

  it('finds previous match with wrap', () => {
    expect(findPrevMatch(text, 'bar', 14, false)).toEqual({ start: 12, end: 15 })
    expect(findPrevMatch(text, 'bar', 12, false)).toEqual({ start: 4, end: 7 })
  })

  it('counts matches case-insensitively', () => {
    expect(countMatches(text, 'foo', false)).toBe(2)
    expect(countMatches(text, 'foo', true)).toBe(1)
  })

  it('detects selection match', () => {
    expect(selectionMatchesFind(text, 0, 3, 'foo', false)).toBe(true)
    expect(selectionMatchesFind(text, 0, 3, 'Foo', true)).toBe(false)
  })

  it('picks next search index after current match', () => {
    expect(findNextFromSelection(text, 'foo', 0, 3, false)).toBe(3)
    expect(findNextFromSelection(text, 'foo', 5, 5, false)).toBe(5)
  })

  it('replaces all occurrences', () => {
    const { text: next, count } = replaceAllInText(text, 'foo', 'baz', false)
    expect(count).toBe(2)
    expect(next).toBe('baz bar baz BAR')
  })

  it('lists all match ranges without overlap', () => {
    expect(findAllMatchRanges('aaaa', 'aa', false)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ])
    expect(findAllMatchRanges(text, 'foo', false)).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ])
  })
})
