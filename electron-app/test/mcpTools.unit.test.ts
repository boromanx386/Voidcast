import { describe, expect, test } from 'vitest'
import {
  convertMcpToolToOllama,
  formatMcpGetToolResult,
  formatMcpToolName,
  formatMcpToolsListResult,
  isMcpMetaToolName,
  isMcpToolName,
  MCP_CALL_NAME,
  MCP_GET_TOOL_NAME,
  MCP_LIST_TOOLS_NAME,
  MCP_READ_RESULT_NAME,
  parseMcpToolName,
  type McpToolInfo,
} from '@/lib/mcpTools'
import { buildOllamaToolsList, isPlanModeBlockedTool } from '@/lib/toolDefinitions'

const sampleTools: McpToolInfo[] = [
  {
    serverId: 'runware',
    name: 'list_models',
    qualifiedName: 'mcp__runware__list_models',
    description: 'List curated models with a very long description '.repeat(20),
    parameters: {
      type: 'object',
      properties: { search: { type: 'string' } },
    },
  },
  {
    serverId: 'wangp',
    name: 'ping',
    qualifiedName: 'mcp__wangp__ping',
    description: 'Health check',
    parameters: { type: 'object', properties: {} },
  },
]

describe('mcpTools naming', () => {
  test('format and parse round-trip', () => {
    const q = formatMcpToolName('github', 'create_issue')
    expect(q).toBe('mcp__github__create_issue')
    expect(parseMcpToolName(q)).toEqual({ serverId: 'github', toolName: 'create_issue' })
  })

  test('isMcpToolName / meta names', () => {
    expect(isMcpToolName('mcp__x__y')).toBe(true)
    expect(isMcpMetaToolName(MCP_LIST_TOOLS_NAME)).toBe(true)
    expect(isMcpMetaToolName(MCP_GET_TOOL_NAME)).toBe(true)
    expect(isMcpMetaToolName(MCP_CALL_NAME)).toBe(true)
    expect(isMcpMetaToolName(MCP_READ_RESULT_NAME)).toBe(true)
  })

  test('plan mode blocks mcp_call and direct mcp__* but not list/get/read', () => {
    expect(isPlanModeBlockedTool(MCP_CALL_NAME)).toBe(true)
    expect(isPlanModeBlockedTool('mcp__github__create_issue')).toBe(true)
    expect(isPlanModeBlockedTool(MCP_LIST_TOOLS_NAME)).toBe(false)
    expect(isPlanModeBlockedTool(MCP_GET_TOOL_NAME)).toBe(false)
    expect(isPlanModeBlockedTool(MCP_READ_RESULT_NAME)).toBe(false)
  })
})

describe('mcp progressive disclosure (3 layers)', () => {
  test('list returns summary only — never schemas', () => {
    const summary = formatMcpToolsListResult(sampleTools, { query: 'runware' })
    expect(summary).toContain('mcp__runware__list_models')
    expect(summary).not.toContain('"parameters"')
    expect(summary).toContain('summary only')
  })

  test('get returns schema for exactly one tool', () => {
    const schema = formatMcpGetToolResult(sampleTools, 'mcp__runware__list_models')
    expect(schema).toContain('"parameters"')
    expect(schema).toContain('list_models')
    expect(schema).not.toContain('wangp')
  })

  test('get unknown tool errors', () => {
    expect(formatMcpGetToolResult(sampleTools, 'mcp__nope__x')).toMatch(/^Error:/)
  })

  test('buildOllamaToolsList exposes list + get + read + call (no mcp__*)', () => {
    const tools = buildOllamaToolsList(
      {
        webSearch: false,
        youtube: false,
        reddit: false,
        weather: false,
        scrape: false,
        pdf: false,
        runwareImage: false,
        runwareMusic: false,
        coding: false,
        enterPlan: false,
      },
      false,
      { mcpTools: sampleTools },
    )
    const names = tools.map((t) => t.function.name)
    expect(names).toContain(MCP_LIST_TOOLS_NAME)
    expect(names).toContain(MCP_GET_TOOL_NAME)
    expect(names).toContain(MCP_READ_RESULT_NAME)
    expect(names).toContain(MCP_CALL_NAME)
    expect(names.some((n) => n.startsWith('mcp__'))).toBe(false)
  })

  test('convertMcpToolToOllama still works for legacy', () => {
    const def = convertMcpToolToOllama(sampleTools[0]!)
    expect(def.function.name).toBe('mcp__runware__list_models')
  })
})
