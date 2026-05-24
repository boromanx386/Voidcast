import { describe, it, expect } from 'vitest'
import {
  detectFileLineEndings,
  toLf,
  restoreLineEndings,
  applySnippetEdit,
  parseEditedLineRangeFromToolResult,
  formatEditedFileMemoEntry,
  readFileToolDisplayPrefix,
} from '../src/lib/codingEol'

// ---------------------------------------------------------------------------
// detectFileLineEndings
// ---------------------------------------------------------------------------
describe('detectFileLineEndings', () => {
  it('returns crlf when text contains \\r\\n', () => {
    expect(detectFileLineEndings('line1\r\nline2')).toBe('crlf')
  })

  it('returns lf when text has only \\n', () => {
    expect(detectFileLineEndings('line1\nline2')).toBe('lf')
  })

  it('returns lf for empty string', () => {
    expect(detectFileLineEndings('')).toBe('lf')
  })

  it('returns lf when no newlines at all', () => {
    expect(detectFileLineEndings('single line')).toBe('lf')
  })
})

// ---------------------------------------------------------------------------
// toLf
// ---------------------------------------------------------------------------
describe('toLf', () => {
  it('converts CRLF to LF', () => {
    expect(toLf('hello\r\nworld')).toBe('hello\nworld')
  })

  it('leaves LF unchanged', () => {
    expect(toLf('hello\nworld')).toBe('hello\nworld')
  })

  it('handles mixed CRLF and stray CR', () => {
    expect(toLf('a\r\nb\rc\r\nd')).toBe('a\nb\nc\nd')
  })

  it('returns empty string unchanged', () => {
    expect(toLf('')).toBe('')
  })

  it('returns text with no newlines unchanged', () => {
    expect(toLf('plain text')).toBe('plain text')
  })

  it('handles multiple CRLF sequences', () => {
    expect(toLf('a\r\n\r\nb\r\nc')).toBe('a\n\nb\nc')
  })
})

// ---------------------------------------------------------------------------
// restoreLineEndings
// ---------------------------------------------------------------------------
describe('restoreLineEndings', () => {
  it('leaves LF text as-is when target is lf', () => {
    expect(restoreLineEndings('hello\nworld', 'lf')).toBe('hello\nworld')
  })

  it('converts LF to CRLF when target is crlf', () => {
    expect(restoreLineEndings('hello\nworld', 'crlf')).toBe('hello\r\nworld')
  })

  it('handles empty string', () => {
    expect(restoreLineEndings('', 'crlf')).toBe('')
  })

  it('handles multiple newlines', () => {
    expect(restoreLineEndings('a\n\nb\nc', 'crlf')).toBe('a\r\n\r\nb\r\nc')
  })
})

// ---------------------------------------------------------------------------
// applySnippetEdit
// ---------------------------------------------------------------------------
describe('applySnippetEdit', () => {
  it('exact match — replaces first occurrence', () => {
    const result = applySnippetEdit('hello world', 'hello', 'hi', false)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.next).toBe('hi world')
      expect(result.mode).toBe('exact')
    }
  })

  it('exact match — replace all', () => {
    const result = applySnippetEdit('a a a', 'a', 'b', true)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.next).toBe('b b b')
  })

  it('exact match — reports correct line numbers', () => {
    const result = applySnippetEdit('line1\nline2\nline3', 'line2', 'L2', false)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.startLine).toBe(2)
      expect(result.endLine).toBe(2)
    }
  })

  it('exact match — multi-line replace line range', () => {
    const result = applySnippetEdit(
      'a\nb\nc\nd',
      'b\nc',
      'B\nC\nX',
      false,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.next).toBe('a\nB\nC\nX\nd')
      expect(result.startLine).toBe(2)
      expect(result.endLine).toBe(4)
    }
  })

  it('crlf-expanded — LF find_text matches on CRLF file', () => {
    const file = 'line1\r\nline2\r\nline3'
    // find_text uses LF; replace_text uses LF — the function expands both to CRLF
    const result = applySnippetEdit(file, 'line2\nline3', 'L2\nL3', false)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.mode).toBe('crlf-expanded')
      expect(result.next).toBe('line1\r\nL2\r\nL3')
    }
  })

  it('crlf-expanded — reports correct line numbers', () => {
    const file = 'a\r\nb\r\nc\r\nd'
    const result = applySnippetEdit(file, 'b\nc', 'B\r\nC', false)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.startLine).toBe(2)
      expect(result.endLine).toBe(3)
    }
  })

  // crlf-expanded catches these — LF find_text with CRLF file
  it('crlf-expanded — LF find_text in CRLF file', () => {
    const file = 'const x = 1\r\nconst y = 2\r\n'
    const result = applySnippetEdit(file, 'const x = 1\nconst y = 2', 'const a = 1\nconst b = 2', false)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.mode).toBe('crlf-expanded')
      expect(result.next).toBe('const a = 1\r\nconst b = 2\r\n')
    }
  })

  it('crlf-expanded — preserves CRLF EOL', () => {
    const file = 'hello\r\nworld\r\n'
    const result = applySnippetEdit(file, 'hello\nworld', 'hi\nthere', false)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.mode).toBe('crlf-expanded')
      expect(result.next).toBe('hi\r\nthere\r\n')
    }
  })

  it('crlf-expanded — replace all', () => {
    const file = 'x\r\ny\r\nx\r\n'
    const result = applySnippetEdit(file, 'x\n', 'z\n', true)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.mode).toBe('crlf-expanded')
      expect(result.next).toBe('z\r\ny\r\nz\r\n')
    }
  })

  // True normalized path: exact fails, crlf-expanded skipped (find has \r\n), toLf matches
  it('normalized — mixed-EOL find where exact and crlf-expanded both miss', () => {
    // file:     "ab\r\ncd\nef"   (first EOL CRLF, second EOL LF)
    // find:     "ab\ncd\r\nef"   (mixed LF then CRLF — swapped vs file)
    // exact:    NO (line endings don't match)
    // crlf-exp: skipped (find has \r\n)
    // toLf both: "ab\ncd\nef" = "ab\ncd\nef" → YES → normalized
    const file = 'ab\r\ncd\nef'
    const result = applySnippetEdit(file, 'ab\ncd\r\nef', 'X\nY', false)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.mode).toBe('normalized')
      expect(result.next).toBe('X\r\nY')
    }
  })

  it('returns ok:false for empty find_text', () => {
    const result = applySnippetEdit('hello', '', 'x', false)
    expect(result.ok).toBe(false)
  })

  it('returns ok:false when no match found', () => {
    const result = applySnippetEdit('hello world', 'xyz', 'abc', false)
    expect(result.ok).toBe(false)
  })

  it('handles find_text same as replace_text (no-op)', () => {
    const result = applySnippetEdit('hello world', 'hello', 'hello', false)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.next).toBe('hello world')
  })

  it('handles file with only newlines', () => {
    const result = applySnippetEdit('\n\n', '\n\n', '\n', false)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.next).toBe('\n')
  })
})

