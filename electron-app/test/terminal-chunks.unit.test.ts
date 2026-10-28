import { describe, expect, it } from 'vitest'
import { appendTerminalChunk, expandTextToTerminalLines } from '../src/lib/terminalChunks'
import { codingShellCommandLine } from '../src/lib/codingProcessStdio'
import type { TerminalLine } from '../src/types/coding'

const texts = (text: string) => expandTextToTerminalLines('stdout', text, 't').map((l) => l.text)

const feed = (chunks: string[], runId = 'r1', stream: TerminalLine['stream'] = 'stdout') =>
  chunks.reduce<TerminalLine[]>(
    (rows, text, i) => appendTerminalChunk(rows, { stream, text, idPrefix: `c${i}`, runId }),
    [],
  )

describe('expandTextToTerminalLines', () => {
  it('does not add a blank row for a trailing newline', () => {
    expect(texts('a\nb\n')).toEqual(['a', 'b'])
  })

  it('keeps real blank lines and leading whitespace', () => {
    expect(texts('a\n\n    at foo (x.ts:1)\n')).toEqual(['a', '', '    at foo (x.ts:1)'])
  })

  it('treats a lone newline as one blank row', () => {
    expect(texts('\n')).toEqual([''])
  })
})

describe('appendTerminalChunk', () => {
  it('continues an open row of the same run', () => {
    const rows = feed(['Proceed? ', 'y\n', 'done\n'])
    expect(rows.map((r) => r.text)).toEqual(['Proceed? y', 'done'])
    expect(rows.some((r) => r.partial)).toBe(false)
  })

  it('does not merge across runs or streams', () => {
    let rows = feed(['open '])
    rows = appendTerminalChunk(rows, {
      stream: 'stdout',
      text: 'other\n',
      idPrefix: 'x',
      runId: 'r2',
    })
    rows = appendTerminalChunk(rows, {
      stream: 'system',
      text: '[exit 0]',
      idPrefix: 'y',
      runId: 'r2',
    })
    expect(rows.map((r) => r.text)).toEqual(['open ', 'other', '[exit 0]'])
  })

  it('redraws a progress line on carriage return, across chunks', () => {
    const rows = feed(['10%\r', '20%\r', '30%\r', '100%\n', 'next\n'])
    expect(rows.map((r) => r.text)).toEqual(['100%', 'next'])
  })

  it('keeps the last frame visible while a redraw is pending', () => {
    const rows = feed(['downloading 50%\r'])
    expect(rows.map((r) => r.text)).toEqual(['downloading 50%'])
    expect(rows[0].pendingCr).toBe(true)
  })

  it('treats cursor-to-column and erase-line escapes as a redraw', () => {
    const rows = feed(['\x1b[2K\x1b[1Gspin 1', '\x1b[2K\x1b[1Gspin 2', '\x1b[2K\x1b[1Gok\n'])
    expect(rows.map((r) => r.text)).toEqual(['ok'])
  })

  it('keeps SGR colors and drops other escapes', () => {
    const rows = feed(['\x1b]0;title\x07\x1b[?25l\x1b[32mgreen\x1b[0m\n'])
    expect(rows.map((r) => r.text)).toEqual(['\x1b[32mgreen\x1b[0m'])
  })

  it('caps the number of rows', () => {
    const rows = appendTerminalChunk(
      [],
      { stream: 'stdout', text: 'a\nb\nc\nd\n', idPrefix: 'p', runId: 'r' },
      2,
    )
    expect(rows.map((r) => r.text)).toEqual(['c', 'd'])
  })
})

describe('codingShellCommandLine', () => {
  it('switches cmd.exe to UTF-8 on Windows only', () => {
    expect(codingShellCommandLine('npm test', 'win32')).toBe('chcp 65001 >nul 2>&1 & npm test')
    expect(codingShellCommandLine('npm test', 'linux')).toBe('npm test')
  })
})
