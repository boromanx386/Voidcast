import { describe, expect, test } from 'vitest'
import {
  buildPlanModeSystemHint,
  planArtifactFromSubmitArgs,
  SUBMIT_PLAN_TOOL_NAME,
} from '@/lib/planArtifact'
import { buildToolsList } from '@/lib/toolDefinitions'
import { handleSubmitPlan } from '@/lib/toolHandlers/appHandlers'
import type { ExecCtx } from '@/lib/toolExecTypes'

describe('submit_plan', () => {
  test('flat plan with research', () => {
    const plan = planArtifactFromSubmitArgs({
      title: 'Add login',
      steps: ['Edit src/a.ts', 'Edit src/b.ts'],
      research: { keyFiles: ['src/a.ts'], findings: 'auth lives in a.ts' },
    })
    expect(plan?.title).toBe('Add login')
    expect(plan?.steps.map((s) => s.text)).toEqual(['Edit src/a.ts', 'Edit src/b.ts'])
    expect(plan?.research?.keyFiles).toEqual(['src/a.ts'])
    expect(plan?.status).toBe('draft')
  })

  test('approaches select the recommended one', () => {
    const plan = planArtifactFromSubmitArgs({
      title: 'X',
      approaches: [
        { id: 'A', label: 'Fast', steps: ['a1'] },
        { id: 'B', label: 'Safe', steps: ['b1', 'b2'] },
      ],
      recommended: 'B',
    })
    expect(plan?.selectedApproachId).toBe('B')
    expect(plan?.steps.map((s) => s.text)).toEqual(['b1', 'b2'])
  })

  test('decodes arrays sent as JSON strings', () => {
    const plan = planArtifactFromSubmitArgs({ title: 'X', steps: '["one", "two"]' })
    expect(plan?.steps.map((s) => s.text)).toEqual(['one', 'two'])
  })

  test('rejects a plan without steps', () => {
    expect(planArtifactFromSubmitArgs({ title: 'X' })).toBeNull()
    expect(planArtifactFromSubmitArgs({ title: 'X', steps: 'do it' })).toBeNull()
  })

  test('handler validates and is Plan-only', async () => {
    const plan = { agentMode: 'plan' } as ExecCtx
    expect(await handleSubmitPlan({ title: 'X', steps: ['a'] }, plan)).toMatch(/^Plan submitted/)
    expect(await handleSubmitPlan({ title: 'X' }, plan)).toMatch(/^Error:/)
    expect(
      await handleSubmitPlan({ title: 'X', steps: ['a'] }, { agentMode: 'agent' } as ExecCtx),
    ).toMatch(/^Error:/)
  })

  test('tool is offered only in Plan mode', () => {
    const names = (mode: 'plan' | 'agent' | 'ask') =>
      buildToolsList({ webSearch: true } as never, false, { agentMode: mode }).map(
        (t) => t.function.name,
      )
    expect(names('plan')).toContain(SUBMIT_PLAN_TOOL_NAME)
    expect(names('agent')).not.toContain(SUBMIT_PLAN_TOOL_NAME)
    expect(names('ask')).not.toContain(SUBMIT_PLAN_TOOL_NAME)
  })

  test('prompt asks for the tool, fence only as fallback', () => {
    const withTool = buildPlanModeSystemHint({ submitTool: true })
    expect(withTool).toContain('calling submit_plan exactly once')
    expect(withTool).not.toContain('Preferred shapes')
    expect(buildPlanModeSystemHint()).toContain('Preferred shapes')
  })
})
