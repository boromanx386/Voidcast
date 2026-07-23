import { describe, expect, it } from 'vitest'
import {
  TOOL_BUDGET_EXHAUSTED_FALLBACK_REPLY,
  TOOL_BUDGET_EXHAUSTED_REPROMPT_MESSAGE,
  TOOL_BUDGET_WARNING_REPROMPT_MESSAGE,
} from '../src/lib/agentToolUtils'

describe('tool budget wrap-up prompts', () => {
  it('warning asks to finish soon without mentioning budget to the user', () => {
    expect(TOOL_BUDGET_WARNING_REPROMPT_MESSAGE).toMatch(/nearing the tool-call budget/i)
    expect(TOOL_BUDGET_WARNING_REPROMPT_MESSAGE).toMatch(/Do not mention this budget warning/i)
  })

  it('exhausted prompt forbids more tools and asks for a final reply', () => {
    expect(TOOL_BUDGET_EXHAUSTED_REPROMPT_MESSAGE).toMatch(/Do NOT call any more tools/i)
    expect(TOOL_BUDGET_EXHAUSTED_REPROMPT_MESSAGE).toMatch(/final user-visible reply/i)
  })

  it('fallback reply is user-facing when the model returns empty', () => {
    expect(TOOL_BUDGET_EXHAUSTED_FALLBACK_REPLY.length).toBeGreaterThan(20)
    expect(TOOL_BUDGET_EXHAUSTED_FALLBACK_REPLY).toMatch(/budget reached/i)
  })
})
