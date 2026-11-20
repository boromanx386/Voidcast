import { describe, expect, test } from 'vitest'
import { MCP_CALL_NAME, type McpToolInfo } from '@/lib/mcpTools'
import { buildToolsList, isPlanModeBlockedTool } from '@/lib/toolDefinitions'
import type { ToolsEnabled } from '@/lib/settings'
import type { AgentChatMode } from '@/types/chat'

const ALL_ON: ToolsEnabled = {
  webSearch: true,
  scrape: true,
  browser: true,
  pdf: true,
  youtube: true,
  runwareImage: true,
  runwareMusic: true,
  tts: true,
  coding: true,
  enterPlan: true,
}

// Stands in for servers from a trusted project's .mcp.json: trust decides whether
// they connect, never which MCP tools a read-only mode may call.
const MCP_TOOLS = [
  { serverId: 'proj', name: 'mcp__proj__write_thing', description: '', inputSchema: {} },
] as unknown as McpToolInfo[]

// Hidden in Ask / Plan but deliberately not blocked by the executor.
// enter_plan_mode only moves between read-only modes.
const HIDDEN_BUT_ALLOWED = new Set(['enter_plan_mode'])

function toolNames(mode: AgentChatMode): Set<string> {
  return new Set(
    buildToolsList(ALL_ON, true, {
      agentMode: mode,
      mcpTools: MCP_TOOLS,
      subAgentCodingEnabled: true,
      codingProjectPath: '/proj',
    }).map((t) => t.function.name),
  )
}

describe('Ask / Plan read-only rules', () => {
  const writable = new Set([...toolNames('agent'), ...toolNames('team')])

  for (const mode of ['ask', 'plan'] as const) {
    test(`${mode}: every tool hidden from the list is also blocked at execution`, () => {
      const listed = toolNames(mode)
      // A model can still call a hidden tool (e.g. from earlier Agent turns in the
      // same chat), so hiding alone is not a guard.
      const unguarded = [...writable].filter(
        (name) =>
          !listed.has(name) && !isPlanModeBlockedTool(name) && !HIDDEN_BUT_ALLOWED.has(name),
      )
      expect(unguarded).toEqual([])
    })

    test(`${mode}: never lists a tool the executor would block`, () => {
      expect([...toolNames(mode)].filter(isPlanModeBlockedTool)).toEqual([])
    })

    test(`${mode}: MCP discovery stays, mcp_call is gone even with project servers`, () => {
      const listed = toolNames(mode)
      expect(listed.has('mcp_list_tools')).toBe(true)
      expect(listed.has(MCP_CALL_NAME)).toBe(false)
      expect(isPlanModeBlockedTool(MCP_CALL_NAME)).toBe(true)
      expect(isPlanModeBlockedTool('mcp__proj__write_thing')).toBe(true)
    })
  }

  test('browser screenshots are blocked: they write files', () => {
    expect(isPlanModeBlockedTool('browser_take_screenshot')).toBe(true)
  })
})
