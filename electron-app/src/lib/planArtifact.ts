import { isCodingToolFailure } from '@/lib/codingContextMemo'
import type { PlanApproach, PlanArtifact, PlanStep, UiMessage } from '@/types/chat'

let planStepSeq = 0

export function newPlanStepId(): string {
  planStepSeq += 1
  return `ps-${Date.now().toString(36)}-${planStepSeq}`
}

export function createPlanStep(text: string, done = false): PlanStep {
  return { id: newPlanStepId(), text: text.trim(), done }
}

/** System hint appended in Plan mode — explore read-only, end with JSON plan fence. */
export const PLAN_MODE_SYSTEM_HINT = [
  'You are in PLAN mode (read-only). Explore the codebase or web with available tools, but do NOT implement changes, write files, run shell commands, generate media, or mutate settings/reminders.',
  'When coding_explore is available, prefer it for broad codebase mapping before drafting the plan.',
  'After enough exploration, end with a structured plan. Default to ONE flat plan (no approaches) when the path is clear.',
  'Offer approaches only when there are real tradeoffs (e.g. speed vs safety vs scope). Prefer 2 distinct options; add a 3rd only if it is meaningfully different — never pad with filler. Optionally add a 4th (D) only when warranted.',
  'End your reply with a fenced JSON block tagged `json plan`. Preferred shapes:',
  '',
  'Flat plan (most tasks):',
  '```json plan',
  '{',
  '  "title": "Short plan title",',
  '  "summary": "Optional 1-3 sentence overview",',
  '  "steps": ["Step 1…", "Step 2…"]',
  '}',
  '```',
  '',
  'When tradeoffs matter (2 approaches — add C/D only if needed):',
  '```json plan',
  '{',
  '  "title": "Short plan title",',
  '  "summary": "Optional overview of the decision",',
  '  "approaches": [',
  '    { "id": "A", "label": "Short name", "summary": "Tradeoff in one line", "steps": ["Step 1…", "Step 2…"] },',
  '    { "id": "B", "label": "…", "summary": "…", "steps": ["…"] }',
  '  ],',
  '  "recommended": "A"',
  '}',
  '```',
  'Each approach must have actionable ordered steps. Do not claim work was already done.',
  'If the user asks to revise with their own idea, adapt the plan to that preference and emit a fresh json plan fence (flat or approaches as appropriate).',
].join('\n')

type RawPlanJson = {
  title?: unknown
  summary?: unknown
  steps?: unknown
  approaches?: unknown
  recommended?: unknown
}

function stepsFromUnknown(steps: unknown): string[] {
  if (!Array.isArray(steps)) return []
  return steps
    .map((s) => {
      if (typeof s === 'string') return s.trim()
      if (s && typeof s === 'object' && typeof (s as { text?: unknown }).text === 'string') {
        return String((s as { text: string }).text).trim()
      }
      return ''
    })
    .filter(Boolean)
}

function approachesFromUnknown(raw: unknown): PlanApproach[] {
  if (!Array.isArray(raw)) return []
  const out: PlanApproach[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const idRaw = typeof o.id === 'string' ? o.id.trim().toUpperCase() : ''
    const id = /^[A-D]$/.test(idRaw)
      ? idRaw
      : String.fromCharCode(65 + out.length) // A, B, C…
    if (id < 'A' || id > 'D') continue
    if (out.some((a) => a.id === id)) continue
    const label =
      (typeof o.label === 'string' && o.label.trim()) ||
      (typeof o.name === 'string' && o.name.trim()) ||
      `Approach ${id}`
    const summary =
      typeof o.summary === 'string' && o.summary.trim() ? o.summary.trim() : undefined
    const stepTexts = stepsFromUnknown(o.steps)
    if (stepTexts.length === 0) continue
    out.push({
      id,
      label,
      ...(summary ? { summary } : {}),
      steps: stepTexts.map((t) => createPlanStep(t)),
    })
  }
  return out.slice(0, 4)
}

export function planArtifactFromParts(
  title: string,
  steps: string[],
  summary?: string,
  status: PlanArtifact['status'] = 'draft',
  approaches?: PlanApproach[],
  selectedApproachId?: string,
): PlanArtifact {
  const cleanSteps = steps.map((t) => t.trim()).filter(Boolean)
  return {
    title: title.trim() || 'Plan',
    ...(summary?.trim() ? { summary: summary.trim() } : {}),
    steps: (cleanSteps.length > 0 ? cleanSteps : ['Review and implement the request']).map((t) =>
      createPlanStep(t),
    ),
    status,
    ...(approaches && approaches.length > 0 ? { approaches } : {}),
    ...(selectedApproachId ? { selectedApproachId } : {}),
  }
}

