import { describe, expect, it } from 'vitest'
import { isPlanModeBlockedTool } from '../src/lib/toolDefinitions'
import { CODING_ACTION_TOOLS } from '../src/lib/agentToolUtils'
import { isCodingToolFailure } from '../src/lib/codingContextMemo'

describe('git_restore / git_stash agent tools', () => {
  it('are mutating tools blocked in Plan mode', () => {
    expect(isPlanModeBlockedTool('git_restore')).toBe(true)
    expect(isPlanModeBlockedTool('git_stash')).toBe(true)
    expect(isPlanModeBlockedTool('git_status')).toBe(false)
  })

  it('count as coding action tools for false-claim guard', () => {
    expect(CODING_ACTION_TOOLS.has('git_restore')).toBe(true)
    expect(CODING_ACTION_TOOLS.has('git_stash')).toBe(true)
  })

  it('detects restore success/failure from result text', () => {
    expect(
      isCodingToolFailure(
        'git_restore',
        'restored (worktree from index): src/a.ts',
      ),
    ).toBe(false)
    expect(isCodingToolFailure('git_restore', 'Error: Missing path for git discard.')).toBe(
      true,
    )
    expect(isCodingToolFailure('git_restore', 'pathspec did not match')).toBe(true)
  })

  it('treats stash list/push-ish success as non-failure', () => {
    expect(isCodingToolFailure('git_stash', '(no stashes)')).toBe(false)
    expect(isCodingToolFailure('git_stash', 'stash@{0}: On main: voidcast checkpoint')).toBe(
      false,
    )
    expect(isCodingToolFailure('git_stash', 'Invalid stash ref. Use stash@{n}')).toBe(true)
  })
})
