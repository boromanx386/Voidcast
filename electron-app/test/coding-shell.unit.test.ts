import { describe, expect, it } from 'vitest'
import {
  codingShellNote,
  codingShellSpawn,
  findGitBash,
  GIT_BASH_COMMAND_PREFIX,
  gitBashPathToWindows,
  resolveCodingShell,
} from '../src/lib/codingShell'

const existsIn = (files: string[]) => {
  const set = new Set(files.map((f) => f.toLowerCase()))
  return (p: string) => set.has(p.toLowerCase())
}

describe('findGitBash', () => {
  it('finds the standard Program Files install', () => {
    const env = { ProgramFiles: 'C:\\Program Files', PATH: '' }
    expect(findGitBash(env, existsIn(['C:\\Program Files\\Git\\bin\\bash.exe']))).toBe(
      'C:\\Program Files\\Git\\bin\\bash.exe',
    )
  })

  it('finds a per-user install under LOCALAPPDATA', () => {
    const env = { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }
    const bash = 'C:\\Users\\u\\AppData\\Local\\Programs\\Git\\bin\\bash.exe'
    expect(findGitBash(env, existsIn([bash]))).toBe(bash)
  })

  it('derives bash from git.exe on PATH (cmd and mingw64\\bin folders)', () => {
    const bash = 'D:\\tools\\PortableGit\\bin\\bash.exe'
    expect(
      findGitBash(
        { Path: 'C:\\x;D:\\tools\\PortableGit\\cmd' },
        existsIn(['D:\\tools\\PortableGit\\cmd\\git.exe', bash]),
      ),
    ).toBe(bash)
    expect(
      findGitBash(
        { PATH: 'D:\\tools\\PortableGit\\mingw64\\bin' },
        existsIn(['D:\\tools\\PortableGit\\mingw64\\bin\\git.exe', bash]),
      ),
    ).toBe(bash)
  })

  it('never returns the WSL launcher', () => {
    const env = { VOIDCAST_BASH_PATH: 'C:\\Windows\\System32\\bash.exe', PATH: '' }
    expect(findGitBash(env, existsIn(['C:\\Windows\\System32\\bash.exe']))).toBeNull()
  })

  it('honours VOIDCAST_BASH_PATH first', () => {
    const env = { VOIDCAST_BASH_PATH: 'E:\\msys\\bash.exe', ProgramFiles: 'C:\\Program Files' }
    expect(
      findGitBash(env, existsIn(['E:\\msys\\bash.exe', 'C:\\Program Files\\Git\\bin\\bash.exe'])),
    ).toBe('E:\\msys\\bash.exe')
  })
})

describe('resolveCodingShell', () => {
  const bash = 'C:\\Program Files\\Git\\bin\\bash.exe'
  const env = { ProgramFiles: 'C:\\Program Files' }

  it('uses Git Bash on Windows when installed, cmd otherwise', () => {
    expect(resolveCodingShell('win32', env, existsIn([bash]))).toEqual({ kind: 'bash', path: bash })
    expect(resolveCodingShell('win32', env, existsIn([]))).toEqual({ kind: 'cmd' })
  })

  it('VOIDCAST_SHELL=cmd keeps cmd.exe', () => {
    expect(
      resolveCodingShell('win32', { ...env, VOIDCAST_SHELL: 'cmd' }, existsIn([bash])),
    ).toEqual({ kind: 'cmd' })
  })

  it('is sh off Windows', () => {
    expect(resolveCodingShell('linux', env, existsIn([bash]))).toEqual({ kind: 'sh' })
  })
})

describe('codingShellSpawn', () => {
  it('runs bash -c without a second shell layer', () => {
    const s = codingShellSpawn({ kind: 'bash', path: 'C:\\Git\\bin\\bash.exe' }, 'ls | head -3')
    expect(s).toEqual({
      file: 'C:\\Git\\bin\\bash.exe',
      args: ['-c', `${GIT_BASH_COMMAND_PREFIX}ls | head -3`],
      shell: false,
    })
  })

  it('switches to UTF-8 and covers a missing or Store-alias python3', () => {
    expect(GIT_BASH_COMMAND_PREFIX).toMatch(/^chcp\.com 65001 /)
    expect(GIT_BASH_COMMAND_PREFIX).toContain('*[Ww]indows[Aa]pps*')
    expect(GIT_BASH_COMMAND_PREFIX).toContain('python3() { python "$@"; }')
    expect(GIT_BASH_COMMAND_PREFIX.trimEnd().endsWith(';')).toBe(true)
  })

  it('keeps the cmd and sh command lines', () => {
    expect(codingShellSpawn({ kind: 'cmd' }, 'dir')).toEqual({
      file: 'chcp 65001 >nul 2>&1 & dir',
      args: [],
      shell: true,
    })
    expect(codingShellSpawn({ kind: 'sh' }, 'ls')).toEqual({ file: 'ls', args: [], shell: true })
  })
})

describe('codingShellNote', () => {
  it('is one short line, empty for plain sh', () => {
    expect(codingShellNote('cmd')).toBe(' Shell: cmd.exe (Windows), not bash.')
    expect(codingShellNote('bash')).toContain('forward slashes')
    expect(codingShellNote('sh')).toBe('')
    expect(codingShellNote(undefined)).toBe('')
  })
})

describe('gitBashPathToWindows', () => {
  const tmp = 'C:\\Users\\u\\AppData\\Local\\Temp'
  it('maps /tmp and drive mounts, leaves the rest', () => {
    expect(gitBashPathToWindows('/tmp/acuity.png', tmp)).toBe(`${tmp}\\acuity.png`)
    expect(gitBashPathToWindows('/tmp', tmp)).toBe(tmp)
    expect(gitBashPathToWindows('/c/Users/u/x.png', tmp)).toBe('C:\\Users\\u\\x.png')
    expect(gitBashPathToWindows('/usr/share/x.png', tmp)).toBe('/usr/share/x.png')
    expect(gitBashPathToWindows('/tmpfile.png', tmp)).toBe('/tmpfile.png')
  })
})
