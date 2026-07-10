export type TextRange = { start: number; end: number }

function sliceMatches(text: string, index: number, query: string, matchCase: boolean): boolean {
  if (query.length === 0 || index < 0 || index + query.length > text.length) return false
  const slice = text.slice(index, index + query.length)
  return matchCase ? slice === query : slice.toLowerCase() === query.toLowerCase()
}

/** Find next match after the current position; wraps to start of text. */
export function findNextMatch(
  text: string,
  query: string,
  from: number,
  matchCase = false,
): TextRange | null {
  if (!query) return null
  const start = Math.max(0, Math.min(from, text.length))
  for (let i = start; i <= text.length - query.length; i++) {
    if (sliceMatches(text, i, query, matchCase)) return { start: i, end: i + query.length }
  }
  for (let i = 0; i < start && i <= text.length - query.length; i++) {
    if (sliceMatches(text, i, query, matchCase)) return { start: i, end: i + query.length }
  }
  return null
}

/** Starting index for the next find from a textarea selection. */
export function findNextFromSelection(
  text: string,
  query: string,
  selectionStart: number,
  selectionEnd: number,
  matchCase = false,
): number {
  if (selectionMatchesFind(text, selectionStart, selectionEnd, query, matchCase)) {
    return selectionEnd
  }
  return selectionStart
}

/** Find previous match before `from` (exclusive), wrapping to end of text. */
export function findPrevMatch(
  text: string,
  query: string,
  from: number,
  matchCase = false,
): TextRange | null {
  if (!query) return null
  const before = Math.max(0, Math.min(from, text.length))
  const maxStart = text.length - query.length
  for (let i = Math.min(before - 1, maxStart); i >= 0; i--) {
    if (sliceMatches(text, i, query, matchCase)) return { start: i, end: i + query.length }
  }
  for (let i = maxStart; i >= before; i--) {
    if (sliceMatches(text, i, query, matchCase)) return { start: i, end: i + query.length }
  }
  return null
}

export function countMatches(text: string, query: string, matchCase = false): number {
  if (!query) return 0
  let count = 0
  let i = 0
  while (i <= text.length - query.length) {
    if (!sliceMatches(text, i, query, matchCase)) {
      i += 1
      continue
    }
    count += 1
    i += query.length || 1
  }
  return count
}

export function selectionMatchesFind(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  query: string,
  matchCase = false,
): boolean {
  if (!query || selectionStart === selectionEnd) return false
  const selected = text.slice(selectionStart, selectionEnd)
  return matchCase ? selected === query : selected.toLowerCase() === query.toLowerCase()
}

export function replaceAllInText(
  text: string,
  find: string,
  replace: string,
  matchCase = false,
): { text: string; count: number } {
  if (!find) return { text, count: 0 }
  let count = 0
  let out = ''
  let i = 0
  while (i <= text.length - find.length) {
    if (!sliceMatches(text, i, find, matchCase)) {
      out += text[i]
      i += 1
      continue
    }
    out += replace
    count += 1
    i += find.length
  }
  out += text.slice(i)
  return { text: out, count }
}

/** All non-overlapping match ranges in document order. */
export function findAllMatchRanges(
  text: string,
  query: string,
  matchCase = false,
): TextRange[] {
  if (!query) return []
  const ranges: TextRange[] = []
  let i = 0
  while (i <= text.length - query.length) {
    if (!sliceMatches(text, i, query, matchCase)) {
      i += 1
      continue
    }
    ranges.push({ start: i, end: i + query.length })
    i += query.length
  }
  return ranges
}
