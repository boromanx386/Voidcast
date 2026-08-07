import { describe, expect, test } from 'vitest'
import {
  advancePlanStepsOnProgress,
  applyPlanProgressUpdate,
  attachResearchToPlan,
  emptyPlanResearchHarvest,
  extractPlanArtifactFromReply,
  finalizePlanAfterBuild,
  formatPlanForBuildPrompt,
  formatPlanForRevisePrompt,
  formatPlanProgressToolResult,
  harvestPlanToolIntoBuffer,
  isPlanProgressToolResult,
  markAllPlanStepsDone,
  mergePlanResearch,
  normalizePlanArtifact,
  parsePlanChecklistFromText,
  parsePlanJsonFromText,
  planHasResearch,
  planResearchFromHarvest,
  reopenPlanAsDraft,
  selectPlanApproach,
  stripPlanJsonFenceFromContent,
  stripPlanResearchPathEntry,
} from '../src/lib/planArtifact'

describe('parsePlanJsonFromText', () => {
  test('parses json plan fence', () => {
    const text = `Here is the approach.

\`\`\`json plan
{
  "title": "Add dark mode",
  "summary": "Theme toggle and CSS vars",
  "steps": ["Add setting", "Wire CSS", "Test"]
}
\`\`\`
`
    const plan = parsePlanJsonFromText(text)
    expect(plan?.title).toBe('Add dark mode')
    expect(plan?.summary).toContain('Theme toggle')
    expect(plan?.steps.map((s) => s.text)).toEqual(['Add setting', 'Wire CSS', 'Test'])
    expect(plan?.status).toBe('draft')
  })

  test('parses A/B/C approaches with recommended', () => {
    const text = `\`\`\`json plan
{
  "title": "Auth refactor",
  "summary": "Pick a path",
  "recommended": "B",
  "approaches": [
    { "id": "A", "label": "Minimal", "summary": "Fast", "steps": ["Patch helper"] },
    { "id": "B", "label": "Clean", "summary": "Safer", "steps": ["Extract module", "Migrate callers"] },
    { "id": "C", "label": "Rewrite", "steps": ["New auth", "Delete old"] },
    { "id": "D", "label": "Defer", "summary": "Optional", "steps": ["File issue"] }
  ]
}
\`\`\``
    const plan = parsePlanJsonFromText(text)
    expect(plan?.approaches).toHaveLength(4)
    expect(plan?.selectedApproachId).toBe('B')
    expect(plan?.steps.map((s) => s.text)).toEqual(['Extract module', 'Migrate callers'])
  })

  test('parses plain json fence with steps', () => {
    const text = `\`\`\`json
{"title":"Fix bug","steps":["Reproduce","Patch"]}\`\`\``
    const plan = parsePlanJsonFromText(text)
    expect(plan?.title).toBe('Fix bug')
    expect(plan?.steps).toHaveLength(2)
  })

  test('parses research block from json plan', () => {
    const text = `\`\`\`json plan
{
  "title": "Handoff",
  "steps": ["Edit planArtifact"],
  "research": {
    "keyFiles": ["src/lib/planArtifact.ts", "src/hooks/useChatAgent.ts"],
    "findings": "Plan stores checklist only; Build needs research snapshot.",
    "searches": ["formatPlanForBuildPrompt"]
  }
}
\`\`\``
    const plan = parsePlanJsonFromText(text)
    expect(plan?.research?.keyFiles).toEqual([
      'src/lib/planArtifact.ts',
      'src/hooks/useChatAgent.ts',
    ])
    expect(plan?.research?.findings).toContain('research snapshot')
    expect(plan?.research?.searches).toEqual(['formatPlanForBuildPrompt'])
    expect(planHasResearch(plan!)).toBe(true)
  })
})

describe('selectPlanApproach', () => {
  test('switches steps to chosen approach', () => {
    const plan = parsePlanJsonFromText(`\`\`\`json plan
{
  "title": "T",
  "recommended": "A",
  "approaches": [
    { "id": "A", "label": "A", "steps": ["a1"] },
    { "id": "B", "label": "B", "steps": ["b1", "b2"] }
  ]
}
\`\`\``)!
    const next = selectPlanApproach(plan, 'B')
    expect(next.selectedApproachId).toBe('B')
    expect(next.steps.map((s) => s.text)).toEqual(['b1', 'b2'])
  })
})

