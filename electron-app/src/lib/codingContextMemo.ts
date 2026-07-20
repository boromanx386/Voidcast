import type { AppSettings } from '@/lib/settings'

export type CodingCommandMemo = {
  command: string
  ok: boolean
  snippet: string
}

export type CodingContextMemo = {
  projectPath: string
  lastDirectory: string
  recentFiles: string[]
  recentSearches: string[]
  recentCommands: CodingCommandMemo[]
  recentGitOps: string[]
  recentFailures: string[]
}

export type CodingProjectSnapshot = Pick<
  CodingContextMemo,
  'lastDirectory' | 'recentFiles' | 'recentFailures' | 'recentCommands'
>

const PROJECT_MEMO_STORAGE_KEY = 'voidcast-coding-project-memo-v1'
const COMMAND_SNIPPET_MAX = 150

export function getCodingProjectPath(settings: Pick<AppSettings, 'coding' | 'codingProjectPath'>): string {
  return (settings.coding.projectPath || settings.codingProjectPath || '').trim()
}

export function emptyCodingContextMemo(projectPath = ''): CodingContextMemo {
  return {
    projectPath,
    lastDirectory: '',
    recentFiles: [],
    recentSearches: [],
    recentCommands: [],
    recentGitOps: [],
    recentFailures: [],
  }
}

function dedupeNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.map((x) => x.trim()).filter(Boolean)))
}

function normalizeCommandEntry(raw: unknown): CodingCommandMemo | null {
  if (!raw || typeof raw !== 'object') {
    if (typeof raw === 'string' && raw.trim()) {
      return { command: raw.trim(), ok: true, snippet: '' }
    }
    return null
  }
  const o = raw as Partial<CodingCommandMemo>
  const command = typeof o.command === 'string' ? o.command.trim() : ''
  if (!command) return null
  return {
    command,
    ok: o.ok === false ? false : true,
    snippet: typeof o.snippet === 'string' ? o.snippet.slice(0, COMMAND_SNIPPET_MAX) : '',
  }
}

export function normalizeCodingContextMemo(raw: unknown, projectPath: string): CodingContextMemo {
  const base = emptyCodingContextMemo(projectPath)
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<CodingContextMemo>

  const commands: CodingCommandMemo[] = []
  if (Array.isArray(r.recentCommands)) {
    for (const item of r.recentCommands) {
      const entry = normalizeCommandEntry(item)
      if (entry) commands.push(entry)
    }
  }

  return {
    projectPath,
    lastDirectory: typeof r.lastDirectory === 'string' ? r.lastDirectory : '',
    recentFiles: Array.isArray(r.recentFiles)
      ? dedupeNonEmpty(r.recentFiles.filter((x): x is string => typeof x === 'string')).slice(0, 12)
      : [],
    recentSearches: Array.isArray(r.recentSearches)
      ? dedupeNonEmpty(r.recentSearches.filter((x): x is string => typeof x === 'string')).slice(0, 8)
      : [],
    recentCommands: commands.slice(0, 8),
    recentGitOps: Array.isArray(r.recentGitOps)
      ? dedupeNonEmpty(r.recentGitOps.filter((x): x is string => typeof x === 'string')).slice(0, 8)
      : [],
    recentFailures: Array.isArray(r.recentFailures)
      ? dedupeNonEmpty(r.recentFailures.filter((x): x is string => typeof x === 'string')).slice(0, 8)
      : [],
  }
}

export function pushRecentUnique(values: string[], next: string, limit = 8): string[] {
  const trimmed = next.trim()
  if (!trimmed) return values
  const without = values.filter((v) => v !== trimmed)
  return [trimmed, ...without].slice(0, limit)
}

export function pushRecentCommand(
  values: CodingCommandMemo[],
  next: CodingCommandMemo,
  limit = 6,
): CodingCommandMemo[] {
  const command = next.command.trim()
  if (!command) return values
  const entry: CodingCommandMemo = {
    command,
    ok: next.ok,
    snippet: next.snippet.slice(0, COMMAND_SNIPPET_MAX),
  }
  const without = values.filter((v) => v.command !== command)
  return [entry, ...without].slice(0, limit)
}

export function commandResultSnippet(result: string): string {
  const trimmed = result.trim()
  if (!trimmed) return ''
  const lines = trimmed.split(/\r?\n/)
  const body = lines[0]?.startsWith('$ ') ? lines.slice(1).join('\n').trim() : trimmed
  return body.slice(0, COMMAND_SNIPPET_MAX)
}

/** Narrow failure detection for coding context memo (avoid matching arbitrary "not found" in file bodies). */
export function isCodingToolFailure(toolName: string, result: string): boolean {
  const r = result.trim()
  if (!r) return false

  if (r.startsWith('Error:')) return true

  if (toolName === 'execute_command') return !r.startsWith('$ ')
  if (toolName === 'write_file') return !r.startsWith('Saved ')
  if (toolName === 'edit_code') return !r.startsWith('Edited ')
  if (toolName === 'coding_explore') {
    return r.startsWith('Error:') || r.includes('\nError:')
  }

  if (r.endsWith(' failed.')) return true
  if (r.startsWith('Target snippet not found')) return true
  if (r.startsWith('find_text must not be empty.')) return true
  if (r.startsWith('File appears to be binary')) return true
  if (r.startsWith('File is too large to read')) return true
  if (r.includes('is available only in Electron desktop')) return true
  if (r.startsWith('Not a git repository.')) return true
  if (r.startsWith('Missing projectPath') || r.startsWith('Missing coding project')) return true
  if (r.startsWith('Path escapes project root')) return true
  if (r.startsWith('Git command timed out')) return true

  return false
}

