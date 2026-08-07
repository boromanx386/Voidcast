import type { CodingFileNode, CodingToolResult } from '@/types/coding'
import {
  applySnippetEdit,
  buildEditUnifiedDiff,
  formatClosestMatchFailure,
  readFileToolDisplayPrefix,
  type FileLineEndings,
} from '@/lib/codingEol'
import { formatSearchResults } from '@/lib/codingSearch'
import { formatSymbolsOutline, type SymbolEntry } from '@/lib/codingOutline'
import type { ActiveCodingProcess } from '@/lib/codingActiveProcesses'
import {
  markLastExecuteCommandStreamed,
  type CodingCommandOutputEvent,
} from '@/lib/codingCommandStream'

// Central helper: bridge absence is reported as a failed result, not a thrown exception.
function missingBridgeResult(action: string): CodingToolResult {
  return { ok: false, text: `${action} is available only in Electron desktop.` }
}

export async function invokePickCodingDirectory(): Promise<{ ok: true; path: string } | { ok: false }> {
  const fn = window.voidcast?.pickCodingDirectory
  if (!fn) return { ok: false }
  return fn()
}

export async function invokeListCodingDirectory(
  projectPath: string,
  path = '',
  options?: { includeIgnored?: boolean },
): Promise<{ ok: true; entries: CodingFileNode[] } | { ok: false; error: string }> {
  const fn = window.voidcast?.codingListDirectory
  if (!fn) return { ok: false, error: 'Not available outside Electron.' }
  const res = await fn({
    projectPath,
    path,
    includeIgnored: options?.includeIgnored === true,
  })
  if (!res.ok) return { ok: false, error: res.error || 'List directory failed.' }
  return { ok: true, entries: res.entries }
}

export async function invokeCodingWatchProject(
  projectPath: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const fn = window.voidcast?.codingWatchProject
  if (!fn) return { ok: false, error: 'Not available outside Electron.' }
  const res = await fn({ projectPath })
  if (!res.ok) return { ok: false, error: res.error || 'Watch project failed.' }
  return { ok: true }
}

export function subscribeCodingFsChange(callback: () => void): () => void {
  const fn = window.voidcast?.onCodingFsChange
  if (!fn) return () => {}
  return fn(callback)
}

export function subscribeCodingCommandOutput(
  callback: (event: CodingCommandOutputEvent) => void,
): () => void {
  const fn = window.voidcast?.onCodingCommandOutput
  if (!fn) return () => {}
  return fn(callback)
}

export function subscribeCodingProcessUpdate(
  callback: (
    event: { action: 'upsert'; process: ActiveCodingProcess } | { action: 'remove'; runId: string },
  ) => void,
): () => void {
  const fn = window.voidcast?.onCodingProcessUpdate
  if (!fn) return () => {}
  return fn(callback)
}

export async function invokeListActiveCodingProcesses(): Promise<ActiveCodingProcess[]> {
  const fn = window.voidcast?.codingListActiveProcesses
  if (!fn) return []
  const res = await fn()
  return res.processes ?? []
}

export async function invokeReadCodingProcessOutput(
  runId: string,
  offset?: number,
): Promise<CodingToolResult> {
  const fn = window.voidcast?.codingReadProcessOutput
  if (!fn) return missingBridgeResult('Read process output')
  const res = await fn({ runId, offset })
  if (!res.ok) return { ok: false, text: res.error || 'Read process output failed.' }
  const header = [
    `Process ${runId} (${res.kind}): ${res.command}`,
    `offset ${offset ?? res.startOffset} → nextOffset ${res.nextOffset}` +
      (res.truncatedFromStart ? ' (requested offset older than retained buffer)' : ''),
  ].join('\n')
  const body = res.text.trimEnd()
  return {
    ok: true,
    text: body ? `${header}\n\n${body}` : `${header}\n\n(no output yet)`,
  }
}

export async function invokeKillAllActiveCodingProcesses(): Promise<void> {
  const fn = window.voidcast?.codingKillAllActiveProcesses
  if (!fn) return
  await fn()
}

export async function invokeKillCodingCommand(
  runId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const fn = window.voidcast?.codingKillCommand
  if (!fn) return { ok: false, error: 'Stop is available only in Electron desktop.' }
  const res = await fn({ runId })
  if (!res.ok) return { ok: false, error: res.error || 'Stop failed.' }
  return { ok: true }
}

