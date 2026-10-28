import { describe, expect, it } from 'vitest'
import { expandTextToTerminalLines } from '../src/lib/terminalChunks'
import { codingShellCommandLine } from '../src/lib/codingProcessStdio'

const texts = (text: string) => expandTextToTerminalLines('stdout', text, 't').map((l) => l.text)

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

describe('codingShellCommandLine', () => {
  it('switches cmd.exe to UTF-8 on Windows only', () => {
    expect(codingShellCommandLine('npm test', 'win32')).toBe('chcp 65001 >nul 2>&1 & npm test')
    expect(codingShellCommandLine('npm test', 'linux')).toBe('npm test')
  })
})
