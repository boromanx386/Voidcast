import { describe, expect, test } from 'vitest'
import {
  buildGitStatusByPath,
  dirHasGitChanges,
  formatGitBranchBadge,
  gitLetterTextClass,
  parseGitBranchHeader,
  parseGitStatusLine,
  parseGitStatusText,
} from '../src/lib/gitStatusParse'

describe('parseGitBranchHeader', () => {
  test('parses simple branch', () => {
    expect(parseGitBranchHeader('## main')).toEqual({ branch: 'main' })
  })

  test('parses upstream and ahead', () => {
    expect(parseGitBranchHeader('## main...origin/main [ahead 1]')).toEqual({
      branch: 'main',
      upstream: 'origin/main',
      ahead: 1,
      behind: undefined,
    })
  })

  test('parses ahead and behind', () => {
    expect(parseGitBranchHeader('## feature...origin/feature [ahead 2, behind 3]')).toEqual({
      branch: 'feature',
      upstream: 'origin/feature',
      ahead: 2,
      behind: 3,
    })
  })

  test('returns null for non-header', () => {
    expect(parseGitBranchHeader(' M file.ts')).toBeNull()
  })
})

describe('parseGitStatusLine', () => {
  test('staged modify (M space)', () => {
    const e = parseGitStatusLine('M  src/App.css')
    expect(e).toMatchObject({
      path: 'src/App.css',
      index: 'M',
      worktree: ' ',
      staged: true,
      unstaged: false,
      untracked: false,
      letter: 'M',
    })
  })

  test('unstaged modify (space M)', () => {
    const e = parseGitStatusLine(' M electron-app/src/lib/settings.ts')
    expect(e).toMatchObject({
      path: 'electron-app/src/lib/settings.ts',
      index: ' ',
      worktree: 'M',
      staged: false,
      unstaged: true,
      untracked: false,
      letter: 'M',
    })
  })

  test('both staged and unstaged (MM)', () => {
    const e = parseGitStatusLine('MM both.ts')
    expect(e).toMatchObject({
      path: 'both.ts',
      staged: true,
      unstaged: true,
      letter: 'M',
    })
  })

  test('untracked', () => {
    const e = parseGitStatusLine('?? frog_comic.jpg')
    expect(e).toMatchObject({
      path: 'frog_comic.jpg',
      untracked: true,
      staged: false,
      unstaged: false,
      letter: '?',
    })
  })

  test('rename uses new path', () => {
    const e = parseGitStatusLine('R  old/name.ts -> new/name.ts')
    expect(e).toMatchObject({
      path: 'new/name.ts',
      index: 'R',
      staged: true,
      letter: 'R',
    })
  })

  test('ignores branch header', () => {
    expect(parseGitStatusLine('## main')).toBeNull()
  })
})

describe('parseGitStatusText', () => {
  test('groups staged unstaged untracked', () => {
    const text = [
      '## main...origin/main [ahead 1]',
      'M  staged.ts',
      ' M dirty.ts',
      'MM both.ts',
      '?? new.txt',
      'R  a.ts -> b.ts',
    ].join('\n')

    const parsed = parseGitStatusText(text)
    expect(parsed.branch).toEqual({
      branch: 'main',
      upstream: 'origin/main',
      ahead: 1,
      behind: undefined,
    })
    expect(parsed.staged.map((e) => e.path).sort()).toEqual(['b.ts', 'both.ts', 'staged.ts'])
    expect(parsed.unstaged.map((e) => e.path).sort()).toEqual(['both.ts', 'dirty.ts'])
    expect(parsed.untracked.map((e) => e.path)).toEqual(['new.txt'])
  })

  test('clean tree has empty groups', () => {
    const parsed = parseGitStatusText('## main\n')
    expect(parsed.entries).toEqual([])
    expect(parsed.staged).toEqual([])
    expect(formatGitBranchBadge(parsed.branch)).toBe('main')
  })
})

describe('formatGitBranchBadge', () => {
  test('formats ahead behind', () => {
    expect(
      formatGitBranchBadge({ branch: 'main', ahead: 1, behind: 2 }),
    ).toBe('main ↑1 ↓2')
  })

  test('null is dash', () => {
    expect(formatGitBranchBadge(null)).toBe('—')
  })
})

describe('buildGitStatusByPath / dirHasGitChanges', () => {
  test('maps paths and detects dirty dirs', () => {
    const parsed = parseGitStatusText(
      ['## main', ' M src/lib/a.ts', '?? assets/x.png'].join('\n'),
    )
    const map = buildGitStatusByPath(parsed)
    expect(map.get('src/lib/a.ts')?.letter).toBe('M')
    expect(map.get('assets/x.png')?.untracked).toBe(true)
    expect(dirHasGitChanges('src', map)).toBe(true)
    expect(dirHasGitChanges('src/lib', map)).toBe(true)
    expect(dirHasGitChanges('other', map)).toBe(false)
  })

  test('letter colors', () => {
    expect(gitLetterTextClass('M')).toContain('yellow')
    expect(gitLetterTextClass('A')).toContain('green')
    expect(gitLetterTextClass('D')).toContain('red')
    expect(gitLetterTextClass('?')).toContain('void-text')
  })
})
