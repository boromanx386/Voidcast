import { describe, expect, it } from 'vitest'
import {
  emptyCodingTurnLog,
  formatCodingTurnEvidenceLabel,
  isGitMutationDetail,
  recordCodingToolInTurnLog,
  summarizeCodingTurnEvidence,
} from '../src/lib/codingContextMemo'
import {
  isSuccessfulExecuteCommandResult,
  isSuccessfulRepoActionTool,
} from '../src/lib/agentToolUtils'

describe('summarizeCodingTurnEvidence', () => {
  it('empty log → no repo action', () => {
    const ev = summarizeCodingTurnEvidence(emptyCodingTurnLog())
    expect(ev.hadAnyToolEvents).toBe(false)
    expect(ev.hadRepoAction).toBe(false)
    expect(ev.filesChanged).toBe(0)
    expect(ev.commandsRun).toBe(0)
    expect(ev.gitMutations).toBe(0)
  })

  it('commit lie fixture: no events matches user report of fake commit', () => {
    const ev = summarizeCodingTurnEvidence(emptyCodingTurnLog())
    expect(formatCodingTurnEvidenceLabel(ev)).toBe('No coding tools were called this turn.')
  })

  it('records successful git commit via execute_command', () => {
    let log = emptyCodingTurnLog()
    log = recordCodingToolInTurnLog(
      log,
      'execute_command',
      { command: 'git commit -m "fix"' },
      '$ git commit -m "fix"\n[main abc1234] fix',
    )
    const ev = summarizeCodingTurnEvidence(log)
    expect(ev.hadCommand).toBe(true)
    expect(ev.hadRepoAction).toBe(true)
    expect(ev.commandsRun).toBe(1)
    expect(ev.commandSummaries[0]).toContain('git commit')
  })

  it('does not expose a command preview in the UI label', () => {
    let log = emptyCodingTurnLog()
    log = recordCodingToolInTurnLog(
      log,
      'execute_command',
      { command: 'nvidia-smi --query-gpu=name --format=csv' },
      '$ nvidia-smi --query-gpu=name --format=csv\nok',
    )
    const label = formatCodingTurnEvidenceLabel(summarizeCodingTurnEvidence(log))
    expect(label).toBe('0 file(s) · 1 command(s) · 0 git action(s)')
    expect(label).not.toContain('nvidia-smi')
  })

  it('records git_stash push as git mutation', () => {
    let log = emptyCodingTurnLog()
    log = recordCodingToolInTurnLog(log, 'git_stash', { action: 'push' }, 'stash@{0}: wip')
    const ev = summarizeCodingTurnEvidence(log)
    expect(ev.hadGitMutation).toBe(true)
    expect(ev.hadRepoAction).toBe(true)
    expect(ev.gitMutations).toBe(1)
  })

  it('read-only git_status is not a git mutation', () => {
    let log = emptyCodingTurnLog()
    log = recordCodingToolInTurnLog(log, 'git_status', {}, 'On branch main')
    const ev = summarizeCodingTurnEvidence(log)
    expect(ev.hadGitMutation).toBe(false)
    expect(ev.hadRepoAction).toBe(false)
    expect(ev.hadAnyToolEvents).toBe(true)
    expect(formatCodingTurnEvidenceLabel(ev)).toContain('Read-only')
  })

  it('records run_coding_workers', () => {
    let log = emptyCodingTurnLog()
    log = recordCodingToolInTurnLog(
      log,
      'run_coding_workers',
      { tasks: [{ goal: 'fix auth' }] },
      'Workers finished (2 tasks).',
    )
    expect(log.events.some((e) => e.kind === 'workers')).toBe(true)
    const ev = summarizeCodingTurnEvidence(log)
    expect(ev.hadFileMutation).toBe(true)
    expect(ev.hadRepoAction).toBe(true)
  })
})

describe('isGitMutationDetail', () => {
  it('distinguishes mutating vs read-only git lines', () => {
    expect(isGitMutationDetail('git_restore src/a.ts')).toBe(true)
    expect(isGitMutationDetail('git_stash push')).toBe(true)
    expect(isGitMutationDetail('git_stash pop')).toBe(true)
    expect(isGitMutationDetail('git_status')).toBe(false)
    expect(isGitMutationDetail('git_diff --staged')).toBe(false)
  })
})

describe('isSuccessfulRepoActionTool', () => {
  it('execute_command success requires shell echo line', () => {
    expect(isSuccessfulExecuteCommandResult('$ npm test\nok')).toBe(true)
    expect(isSuccessfulExecuteCommandResult('Error: failed')).toBe(false)
    expect(
      isSuccessfulRepoActionTool('execute_command', '$ git commit -m x\nok'),
    ).toBe(true)
    expect(isSuccessfulRepoActionTool('execute_command', 'Error: denied')).toBe(false)
  })
})
