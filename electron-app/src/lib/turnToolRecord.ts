import type { TurnToolUse, UiMessage } from '@/types/chat'

/**
 * Argument that names what a call read or searched, per tool. Their results never
 * reach the next turn, so without this the model only knows "web_search ×3" and
 * either repeats the search or cannot tell which page a claim came from.
 */
const SOURCE_ARGS: Record<string, readonly string[]> = {
  web_search: ['query'],
  search_youtube: ['video_url', 'query'],
  scrape_url: ['url'],
  browser_navigate_page: ['url'],
  browser_new_page: ['url'],
  mcp_call: ['name'],
  mcp_read_result: ['path'],
}

const MAX_SOURCES_PER_TOOL = 5
const MAX_SOURCE_CHARS = 120

function sourceOf(name: string, args: Record<string, unknown> | undefined): string {
  for (const key of SOURCE_ARGS[name] ?? []) {
    const v = args?.[key]
    if (typeof v !== 'string') continue
    const s = v.replace(/\s+/g, ' ').trim()
    if (s) return s.length > MAX_SOURCE_CHARS ? `${s.slice(0, MAX_SOURCE_CHARS - 1)}…` : s
  }
  return ''
}

/** Count one tool call into the turn's list, keeping first-call order. */
export function recordTurnToolUse(
  list: TurnToolUse[],
  name: string,
  result: string,
  args?: Record<string, unknown>,
): TurnToolUse[] {
  const failed = /^\s*error\b/i.test(result) ? 1 : 0
  // A failed call read nothing, so it is not a source.
  const source = failed ? '' : sourceOf(name, args)
  const i = list.findIndex((t) => t.name === name)
  const prev = i < 0 ? undefined : list[i]
  const sources = prev?.sources ?? []
  const nextSources =
    source && !sources.includes(source) && sources.length < MAX_SOURCES_PER_TOOL
      ? [...sources, source]
      : sources
  const entry: TurnToolUse = {
    name,
    calls: (prev?.calls ?? 0) + 1,
    failed: (prev?.failed ?? 0) + failed,
    ...(nextSources.length ? { sources: nextSources } : {}),
  }
  if (i < 0) return [...list, entry]
  const next = list.slice()
  next[i] = entry
  return next
}

type CodingEvidence = NonNullable<UiMessage['codingTurnEvidence']>

/**
 * App-written tool log appended to a prior assistant turn in the model history.
 * History otherwise carries only the reply text, so after a few turns the model
 * sees "user asks → assistant says done" with no tool calls and copies that.
 * Returns '' when the message has no record (older messages, no tools offered).
 */
export function formatTurnToolRecord(
  m: Pick<UiMessage, 'turnTools' | 'codingTurnEvidence'>,
): string {
  const tools = m.turnTools
  const ev = m.codingTurnEvidence
  if (!tools && !ev) return ''

  const parts: string[] = []
  if (tools) {
    parts.push(
      tools.length === 0
        ? 'No tools were called in this turn.'
        : `Tools called: ${tools.map(formatToolUse).join(', ')}.`,
    )
  }
  if (ev) parts.push(formatCodingPart(ev, Boolean(tools)))
  return `<tool_record>${parts.filter(Boolean).join(' ')}</tool_record>`
}

function formatToolUse(t: TurnToolUse): string {
  const count = t.calls > 1 ? ` ×${t.calls}` : ''
  const failed = t.failed > 0 ? ` (${t.failed} failed)` : ''
  const sources = t.sources?.length
    ? ` [${t.sources.map((s) => JSON.stringify(s)).join(', ')}]`
    : ''
  return `${t.name}${count}${failed}${sources}`
}

function formatCodingPart(ev: CodingEvidence, haveToolList: boolean): string {
  if (!ev.hadRepoAction) {
    // Messages from before turnTools only know about coding tools.
    if (haveToolList) return 'Nothing in the project changed.'
    return ev.hadAnyToolEvents
      ? 'Read-only coding tools only; nothing in the project changed.'
      : 'No coding tools were called; nothing in the project changed.'
  }
  const parts: string[] = []
  if (ev.filePaths?.length) parts.push(`files changed: ${ev.filePaths.join(', ')}`)
  if (ev.commandSummaries?.length) parts.push(`commands run: ${ev.commandSummaries.join(' | ')}`)
  if (ev.gitSummaries?.length) parts.push(`git: ${ev.gitSummaries.join(' | ')}`)
  return parts.length ? `Project: ${parts.join('; ')}.` : ''
}
