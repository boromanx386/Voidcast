import { readAgentSkillBody } from '@/lib/agentSkills'
import { formatPlanProgressToolResult, planArtifactFromSubmitArgs } from '@/lib/planArtifact'
import { sanitizeCandidate } from '@/lib/longMemoryExtract'
import { upsertMemories } from '@/lib/longMemoryStorage'
import { parseToolValueAsString } from '@/lib/toolHandlers/helpers'
import type { ToolHandlerFn, ToolHandlerRegistry } from '@/lib/toolExecTypes'

export const handleEnterPlanMode: ToolHandlerFn = async (_args, ctx) => {
  if (ctx.agentMode === 'team') {
    return (
      'Error: Team mode does not escalate to Plan. Stay in Team: use ' +
      'run_coding_workers (parallel coding workers) and implement. ' +
      'If the user wants a Plan card, they must switch the composer to Plan themselves.'
    )
  }
  return 'Switching to Plan mode.'
}

export const handleSubmitPlan: ToolHandlerFn = async (args, ctx) => {
  if (ctx.agentMode !== 'plan') return 'Error: submit_plan is only available in Plan mode.'
  const plan = planArtifactFromSubmitArgs(args)
  if (!plan) {
    return (
      'Error: the plan needs "title" plus non-empty "steps" (array of strings), or ' +
      '"approaches" where each has id, label and non-empty steps. Fix the arguments and call submit_plan again.'
    )
  }
  const options = plan.approaches?.length
    ? `${plan.approaches.length} approaches, ${plan.selectedApproachId} recommended`
    : `${plan.steps.length} steps`
  return `Plan submitted: "${plan.title}" (${options}). It is shown to the user as a plan card for approval.`
}

export const handleUpdatePlanProgress: ToolHandlerFn = async (args, ctx) => {
  return formatPlanProgressToolResult(ctx.getActiveBuildPlan?.(), args)
}

export const handleReadSkill: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.skillsEnabled) {
    return 'Error: read_skill tool is disabled in settings.'
  }
  const skillName = typeof args.name === 'string' ? args.name.trim() : ''
  if (!skillName) return 'Error: missing name parameter for read_skill.'
  const res = await readAgentSkillBody(skillName, ctx.codingProjectPath)
  if (!res.ok) return `Error: ${res.error}`
  return `Skill "${res.name}" instructions:\n\n${res.content}`
}

export const handleSaveMemory: ToolHandlerFn = async (args) => {
  // Same filter as the extract flow, so the agent cannot store secret-shaped values.
  const candidate = sanitizeCandidate({
    kind: parseToolValueAsString(args.kind).trim() || 'fact',
    text: parseToolValueAsString(args.text),
    tags: Array.isArray(args.tags) ? args.tags : [],
    importance: args.importance,
    confidence: 0.8,
  })
  if (!candidate) {
    return (
      'Error: memory not saved. It needs a "text" of at least 6 characters, a kind of ' +
      'preference / project / fact / constraint / task, and no secret-looking values.'
    )
  }
  try {
    const saved = await upsertMemories([candidate], 'agent-tool')
    if (saved.length === 0) return 'Error: memory was empty and was not saved.'
    return `OK: remembered (${saved[0].kind}): ${saved[0].text}`
  } catch (e) {
    return e instanceof Error ? `Error: failed to save memory: ${e.message}` : String(e)
  }
}

export const appHandlersRegistry: ToolHandlerRegistry = {
  ['enter_plan_mode']: handleEnterPlanMode,
  ['update_plan_progress']: handleUpdatePlanProgress,
  ['submit_plan']: handleSubmitPlan,
  ['read_skill']: handleReadSkill,
  ['save_memory']: handleSaveMemory,
}
