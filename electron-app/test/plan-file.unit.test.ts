import { describe, expect, test } from 'vitest'
import {
  formatPlanForBuildPrompt,
  formatPlanHistoryNote,
  formatPlanMarkdown,
  normalizePlanArtifact,
  planArtifactFromParts,
  planFileAbsolutePath,
  planFileRef,
  planFileSlug,
  withPlanFile,
} from '@/lib/planArtifact'

const day = new Date(2026, 9, 27, 14, 5)

describe('plan file', () => {
  test('slug strips diacritics and punctuation', () => {
    expect(planFileSlug('Poboljšaj plan mode: MD u folder!')).toBe(
      'poboljsaj-plan-mode-md-u-folder',
    )
    expect(planFileSlug('???')).toBe('plan')
  })

  test('ref is date-prefixed under .voidcast/plans', () => {
    expect(planFileRef('/repo', 'Add login', day).path).toBe(
      '.voidcast/plans/2026-10-27-add-login.md',
    )
  })

  test('absolute path follows the project separator', () => {
    expect(planFileAbsolutePath({ projectPath: 'Q:\\repo\\', path: '.voidcast/plans/a.md' })).toBe(
      'Q:\\repo\\.voidcast\\plans\\a.md',
    )
    expect(
      planFileAbsolutePath({ projectPath: '/home/u/repo', path: '.voidcast/plans/a.md' }),
    ).toBe('/home/u/repo/.voidcast/plans/a.md')
  })

  test('markdown has checklist, research and notes', () => {
    const base = planArtifactFromParts(
      'Add login',
      ['Edit src/a.ts', 'Edit src/b.ts'],
      'Why',
      'draft',
      undefined,
      undefined,
      {
        keyFiles: ['src/a.ts'],
        findings: 'a.ts owns auth',
      },
    )
    const plan = withPlanFile(
      { ...base, steps: [{ ...base.steps[0], done: true }, base.steps[1]] },
      '/repo',
      'Open question: OAuth?',
      day,
    )
    const md = formatPlanMarkdown(plan)
    expect(md).toContain('# Add login')
    expect(md).toContain('1/2 steps done')
    expect(md).toContain('- [x] 1. Edit src/a.ts')
    expect(md).toContain('- [ ] 2. Edit src/b.ts')
    expect(md).toContain('- `src/a.ts`')
    expect(md).toContain('## Notes\n\nOpen question: OAuth?')
    expect(md.endsWith('\n')).toBe(true)
  })

  test('file and notes survive normalize, build prompt and history note mention the file', () => {
    const plan = withPlanFile(planArtifactFromParts('X', ['s1']), '/repo', 'n', day)
    const restored = normalizePlanArtifact(JSON.parse(JSON.stringify(plan)))
    expect(restored?.file).toEqual(plan.file)
    expect(restored?.notes).toBe('n')
    expect(formatPlanForBuildPrompt(plan)).toContain(`Plan file: ${plan.file?.path}`)
    expect(formatPlanHistoryNote(plan)).toContain('saved to .voidcast/plans/2026-10-27-x.md')
  })
})
