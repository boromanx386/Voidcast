import type { TurnToolUse, UiMessage } from '@/types/chat'

/** Count one tool call into the turn's list, keeping first-call order. */
export function recordTurnToolUse(
  list: TurnToolUse[],
  name: string,
  result: string,
): TurnToolUse[] {
  const failed = /^\s*error\b/i.test(result) ? 1 : 0
  const i = list.findIndex((t) => t.name === name)
  if (i < 0) return [...list, { name, calls: 1, failed }]
  const next = list.slice()
  next[i] = { name, calls: list[i].calls + 1, failed: list[i].failed + failed }
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
  return `${t.name}${count}${failed}`
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
