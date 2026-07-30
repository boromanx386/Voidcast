import { describe, expect, it } from 'vitest'
import {
  buildCodingMemoHint,
  buildCodingTurnSummary,
  emptyCodingContextMemo,
  emptyCodingTurnLog,
  normalizeCodingContextMemo,
  recordCodingToolInTurnLog,
  CODING_TURN_SUMMARY_MAX_CHARS,
} from '../src/lib/codingContextMemo'

describe('recordCodingToolInTurnLog', () => {
  it('records successful edits and skips reads', () => {
    let log = emptyCodingTurnLog()
    log = recordCodingToolInTurnLog(log, 'read_file', { path: 'a.ts' }, '1| hello')
    log = recordCodingToolInTurnLog(
      log,
      'edit_code',
      { path: 'a.ts' },
      'Edited a.ts (lines 10-12, first match)',
    )
    expect(log.events).toHaveLength(1)
    expect(log.events[0]).toMatchObject({ kind: 'edit' })
    expect(log.events[0].detail).toContain('a.ts')
  })

  it('records failures separately', () => {
    let log = emptyCodingTurnLog()
    log = recordCodingToolInTurnLog(
      log,
      'edit_code',
      { path: 'b.ts' },
      'Target snippet not found (3 lines; spaces must match)',
    )
    expect(log.events[0]?.kind).toBe('fail')
    expect(log.events[0]?.detail).toContain('b.ts')
  })

  it('records commands and check_types', () => {
    let log = emptyCodingTurnLog()
    log = recordCodingToolInTurnLog(
      log,
      'execute_command',
      { command: 'npm test' },
      '$ npm test\nok',
    )
    log = recordCodingToolInTurnLog(
      log,
      'check_types',
      {},
      'No TypeScript errors found (electron-app).',
    )
    expect(log.events.map((e) => e.kind)).toEqual(['command', 'check'])
  })
})

describe('buildCodingTurnSummary', () => {
  it('returns empty when log is empty', () => {
    expect(
      buildCodingTurnSummary({ userGoal: 'refactor', log: emptyCodingTurnLog() }),
    ).toBe('')
  })

  it('builds a compact digest with goal, changes, failures, and agent note', () => {
    let log = emptyCodingTurnLog()
    log = recordCodingToolInTurnLog(
      log,
      'edit_code',
      { path: 'src/a.ts' },
      'Edited src/a.ts (lines 1-3, first match)',
    )
    log = recordCodingToolInTurnLog(
      log,
      'write_file',
      { path: 'src/b.ts', content: 'x' },
      'Saved src/b.ts',
    )
    log = recordCodingToolInTurnLog(
      log,
      'edit_code',
      { path: 'src/c.ts' },
      'Target snippet not found',
    )
    const summary = buildCodingTurnSummary({
      userGoal: 'Refactor the coding memo to carry turn summaries across prompts',
      log,
      assistantReply: 'Done with a and b. Still need to fix c.ts matching.',
    })
    expect(summary).toContain('Last coding turn:')
    expect(summary).toContain('Goal:')
    expect(summary).toContain('Changed:')
    expect(summary).toContain('edited')
    expect(summary).toContain('wrote')
    expect(summary).toContain('Unresolved failures:')
    expect(summary).toContain('Agent note:')
    expect(summary).toContain('Continue from this state')
    expect(summary.length).toBeLessThanOrEqual(CODING_TURN_SUMMARY_MAX_CHARS)
  })

  it('caps summary length', () => {
    let log = emptyCodingTurnLog()
    for (let i = 0; i < 30; i++) {
      log = recordCodingToolInTurnLog(
        log,
        'edit_code',
        { path: `f${i}.ts` },
        `Edited f${i}.ts (lines 1-2, first match)`,
      )
    }
    const summary = buildCodingTurnSummary({
      userGoal: 'x'.repeat(500),
      log,
      assistantReply: 'y'.repeat(2000),
    })
    expect(summary.length).toBeLessThanOrEqual(CODING_TURN_SUMMARY_MAX_CHARS)
  })
})

describe('buildCodingMemoHint + lastTurnSummary', () => {
  it('includes lastTurnSummary near the top of the hint', () => {
    const memo = {
      ...emptyCodingContextMemo('/proj'),
      lastTurnSummary: 'Last coding turn:\nGoal: refactor\nChanged:\n- edited a.ts',
    }
    const hint = buildCodingMemoHint(memo)
    expect(hint.indexOf('Last coding turn:')).toBeLessThan(hint.indexOf('Recently opened'))
    expect(hint).toContain('edited a.ts')
  })

  it('normalizes lastTurnSummary from raw session data', () => {
    const n = normalizeCodingContextMemo(
      { lastTurnSummary: '  hello turn  ', recentFiles: ['a.ts'] },
      '/p',
    )
    expect(n.lastTurnSummary).toBe('hello turn')
    expect(n.recentFiles).toEqual(['a.ts'])
  })
})