describe('parsePlanChecklistFromText', () => {
  test('parses checklist and heading', () => {
    const text = `# Refactor auth

- [ ] Extract session helper
- [ ] Update callers
1. Add tests
`
    const plan = parsePlanChecklistFromText(text)
    expect(plan?.title).toBe('Refactor auth')
    expect(plan?.steps.map((s) => s.text)).toEqual([
      'Extract session helper',
      'Update callers',
      'Add tests',
    ])
  })
})

describe('extractPlanArtifactFromReply', () => {
  test('prefers json over checklist', () => {
    const text = `# Wrong

- [ ] ignore me

\`\`\`json plan
{"title":"Real","steps":["A","B"]}
\`\`\`
`
    const plan = extractPlanArtifactFromReply(text)
    expect(plan?.title).toBe('Real')
    expect(plan?.steps.map((s) => s.text)).toEqual(['A', 'B'])
  })

  test('returns null for plain prose (no spurious Approve card)', () => {
    const plan = extractPlanArtifactFromReply('Just do the thing carefully.')
    expect(plan).toBeNull()
  })
})

describe('formatPlanForBuildPrompt', () => {
  test('includes title, approach, step ids, and progress tool hint', () => {
    const plan = extractPlanArtifactFromReply(`\`\`\`json plan
{
  "title":"Ship",
  "summary":"Go",
  "recommended":"A",
  "approaches":[
    {"id":"A","label":"Direct","summary":"Ship it","steps":["One","Two"]}
  ]
}
\`\`\``)!
    const prompt = formatPlanForBuildPrompt(plan)
    expect(prompt).toContain('Build the approved plan')
    expect(prompt).toContain('update_plan_progress')
    expect(prompt).toContain('Title: Ship')
    expect(prompt).toContain('Chosen approach: A')
    expect(prompt).toMatch(/1\. \[id=.+\] One/)
    expect(prompt).toMatch(/2\. \[id=.+\] Two/)
    expect(prompt).not.toContain('Research (from Plan mode')
  })

  test('injects research and no-reexplore instructions', () => {
    const plan = extractPlanArtifactFromReply(`\`\`\`json plan
{
  "title":"Ship",
  "steps":["One"],
  "research": {
    "keyFiles": ["src/a.ts"],
    "findings": "Edit buildAgentTurnContext for the hint.",
    "searches": ["BUILD_WITH_RESEARCH"]
  }
}
\`\`\``)!
    const prompt = formatPlanForBuildPrompt(plan)
    expect(prompt).toContain('Prefer it over re-exploring')
    expect(prompt).toContain('Research (from Plan mode — reuse this):')
    expect(prompt).toContain('Key files: src/a.ts')
    expect(prompt).toContain('Searches: BUILD_WITH_RESEARCH')
    expect(prompt).toContain('Edit buildAgentTurnContext for the hint.')
  })

  test('teamWorkers adds run_coding_workers guidance', () => {
    const plan = extractPlanArtifactFromReply(`\`\`\`json plan
{
  "title":"Ship",
  "steps":["Edit a","Edit b"]
}
\`\`\``)!
    const prompt = formatPlanForBuildPrompt(plan, { teamWorkers: true })
    expect(prompt).toContain('run_coding_workers')
    expect(prompt).toContain('path-disjoint')
  })
})

describe('formatPlanForRevisePrompt', () => {
  test('includes custom note and previous steps', () => {
    const plan = extractPlanArtifactFromReply(`\`\`\`json plan
{"title":"Auth","steps":["Add middleware","Wire routes"]}
\`\`\``)!
    const prompt = formatPlanForRevisePrompt(plan, 'Keep the diff minimal, no new deps')
    expect(prompt).toContain('Revise the plan')
    expect(prompt).toContain('Keep the diff minimal, no new deps')
    expect(prompt).toContain('Current title: Auth')
    expect(prompt).toContain('1. Add middleware')
    expect(prompt).toContain('2. Wire routes')
  })

  test('includes previous research searches', () => {
    const plan = extractPlanArtifactFromReply(`\`\`\`json plan
{
  "title":"Auth",
  "steps":["Add middleware"],
  "research": {
    "keyFiles": ["src/auth.ts"],
    "findings": "Middleware lives here.",
    "searches": ["session helper"]
  }
}
\`\`\``)!
    const prompt = formatPlanForRevisePrompt(plan, 'Keep it minimal')
    expect(prompt).toContain('Key files: src/auth.ts')
    expect(prompt).toContain('Searches: session helper')
    expect(prompt).toContain('Middleware lives here.')
  })
})

