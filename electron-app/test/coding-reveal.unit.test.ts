import { describe, expect, it } from 'vitest'
import {
  codingRevealParentDirs,
  codingRevealPathFromToolResult,
  normalizeCodingRevealPath,
} from '../src/lib/codingReveal'

describe('normalizeCodingRevealPath', () => {
  it('normalizes slashes and strips ./', () => {
    expect(normalizeCodingRevealPath('  .\\src\\app.ts  ')).toBe('src/app.ts')
    expect(normalizeCodingRevealPath('./foo/bar.ts')).toBe('foo/bar.ts')
  })
})

describe('codingRevealParentDirs', () => {
  it('returns ancestors root → parent', () => {
    expect(codingRevealParentDirs('src/hooks/useCodingSession.ts')).toEqual([
      'src',
      'src/hooks',
    ])
    expect(codingRevealParentDirs('README.md')).toEqual([])
  })
})

describe('codingRevealPathFromToolResult', () => {
  it('returns path for successful read/write/edit', () => {
    expect(
      codingRevealPathFromToolResult('read_file', '1| hello', { path: 'src/a.ts' }),
    ).toBe('src/a.ts')
    expect(
      codingRevealPathFromToolResult('write_file', 'Saved src/a.ts (12 bytes).', {
        path: 'src/a.ts',
      }),
    ).toBe('src/a.ts')
    expect(
      codingRevealPathFromToolResult('edit_code', 'Edited src/a.ts (1 replacement).', {
        path: 'src\\a.ts',
      }),
    ).toBe('src/a.ts')
  })

  it('skips failures and unrelated tools', () => {
    expect(
      codingRevealPathFromToolResult('read_file', 'Error: missing file', { path: 'x.ts' }),
    ).toBeNull()
    expect(
      codingRevealPathFromToolResult('edit_code', 'Target snippet not found (3 lines).', {
        path: 'x.ts',
      }),
    ).toBeNull()
    expect(
      codingRevealPathFromToolResult('execute_command', '$ ls\nok', { command: 'ls' }),
    ).toBeNull()
    expect(codingRevealPathFromToolResult('read_file', 'ok', {})).toBeNull()
  })
})
