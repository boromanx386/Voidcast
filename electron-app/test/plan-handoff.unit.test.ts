import { describe, expect, it } from 'vitest'
import {
  buildPlanHandoffContextHint,
  buildCodingTurnSummary,
  emptyCodingContextMemo,
  emptyCodingTurnLog,
  recordCodingToolInTurnLog,
  upsertFileDigest,
} from '../src/lib/codingContextMemo'
import { buildPlanModeSystemHint, PLAN_MODE_SYSTEM_HINT } from '../src/lib/planArtifact'

describe('buildPlanHandoffContextHint', () => {
  it('returns empty when memo has no exploration', () => {
    expect(buildPlanHandoffContextHint(emptyCodingContextMemo('/proj'))).toBe('')
  })

  it('includes digests and tells Plan not to re-explore', () => {
    let memo = emptyCodingContextMemo('/proj')
    memo = {
      ...memo,
      recentFileDigests: upsertFileDigest([], 'src/lib/foo.ts', 'exports bar(); used by baz'),
      recentSearches: ['enter_plan_mode'],
    }
    const hint = buildPlanHandoffContextHint(memo)
    expect(hint).toContain('do NOT redo broad coding_explore')
    expect(hint).toContain('src/lib/foo.ts')
    expect(hint).toContain('exports bar()')
    expect(hint).toContain('enter_plan_mode')
  })

  it('prefers explicit turnSummary over memo.lastTurnSummary', () => {
    const memo = {
      ...emptyCodingContextMemo('/proj'),
      lastTurnSummary: 'Last coding turn:\nGoal: stale',
      recentFiles: ['a.ts'],
    }
    const hint = buildPlanHandoffContextHint(memo, {
      turnSummary: 'Last coding turn:\nGoal: fresh handoff',
    })
    expect(hint).toContain('fresh handoff')
    expect(hint).not.toContain('stale')
  })

  it('builds from turn-log summary + digests like enter_plan_mode escalate', () => {
    let log = emptyCodingTurnLog()
    log = recordCodingToolInTurnLog(log, 'search_files', { query: 'ChunkThrottle' }, '2 matches')
    log = recordCodingToolInTurnLog(
      log,
      'find_symbols',
      { path: 'src/lib/chunkThrottle.ts', query: 'flush' },
      'flush(L22)',
    )
    const summary = buildCodingTurnSummary({ userGoal: 'fix empty stdout', log })
    expect(summary).toContain('ChunkThrottle')
    expect(summary).toContain('symbols:')

    let memo = emptyCodingContextMemo('/proj')
    memo = {
      ...memo,
      lastTurnSummary: summary,
      recentFileDigests: upsertFileDigest(
        [],
        'src/lib/chunkThrottle.ts',
        'class ChunkThrottle; flush()',
      ),
    }
    const hint = buildPlanHandoffContextHint(memo, { turnSummary: summary })
    expect(hint).toContain('fix empty stdout')
    expect(hint).toContain('ChunkThrottle')
    expect(hint).toContain('src/lib/chunkThrottle.ts')
  })
})

describe('buildPlanModeSystemHint', () => {
  it('default matches PLAN_MODE_SYSTEM_HINT constant', () => {
    expect(buildPlanModeSystemHint()).toBe(PLAN_MODE_SYSTEM_HINT)
  })

  it('without handoff still prefers coding_explore for mapping', () => {
    const hint = buildPlanModeSystemHint()
    expect(hint).toContain('prefer it for broad codebase mapping')
    expect(hint).toContain('Steps must be concrete')
    expect(hint).toContain('json plan')
  })

  it('with handoff softens explore and keeps concrete-step guidance', () => {
    const hint = buildPlanModeSystemHint({ hasHandoff: true })
    expect(hint).toContain('prior agent-mode exploration handoff')
    expect(hint).toContain('Prefer that research over coding_explore')
    expect(hint).not.toContain('prefer it for broad codebase mapping')
    expect(hint).toContain('Steps must be concrete')
    expect(hint).toContain('file-level detail')
  })
})