describe('stripPlanResearchPathEntry', () => {
  test('strips real-world line-count suffixes', () => {
    expect(
      stripPlanResearchPathEntry(
        'src/hooks/useChatMessageRender.ts (215 lines; spaces must match)',
      ),
    ).toBe('src/hooks/useChatMessageRender.ts')
    expect(stripPlanResearchPathEntry('src/a.ts (lines 12-18)')).toBe('src/a.ts')
    expect(stripPlanResearchPathEntry('src/a.ts (from line 5)')).toBe('src/a.ts')
    expect(stripPlanResearchPathEntry('src/a.ts (written)')).toBe('src/a.ts')
  })
})

describe('stripPlanJsonFenceFromContent', () => {
  test('removes trailing fence', () => {
    const raw = `Overview here.\n\n\`\`\`json plan\n{"title":"T","steps":["a"]}\n\`\`\`\n`
    expect(stripPlanJsonFenceFromContent(raw)).toBe('Overview here.')
  })
})

describe('auto-check progress', () => {
  test('isPlanProgressToolResult gates errors (legacy heuristic)', () => {
    expect(isPlanProgressToolResult('write_file', 'Saved foo.ts')).toBe(true)
    expect(isPlanProgressToolResult('write_file', 'Error: denied')).toBe(false)
    expect(isPlanProgressToolResult('edit_code', 'Target snippet not found (10 lines)')).toBe(false)
    expect(isPlanProgressToolResult('edit_code', 'Edited foo.ts (lines 1-2, first match)')).toBe(true)
    expect(isPlanProgressToolResult('read_file', 'ok')).toBe(false)
  })

  test('advancePlanStepsOnProgress marks next step (legacy)', () => {
    const plan = extractPlanArtifactFromReply(`\`\`\`json plan
{"title":"T","steps":["One","Two","Three"]}
\`\`\``)!
    const a1 = advancePlanStepsOnProgress(plan)
    expect(a1.steps.map((s) => s.done)).toEqual([true, false, false])
    const a2 = advancePlanStepsOnProgress(a1)
    expect(a2.steps.map((s) => s.done)).toEqual([true, true, false])
  })

  test('applyPlanProgressUpdate marks by id and index', () => {
    const plan = extractPlanArtifactFromReply(`\`\`\`json plan
{"title":"T","steps":["One","Two","Three"]}
\`\`\``)!
    const byIndex = applyPlanProgressUpdate(plan, { step_index: 2 })
    expect(byIndex.error).toBeUndefined()
    expect(byIndex.matched).toBe(1)
    expect(byIndex.plan.steps.map((s) => s.done)).toEqual([false, true, false])

    const byId = applyPlanProgressUpdate(byIndex.plan, { step_ids: [plan.steps[0]!.id] })
    expect(byId.plan.steps.map((s) => s.done)).toEqual([true, true, false])

    const reopen = applyPlanProgressUpdate(byId.plan, { step_index: 2, status: 'pending' })
    expect(reopen.plan.steps.map((s) => s.done)).toEqual([true, false, false])
  })

  test('applyPlanProgressUpdate errors without targets', () => {
    const plan = extractPlanArtifactFromReply(`\`\`\`json plan
{"title":"T","steps":["One"]}
\`\`\``)!
    expect(applyPlanProgressUpdate(plan, {}).error).toMatch(/step_ids/)
    expect(formatPlanProgressToolResult(undefined, { step_index: 1 })).toMatch(/^Error:/)
  })

  test('markAllPlanStepsDone sets built', () => {
    const plan = extractPlanArtifactFromReply(`\`\`\`json plan
{"title":"T","steps":["One","Two"]}
\`\`\``)!
    const done = markAllPlanStepsDone(plan)
    expect(done.status).toBe('built')
    expect(done.steps.every((s) => s.done)).toBe(true)
  })

  test('finalizePlanAfterBuild requires progress and keeps honest checks', () => {
    const plan = extractPlanArtifactFromReply(`\`\`\`json plan
{"title":"T","steps":["One","Two"]}
\`\`\``)!
    expect(finalizePlanAfterBuild({ ...plan, status: 'approved' }).status).toBe('draft')
    const partial = applyPlanProgressUpdate({ ...plan, status: 'approved' }, { step_index: 1 }).plan
    const done = finalizePlanAfterBuild(partial)
    expect(done.status).toBe('built')
    expect(done.steps.map((s) => s.done)).toEqual([true, false])
  })

  test('reopenPlanAsDraft unlocks approved plan', () => {
    const plan = extractPlanArtifactFromReply(`\`\`\`json plan
{"title":"T","steps":["One"]}
\`\`\``)!
    const reopened = reopenPlanAsDraft({ ...plan, status: 'approved', steps: [{ ...plan.steps[0]!, done: true }] })
    expect(reopened.status).toBe('draft')
    expect(reopened.steps[0]?.done).toBe(true)
  })
})