export async function invokeReadCodingFile(
  projectPath: string,
  filePath: string,
  options?: {
    startLine?: number
    endLine?: number
    maxChars?: number
    allowLargeRead?: boolean
    /** When true, prepend a one-line CRLF hint for the model (not used for internal edit_code reads). */
    forToolDisplay?: boolean
  },
): Promise<CodingToolResult> {
  const fn = window.voidcast?.codingReadFile
  if (!fn) return missingBridgeResult('Read file')
  const res = await fn({
    projectPath,
    path: filePath,
    startLine: options?.startLine,
    endLine: options?.endLine,
    maxChars: options?.maxChars,
    allowLargeRead: options?.allowLargeRead,
  })
  if (!res.ok) return { ok: false, text: res.error || 'Read failed.' }
  const lineEndings: FileLineEndings = res.lineEndings ?? 'lf'
  const numberedView = options?.startLine !== undefined || options?.endLine !== undefined
  const prefix =
    options?.forToolDisplay === true
      ? readFileToolDisplayPrefix(lineEndings, numberedView)
      : ''
  return { ok: true, text: `${prefix}${res.content}` }
}

export async function invokeWriteCodingFile(projectPath: string, path: string, content: string): Promise<CodingToolResult> {
  const fn = window.voidcast?.codingWriteFile
  if (!fn) return missingBridgeResult('Write file')
  const res = await fn({ projectPath, path, content })
  return { ok: res.ok, text: res.ok ? `Saved ${res.path}` : res.error || 'Write failed.' }
}

export async function invokeEditCodingFile(
  projectPath: string,
  path: string,
  findText: string,
  replaceText: string,
  replaceAll = false,
  options?: {
    startLine?: number
    endLine?: number
    ignoreWhitespace?: boolean
  },
): Promise<CodingToolResult> {
  const read = await invokeReadCodingFile(projectPath, path, { allowLargeRead: true })
  if (!read.ok) return read
  if (!findText) return { ok: false, text: 'find_text must not be empty.' }

  const before = read.text
  const applied = applySnippetEdit(before, findText, replaceText, {
    replaceAll,
    startLine: options?.startLine,
    endLine: options?.endLine,
    ignoreWhitespace: options?.ignoreWhitespace,
  })
  if (!applied.ok) {
    const lineCount = before.split(/\r?\n/).length
    return {
      ok: false,
      text: `Target snippet not found (${lineCount} lines). ${formatClosestMatchFailure(applied.closest)}`,
    }
  }

  const write = await invokeWriteCodingFile(projectPath, path, applied.next)
  if (!write.ok) return write
  const modeNote =
    applied.mode === 'exact'
      ? replaceAll
        ? 'all matches'
        : 'first match'
      : applied.mode === 'whitespace-normalized'
        ? `whitespace-normalized ${replaceAll ? 'all matches' : 'first match'}`
        : `${applied.mode === 'crlf-expanded' ? 'CRLF-adjusted' : 'EOL-normalized'} ${replaceAll ? 'all matches' : 'first match'}`
  const lineNote = `lines ${applied.startLine}-${applied.endLine}`
  const diff = buildEditUnifiedDiff(
    before,
    applied.next,
    path,
    applied.startLine,
    applied.endLine,
  )
  return {
    ok: true,
    text: `Edited ${path} (${lineNote}, ${modeNote})\n${diff}`,
  }
}

export async function invokeSearchCodingFiles(
  projectPath: string,
  query: string,
  options?: { pathPrefix?: string; recentFiles?: string[] },
): Promise<CodingToolResult> {
  const fn = window.voidcast?.codingSearchFiles
  if (!fn) return missingBridgeResult('Search files')
  const res = await fn({
    projectPath,
    query,
    pathPrefix: options?.pathPrefix,
    recentFiles: options?.recentFiles,
  })
  if (!res.ok) return { ok: false, text: res.error || 'Search failed.' }
  return { ok: true, text: formatSearchResults(res.result) }
}

export async function invokeGlobCodingFiles(
  projectPath: string,
  options?: { pathPrefix?: string; extensions?: string[]; maxResults?: number },
): Promise<CodingToolResult> {
  const fn = window.voidcast?.codingGlobFiles
  if (!fn) return missingBridgeResult('Glob files')
  const res = await fn({
    projectPath,
    pathPrefix: options?.pathPrefix,
    extensions: options?.extensions,
    maxResults: options?.maxResults,
  })
  if (!res.ok) return { ok: false, text: res.error || 'Glob failed.' }
  if (res.paths.length === 0) return { ok: true, text: 'No matching files.' }
  return { ok: true, text: res.paths.join('\n') }
}

