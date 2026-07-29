/**
 * Coding sub-agent — context management for coding tool results + read-only explore.
 *
 * Standard layering (Claude Code / OpenAI ToolOutputTrimmer / Cursor subagents):
 * 1. Deterministic head+tail trim of noisy outputs in the current turn (no LLM).
 * 2. Clearing of old, re-fetchable tool results from prior rounds (placeholder).
 * 3. Isolation of broad discovery in the coding_explore nested loop (digest only).
 * Exact source (read_file, git_diff) always reaches the main model untouched.
 */

import type { SubAgentConfig } from '@/lib/settings'
import { subAgentConfigForRole } from '@/lib/settings'
import {
  callSubAgentChat,
  type SubAgentKeys,
  type SubAgentUiCallbacks,
} from '@/lib/subAgent'

// ── Layer 1: deterministic trim of noisy outputs (current turn) ──────────

export const CODING_TRIM_THRESHOLD = 8_000
export const CODING_TRIM_HEAD_CHARS = 4_500
export const CODING_TRIM_TAIL_CHARS = 2_500

/** Noisy / high-volume tools only — never read_file (main agent needs exact source). */
export const CODING_TRIM_TOOLS = new Set([
  'execute_command',
  'git_log',
  'search_files',
  'check_types',
])

export const CODING_EXPLORE_ALLOWED_TOOLS = new Set([
  'list_directory',
  'read_file',
  'search_files',
  'glob_files',
  'find_symbols',
  'git_status',
  'git_diff',
  'git_log',
  'git_show',
  'check_types',
  'list_processes',
  'read_process_output',
])

export const CODING_EXPLORE_DEFAULT_ROUNDS = 8
export const CODING_EXPLORE_MAX_ROUNDS = 12
export const CODING_EXPLORE_READ_BUDGET = 48_000

export function shouldTrimCodingResult(
  name: string,
  raw: string,
  enabled: boolean,
): boolean {
  if (!enabled) return false
  if (!CODING_TRIM_TOOLS.has(name)) return false
  return raw.length > CODING_TRIM_THRESHOLD
}

/**
 * Deterministic head+tail trim (no LLM). Head keeps the command/context;
 * tail keeps errors and exit status, which usually appear at the end.
 */
export function trimNoisyCodingResult(raw: string): string {
  if (raw.length <= CODING_TRIM_THRESHOLD) return raw
  const head = raw.slice(0, CODING_TRIM_HEAD_CHARS)
  const tail = raw.slice(-CODING_TRIM_TAIL_CHARS)
  const omitted = raw.length - CODING_TRIM_HEAD_CHARS - CODING_TRIM_TAIL_CHARS
  return `${head}\n\n… [${omitted.toLocaleString()} chars omitted — noisy output trimmed; narrow the command/search or re-run if the middle matters] …\n\n${tail}`
}

// ── Layer 2: clearing of old, re-fetchable tool results ──────────────────

export const CODING_CLEAR_MIN_CHARS = 2_000
/** Default: keep last 4 rounds of clearable tools full (was 2 — caused thrashing). */
export const CODING_CLEAR_KEEP_RECENT_ROUNDS = 4
/** Keep read_file / find_symbols longer — these are the working set for edits. */
export const CODING_CLEAR_KEEP_READ_ROUNDS = 8
/** Always pin the last N read_file results full regardless of round age. */
export const CODING_PIN_RECENT_READS = 3
/** Always pin the last N find_symbols outlines (cheap + high reuse). */
export const CODING_PIN_RECENT_OUTLINES = 2

export const CODING_CLEAR_KEEP_RECENT_ROUNDS_BY_TOOL: Record<string, number> = {
  read_file: CODING_CLEAR_KEEP_READ_ROUNDS,
  find_symbols: CODING_CLEAR_KEEP_READ_ROUNDS,
}

export const CODING_PIN_RECENT_BY_TOOL: Record<string, number> = {
  read_file: CODING_PIN_RECENT_READS,
  find_symbols: CODING_PIN_RECENT_OUTLINES,
}

