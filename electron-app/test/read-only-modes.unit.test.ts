import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MCP_CALL_NAME, type McpToolInfo } from '@/lib/mcpTools'
import { buildToolsList, isPlanModeBlockedTool } from '@/lib/toolDefinitions'
import type { ExecCtx } from '@/lib/toolExecTypes'
import { handleBrowserTakeScreenshot } from '@/lib/toolHandlers/browserHandlers'
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
    test(`${mode}: screenshots are offered, but without a project path`, () => {
      const tool = buildToolsList(ALL_ON, false, { agentMode: mode }).find(
        (t) => t.function.name === 'browser_take_screenshot',
      )
      expect(tool).toBeDefined()
      expect(Object.keys(tool!.function.parameters.properties ?? {})).not.toContain('path')
    })
  }

  test('agent: screenshots keep the project path', () => {
    const tool = buildToolsList(ALL_ON, false, { agentMode: 'agent' }).find(
      (t) => t.function.name === 'browser_take_screenshot',
    )
    expect(Object.keys(tool!.function.parameters.properties ?? {})).toContain('path')
  })
})

describe('browser_take_screenshot handler in read-only modes', () => {
  const screenshot = vi.fn(async (_req: { path?: string }) => ({
    ok: true,
    path: '/proj/.voidcast/browser/shots/a.jpg',
    relativePath: '.voidcast/browser/shots/a.jpg',
    bytes: 1,
    width: 1,
    height: 1,
  }))

  beforeEach(() => {
    screenshot.mockClear()
    vi.stubGlobal('window', { voidcast: { browser: { screenshot } } })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const ctx = (agentMode: AgentChatMode) =>
    ({ agentMode, toolsEnabled: ALL_ON, codingProjectPath: '/proj' }) as unknown as ExecCtx

  test('refuses a path in Ask and Plan without writing anything', async () => {
    for (const mode of ['ask', 'plan'] as const) {
      const out = await handleBrowserTakeScreenshot({ path: 'shots/home.png' }, ctx(mode))
      expect(out).toMatch(/^Error: `path` is not available/)
    }
    expect(screenshot).not.toHaveBeenCalled()
  })

  test('captures without a path in Ask and Plan', async () => {
    for (const mode of ['ask', 'plan'] as const) {
      const out = await handleBrowserTakeScreenshot({}, ctx(mode))
      expect(out).toMatch(/^Screenshot saved/)
    }
    expect(screenshot).toHaveBeenCalledTimes(2)
    expect(screenshot.mock.calls.every(([req]) => req.path === undefined)).toBe(true)
  })

  test('Agent mode still saves at the given path', async () => {
    await handleBrowserTakeScreenshot({ path: 'shots/home.png' }, ctx('agent'))
    expect(screenshot.mock.calls[0][0].path).toBe('shots/home.png')
  })
})
