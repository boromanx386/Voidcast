import { describe, expect, it } from 'vitest'
import {
  AGENT_MAX_TOOL_ROUNDS_DEFAULT,
  AGENT_MAX_TOOL_ROUNDS_MAX,
  clampAgentMaxToolRounds,
} from '../src/lib/settings'

describe('clampAgentMaxToolRounds', () => {
  it('allows up to 300 rounds and keeps the default at 50', () => {
    expect(AGENT_MAX_TOOL_ROUNDS_MAX).toBe(300)
    expect(AGENT_MAX_TOOL_ROUNDS_DEFAULT).toBe(50)
    expect(clampAgentMaxToolRounds(250)).toBe(250)
    expect(clampAgentMaxToolRounds(1000)).toBe(300)
    expect(clampAgentMaxToolRounds(1)).toBe(5)
    expect(clampAgentMaxToolRounds(Number.NaN)).toBe(50)
  })
})