/** Re-fetchable coding results — safe to clear from old rounds (agent can re-run). */
export const CODING_CLEARABLE_TOOLS = new Set([
  'read_file',
  'list_directory',
  'search_files',
  'glob_files',
  'find_symbols',
  'git_status',
  'git_diff',
  'git_log',
  'git_show',
  'check_types',
  'execute_command',
  'list_processes',
  'read_process_output',
])

export function isClearableCodingToolResult(name: string): boolean {
  return CODING_CLEARABLE_TOOLS.has(name)
}

/**
 * Whether an old tool-result record should be replaced with a digest placeholder.
 * Keeps recent rounds (per-tool override) and pins the last N of read-heavy tools.
 */
export function shouldEvictOldToolResult(params: {
  rec: { index: number; round: number; name: string }
  currentRound: number
  keepRecentRounds: number
  keepRecentRoundsByTool?: Record<string, number>
  pinRecentByTool?: Record<string, number>
  allRecords: Array<{ index: number; round: number; name: string }>
}): boolean {
  const keepRounds =
    params.keepRecentRoundsByTool?.[params.rec.name] ?? params.keepRecentRounds
  if (params.rec.round >= params.currentRound - keepRounds) return false

  const pinN = params.pinRecentByTool?.[params.rec.name] ?? 0
  if (pinN > 0) {
    const sameTool = [...params.allRecords]
      .filter((r) => r.name === params.rec.name)
      .sort((a, b) => b.round - a.round || b.index - a.index)
    const rank = sameTool.findIndex((r) => r.index === params.rec.index)
    if (rank >= 0 && rank < pinN) return false
  }
  return true
}

export const CODING_CLEAR_DIGEST_MAX = 560

