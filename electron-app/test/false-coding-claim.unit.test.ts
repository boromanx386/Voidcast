import { describe, expect, it } from 'vitest'
import {
  CODING_ACTION_TOOLS,
  assistantClaimsCodingActionWithoutTool,
  shouldGuardFalseCodingClaims,
} from '../src/lib/agentToolUtils'

describe('CODING_ACTION_TOOLS', () => {
  it('contains only mutating coding tools', () => {
    expect(CODING_ACTION_TOOLS.has('write_file')).toBe(true)
    expect(CODING_ACTION_TOOLS.has('edit_code')).toBe(true)
    expect(CODING_ACTION_TOOLS.has('execute_command')).toBe(true)
    expect(CODING_ACTION_TOOLS.has('read_file')).toBe(false)
    expect(CODING_ACTION_TOOLS.has('git_diff')).toBe(false)
    expect(CODING_ACTION_TOOLS.has('search_files')).toBe(false)
  })
})

describe('assistantClaimsCodingActionWithoutTool', () => {
  it('detects English first-person done claims about code/files', () => {
    expect(
      assistantClaimsCodingActionWithoutTool("I've updated the function in utils.ts to handle null."),
    ).toBe(true)
    expect(
      assistantClaimsCodingActionWithoutTool('I have created the file config.json with the settings.'),
    ).toBe(true)
    expect(
      assistantClaimsCodingActionWithoutTool('Done. I fixed the bug in the login component.'),
    ).toBe(true)
  })

  it('detects Serbian first-person done claims', () => {
    expect(assistantClaimsCodingActionWithoutTool('Izmenio sam fajl settings.ts kao što si tražio.')).toBe(true)
    expect(assistantClaimsCodingActionWithoutTool('Dodao sam novu funkciju u komponentu.')).toBe(true)
    expect(assistantClaimsCodingActionWithoutTool('Popravio sam bug u kodu.')).toBe(true)
  })

  it('detects passive "file was saved / changes applied" claims', () => {
    expect(assistantClaimsCodingActionWithoutTool('The file has been saved to src/index.ts.')).toBe(true)
    expect(assistantClaimsCodingActionWithoutTool('Changes have been applied successfully.')).toBe(true)
    expect(assistantClaimsCodingActionWithoutTool('Fajl je sačuvan u projektu.')).toBe(true)
  })

  it('detects "I ran the command/tests" claims', () => {
    expect(assistantClaimsCodingActionWithoutTool('I ran the tests and everything passes.')).toBe(true)
    expect(assistantClaimsCodingActionWithoutTool("I've executed the build script.")).toBe(true)
  })

  it('ignores suggestions, questions, and plans', () => {
    expect(assistantClaimsCodingActionWithoutTool('You should edit utils.ts and add a null check.')).toBe(false)
    expect(assistantClaimsCodingActionWithoutTool('I will update the function next.')).toBe(false)
    expect(assistantClaimsCodingActionWithoutTool('To fix this, change line 42 in app.ts.')).toBe(false)
    expect(assistantClaimsCodingActionWithoutTool('Treba da izmeniš fajl settings.ts.')).toBe(false)
  })

  it('ignores references to earlier turns', () => {
    expect(
      assistantClaimsCodingActionWithoutTool('I edited that file earlier in this session, so it is up to date.'),
    ).toBe(false)
    expect(assistantClaimsCodingActionWithoutTool('Ranije sam izmenio taj fajl, sve je ažurno.')).toBe(false)
  })

  it('ignores done claims without any code/file context', () => {
    expect(assistantClaimsCodingActionWithoutTool('I have added more detail to my explanation.')).toBe(false)
  })

  it('ignores empty text', () => {
    expect(assistantClaimsCodingActionWithoutTool('')).toBe(false)
    expect(assistantClaimsCodingActionWithoutTool('   ')).toBe(false)
  })
})

describe('shouldGuardFalseCodingClaims', () => {
  it('guards when user asked for an action and assistant claims done', () => {
    expect(
      shouldGuardFalseCodingClaims("I've updated the file as requested.", 'fix the bug in settings.ts'),
    ).toBe(true)
    expect(
      shouldGuardFalseCodingClaims('Izmenio sam kod u komponenti.', 'izmeni tu komponentu da radi'),
    ).toBe(true)
  })

  it('skips when user only asked a question', () => {
    expect(
      shouldGuardFalseCodingClaims("I've updated my summary of the file.", 'what does this file do?'),
    ).toBe(false)
  })

  it('skips when assistant made no done claim', () => {
    expect(
      shouldGuardFalseCodingClaims('Here is my plan for the refactor.', 'refactor the settings module'),
    ).toBe(false)
  })
})
