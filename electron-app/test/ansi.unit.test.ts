import { describe, expect, it } from 'vitest'
import { parseAnsi } from '../src/lib/ansi'

describe('parseAnsi', () => {
  it('returns plain text as one unstyled span', () => {
    expect(parseAnsi('hello')).toEqual([{ text: 'hello', style: {} }])
  })

  it('maps 16-color codes to palette tokens and resets on 0', () => {
    expect(parseAnsi('\x1b[31merr\x1b[0m ok \x1b[92mpass\x1b[39m')).toEqual([
      { text: 'err', style: { fg: 'rgb(var(--ansi-1))' } },
      { text: ' ok ', style: {} },
      { text: 'pass', style: { fg: 'rgb(var(--ansi-10))' } },
    ])
  })

  it('handles bold, 256-color and truecolor', () => {
    const [a, b, c] = parseAnsi('\x1b[1;38;5;196mA\x1b[22;38;2;1;2;3mB\x1b[48;5;244mC')
    expect(a.style).toEqual({ bold: true, fg: 'rgb(255 0 0)' })
    expect(b.style).toEqual({ fg: 'rgb(1 2 3)' })
    expect(c.style).toEqual({ fg: 'rgb(1 2 3)', bg: 'rgb(128 128 128)' })
  })

  it('treats an empty SGR as reset and hides a cut-off sequence', () => {
    expect(parseAnsi('\x1b[33my\x1b[mz\x1b[3')).toEqual([
      { text: 'y', style: { fg: 'rgb(var(--ansi-3))' } },
      { text: 'z', style: {} },
    ])
  })
})
