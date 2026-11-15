import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { McpManager, loadMcpConfig } from '../electron/main/mcpManager'

let home = ''
let project = ''

beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'voidcast-mcp-home-'))
  project = await mkdtemp(path.join(os.tmpdir(), 'voidcast-mcp-project-'))
  vi.spyOn(os, 'homedir').mockReturnValue(home)
  await mkdir(path.join(home, '.voidcast'), { recursive: true })
  await writeFile(
    path.join(home, '.voidcast', 'mcp.json'),
    JSON.stringify({
      mcpServers: {
        alpha: { command: 'node', args: ['alpha.js'] },
        beta: { url: 'http://127.0.0.1:3000/mcp' },
      },
    }),
  )
  await writeFile(
    path.join(project, '.mcp.json'),
    JSON.stringify({ mcpServers: { gamma: { command: 'node', args: ['gamma.js'] } } }),
  )
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(home, { recursive: true, force: true })
  await rm(project, { recursive: true, force: true })
})

/** Pretend a previous ensure connected `id` from `config`, without spawning anything. */
function fakeConnected(mgr: McpManager, id: string, config: object, toolCount: number): void {
  const internals = mgr as unknown as {
    servers: Map<string, { tools: unknown[] }>
    lastServerConfigs: Record<string, object>
  }
  internals.servers.set(id, { tools: Array.from({ length: toolCount }, () => ({})) })
  internals.lastServerConfigs = { ...internals.lastServerConfigs, [id]: config }
}

describe('McpManager.statusFor', () => {
  test('lists the folder config before anything has connected', async () => {
    const status = await new McpManager().statusFor(
      project,
      { beta: false },
      { allowProjectConfig: true },
    )
    expect(status.map((s) => [s.id, s.state])).toEqual([
      ['alpha', 'stopped'],
      ['beta', 'disabled'],
      ['gamma', 'stopped'],
    ])
  })

  test('leaves out an untrusted project config', async () => {
    const status = await new McpManager().statusFor(project, {}, { allowProjectConfig: false })
    expect(status.map((s) => s.id)).toEqual(['alpha', 'beta'])
  })

  test('reports a live connection started from the same config', async () => {
    const mgr = new McpManager()
    // Same parser as a real ensure, so the stored config has the same shape.
    const parsed = await loadMcpConfig(project, { allowProjectConfig: true })
    fakeConnected(mgr, 'alpha', parsed.mcpServers.alpha ?? {}, 3)
    const status = await mgr.statusFor(project, {}, { allowProjectConfig: true })
    expect(status.find((s) => s.id === 'alpha')).toMatchObject({ state: 'running', toolCount: 3 })
  })

  test("does not report another project's server under the same id as running", async () => {
    const mgr = new McpManager()
    fakeConnected(mgr, 'gamma', { command: 'node', args: ['other-project.js'] }, 2)
    const status = await mgr.statusFor(project, {}, { allowProjectConfig: true })
    expect(status.find((s) => s.id === 'gamma')).toMatchObject({ state: 'stopped', toolCount: 0 })
  })
})
