import { describe, expect, test } from 'vitest'
import {
  advancePlanStepsOnProgress,
  extractPlanArtifactFromReply,
  finalizePlanAfterBuild,
  formatPlanForBuildPrompt,
  isPlanProgressToolResult,
  markAllPlanStepsDone,
  normalizePlanArtifact,
  parsePlanChecklistFromText,
  parsePlanJsonFromText,
  reopenPlanAsDraft,
  selectPlanApproach,
  stripPlanJsonFenceFromContent,
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
  test('includes title, approach, and numbered steps', () => {
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
    expect(prompt).toContain('Title: Ship')
    expect(prompt).toContain('Chosen approach: A')
    expect(prompt).toContain('1. One')
    expect(prompt).toContain('2. Two')
  })
})

describe('stripPlanJsonFenceFromContent', () => {
  test('removes trailing fence', () => {
    const raw = `Overview here.\n\n\`\`\`json plan\n{"title":"T","steps":["a"]}\n\`\`\`\n`
    expect(stripPlanJsonFenceFromContent(raw)).toBe('Overview here.')
  })
})

describe('auto-check progress', () => {
  test('isPlanProgressToolResult gates errors', () => {
    expect(isPlanProgressToolResult('write_file', 'Saved foo.ts')).toBe(true)
    expect(isPlanProgressToolResult('write_file', 'Error: denied')).toBe(false)
    expect(isPlanProgressToolResult('edit_code', 'Target snippet not found (10 lines)')).toBe(false)
    expect(isPlanProgressToolResult('edit_code', 'Edited foo.ts (lines 1-2, first match)')).toBe(true)
    expect(isPlanProgressToolResult('read_file', 'ok')).toBe(false)
  })

  test('advancePlanStepsOnProgress marks next step', () => {
    const plan = extractPlanArtifactFromReply(`\`\`\`json plan
{"title":"T","steps":["One","Two","Three"]}
\`\`\``)!
    const a1 = advancePlanStepsOnProgress(plan)
    expect(a1.steps.map((s) => s.done)).toEqual([true, false, false])
    const a2 = advancePlanStepsOnProgress(a1)
    expect(a2.steps.map((s) => s.done)).toEqual([true, true, false])
  })

  test('markAllPlanStepsDone sets built', () => {
    const plan = extractPlanArtifactFromReply(`\`\`\`json plan
{"title":"T","steps":["One","Two"]}
\`\`\``)!
    const done = markAllPlanStepsDone(plan)
    expect(done.status).toBe('built')
    expect(done.steps.every((s) => s.done)).toBe(true)
  })

  test('finalizePlanAfterBuild requires progress', () => {
    const plan = extractPlanArtifactFromReply(`\`\`\`json plan
{"title":"T","steps":["One","Two"]}
\`\`\``)!
    expect(finalizePlanAfterBuild({ ...plan, status: 'approved' }).status).toBe('draft')
    const advanced = advancePlanStepsOnProgress({ ...plan, status: 'approved' })
    const done = finalizePlanAfterBuild(advanced)
    expect(done.status).toBe('built')
    expect(done.steps.every((s) => s.done)).toBe(true)
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

  test('rejects garbage', () => {
    expect(normalizePlanArtifact(null)).toBeUndefined()
    expect(normalizePlanArtifact({ title: 'x' })).toBeUndefined()
  })
})