const READ_FILE_SYMBOL_RE =
  /^(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)|^(?:export\s+default\s+(?:async\s+)?function\s+(\w+))|^ipcMain\.handle\(\s*['"]([^'"]+)/

function stripNumberedLine(line: string): { lineNo: number | null; text: string } {
  const m = line.match(/^(\d+)\|(.*)$/)
  if (m) return { lineNo: Number(m[1]), text: m[2] ?? '' }
  return { lineNo: null, text: line }
}

function digestReadFile(content: string): string {
  const lines = content.split(/\r?\n/)
  const bodyLines = lines.filter((l) => !l.startsWith('[Note:') && l.trim() !== '')
  const symbols: string[] = []
  for (const raw of bodyLines) {
    if (symbols.length >= 8) break
    const { lineNo, text } = stripNumberedLine(raw)
    const trimmed = text.trim()
    const m = trimmed.match(READ_FILE_SYMBOL_RE)
    if (!m) continue
    const name = m[1] || m[2] || m[3]
    if (!name) continue
    const loc = lineNo != null ? `L${lineNo}` : '?'
    symbols.push(`${name}(${loc})`)
  }
  const lineCount = bodyLines.length
  const symbolPart = symbols.length ? `: ${symbols.join('; ')}` : ''
  return `read_file [${lineCount} lines]${symbolPart}`
}

function digestPathList(content: string, label: string, maxPaths = 40): string {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0) return `${label}: (empty)`
  const shown = lines.slice(0, maxPaths)
  const more = lines.length > maxPaths ? `; …+${lines.length - maxPaths} more` : ''
  return `${label} [${lines.length}]: ${shown.join(', ')}${more}`
}

function digestSearchFiles(content: string): string {
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const files: string[] = []
  for (const line of lines) {
    // Blocks often start with path:line or "## path" / bare path headers
    const pathHit =
      line.match(/^(?:##\s+)?([^\s:]+\.[a-zA-Z0-9]+)(?::\d+)?/) ||
      line.match(/^([^\s]+\.[a-zA-Z0-9]+)\s*\(/)
    if (pathHit) {
      const p = pathHit[1]!
      if (!files.includes(p)) files.push(p)
    }
    if (files.length >= 12) break
  }
  const head = lines[0]?.slice(0, 80) ?? ''
  const filePart = files.length ? ` hits: ${files.join(', ')}` : ''
  return `search_files${head ? ` (${head})` : ''}${filePart}`
}

function digestHeadTail(label: string, content: string): string {
  const lines = content.split(/\r?\n/).map((l) => l.trimEnd())
  const nonempty = lines.filter((l) => l.trim())
  if (nonempty.length === 0) return `${label}: (empty)`
  const first = nonempty[0]!.slice(0, 120)
  const last = nonempty.slice(-3).map((l) => l.slice(0, 100))
  const lastPart = last.length > 1 || last[0] !== first ? ` → ${last.join(' | ')}` : ''
  return `${label}: ${first}${lastPart}`
}

/** Compact structural digest left behind when an old tool result is cleared. */
function digestFindSymbols(c: string): string {
  const lines = c.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length === 0) return 'find_symbols: (empty)'
  // First line is the header: "find_symbols: relPath (N lines, M symbols)"
  const header = stripNumberedLine(lines[0]!).text
  const symLines = lines.slice(1)
  const out: string[] = [header]
  const shown = symLines.slice(0, 4)
  for (const l of shown) {
    const m = /^\s*(\d+)\s+(\S+)\s+(\S+)/.exec(l)
    if (m) out.push(`${m[1]} ${m[2]} ${m[3]}`)
    else out.push(stripNumberedLine(l).text)
  }
  if (symLines.length > shown.length) {
    out.push(`… (+${symLines.length - shown.length} more)`)
  }
  return out.join(' | ')
}

export function buildClearedToolDigest(name: string, content: string): string {
  const c = content.trim()
  if (!c) return `${name}: (empty)`
  let body: string
  switch (name) {
    case 'read_file':
      body = digestReadFile(c)
      break
    case 'list_directory':
      body = digestPathList(c, 'list_directory')
      break
    case 'glob_files':
      body = digestPathList(c, 'glob_files')
      break
    case 'find_symbols':
      body = digestFindSymbols(c)
      break
    case 'search_files':
      body = digestSearchFiles(c)
      break
    case 'git_status':
    case 'git_diff':
    case 'git_log':
    case 'git_show':
    case 'check_types':
    case 'execute_command':
    case 'list_processes':
    case 'read_process_output':
      body = digestHeadTail(name, c)
      break
    default:
      body = digestHeadTail(name, c)
  }
  if (body.length > CODING_CLEAR_DIGEST_MAX) {
    return `${body.slice(0, CODING_CLEAR_DIGEST_MAX - 1)}…`
  }
  return body
}

export function clearedCodingToolResultPlaceholder(
  name: string,
  chars: number,
  content = '',
): string {
  const digest = content ? buildClearedToolDigest(name, content) : ''
  const digestLine = digest ? `\nDigest: ${digest}` : ''
  const reuseHint =
    name === 'read_file' || name === 'find_symbols'
      ? ' Prefer the Digest below — only re-read if you need exact lines for edit_code or the digest is insufficient.'
      : ' Call the tool again only if you still need the full result.'
  return `[Old ${name} result (${chars.toLocaleString()} chars) cleared to save context.${reuseHint}]${digestLine}`
}

export function isCodingExploreAllowedTool(name: string): boolean {
  return CODING_EXPLORE_ALLOWED_TOOLS.has(name)
}

export function clampExploreMaxRounds(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return CODING_EXPLORE_DEFAULT_ROUNDS
  return Math.max(1, Math.min(CODING_EXPLORE_MAX_ROUNDS, Math.round(raw)))
}

export type CodingExploreToolCall = {
  tool: string
  args: Record<string, unknown>
}

export type CodingExploreModelAction =
  | { kind: 'tool'; call: CodingExploreToolCall }
  | { kind: 'done'; digest: string }
  | { kind: 'invalid'; raw: string }

/** Parse one explore turn: JSON tool call or final digest. */
export function parseCodingExploreAction(raw: string): CodingExploreModelAction {
  const text = raw.trim()
  if (!text) return { kind: 'invalid', raw: '' }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  const candidate = fenced || text

  const tryParse = (s: string): unknown | null => {
    try {
      return JSON.parse(s) as unknown
    } catch {
      return null
    }
  }

  let parsed = tryParse(candidate)
  if (!parsed) {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) {
      parsed = tryParse(candidate.slice(start, end + 1))
    }
  }

  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>
    // Prefer tool calls over digest — models sometimes include both fields.
    const tool =
      typeof o.tool === 'string'
        ? o.tool.trim()
        : typeof o.name === 'string'
          ? o.name.trim()
          : ''
    if (tool) {
      const args =
        o.args && typeof o.args === 'object' && !Array.isArray(o.args)
          ? (o.args as Record<string, unknown>)
          : o.arguments && typeof o.arguments === 'object' && !Array.isArray(o.arguments)
            ? (o.arguments as Record<string, unknown>)
            : {}
      return { kind: 'tool', call: { tool, args } }
    }
    if (o.done === true || typeof o.digest === 'string' || typeof o.summary === 'string') {
      const digest =
        typeof o.digest === 'string' && o.digest.trim()
          ? o.digest.trim()
          : typeof o.summary === 'string'
            ? o.summary.trim()
            : text
      return { kind: 'done', digest: digest || text }
    }
  }

  // Heuristic: long non-JSON reply treated as final digest
  if (!text.startsWith('{') && text.length > 80) {
    return { kind: 'done', digest: text }
  }
  return { kind: 'invalid', raw: text }
}

function exploreSystemPrompt(pathPrefix: string, recentFiles: string[]): string {
  const tools = [...CODING_EXPLORE_ALLOWED_TOOLS].join(', ')
  const prefixLine = pathPrefix
    ? `Prefer scoping to path_prefix "${pathPrefix}" when calling search/glob/list.`
    : 'Stay inside the coding project root.'
  const recent =
    recentFiles.length > 0
      ? `Recently touched files: ${recentFiles.slice(0, 8).join(', ')}.`
      : 'No recent files yet.'
  return `You are a read-only coding explore sub-agent. Investigate the codebase to answer the goal.
Allowed tools only: ${tools}.
Never write, edit, or execute shell commands.

Each turn reply with ONE JSON object only:
- Tool call: {"tool":"<name>","args":{...}}
- Finished: {"done":true,"digest":"<compact findings: paths, APIs, suggested next edits>"}

${prefixLine}
${recent}
Keep digests under 2000 characters. Prefer search_files/glob_files before reading whole files.`
}

export async function runCodingExplore(opts: {
  goal: string
  pathPrefix?: string
  maxRounds?: number
  recentFiles?: string[]
  config: SubAgentConfig
  keys: SubAgentKeys
  signal?: AbortSignal
  ui?: SubAgentUiCallbacks
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>
}): Promise<string> {
  const goal = opts.goal.trim()
  if (!goal) return 'Error: missing goal for coding_explore.'

  const codingConfig = subAgentConfigForRole(opts.config, 'coding')
  const maxRounds = clampExploreMaxRounds(opts.maxRounds)
  const pathPrefix = (opts.pathPrefix || '').trim()
  const recentFiles = opts.recentFiles ?? []
  let readBudget = CODING_EXPLORE_READ_BUDGET
  const notes: string[] = []

  opts.ui?.onCodingStart?.(`SUB_AGENT · EXPLORE (0/${maxRounds})`)

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: exploreSystemPrompt(pathPrefix, recentFiles) },
    {
      role: 'user',
      content: `Goal: ${goal}${pathPrefix ? `\nPath prefix hint: ${pathPrefix}` : ''}\n\nStart exploring. Reply with JSON only.`,
    },
  ]

  try {
    for (let round = 0; round < maxRounds; round++) {
      if (opts.signal?.aborted) {
        const digest = `[Coding explore]\nAborted.${notes.length ? ` (${notes.join(' ')})` : ''}`
        opts.ui?.onCodingDone?.(digest)
        return digest
      }
      opts.ui?.onCodingStart?.(`SUB_AGENT · EXPLORE (${round + 1}/${maxRounds})`)

      const reply = await callSubAgentChat({
        messages,
        config: codingConfig,
        keys: opts.keys,
        signal: opts.signal,
        maxTokens: Math.min(opts.config.outputTokens ?? 1024, 2048),
      })
      messages.push({ role: 'assistant', content: reply })

      const action = parseCodingExploreAction(reply)
      if (action.kind === 'done') {
        const digest = `[Coding explore]\n${action.digest}`
        opts.ui?.onCodingDone?.(digest)
        return digest
      }
      if (action.kind === 'invalid') {
        messages.push({
          role: 'user',
          content:
            'Invalid reply. Respond with either {"tool":"...","args":{...}} or {"done":true,"digest":"..."}.',
        })
        continue
      }

      const { tool, args } = action.call
      if (!isCodingExploreAllowedTool(tool)) {
        messages.push({
          role: 'user',
          content: `Error: tool "${tool}" is not allowed in coding_explore. Allowed: ${[...CODING_EXPLORE_ALLOWED_TOOLS].join(', ')}.`,
        })
        continue
      }

      if (tool === 'read_file' && readBudget <= 0) {
        notes.push('Read budget exhausted.')
        messages.push({
          role: 'user',
          content:
            'Error: nested read_file character budget exhausted. Finish with {"done":true,"digest":"..."}.',
        })
        continue
      }

      // Apply path_prefix hint for search/glob when not set
      const execArgs = { ...args }
      if (
        pathPrefix &&
        (tool === 'search_files' || tool === 'glob_files' || tool === 'list_directory') &&
        typeof execArgs.path_prefix !== 'string' &&
        (tool === 'list_directory' ? typeof execArgs.path !== 'string' : true)
      ) {
        if (tool === 'list_directory' && !execArgs.path) {
          execArgs.path = pathPrefix
        } else if (tool !== 'list_directory' && !execArgs.path_prefix) {
          execArgs.path_prefix = pathPrefix
        }
      }

      let result = await opts.executeTool(tool, execArgs)
      if (tool === 'read_file') {
        if (result.length > readBudget) {
          result = `${result.slice(0, readBudget)}\n…[truncated for explore budget]`
          readBudget = 0
        } else {
          readBudget -= result.length
        }
      }

      // Cap tool result size in explore conversation
      const forModel =
        result.length > 12_000
          ? `${result.slice(0, 12_000)}\n…[truncated for explore context]`
          : result
      messages.push({
        role: 'user',
        content: `Tool result (${tool}):\n${forModel}\n\nContinue: another tool JSON or {"done":true,"digest":"..."}.`,
      })
    }

    if (opts.signal?.aborted) {
      const digest = `[Coding explore]\nAborted.${notes.length ? ` (${notes.join(' ')})` : ''}`
      opts.ui?.onCodingDone?.(digest)
      return digest
    }

    // Force a final digest if rounds exhausted
    messages.push({
      role: 'user',
      content:
        'Max explore rounds reached. Reply with {"done":true,"digest":"..."} summarizing what you found.',
    })
    const finalReply = await callSubAgentChat({
      messages,
      config: codingConfig,
      keys: opts.keys,
      signal: opts.signal,
      maxTokens: Math.min(opts.config.outputTokens ?? 1024, 2048),
    })
    const action = parseCodingExploreAction(finalReply)
    const body =
      action.kind === 'done'
        ? action.digest
        : finalReply.trim() || 'Explore finished without a structured digest.'
    const noteLine = notes.length ? `\n(${notes.join(' ')})` : ''
    const digest = `[Coding explore]\n${body}${noteLine}`
    opts.ui?.onCodingDone?.(digest)
    return digest
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const isAbort =
      opts.signal?.aborted ||
      (e instanceof Error && (e.name === 'AbortError' || /abort/i.test(e.message)))
    const formatted = isAbort
      ? `[Coding explore]\nAborted.`
      : `[Coding explore]\nError: ${msg}`
    opts.ui?.onCodingDone?.(formatted)
    return formatted
  }
}
