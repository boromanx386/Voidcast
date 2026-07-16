import { describe, expect, test } from 'vitest'
import {
  convertMcpToolToOllama,
  formatMcpToolName,
  isMcpToolName,
  parseMcpToolName,
} from '@/lib/mcpTools'
import { isPlanModeBlockedTool } from '@/lib/toolDefinitions'

describe('mcpTools naming', () => {
  test('format and parse round-trip', () => {
    const q = formatMcpToolName('github', 'create_issue')
    expect(q).toBe('mcp__github__create_issue')
    expect(parseMcpToolName(q)).toEqual({ serverId: 'github', toolName: 'create_issue' })
  })

  test('parse tool names that contain underscores', () => {
    expect(parseMcpToolName('mcp__fs__list_directory')).toEqual({
      serverId: 'fs',
      toolName: 'list_directory',
    })
    expect(parseMcpToolName('mcp__a__b__c')).toEqual({
      serverId: 'a',
      toolName: 'b__c',
    })
  })

  test('isMcpToolName', () => {
    expect(isMcpToolName('mcp__x__y')).toBe(true)
    expect(isMcpToolName('read_file')).toBe(false)
  })

  test('convertMcpToolToOllama uses qualified name', () => {
    const def = convertMcpToolToOllama({
      serverId: 'github',
      name: 'create_issue',
      qualifiedName: 'mcp__github__create_issue',
      description: 'Create an issue',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Issue title' },
        },
        required: ['title'],
      },
    })
    expect(def.function.name).toBe('mcp__github__create_issue')
    expect(def.function.description).toContain('[mcp:github]')
    expect(def.function.parameters.required).toEqual(['title'])
  })

  test('plan mode blocks mcp tools', () => {
    expect(isPlanModeBlockedTool('mcp__github__create_issue')).toBe(true)
    expect(isPlanModeBlockedTool('read_file')).toBe(false)
  })
})
