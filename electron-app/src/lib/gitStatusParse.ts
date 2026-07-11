/** Parsed branch line from `git status --short --branch`. */
export type GitBranchInfo = {
  branch: string
  upstream?: string
  ahead?: number
  behind?: number
}

/** One path from porcelain short status. */
export type GitStatusEntry = {
  path: string
  /** Index (staged) status letter, space if none. */
  index: string
  /** Worktree status letter, space if none. */
  worktree: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  /** Display letter for UI (prefer worktree, else index, else ?). */
  letter: string
}

export type ParsedGitStatus = {
  branch: GitBranchInfo | null
  entries: GitStatusEntry[]
  staged: GitStatusEntry[]
  unstaged: GitStatusEntry[]
  untracked: GitStatusEntry[]
}

function isStagedLetter(ch: string): boolean {
  return ch !== ' ' && ch !== '?' && ch !== '!'
}

function isUnstagedLetter(ch: string): boolean {
  return ch !== ' ' && ch !== '?' && ch !== '!'
}

function displayLetter(index: string, worktree: string, untracked: boolean): string {
  if (untracked) return '?'
  if (worktree !== ' ') return worktree
  if (index !== ' ') return index
  return ' '
}

/**
 * Parse `## branch...upstream [ahead N, behind M]` header.
 * Detached HEAD / no branch → branch string as given by git.
 */
export function parseGitBranchHeader(line: string): GitBranchInfo | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('## ')) return null
  const rest = trimmed.slice(3).trim()
  if (!rest) return null

  let ahead: number | undefined
  let behind: number | undefined
  const bracket = rest.match(/\[([^\]]+)\]\s*$/)
  let core = rest
  if (bracket) {
    core = rest.slice(0, bracket.index).trim()
    const bits = bracket[1]!
    const a = bits.match(/ahead\s+(\d+)/i)
    const b = bits.match(/behind\s+(\d+)/i)
    if (a) ahead = Number(a[1])
    if (b) behind = Number(b[1])
  }

  const dots = core.indexOf('...')
  if (dots >= 0) {
    const branch = core.slice(0, dots).trim() || 'HEAD'
    const upstream = core.slice(dots + 3).trim() || undefined
    return { branch, upstream, ahead, behind }
  }

  return { branch: core || 'HEAD', ahead, behind }
}

/**
 * Parse one porcelain short line (`XY path` or `XY old -> new`).
 * Returns null for empty / non-status lines.
 */
export function parseGitStatusLine(line: string): GitStatusEntry | null {
  const raw = line.replace(/\r$/, '')
  if (!raw || raw.startsWith('## ')) return null
  if (raw.length < 3) return null

  const index = raw[0] ?? ' '
  const worktree = raw[1] ?? ' '
  let pathPart = raw.slice(2)
  // Porcelain short uses a space after XY; tolerate missing space.
  if (pathPart.startsWith(' ')) pathPart = pathPart.slice(1)
  pathPart = pathPart.trim()
  if (!pathPart) return null

  // Rename / copy: `old -> new` (optionally quoted) — use new path for diff.
  let path = pathPart
  if (pathPart.includes(' -> ')) {
    const parts = pathPart.split(' -> ')
    path = (parts[parts.length - 1] ?? pathPart).trim()
  }
  path = path.replace(/^"|"$/g, '')

  const untracked = index === '?' && worktree === '?'
  const staged = !untracked && isStagedLetter(index)
  const unstaged = !untracked && isUnstagedLetter(worktree)

  return {
    path,
    index,
    worktree,
    staged,
    unstaged,
    untracked,
    letter: displayLetter(index, worktree, untracked),
  }
}

/** Full parse of `git status --short --branch` (or similar) text. */
export function parseGitStatusText(text: string): ParsedGitStatus {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  let branch: GitBranchInfo | null = null
  const entries: GitStatusEntry[] = []
  const seen = new Set<string>()

  for (const line of lines) {
    if (!line.trim()) continue
    if (line.startsWith('## ')) {
      branch = parseGitBranchHeader(line)
      continue
    }
    const entry = parseGitStatusLine(line)
    if (!entry) continue
    // Deduplicate by path+index+worktree (rare duplicates).
    const key = `${entry.index}${entry.worktree}:${entry.path}`
    if (seen.has(key)) continue
    seen.add(key)
    entries.push(entry)
  }

  const staged = entries.filter((e) => e.staged)
  const unstaged = entries.filter((e) => e.unstaged)
  const untracked = entries.filter((e) => e.untracked)

  return { branch, entries, staged, unstaged, untracked }
}

export function formatGitBranchBadge(info: GitBranchInfo | null): string {
  if (!info) return '—'
  const parts = [info.branch]
  if (info.ahead != null && info.ahead > 0) parts.push(`↑${info.ahead}`)
  if (info.behind != null && info.behind > 0) parts.push(`↓${info.behind}`)
  return parts.join(' ')
}

/** Normalize path separators for map lookups (git uses `/`). */
export function normalizeGitPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

/**
 * Map relative path → best status entry for tree coloring.
 * If a path appears twice (rare), prefer the one with worktree changes.
 */
export function buildGitStatusByPath(parsed: ParsedGitStatus): Map<string, GitStatusEntry> {
  const map = new Map<string, GitStatusEntry>()
  for (const e of parsed.entries) {
    const key = normalizeGitPath(e.path)
    const prev = map.get(key)
    if (!prev || (e.unstaged && !prev.unstaged) || (e.untracked && !prev.untracked)) {
      map.set(key, e)
    }
  }
  return map
}

/** True if this directory (or any descendant) has a git change. */
export function dirHasGitChanges(
  dirPath: string,
  byPath: ReadonlyMap<string, GitStatusEntry>,
): boolean {
  const prefix = normalizeGitPath(dirPath).replace(/\/$/, '') + '/'
  const exact = prefix.slice(0, -1)
  for (const key of byPath.keys()) {
    if (key === exact || key.startsWith(prefix)) return true
  }
  return false
}

/** Tailwind text class for a status letter (coding panel semantic colors). */
export function gitLetterTextClass(letter: string): string {
  switch (letter) {
    case 'M':
      return 'coding-git--modified'
    case 'A':
    case 'C':
      return 'coding-git--added'
    case 'D':
      return 'coding-git--deleted'
    case 'R':
      return 'coding-git--renamed'
    case '?':
      return 'coding-git--untracked'
    case 'U':
      return 'coding-git--conflict'
    default:
      return 'coding-git--default'
  }
}