// ---------------------------------------------------------------------------
// parseEditedLineRangeFromToolResult
// ---------------------------------------------------------------------------
describe('parseEditedLineRangeFromToolResult', () => {
  it('parses standard format', () => {
    const r = parseEditedLineRangeFromToolResult('Edited path (lines 12-18, …)')
    expect(r).toEqual({ startLine: 12, endLine: 18 })
  })

  it('returns null for no match', () => {
    expect(parseEditedLineRangeFromToolResult('No range here')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseEditedLineRangeFromToolResult('')).toBeNull()
  })

  it('returns null for inverted range', () => {
    expect(parseEditedLineRangeFromToolResult('(lines 10-5)')).toBeNull()
  })

  it('returns null for zero start', () => {
    expect(parseEditedLineRangeFromToolResult('(lines 0-5)')).toBeNull()
  })

  it('parses single-line range', () => {
    const r = parseEditedLineRangeFromToolResult('(lines 42-42)')
    expect(r).toEqual({ startLine: 42, endLine: 42 })
  })

  it('parses with leading/trailing text', () => {
    const r = parseEditedLineRangeFromToolResult(
      'OK: src/file.ts (lines 100-150) modified',
    )
    expect(r).toEqual({ startLine: 100, endLine: 150 })
  })
})

// ---------------------------------------------------------------------------
// formatEditedFileMemoEntry
// ---------------------------------------------------------------------------
describe('formatEditedFileMemoEntry', () => {
  it('formats with line range when tool result has it', () => {
    expect(formatEditedFileMemoEntry('src/foo.ts', 'Edited path (lines 5-10, …)'))
      .toBe('src/foo.ts (edited lines 5-10)')
  })

  it('formats without range when tool result has none', () => {
    expect(formatEditedFileMemoEntry('src/bar.ts', 'Success'))
      .toBe('src/bar.ts (edited)')
  })

  it('handles empty tool result', () => {
    expect(formatEditedFileMemoEntry('src/baz.ts', '')).toBe('src/baz.ts (edited)')
  })
})

// ---------------------------------------------------------------------------
// readFileToolDisplayPrefix
// ---------------------------------------------------------------------------
describe('readFileToolDisplayPrefix', () => {
  it('returns empty string for LF files', () => {
    expect(readFileToolDisplayPrefix('lf', true)).toBe('')
    expect(readFileToolDisplayPrefix('lf', false)).toBe('')
  })

  it('returns CRLF hint for CRLF files (numbered view)', () => {
    const hint = readFileToolDisplayPrefix('crlf', true)
    expect(hint).toContain('CRLF')
    expect(hint).toContain('edit_code')
  })

  it('returns CRLF hint for CRLF files (raw view)', () => {
    const hint = readFileToolDisplayPrefix('crlf', false)
    expect(hint).toContain('CRLF')
    expect(hint).toContain('EOL-aware')
  })
})
