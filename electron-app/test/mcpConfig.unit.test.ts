import { describe, expect, test } from 'vitest'
import { mergeMcpConfigs, parseMcpConfigJson } from '../electron/main/mcpManager'

describe('parseMcpConfigJson', () => {
  test('parses stdio and url servers', () => {
    const cfg = parseMcpConfigJson(
      JSON.stringify({
        mcpServers: {
          local: { command: 'node', args: ['server.js'], cwd: '/tmp' },
          remote: { url: 'http://127.0.0.1:3000/mcp' },
          bad__id: { command: 'x' },
          empty: {},
        },
      }),
    )
    expect(Object.keys(cfg.mcpServers).sort()).toEqual(['local', 'remote'])
    expect(cfg.mcpServers.local?.command).toBe('node')
    expect(cfg.mcpServers.remote?.url).toBe('http://127.0.0.1:3000/mcp')
  })

  test('invalid JSON returns empty config', () => {
    expect(parseMcpConfigJson('{not json')).toEqual({ mcpServers: {} })
  })

  test('parses oauth config for remote servers', () => {
    const cfg = parseMcpConfigJson(
      JSON.stringify({
        mcpServers: {
          github: {
            url: 'https://example.com/mcp',
            oauth: {
              scope: 'repo',
              clientId: 'app-id',
            },
          },
          simple: {
            url: 'https://example.com/simple',
            oauth: true,
          },
        },
      }),
    )
    expect(cfg.mcpServers.github?.oauth).toEqual({
      scope: 'repo',
      clientId: 'app-id',
    })
    expect(cfg.mcpServers.simple?.oauth).toBe(true)
  })
})

describe('mergeMcpConfigs', () => {
  test('project servers override global ids', () => {
    const merged = mergeMcpConfigs(
      {
        mcpServers: {
          shared: { command: 'global' },
          onlyGlobal: { command: 'g' },
        },
      },
      {
        mcpServers: {
          shared: { command: 'project' },
          onlyProject: { url: 'http://localhost/mcp' },
        },
      },
    )
    expect(merged.mcpServers.shared?.command).toBe('project')
    expect(merged.mcpServers.onlyGlobal?.command).toBe('g')
    expect(merged.mcpServers.onlyProject?.url).toBe('http://localhost/mcp')
  })
})