/** Apply a chosen approach onto the plan (copies its steps). */
export function selectPlanApproach(plan: PlanArtifact, approachId: string): PlanArtifact {
  const approach = plan.approaches?.find((a) => a.id === approachId)
  if (!approach) return plan
  return {
    ...plan,
    selectedApproachId: approach.id,
    steps: approach.steps.map((s) => createPlanStep(s.text, s.done === true)),
    ...(approach.summary?.trim()
      ? { summary: approach.summary.trim() }
      : plan.summary
        ? { summary: plan.summary }
        : {}),
  }
}

/** Extract ```json plan ... ``` or ```json ... ``` with title/steps. */
export function parsePlanJsonFromText(text: string): PlanArtifact | null {
  const fenced = /```(?:json\s*plan|plan\s*json|json)\s*\r?\n([\s\S]*?)```/gi
  let match: RegExpExecArray | null
  const candidates: string[] = []
  while ((match = fenced.exec(text)) !== null) {
    candidates.push(match[1] ?? '')
  }
  for (const raw of [...candidates].reverse()) {
    try {
      const parsed = JSON.parse(raw.trim()) as RawPlanJson
      const approaches = approachesFromUnknown(parsed.approaches)
      const stepTexts = stepsFromUnknown(parsed.steps)
      if (approaches.length === 0 && stepTexts.length === 0) continue

      const title =
        typeof parsed.title === 'string' && parsed.title.trim()
          ? parsed.title.trim()
          : 'Plan'
      const summary =
        typeof parsed.summary === 'string' && parsed.summary.trim()
          ? parsed.summary.trim()
          : undefined

      if (approaches.length > 0) {
        const recommendedRaw =
          typeof parsed.recommended === 'string' ? parsed.recommended.trim().toUpperCase() : ''
        const recommended =
          approaches.find((a) => a.id === recommendedRaw)?.id ?? approaches[0]?.id
        const selected = approaches.find((a) => a.id === recommended) ?? approaches[0]!
        return {
          title,
          ...(summary ? { summary } : {}),
          approaches,
          selectedApproachId: selected.id,
          steps: selected.steps.map((s) => createPlanStep(s.text)),
          status: 'draft',
        }
      }

      return planArtifactFromParts(title, stepTexts, summary)
    } catch {
      // try next
    }
  }
  return null
}

/** Parse markdown checklist / numbered / bulleted steps. */
export function parsePlanChecklistFromText(text: string): PlanArtifact | null {
  const lines = text.split(/\r?\n/)
  const steps: string[] = []
  let title = ''

  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)\s*$/)
    if (heading && !title) {
      title = heading[1].trim()
      continue
    }
    const check = line.match(/^\s*[-*+]\s+\[(?: |x|X)\]\s+(.+)\s*$/)
    if (check) {
      steps.push(check[1].trim())
      continue
    }
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)\s*$/)
    if (numbered) {
      steps.push(numbered[1].trim())
      continue
    }
    const bullet = line.match(/^\s*[-*+]\s+(.+)\s*$/)
    if (bullet && steps.length > 0) {
      steps.push(bullet[1].trim())
    } else if (bullet && /^(step|implement|add|fix|update|create|refactor)\b/i.test(bullet[1])) {
      steps.push(bullet[1].trim())
    }
  }

  if (steps.length === 0) return null
  return planArtifactFromParts(title || 'Plan', steps)
}

/**
 * Build a PlanArtifact from a finished Plan-mode assistant reply.
 * Prefer JSON plan fence → checklist. Returns null for plain prose
 * (clarifying questions should not get an Approve & Build card).
 */
export function extractPlanArtifactFromReply(reply: string): PlanArtifact | null {
  const trimmed = reply.trim()
  if (!trimmed) return null
  const fromJson = parsePlanJsonFromText(trimmed)
  if (fromJson) return fromJson
  const fromList = parsePlanChecklistFromText(trimmed)
  if (fromList) return fromList
  return null
}

/** Strip the trailing json plan fence from display content (card shows the structure). */
export function stripPlanJsonFenceFromContent(text: string): string {
  return text
    .replace(/```(?:json\s*plan|plan\s*json|json)\s*\r?\n[\s\S]*?```\s*$/i, '')
    .trimEnd()
}