export async function invokeFindSymbols(
  projectPath: string,
  options: { path: string; query?: string; maxSymbols?: number },
): Promise<CodingToolResult> {
  const fn = window.voidcast?.codingFindSymbols
  if (!fn) return missingBridgeResult('Find symbols')
  const res = await fn({
    projectPath,
    path: options.path,
    query: options.query,
    maxSymbols: options.maxSymbols,
  })
  if (!res.ok) return { ok: false, text: res.error || 'find_symbols failed.' }
  // Query already applied during extraction; pass through for header annotation only.
  const text = formatSymbolsOutline(res.relPath, res.symbols as SymbolEntry[], res.fileLineCount, {
    query: options.query,
  })
  return { ok: true, text }
}

export async function invokeCodingGit(
  projectPath: string,
  options:
    | { mode: 'status' }
    | { mode: 'diff'; path?: string; staged?: boolean }
    | { mode: 'log'; logMaxCount?: number; logPath?: string }
    | { mode: 'show'; showRef?: string; showPath?: string }
    | { mode: 'stage'; path: string }
    | { mode: 'unstage'; path: string }
    | { mode: 'discard'; path: string; toHead?: boolean }
    | { mode: 'discardAll' }
    | { mode: 'stashList' }
    | {
        mode: 'stashPush'
        message?: string
        path?: string
        includeUntracked?: boolean
      }
    | { mode: 'stashPop'; stashRef?: string }
    | { mode: 'commit'; message: string; all?: boolean },
): Promise<CodingToolResult> {
  const fn = window.voidcast?.codingGit
  if (!fn) return missingBridgeResult('Git')
  const payload =
    options.mode === 'status'
      ? { projectPath, mode: 'status' as const }
      : options.mode === 'diff'
        ? {
            projectPath,
            mode: 'diff' as const,
            path: options.path,
            staged: options.staged,
          }
        : options.mode === 'log'
          ? {
              projectPath,
              mode: 'log' as const,
              logMaxCount: options.logMaxCount,
              logPath: options.logPath,
            }
          : options.mode === 'show'
            ? {
                projectPath,
                mode: 'show' as const,
                showRef: options.showRef,
                showPath: options.showPath,
              }
            : options.mode === 'commit'
              ? {
                  projectPath,
                  mode: 'commit' as const,
                  commitMessage: options.message,
                  commitAll: options.all === true,
                }
              : options.mode === 'discardAll'
                ? { projectPath, mode: 'discardAll' as const }
                : options.mode === 'stashList'
                  ? { projectPath, mode: 'stashList' as const }
                  : options.mode === 'stashPush'
                    ? {
                        projectPath,
                        mode: 'stashPush' as const,
                        stashMessage: options.message,
                        path: options.path,
                        stashIncludeUntracked: options.includeUntracked,
                      }
                    : options.mode === 'stashPop'
                      ? {
                          projectPath,
                          mode: 'stashPop' as const,
                          stashRef: options.stashRef,
                        }
                      : options.mode === 'discard'
                        ? {
                            projectPath,
                            mode: 'discard' as const,
                            path: options.path,
                            toHead: options.toHead,
                          }
                        : {
                            projectPath,
                            mode: options.mode,
                            path: options.path,
                          }
  const res = await fn(payload)
  return { ok: res.ok, text: res.ok ? res.text : res.error || 'Git command failed.' }
}

export async function invokeCheckCodingTypes(
  projectPath: string,
  options?: { pathPrefix?: string; paths?: string[] },
): Promise<CodingToolResult> {
  const fn = window.voidcast?.codingCheckTypes
  if (!fn) return missingBridgeResult('Check types')
  const res = await fn({
    projectPath,
    pathPrefix: options?.pathPrefix,
    paths: options?.paths,
  })
  return { ok: res.ok, text: res.ok ? res.text : res.error || 'Typecheck failed.' }
}

export async function invokeExecuteCodingCommand(
  projectPath: string,
  command: string,
  options?: { timeoutSec?: number; runInBackground?: boolean; ownerId?: string },
): Promise<CodingToolResult> {
  const fn = window.voidcast?.codingExecuteCommand
  if (!fn) return missingBridgeResult('Execute command')
  const res = await fn({
    projectPath,
    command,
    timeoutSec: options?.timeoutSec,
    runInBackground: options?.runInBackground,
    ownerId: options?.ownerId,
  })
  if (!res.ok) {
    const streamed = res.streamed === true
    markLastExecuteCommandStreamed(streamed)
    return {
      ok: false,
      text: res.error || 'Command failed.',
      streamed,
      runId: res.runId,
    }
  }
  const streamed = res.streamed === true
  markLastExecuteCommandStreamed(streamed)
  const output = [res.stdout, res.stderr].filter(Boolean).join('\n').trim() || '(no output)'
  return {
    ok: true,
    text: `$ ${command}\n${output}`,
    streamed,
    code: res.code,
    runId: res.runId,
  }
}