export function buildCodingMemoHint(memo: CodingContextMemo): string {
  const commandLines = memo.recentCommands.map((c) => {
    const status = c.ok ? 'OK' : 'FAIL'
    const tail = c.snippet ? `: ${c.snippet}` : ''
    return `${c.command} → ${status}${tail}`
  })

  const lines: string[] = [
    'Coding context memory from this chat session:',
    `- Active project: ${memo.projectPath || '(not set)'}`,
    `- Last listed directory: ${memo.lastDirectory || '(none yet)'}`,
    `- Recently opened/edited files: ${memo.recentFiles.length ? memo.recentFiles.join(', ') : '(none yet)'}`,
    `- Recent searches: ${memo.recentSearches.length ? memo.recentSearches.join(' | ') : '(none yet)'}`,
    `- Recent commands: ${commandLines.length ? commandLines.join(' | ') : '(none yet)'}`,
    `- Recent git operations: ${memo.recentGitOps.length ? memo.recentGitOps.join(' | ') : '(none yet)'}`,
    `- Recent failures: ${memo.recentFailures.length ? memo.recentFailures.join(' | ') : '(none yet)'}`,
    'Prefer reusing this context before scanning the whole project again.',
  ]
  return lines.join('\n')
}

function projectMemoKey(projectPath: string): string {
  return projectPath.trim().toLowerCase()
}

function readProjectMemoStore(): Record<string, CodingProjectSnapshot> {
  try {
    const raw = localStorage.getItem(PROJECT_MEMO_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as Record<string, CodingProjectSnapshot>
  } catch {
    return {}
  }
}

export function loadProjectCodingMemo(projectPath: string): CodingContextMemo {
  const path = projectPath.trim()
  if (!path) return emptyCodingContextMemo()
  const store = readProjectMemoStore()
  const snap = store[projectMemoKey(path)]
  if (!snap) return emptyCodingContextMemo(path)
  const normalized = normalizeCodingContextMemo(snap, path)
  return {
    ...emptyCodingContextMemo(path),
    lastDirectory: normalized.lastDirectory,
    recentFiles: normalized.recentFiles,
    recentFailures: normalized.recentFailures,
    recentCommands: normalized.recentCommands,
  }
}

export function saveProjectCodingMemo(projectPath: string, memo: CodingContextMemo): void {
  const path = projectPath.trim()
  if (!path) return
  const normalized = normalizeCodingContextMemo(memo, path)
  const snapshot: CodingProjectSnapshot = {
    lastDirectory: normalized.lastDirectory,
    recentFiles: normalized.recentFiles,
    recentFailures: normalized.recentFailures,
    recentCommands: normalized.recentCommands,
  }
  const store = readProjectMemoStore()
  store[projectMemoKey(path)] = snapshot
  try {
    localStorage.setItem(PROJECT_MEMO_STORAGE_KEY, JSON.stringify(store))
  } catch {
    // ignore quota errors
  }
}

export function resolveMemoForSession(
  session: { codingContextMemo?: CodingContextMemo; codingProjectPath?: string } | undefined,
  projectPath: string,
): CodingContextMemo {
  const path = projectPath.trim()
  if (
    session?.codingContextMemo &&
    (session.codingProjectPath ?? '').trim() === path &&
    path
  ) {
    return normalizeCodingContextMemo(session.codingContextMemo, path)
  }
  if (path) return loadProjectCodingMemo(path)
  return emptyCodingContextMemo()
}

export function resolveMemoForNewChat(projectPath: string): CodingContextMemo {
  return loadProjectCodingMemo(projectPath)
}

/** Path saved on the session, or global fallback for legacy sessions. */
export function sessionCodingProjectPath(
  session: { codingProjectPath?: string } | undefined,
  fallbackPath: string,
): string {
  const fromSession = (session?.codingProjectPath ?? '').trim()
  return fromSession || fallbackPath.trim()
}

/** Update settings project path without clearing coding memo. */
export function mergeCodingProjectPathIntoSettings(settings: AppSettings, path: string): AppSettings {
  const trimmed = path.trim()
  const cur = (settings.coding.projectPath || settings.codingProjectPath || '').trim()
  if (cur === trimmed) return settings
  return {
    ...settings,
    coding: { ...settings.coding, enabled: true, projectPath: trimmed },
    codingProjectPath: trimmed,
    toolsEnabled: { ...settings.toolsEnabled, coding: true },
  }
}

type SessionCodingPatch = {
  id: string
  updatedAt: number
  codingProjectPath?: string
  codingContextMemo?: CodingContextMemo
}

/** Persist current memo + path onto a session before switching away. */
export function patchSessionCodingState<T extends SessionCodingPatch>(
  sessions: T[],
  sessionId: string,
  projectPath: string,
  memo: CodingContextMemo,
): T[] {
  const idx = sessions.findIndex((s) => s.id === sessionId)
  if (idx < 0) return sessions
  const normalizedMemo = normalizeCodingContextMemo(memo, projectPath)
  const cur = sessions[idx]
  const pathField = projectPath || undefined
  const samePath = (cur.codingProjectPath ?? '') === (pathField ?? '')
  const sameMemo =
    JSON.stringify(cur.codingContextMemo ?? null) === JSON.stringify(normalizedMemo)
  if (samePath && sameMemo) return sessions
  const next = [...sessions]
  next[idx] = {
    ...cur,
    updatedAt: Date.now(),
    codingProjectPath: pathField,
    codingContextMemo: normalizedMemo,
  }
  return next
}