export function formatPlanForBuildPrompt(plan: PlanArtifact): string {
  const lines = [
    'Build the approved plan. Implement it with the available tools. Do not ask for another plan unless blocked.',
    'When you finish a step, call update_plan_progress with that step_id (or 1-based step_index) before moving on. The UI only checks steps when you call this tool — file edits alone do not advance the checklist.',
    '',
    `Title: ${plan.title}`,
  ]
  if (plan.selectedApproachId && plan.approaches?.length) {
    const a = plan.approaches.find((x) => x.id === plan.selectedApproachId)
    if (a) {
      lines.push(`Chosen approach: ${a.id} — ${a.label}`)
      if (a.summary?.trim()) lines.push(`Approach notes: ${a.summary.trim()}`)
    }
  }
  if (plan.summary?.trim()) {
    lines.push(`Summary: ${plan.summary.trim()}`)
  }
  lines.push('Steps:')
  plan.steps.forEach((s, i) => {
    const flag = s.done ? ' [done]' : ''
    lines.push(`${i + 1}. [id=${s.id}]${flag} ${s.text}`)
  })
  return lines.join('\n')
}

/** Prompt for Plan-mode revise when the user supplies their own approach. */
export function formatPlanForRevisePrompt(plan: PlanArtifact, customNote: string): string {
  const note = customNote.trim()
  const lines = [
    'Revise the plan below to match my preferred approach. Stay in Plan mode (read-only) — do not implement yet.',
    'Emit a fresh ```json plan fence with an updated title/summary/steps (and approaches only if real tradeoffs remain).',
    '',
    `My preferred approach: ${note}`,
    '',
    `Current title: ${plan.title}`,
  ]
  if (plan.selectedApproachId && plan.approaches?.length) {
    const a = plan.approaches.find((x) => x.id === plan.selectedApproachId)
    if (a) {
      lines.push(`Previously selected: ${a.id} — ${a.label}`)
      if (a.summary?.trim()) lines.push(`Previous approach notes: ${a.summary.trim()}`)
    }
  }
  if (plan.approaches?.length) {
    lines.push('Previous approaches:')
    for (const a of plan.approaches) {
      lines.push(`- ${a.id}: ${a.label}${a.summary?.trim() ? ` (${a.summary.trim()})` : ''}`)
    }
  }
  if (plan.summary?.trim()) {
    lines.push(`Previous summary: ${plan.summary.trim()}`)
  }
  lines.push('Previous steps:')
  plan.steps.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.text}`)
  })
  return lines.join('\n')
}

/** Tools that used to auto-advance steps heuristically (kept for tests / legacy). Prefer update_plan_progress. */
export const PLAN_PROGRESS_TOOLS = new Set([
  'write_file',
  'edit_code',
  'execute_command',
])

export function isPlanProgressToolResult(name: string, result: string): boolean {
  if (!PLAN_PROGRESS_TOOLS.has(name)) return false
  const r = result.trim()
  if (!r) return false
  return !isCodingToolFailure(name, result)
}

function collectNumberList(raw: unknown): number[] {
  if (typeof raw === 'number' && Number.isFinite(raw)) return [raw]
  if (!Array.isArray(raw)) return []
  return raw.filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
}

function collectStringList(raw: unknown): string[] {
  if (typeof raw === 'string' && raw.trim()) return [raw.trim()]
  if (!Array.isArray(raw)) return []
  return raw
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
}

/** Apply update_plan_progress tool args onto a plan checklist. */
export function applyPlanProgressUpdate(
  plan: PlanArtifact,
  args: Record<string, unknown>,
): { plan: PlanArtifact; matched: number; error?: string } {
  const statusRaw = typeof args.status === 'string' ? args.status.trim().toLowerCase() : 'done'
  const done = !(statusRaw === 'pending' || statusRaw === 'undone' || statusRaw === 'open')

  const ids = new Set<string>([
    ...collectStringList(args.step_ids),
    ...collectStringList(args.step_id),
  ])
  const indexes = new Set<number>([
    ...collectNumberList(args.step_indexes),
    ...collectNumberList(args.step_index),
  ])

  if (ids.size === 0 && indexes.size === 0) {
    return {
      plan,
      matched: 0,
      error: 'Provide step_ids and/or step_indexes (1-based).',
    }
  }

  let matched = 0
  const steps = plan.steps.map((s, i) => {
    const hit = ids.has(s.id) || indexes.has(i + 1)
    if (!hit) return s
    matched += 1
    return { ...s, done }
  })

  if (matched === 0) {
    return {
      plan,
      matched: 0,
      error: 'No matching plan steps for the given ids/indexes.',
    }
  }

  return { plan: { ...plan, steps }, matched }
}

/** Format executeToolCall result for update_plan_progress. */
export function formatPlanProgressToolResult(
  plan: PlanArtifact | undefined,
  args: Record<string, unknown>,
): string {
  if (!plan) {
    return 'Error: no active approved plan to update. Progress updates apply during Approve & Build.'
  }
  const { plan: next, matched, error } = applyPlanProgressUpdate(plan, args)
  if (error) return `Error: ${error}`
  const statusRaw = typeof args.status === 'string' ? args.status.trim().toLowerCase() : 'done'
  const done = !(statusRaw === 'pending' || statusRaw === 'undone' || statusRaw === 'open')
  const marked = next.steps
    .filter((s, i) => {
      const ids = new Set([...collectStringList(args.step_ids), ...collectStringList(args.step_id)])
      const indexes = new Set([
        ...collectNumberList(args.step_indexes),
        ...collectNumberList(args.step_index),
      ])
      return ids.has(s.id) || indexes.has(i + 1)
    })
    .map((s) => s.text)
  return `Marked ${matched} step(s) ${done ? 'done' : 'pending'}: ${marked.join('; ') || '(ok)'}`
}

/** Plan currently being executed (approved + agent busy). */
export function findActiveBuildingPlan(
  messages: UiMessage[],
  busy: boolean,
): { messageId: string; plan: PlanArtifact } | null {
  if (!busy) return null
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]
    if (m.plan?.status === 'approved') {
      return { messageId: m.id, plan: m.plan }
    }
  }
  return null
}

/** Mark the next incomplete step as done (legacy heuristic — prefer applyPlanProgressUpdate). */
export function advancePlanStepsOnProgress(plan: PlanArtifact): PlanArtifact {
  const idx = plan.steps.findIndex((s) => !s.done)
  if (idx < 0) return plan
  return {
    ...plan,
    steps: plan.steps.map((s, i) => (i === idx ? { ...s, done: true } : s)),
  }
}

/** Mark every step done (end of successful build). */
export function markAllPlanStepsDone(plan: PlanArtifact): PlanArtifact {
  return {
    ...plan,
    steps: plan.steps.map((s) => ({ ...s, done: true })),
    status: 'built',
  }
}

/** Re-open a plan for editing / retry after stop or failed build. */
export function reopenPlanAsDraft(plan: PlanArtifact): PlanArtifact {
  return { ...plan, status: 'draft' }
}

/**
 * After Approve & Build finishes: set built if the agent marked any progress.
 * Keeps step checks honest (does not force remaining steps to ✓).
 */
export function finalizePlanAfterBuild(plan: PlanArtifact): PlanArtifact {
  const anyProgress = plan.steps.some((s) => s.done === true)
  if (!anyProgress) return reopenPlanAsDraft(plan)
  return { ...plan, status: 'built' }
}

export function normalizePlanArtifact(raw: unknown): PlanArtifact | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const p = raw as Partial<PlanArtifact>
  if (typeof p.title !== 'string' || !Array.isArray(p.steps)) return undefined
  const steps: PlanStep[] = []
  for (const s of p.steps) {
    if (!s || typeof s !== 'object') continue
    const text = typeof (s as PlanStep).text === 'string' ? (s as PlanStep).text.trim() : ''
    if (!text) continue
    const id =
      typeof (s as PlanStep).id === 'string' && (s as PlanStep).id
        ? (s as PlanStep).id
        : newPlanStepId()
    steps.push({
      id,
      text,
      done: (s as PlanStep).done === true,
    })
  }
  if (steps.length === 0) return undefined
  const status =
    p.status === 'approved' || p.status === 'built' || p.status === 'draft' ? p.status : 'draft'

  const approaches: PlanApproach[] = []
  if (Array.isArray(p.approaches)) {
    for (const a of p.approaches) {
      if (!a || typeof a !== 'object') continue
      const id = typeof a.id === 'string' ? a.id.trim().toUpperCase() : ''
      if (!/^[A-D]$/.test(id)) continue
      const label = typeof a.label === 'string' && a.label.trim() ? a.label.trim() : `Approach ${id}`
      const aSteps: PlanStep[] = []
      if (Array.isArray(a.steps)) {
        for (const s of a.steps) {
          if (!s || typeof s !== 'object') continue
          const text = typeof s.text === 'string' ? s.text.trim() : ''
          if (!text) continue
          aSteps.push({
            id: typeof s.id === 'string' && s.id ? s.id : newPlanStepId(),
            text,
            done: s.done === true,
          })
        }
      }
      if (aSteps.length === 0) continue
      approaches.push({
        id,
        label,
        ...(typeof a.summary === 'string' && a.summary.trim()
          ? { summary: a.summary.trim() }
          : {}),
        steps: aSteps,
      })
    }
  }

  const selectedRaw =
    typeof p.selectedApproachId === 'string' ? p.selectedApproachId.trim().toUpperCase() : ''
  const selectedApproachId = approaches.some((a) => a.id === selectedRaw)
    ? selectedRaw
    : undefined

  return {
    title: p.title.trim() || 'Plan',
    ...(typeof p.summary === 'string' && p.summary.trim()
      ? { summary: p.summary.trim() }
      : {}),
    steps,
    status,
    ...(approaches.length > 0 ? { approaches } : {}),
    ...(selectedApproachId ? { selectedApproachId } : {}),
  }
}
