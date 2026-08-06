import { describe, expect, it } from 'vitest'
import {
  buildPlanHandoffContextHint,
  buildPlanHandoffUiDraftContent,
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
    expect(hint).toContain('HARD CONSTRAINT')
    expect(hint).toContain('Do NOT call coding_explore')
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

  it('renders the raw agent-round tool trail so Plan does not re-explore', () => {
    let log = emptyCodingTurnLog()
    log = recordCodingToolInTurnLog(log, 'search_files', { query: 'onEscalateToPlan' }, '1 match')
    log = recordCodingToolInTurnLog(
      log,
      'find_symbols',
      { path: 'src/hooks/useChatAgent.ts', query: 'handoff' },
      'handoff(L894)',
    )
    log = recordCodingToolInTurnLog(
      log,
      'execute_command',
      { command: 'npm test' },
      '$ npm test\nok',
    )
    const hint = buildPlanHandoffContextHint(emptyCodingContextMemo('/proj'), {
      toolLog: log,
    })
    expect(hint).toContain('Agent-round tool trail')
    expect(hint).toContain('do NOT repeat')
    expect(hint).toContain('search: "onEscalateToPlan"')
    expect(hint).toContain('symbols: src/hooks/useChatAgent.ts')
    expect(hint).toContain('command: npm test')
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
    expect(hint).toContain('HARD CONSTRAINT')
    expect(hint).toContain('prior agent-mode exploration handoff')
    expect(hint).toContain('Do NOT call coding_explore')
    expect(hint).not.toContain('prefer it for broad codebase mapping')
    expect(hint).toContain('Steps must be concrete')
    expect(hint).toContain('file-level detail')
  })
})

describe('buildPlanHandoffUiDraftContent', () => {
  it('returns null for thin stub with no research', () => {
    expect(
      buildPlanHandoffUiDraftContent({
        replyText: 'Ok ulazim u plan.',
        memo: emptyCodingContextMemo('/proj'),
      }),
    ).toBeNull()
  })

  it('keeps a substantial agent reply as the body', () => {
    const reply =
      'I mapped the OpenAI tool loop and frontend progress rendering. ' +
      'Next step is a plan for the remaining wiring.'
    const body = buildPlanHandoffUiDraftContent({
      replyText: reply,
      memo: emptyCodingContextMemo('/proj'),
    })
    expect(body).toContain('OpenAI tool loop')
    expect(body).not.toContain('Entering Plan mode with prior')
  })

  it('replaces a short stub with explored files + digests', () => {
    let memo = emptyCodingContextMemo('/proj')
    memo = {
      ...memo,
      recentFileDigests: upsertFileDigest(
        [],
        'src/lib/openrouterAgent.ts',
        'runOpenRouterChatWithTools multi-round loop',
      ),
    }
    const body = buildPlanHandoffUiDraftContent({
      replyText: 'Sada imam punu sliku. Da uđem u plan mode.',
      memo,
      turnSummary: 'Last coding turn:\nGoal: finish agent loop',
    })
    expect(body).toContain('Entering Plan mode with prior')
    expect(body).toContain('openrouterAgent.ts')
    expect(body).toContain('multi-round loop')
    expect(body).toContain('finish agent loop')
    expect(body).not.toContain('Sada imam punu sliku')
  })
})
