import type { CodingFileNode, CodingToolResult } from '@/types/coding'

function missingBridgeResult(action: string): CodingToolResult {
  return { ok: false, text: `${action} is available only in Electron desktop.` }
}

export async function invokePickCodingDirectory(): Promise<{ ok: true; path: string } | { ok: false }> {
  const fn = window.voidcast?.pickCodingDirectory
  if (!fn) return { ok: false }
  return fn()
}

export async function invokeListCodingDirectory(projectPath: string, path = ''): Promise<CodingFileNode[]> {
  const fn = window.voidcast?.codingListDirectory
  if (!fn) return []
  const res = await fn({ projectPath, path })
  if (!res.ok) return []
  return res.entries
}

export async function invokeReadCodingFile(projectPath: string, path: string): Promise<CodingToolResult> {
  const fn = window.voidcast?.codingReadFile
  if (!fn) return missingBridgeResult('Read file')
  const res = await fn({ projectPath, path })
  return { ok: res.ok, text: res.ok ? res.content : res.error || 'Read failed.' }
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
): Promise<CodingToolResult> {
  const read = await invokeReadCodingFile(projectPath, path)
  if (!read.ok) return read
  if (!findText) return { ok: false, text: 'find_text must not be empty.' }
  if (!read.text.includes(findText)) return { ok: false, text: 'Target snippet not found.' }
  const next = replaceAll ? read.text.split(findText).join(replaceText) : read.text.replace(findText, replaceText)
  const write = await invokeWriteCodingFile(projectPath, path, next)
  if (!write.ok) return write
  return { ok: true, text: `Edited ${path} (${replaceAll ? 'all matches' : 'first match'})` }
}

export async function invokeSearchCodingFiles(projectPath: string, query: string): Promise<CodingToolResult> {
  const fn = window.voidcast?.codingSearchFiles
  if (!fn) return missingBridgeResult('Search files')
  const res = await fn({ projectPath, query })
  if (!res.ok) return { ok: false, text: res.error || 'Search failed.' }
  if (res.matches.length === 0) return { ok: true, text: 'No matches.' }
  const lines = res.matches.map((m) => `${m.path}:${m.line}: ${m.text}`)
  return { ok: true, text: lines.join('\n') }
}

export async function invokeExecuteCodingCommand(
  projectPath: string,
  command: string,
  options?: { timeoutSec?: number; runInBackground?: boolean },
): Promise<CodingToolResult> {
  const fn = window.voidcast?.codingExecuteCommand
  if (!fn) return missingBridgeResult('Execute command')
  const res = await fn({
    projectPath,
    command,
    timeoutSec: options?.timeoutSec,
    runInBackground: options?.runInBackground,
  })
  if (!res.ok) return { ok: false, text: res.error || 'Command failed.' }
  const output = [res.stdout, res.stderr].filter(Boolean).join('\n').trim() || '(no output)'
  return { ok: true, text: `$ ${command}\n${output}` }
}
