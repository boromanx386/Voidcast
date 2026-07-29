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

/** Per-turn working-set cache — survives old-tool-result clearing. */
export type CodingFileCacheEntry = {
  path: string
  content: string
}

export type CodingFileCache = {
  entries: CodingFileCacheEntry[]
}

export const CODING_FILE_CACHE_MAX_FILES = 6
export const CODING_FILE_CACHE_MAX_TOTAL_CHARS = 15_000
export const CODING_FILE_CACHE_MAX_PER_FILE_CHARS = 3_000

export function emptyCodingFileCache(): CodingFileCache {
  return { entries: [] }
}

/** Upsert a file read/edit/write result into the working-set cache. LRU: promoted to front. */
export function upsertCodingFileCache(
  cache: CodingFileCache,
  path: string,
  content: string,
): CodingFileCache {
  const trimmed = path.trim()
  if (!trimmed || !content) return cache
  const capped = content.length > CODING_FILE_CACHE_MAX_PER_FILE_CHARS
    ? content.slice(0, CODING_FILE_CACHE_MAX_PER_FILE_CHARS)
    : content
  const without = cache.entries.filter((e) => e.path !== trimmed)
  const entry: CodingFileCacheEntry = { path: trimmed, content: capped }
  const next = [entry, ...without].slice(0, CODING_FILE_CACHE_MAX_FILES)
  // Trim by total char budget (drop oldest entries first).
  let total = 0
  const survivors: CodingFileCacheEntry[] = []
  for (const e of next) {
    total += e.content.length
    if (total > CODING_FILE_CACHE_MAX_TOTAL_CHARS) break
    survivors.push(e)
  }
  return { entries: survivors.slice(0, CODING_FILE_CACHE_MAX_FILES) }
}

/** Remove a path from cache (on edit code or stale read). */
export function invalidateCodingFileCache(
  cache: CodingFileCache,
  path: string,
): CodingFileCache {
  return {
    entries: cache.entries.filter((e) => e.path !== path.trim()),
  }
}

/** Build a compact injection block for the working set. Empty string if nothing to inject. */
export function buildWorkingSetHint(
  cache: CodingFileCache,
  /** Paths currently uncleared in tool-result messages — skip these to avoid duplication. */
  unclearedPaths: string[],
): string {
  const toShow = cache.entries.filter(
    (e) => !unclearedPaths.includes(e.path) && e.content.trim(),
  )
  if (toShow.length === 0) return ''
  const lines = [
    '[Working memory — files read this turn, still current. Use this instead of re-reading.]',
    ...toShow.map((e) => {
      const label =
        e.content.length >= CODING_FILE_CACHE_MAX_PER_FILE_CHARS
          ? `${e.path} (first ${CODING_FILE_CACHE_MAX_PER_FILE_CHARS} chars cached)`
          : e.path
      return `### ${label}\n${e.content}`
    }),
  ]
  return lines.join('\n\n')
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
  if (toolName === 'stop_process') return !r.startsWith('Stopped process ')
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

export function buildCodingMemoHint(
  memo: CodingContextMemo,
  opts?: { buildWithResearch?: boolean },
): string {
  const commandLines = memo.recentCommands.map((c) => {
    const status = c.ok ? 'OK' : 'FAIL'
    const tail = c.snippet ? `: ${c.snippet}` : ''
    return `${c.command} → ${status}${tail}`
  })

  const reuseLine = opts?.buildWithResearch
    ? 'These files/searches were opened during Plan mode — do not re-list the whole tree or run broad coding_explore unless Plan research is missing or insufficient. Prefer find_symbols + targeted range-reads over re-reading whole files.'
    : 'Prefer reusing this context (and any in-turn Digests) before scanning the whole project or re-reading the same files again.'

  const lines: string[] = [
    'Coding context memory from this chat session:',
    `- Active project: ${memo.projectPath || '(not set)'}`,
    `- Last listed directory: ${memo.lastDirectory || '(none yet)'}`,
    `- Recently opened/edited files: ${memo.recentFiles.length ? memo.recentFiles.join(', ') : '(none yet)'}`,
    `- Recent searches: ${memo.recentSearches.length ? memo.recentSearches.join(' | ') : '(none yet)'}`,
    `- Recent commands: ${commandLines.length ? commandLines.join(' | ') : '(none yet)'}`,
    `- Recent git operations: ${memo.recentGitOps.length ? memo.recentGitOps.join(' | ') : '(none yet)'}`,
    `- Recent failures: ${memo.recentFailures.length ? memo.recentFailures.join(' | ') : '(none yet)'}`,
    reuseLine,
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

/**
 * Path bound to the session itself (no settings fallback).
 * Empty string = General chat (no project folder).
 * Optional fallback is only used when the session has no bound path (legacy callers).
 */
export function sessionCodingProjectPath(
  session:
    | { codingProjectPath?: string; codingContextMemo?: { projectPath?: string } }
    | undefined,
  fallbackPath = '',
): string {
  const fromSession = (session?.codingProjectPath ?? '').trim()
  if (fromSession) return fromSession
  const fromMemo = (session?.codingContextMemo?.projectPath ?? '').trim()
  if (fromMemo) return fromMemo
  return fallbackPath.trim()
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