describe('normalizePlanArtifact', () => {
  test('sanitizes and keeps valid plans', () => {
    const plan = normalizePlanArtifact({
      title: '  Hello  ',
      status: 'approved',
      steps: [{ id: 'x', text: ' Do it ', done: true }, { text: '' }, null],
    })
    expect(plan?.title).toBe('Hello')
    expect(plan?.status).toBe('approved')
    expect(plan?.steps).toHaveLength(1)
    expect(plan?.steps[0]?.done).toBe(true)
  })

  test('persists research round-trip', () => {
    const plan = normalizePlanArtifact({
      title: 'T',
      status: 'draft',
      steps: [{ id: 'a', text: 'One' }],
      research: {
        keyFiles: [' src/foo.ts ', 'src/foo.ts', 'src/bar.ts'],
        findings: '  Keep this  ',
        searches: ['q1', 'q1'],
      },
    })
    expect(plan?.research?.keyFiles).toEqual(['src/foo.ts', 'src/bar.ts'])
    expect(plan?.research?.findings).toBe('Keep this')
    expect(plan?.research?.searches).toEqual(['q1'])
  })

  test('rejects garbage', () => {
    expect(normalizePlanArtifact(null)).toBeUndefined()
    expect(normalizePlanArtifact({ title: 'x' })).toBeUndefined()
  })
})

describe('plan research harvest + merge', () => {
  test('harvests read_file, search_files, and coding_explore digests', () => {
    const harvest = emptyPlanResearchHarvest()
    harvestPlanToolIntoBuffer(
      harvest,
      'read_file',
      { path: 'src/lib/planArtifact.ts' },
      'export function formatPlanForBuildPrompt',
    )
    harvestPlanToolIntoBuffer(harvest, 'search_files', { query: 'PlanArtifact' }, 'src/types/chat.ts:20')
    harvestPlanToolIntoBuffer(
      harvest,
      'coding_explore',
      { goal: 'plan build handoff' },
      '[Coding explore]\nTouch src/hooks/useChatAgent.ts and src/lib/buildAgentTurnContext.ts for the hint.',
    )
    const fromHarvest = planResearchFromHarvest(harvest)
    expect(fromHarvest?.keyFiles).toContain('src/lib/planArtifact.ts')
    expect(fromHarvest?.keyFiles).toContain('src/hooks/useChatAgent.ts')
    expect(fromHarvest?.searches).toContain('PlanArtifact')
    expect(fromHarvest?.searches?.some((s) => s.startsWith('explore:'))).toBe(true)
    expect(fromHarvest?.findings).toContain('buildAgentTurnContext')
  })

  test('merge concatenates distinct findings and unions files', () => {
    const merged = mergePlanResearch(
      {
        keyFiles: ['a.ts'],
        findings: 'short',
        searches: ['x'],
      },
      {
        keyFiles: ['b.ts'],
        findings: 'much longer harvested digest from coding_explore',
        searches: ['y'],
      },
    )
    expect(merged?.keyFiles).toEqual(['a.ts', 'b.ts'])
    expect(merged?.findings).toContain('short')
    expect(merged?.findings).toContain('coding_explore')
    expect(merged?.searches).toEqual(['x', 'y'])
  })

  test('attachResearchToPlan fills missing research from harvest', () => {
    const plan = extractPlanArtifactFromReply(`\`\`\`json plan
{"title":"T","steps":["One"]}
\`\`\``)!
    expect(plan.research).toBeUndefined()
    const harvest = emptyPlanResearchHarvest()
    harvestPlanToolIntoBuffer(
      harvest,
      'read_file',
      { path: 'src/a.ts' },
      'const x = 1',
    )
    const next = attachResearchToPlan(plan, harvest)
    expect(next.research?.keyFiles).toEqual(['src/a.ts'])
  })

  test('skips failed tool results', () => {
    const harvest = emptyPlanResearchHarvest()
    harvestPlanToolIntoBuffer(
      harvest,
      'read_file',
      { path: 'missing.ts' },
      'Error: File not found',
    )
    expect(planResearchFromHarvest(harvest)).toBeUndefined()
  })
})
