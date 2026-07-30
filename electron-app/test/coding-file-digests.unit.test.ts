import { describe, expect, it } from 'vitest'
import {
  buildCodingMemoHint,
  emptyCodingContextMemo,
  normalizeCodingContextMemo,
  removeFileDigest,
  upsertFileDigest,
  CODING_FILE_DIGEST_MAX_ENTRIES,
  CODING_FILE_DIGEST_MAX_CHARS,
} from '../src/lib/codingContextMemo'
import { digestFindSymbols, digestReadFile } from '../src/lib/codingSubAgent'
import {
  attachResearchToPlan,
  emptyPlanResearchHarvest,
  harvestPlanToolIntoBuffer,
  planResearchFromHarvest,
  BUILD_WITH_RESEARCH_SYSTEM_HINT,
  formatPlanForBuildPrompt,
  createPlanStep,
} from '../src/lib/planArtifact'

describe('upsertFileDigest', () => {
  it('promotes path to front and caps entries', () => {
    let digests = upsertFileDigest([], 'a.ts', 'digest-a')
    digests = upsertFileDigest(digests, 'b.ts', 'digest-b')
    digests = upsertFileDigest(digests, 'a.ts', 'digest-a2')
    expect(digests[0]).toEqual({ path: 'a.ts', digest: 'digest-a2' })
    expect(digests.map((d) => d.path)).toEqual(['a.ts', 'b.ts'])
  })

  it('caps digest length and entry count', () => {
    let digests = upsertFileDigest([], 'big.ts', 'x'.repeat(CODING_FILE_DIGEST_MAX_CHARS + 50))
    expect(digests[0]!.digest.length).toBe(CODING_FILE_DIGEST_MAX_CHARS)
    for (let i = 0; i < CODING_FILE_DIGEST_MAX_ENTRIES + 3; i++) {
      digests = upsertFileDigest(digests, `f${i}.ts`, `d${i}`)
    }
    expect(digests.length).toBeLessThanOrEqual(CODING_FILE_DIGEST_MAX_ENTRIES)
  })

  it('removeFileDigest drops a path', () => {
    const digests = upsertFileDigest(
      upsertFileDigest([], 'a.ts', 'A'),
      'b.ts',
      'B',
    )
    expect(removeFileDigest(digests, 'a.ts').map((d) => d.path)).toEqual(['b.ts'])
  })
})

describe('buildCodingMemoHint digests', () => {
  it('includes recent file digests in the hint', () => {
    const memo = {
      ...emptyCodingContextMemo('/proj'),
      recentFileDigests: [{ path: 'src/a.ts', digest: 'read_file [10 lines]: foo(L1)' }],
    }
    const hint = buildCodingMemoHint(memo)
    expect(hint).toContain('Recent file digests')
    expect(hint).toContain('src/a.ts')
    expect(hint).toContain('foo(L1)')
  })

  it('normalizes recentFileDigests from session data', () => {
    const n = normalizeCodingContextMemo(
      {
        recentFileDigests: [
          { path: '  x.ts ', digest: `  ${'y'.repeat(CODING_FILE_DIGEST_MAX_CHARS + 10)}  ` },
          { path: '', digest: 'skip' },
        ],
      },
      '/p',
    )
    expect(n.recentFileDigests).toHaveLength(1)
    expect(n.recentFileDigests[0]!.path).toBe('x.ts')
    expect(n.recentFileDigests[0]!.digest.length).toBe(CODING_FILE_DIGEST_MAX_CHARS)
  })
})

describe('digestReadFile / digestFindSymbols', () => {
  it('summarizes numbered read_file content', () => {
    const d = digestReadFile('1| export function foo() {}\n2| const bar = 1\n')
    expect(d).toContain('read_file')
    expect(d).toMatch(/foo\(L1\)/)
  })

  it('summarizes find_symbols outline', () => {
    const d = digestFindSymbols(
      'find_symbols: src/a.ts (20 lines, 2 symbols)\n10 function foo\n20 class Bar\n',
    )
    expect(d).toContain('find_symbols: src/a.ts')
    expect(d).toContain('foo')
  })
})

describe('plan harvest read digests', () => {
  it('adds read_file digests into harvest findings', () => {
    const harvest = emptyPlanResearchHarvest()
    harvestPlanToolIntoBuffer(
      harvest,
      'read_file',
      { path: 'src/lib/foo.ts' },
      '1| export function handleFoo() {}\n2| export class FooSvc {}\n',
    )
    expect(harvest.keyFiles).toContain('src/lib/foo.ts')
    expect(harvest.digests.some((d) => d.includes('src/lib/foo.ts'))).toBe(true)
    const research = planResearchFromHarvest(harvest)
    expect(research?.findings).toContain('src/lib/foo.ts')
    expect(research?.findings).toMatch(/handleFoo|FooSvc/)
  })

  it('merges LLM findings with harvested digests on attach', () => {
    const harvest = emptyPlanResearchHarvest()
    harvestPlanToolIntoBuffer(
      harvest,
      'read_file',
      { path: 'a.ts' },
      '1| export function alpha() {}\n',
    )
    const plan = {
      title: 'T',
      steps: [createPlanStep('do it')],
      research: {
        keyFiles: ['b.ts'],
        findings: 'LLM says edit b.ts',
      },
      status: 'draft' as const,
    }
    const next = attachResearchToPlan(plan, harvest)
    expect(next.research?.keyFiles).toEqual(expect.arrayContaining(['a.ts', 'b.ts']))
    expect(next.research?.findings).toContain('LLM says edit b.ts')
    expect(next.research?.findings).toContain('a.ts')
  })
})

describe('BUILD_WITH_RESEARCH wording', () => {
  it('does not push whole-file re-reads as the default', () => {
    expect(BUILD_WITH_RESEARCH_SYSTEM_HINT.toLowerCase()).not.toMatch(
      /re-read a file when you are about to edit/,
    )
    expect(BUILD_WITH_RESEARCH_SYSTEM_HINT).toMatch(/targeted range-read|range-read/i)
    const prompt = formatPlanForBuildPrompt({
      title: 'T',
      steps: [createPlanStep('s')],
      status: 'approved',
      research: {
        keyFiles: ['a.ts'],
        findings: 'a.ts: read_file [3 lines]: foo(L1)',
      },
    })
    expect(prompt).toMatch(/Range-read only|digests/i)
    expect(prompt).not.toMatch(/Re-read when about to edit/)
  })
})
