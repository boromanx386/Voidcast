import type { AgentChatMode } from '@/types/chat'
import { isTeamChatMode } from '@/types/chat'
import type { ToolsEnabled } from '@/lib/settings'

const HTTP_URL_RE = /(https?:\/\/[^\s)]+)(?=[\s)]|$)/i

/** User explicitly asked to search the web. */
const EXPLICIT_WEB_SEARCH_RE =
  /\b(web\s+search|search\s+(?:the\s+)?web|google|check\s+online|look\s+up\s+online|pretraži\s+(?:web|internet)|potraži\s+online|na\s+internetu|na\s+webu)\b/i

/** News / current-events phrasing (not bare "update" or "current"). */
const NEWS_FRESHNESS_RE =
  /\b(breaking\s+news|latest\s+news|news\s+today|current\s+events|headlines?\s+today|vesti\s+danas|najnovije\s+vesti|šta\s+je\s+novo)\b/i

const TIME_SENSITIVE_RE =
  /\b(what(?:'s|\s+is)\s+(?:happening|new)\s+(?:today|now)|danas\s+(?:najnovije|vesti)|trenutno\s+stanje)\b/i

const SOFT_FRESHNESS_RE =
  /\b(check\s+online|na\s+internetu|danas|najnovije|trenutno|vesti)\b/i

/** Typical coding turn — do not auto-inject web_search on round 0 unless user asked for web/news. */
const CODING_TASK_RE =
  /\b(refactor|read_file|write_file|edit_code|execute_command|list_directory|search_files|glob_files|find_symbols|git_|fix\s+(?:the\s+)?bug|implement|codebase|repositor(?:y|ies)|\brepo\b|typescript|javascript|python|npm\s+install|cargo\s+)\b/i

export function parseToolArguments(
  raw: string | Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  const s = raw.trim()
  if (!s) return {}
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function getLastUserText<T extends { role?: string; content?: unknown }>(messages: T[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role === 'user') return String(m.content ?? '').trim()
  }
  return ''
}

export function pickFirstHttpUrl(text: string): string | null {
  const m = text.match(HTTP_URL_RE)
  return m?.[1]?.trim() || null
}

/**
 * Whether round-0 synthetic web_search is appropriate.
 * Uses only the user's typed message — not catalog/file hints appended to the API user blob.
 */
export function shouldForceWebSearch(
  rawUserText: string,
  opts?: { codingEnabled?: boolean },
): boolean {
  const t = rawUserText.trim()
  if (!t) return false

  const explicitWeb = EXPLICIT_WEB_SEARCH_RE.test(t)
  if (explicitWeb) return true
  if (NEWS_FRESHNESS_RE.test(t)) return true
  if (TIME_SENSITIVE_RE.test(t)) return true
  if (/\b20[2-3]\d\b/.test(t) && /\b(news|vesti|price|cena|release)\b/i.test(t)) return true
  if (SOFT_FRESHNESS_RE.test(t)) return true

  if (opts?.codingEnabled && CODING_TASK_RE.test(t) && !explicitWeb) {
    return false
  }

  return false
}

/** Search query from the user's message only (first line, no internal hints). */
export function deriveSearchQuery(rawUserText: string): string {
  const trimmed = rawUserText.trim()
  if (!trimmed) return ''
  const firstBlock = trimmed.split(/\n{2,}/)[0]?.trim() || trimmed
  const firstLine = firstBlock.split('\n')[0]?.trim() || firstBlock
  const noUrls = firstLine.replace(/https?:\/\/\S+/gi, ' ')
  const single = noUrls.replace(/\s+/g, ' ').trim()
  if (!single) return ''
  return single.length > 220 ? single.slice(0, 220).trim() : single
}

export function shouldForceWebSearchOnRoundZero(
  rawUserText: string,
  toolsEnabled: Pick<ToolsEnabled, 'webSearch' | 'coding'>,
): boolean {
  if (!toolsEnabled.webSearch) return false
  return shouldForceWebSearch(rawUserText, { codingEnabled: toolsEnabled.coding })
}

/** File mutations on disk (includes parallel workers). */
export const CODING_FILE_MUTATION_TOOLS = new Set([
  'write_file',
  'edit_code',
  'run_coding_workers',
])

/** Shell tools that can change repo state (commit, build, etc.). */
export const CODING_SHELL_TOOLS = new Set(['execute_command', 'stop_process'])

/** Git tools that mutate worktree/stash (not read-only git_status/diff). */
export const CODING_GIT_MUTATION_TOOLS = new Set(['git_restore', 'git_stash'])

/** Union used for loop repo-action tracking and legacy false-claim sets. */
export const CODING_REPO_ACTION_TOOLS = new Set([
  ...CODING_FILE_MUTATION_TOOLS,
  ...CODING_SHELL_TOOLS,
  ...CODING_GIT_MUTATION_TOOLS,
])

/** Agent or Team — modes that may mutate the coding project. */
export function isImplementAgentMode(mode: AgentChatMode | string | undefined | null): boolean {
  if (mode === 'agent') return true
  return isTeamChatMode(mode)
}

/** Successful execute_command results start with the echoed shell line. */
export function isSuccessfulExecuteCommandResult(result: string): boolean {
  return result.trim().startsWith('$ ')
}

/** Whether a completed tool call counts as a repo mutation for truth UI / wrap-up. */
export function isSuccessfulRepoActionTool(name: string, result: string): boolean {
  if (CODING_FILE_MUTATION_TOOLS.has(name)) {
    return !result.trim().startsWith('Error:')
  }
  if (name === 'execute_command') {
    return isSuccessfulExecuteCommandResult(result)
  }
  if (name === 'stop_process') {
    return result.trim().startsWith('Stopped process ')
  }
  if (name === 'git_restore') {
    return /^restored\b/i.test(result.trim())
  }
  if (name === 'git_stash') {
    const r = result.trim()
    if (r.startsWith('Error:')) return false
    if (/^Invalid stash ref/i.test(r)) return false
    if (/failed \(exit/i.test(r)) return false
    return true
  }
  return false
}

/**
 * Tools whose calls are read-only and can safely run concurrently within one
 * provider tool round. Unknown tools stay serial so newly added integrations
 * do not accidentally gain parallel side effects.
 */
export const PARALLEL_SAFE_AGENT_TOOLS: ReadonlySet<string> = new Set([
  'web_search',
  'get_weather',
  'scrape_url',
  'search_youtube',
  'list_directory',
  'read_file',
  'search_files',
  'glob_files',
  'find_symbols',
  'list_processes',
  'read_process_output',
  'list_reminders',
  'read_skill',
  'browser_take_snapshot',
  'browser_list_console_messages',
  'browser_list_network_requests',
  'mcp_read_result',
])

export function isParallelSafeAgentTool(name: string): boolean {
  return PARALLEL_SAFE_AGENT_TOOLS.has(name)
}

/** Soft nudge near the end of the tool-call budget (model-only). */
export const TOOL_BUDGET_WARNING_REPROMPT_MESSAGE = [
  '[Internal — not for the user] You are nearing the tool-call budget for this turn.',
  'Prefer finishing soon: only essential remaining tool calls, then give the user a clear final answer without more tools.',
  'Do not mention this budget warning in the user-visible reply.',
].join(' ')

/** Hard wrap-up after the tool budget is exhausted (model-only). */
export const TOOL_BUDGET_EXHAUSTED_REPROMPT_MESSAGE = [
  '[Internal — not for the user] The tool-call budget for this turn is exhausted. Do NOT call any more tools.',
  'Write a final user-visible reply now: what you completed, what is still incomplete, and one concrete next step for the user.',
  'Do not apologize at length about limits; keep it practical and grounded in tool results already received.',
].join(' ')

export const TOOL_BUDGET_EXHAUSTED_FALLBACK_REPLY =
  'Stopped: tool-call budget reached this turn before a final answer. Tell me to continue and I will pick up from here.'

/** When wrap-up would let the model claim repo work without tool evidence. */
export const TOOL_BUDGET_NO_REPO_ACTION_FALLBACK_REPLY =
  'Stopped: tool-call budget reached. No files, shell commands, or git mutations succeeded this turn — tell me to continue if more work is needed.'
