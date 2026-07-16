/**
 * MCP (Model Context Protocol) client manager.
 * Supports stdio (`command`) and remote (`url`) servers — Cursor-compatible mcp.json.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

export type McpServerConfig = {
  /** stdio */
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  /** remote HTTP / SSE (Cursor-style) */
  url?: string
  headers?: Record<string, string>
  /** optional hint: stdio | http | sse */
  type?: string
}

export type McpConfig = {
  mcpServers: Record<string, McpServerConfig>
}

export type McpToolInfo = {
  serverId: string
  name: string
  /** Qualified name: mcp__{serverId}__{toolName} */
  qualifiedName: string
  description: string
  parameters: Record<string, unknown>
}

export type McpServerStatus = {
  id: string
  state: 'running' | 'error' | 'stopped'
  toolCount: number
  error?: string
}

type RunningServer = {
  client: Client
  transport: Transport
  tools: McpToolInfo[]
  error?: string
}

const EMPTY_CONFIG: McpConfig = { mcpServers: {} }

const EMPTY_TEMPLATE = `{
  "mcpServers": {
    "wangp": {
      "url": "http://127.0.0.1:7866/mcp"
    }
  }
}
`

export function getGlobalMcpConfigPath(): string {
  return path.join(os.homedir(), '.voidcast', 'mcp.json')
}

export function formatMcpToolName(serverId: string, toolName: string): string {
  return `mcp__${serverId}__${toolName}`
}

export function parseMcpToolName(
  qualifiedName: string,
): { serverId: string; toolName: string } | null {
  if (!qualifiedName.startsWith('mcp__')) return null
  const rest = qualifiedName.slice('mcp__'.length)
  const idx = rest.indexOf('__')
  if (idx <= 0 || idx >= rest.length - 2) return null
  return {
    serverId: rest.slice(0, idx),
    toolName: rest.slice(idx + 2),
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseStringRecord(raw: unknown): Record<string, string> | undefined {
  if (!isPlainObject(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function parseServerConfig(raw: unknown): McpServerConfig | null {
  if (!isPlainObject(raw)) return null

  const url = typeof raw.url === 'string' ? raw.url.trim() : ''
  const command = typeof raw.command === 'string' ? raw.command.trim() : ''
  const type = typeof raw.type === 'string' ? raw.type.trim().toLowerCase() : undefined
  const args = Array.isArray(raw.args)
    ? raw.args.filter((a): a is string => typeof a === 'string')
    : undefined
  const env = parseStringRecord(raw.env)
  const headers = parseStringRecord(raw.headers)
  const cwd = typeof raw.cwd === 'string' && raw.cwd.trim() ? raw.cwd.trim() : undefined

  if (url) {
    return { url, headers, env, type: type || 'http' }
  }
  if (command) {
    return { command, args, env, cwd, type: type || 'stdio' }
  }
  return null
}

function parseMcpConfigJson(raw: string): McpConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return EMPTY_CONFIG
  }
  if (!isPlainObject(parsed)) return EMPTY_CONFIG
  const serversRaw = parsed.mcpServers
  if (!isPlainObject(serversRaw)) return EMPTY_CONFIG
  const mcpServers: Record<string, McpServerConfig> = {}
  for (const [id, cfg] of Object.entries(serversRaw)) {
    const key = id.trim()
    if (!key || key.includes('__')) continue
    const server = parseServerConfig(cfg)
    if (server) mcpServers[key] = server
  }
  return { mcpServers }
}

async function readConfigFile(filePath: string): Promise<McpConfig> {
  try {
    if (!existsSync(filePath)) return EMPTY_CONFIG
    const raw = await readFile(filePath, 'utf8')
    return parseMcpConfigJson(raw)
  } catch {
    return EMPTY_CONFIG
  }
}

export async function loadMcpConfig(projectPath?: string): Promise<McpConfig> {
  const globalCfg = await readConfigFile(getGlobalMcpConfigPath())
  const projectRoot = (projectPath || '').trim()
  if (!projectRoot) return globalCfg
  const projectCfg = await readConfigFile(path.join(projectRoot, '.mcp.json'))
  return {
    mcpServers: {
      ...globalCfg.mcpServers,
      ...projectCfg.mcpServers,
    },
  }
}

function schemaToParameters(inputSchema: unknown): Record<string, unknown> {
  if (isPlainObject(inputSchema)) {
    return {
      ...inputSchema,
      type: typeof inputSchema.type === 'string' ? inputSchema.type : 'object',
    }
  }
  return { type: 'object', properties: {} }
}

function toolResultToString(result: {
  content?: unknown[]
  isError?: boolean
  structuredContent?: unknown
}): string {
  const parts: string[] = []
  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      if (!isPlainObject(block)) continue
      if (block.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text)
      } else if (block.type === 'image') {
        parts.push('[image content omitted]')
      } else if (block.type === 'audio') {
        parts.push('[audio content omitted]')
      } else if (block.type === 'resource' || block.type === 'resource_link') {
        parts.push(JSON.stringify(block))
      } else {
        parts.push(JSON.stringify(block))
      }
    }
  }
  if (parts.length === 0 && result.structuredContent != null) {
    parts.push(JSON.stringify(result.structuredContent))
  }
  const text = parts.join('\n').trim() || '(empty MCP tool result)'
  if (result.isError) return `Error: ${text}`
  return text
}

function resolveStdioCommand(command: string): string {
  if (process.platform !== 'win32') return command
  const lower = command.toLowerCase()
  if (lower === 'npx') return 'npx.cmd'
  if (lower === 'npm') return 'npm.cmd'
  if (lower === 'node') return 'node.exe'
  return command
}

function looksLikePlaceholderPath(p: string): boolean {
  const n = p.replace(/\\/g, '/').toLowerCase()
  return (
    n.includes('/path/to/') ||
    n === 'c:/path/to/allowed' ||
    n.endsWith('/allowed') && n.includes('path/to')
  )
}

function formatError(e: unknown): string {
  if (e instanceof Error) {
    const cause =
      e.cause instanceof Error
        ? e.cause.message
        : e.cause != null
          ? String(e.cause)
          : ''
    return cause ? `${e.message} (${cause})` : e.message
  }
  return String(e)
}

async function connectClient(transport: Transport): Promise<{
  client: Client
  tools: McpToolInfo[]
}> {
  const client = new Client({ name: 'voidcast', version: '1.0.0' }, { capabilities: {} })
  await client.connect(transport)
  const listed = await client.listTools()
  return {
    client,
    tools: (listed.tools ?? []).map((t) => ({
      serverId: '', // filled by caller
      name: t.name,
      qualifiedName: '', // filled by caller
      description: t.description?.trim() || `MCP tool ${t.name}`,
      parameters: schemaToParameters(t.inputSchema),
    })),
  }
}

async function safeClose(client: Client | null, transport: Transport | null): Promise<void> {
  if (client) {
    try {
      await client.close()
    } catch {
      /* ignore */
    }
  }
  if (transport) {
    try {
      await transport.close()
    } catch {
      /* ignore */
    }
  }
}

export class McpManager {
  private servers = new Map<string, RunningServer>()
  /** null = never connected; string = project path key used for last successful ensure/reload */
  private connectedForProject: string | null = null
  private connectPromise: Promise<void> | null = null

  getStatus(): McpServerStatus[] {
    const out: McpServerStatus[] = []
    for (const [id, entry] of this.servers) {
      if (entry.error) {
        out.push({
          id,
          state: 'error',
          toolCount: entry.tools.length,
          error: entry.error,
        })
      } else {
        out.push({
          id,
          state: 'running',
          toolCount: entry.tools.length,
        })
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id))
  }

  listTools(): McpToolInfo[] {
    const out: McpToolInfo[] = []
    for (const entry of this.servers.values()) {
      if (entry.error) continue
      out.push(...entry.tools)
    }
    return out
  }

  async ensureConnected(projectPath?: string): Promise<void> {
    const project = (projectPath || '').trim()
    if (this.connectPromise) {
      await this.connectPromise
      if (this.connectedForProject === project) return
    } else if (this.connectedForProject === project) {
      return
    }
    this.connectPromise = this.connectAll(project)
    try {
      await this.connectPromise
      this.connectedForProject = project
    } finally {
      this.connectPromise = null
    }
  }

  async reload(projectPath?: string): Promise<{ ok: true; status: McpServerStatus[] }> {
    await this.stopAll()
    const project = (projectPath || '').trim()
    await this.connectAll(project)
    this.connectedForProject = project
    return { ok: true, status: this.getStatus() }
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const entry = this.servers.get(serverId)
    if (!entry) {
      return `Error: MCP server "${serverId}" is not running.`
    }
    if (entry.error) {
      return `Error: MCP server "${serverId}" failed to start: ${entry.error}`
    }
    try {
      const result = await entry.client.callTool({
        name: toolName,
        arguments: args,
      })
      return toolResultToString(
        result as { content?: unknown[]; isError?: boolean; structuredContent?: unknown },
      )
    } catch (e) {
      return `Error: MCP tool "${formatMcpToolName(serverId, toolName)}" failed: ${formatError(e)}`
    }
  }

  async stopAll(): Promise<void> {
    const entries = [...this.servers.entries()]
    this.servers.clear()
    this.connectedForProject = null
    await Promise.all(entries.map(([, entry]) => safeClose(entry.client, entry.transport)))
  }

  async ensureGlobalConfigExists(): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
    const configPath = getGlobalMcpConfigPath()
    try {
      const dir = path.dirname(configPath)
      await mkdir(dir, { recursive: true })
      if (!existsSync(configPath)) {
        await writeFile(configPath, EMPTY_TEMPLATE, 'utf8')
      }
      return { ok: true, path: configPath }
    } catch (e) {
      return {
        ok: false,
        error: formatError(e),
      }
    }
  }

  private async connectAll(projectPath: string): Promise<void> {
    const config = await loadMcpConfig(projectPath || undefined)
    const ids = Object.keys(config.mcpServers)
    if (ids.length === 0) return

    await Promise.all(
      ids.map(async (id) => {
        const cfg = config.mcpServers[id]
        if (!cfg) return
        await this.startServer(id, cfg)
      }),
    )
  }

  private setError(id: string, message: string): void {
    this.servers.set(id, {
      client: new Client({ name: 'voidcast', version: '1.0.0' }, { capabilities: {} }),
      transport: {
        start: async () => {},
        send: async () => {},
        close: async () => {},
      },
      tools: [],
      error: message,
    })
  }

  private async startServer(id: string, config: McpServerConfig): Promise<void> {
    try {
      if (config.url) {
        await this.startUrlServer(id, config)
      } else if (config.command) {
        await this.startStdioServer(id, config)
      } else {
        this.setError(id, 'Invalid MCP config: need either "url" or "command".')
      }
    } catch (e) {
      this.setError(id, formatError(e))
    }
  }

  private attachTools(id: string, client: Client, transport: Transport, tools: McpToolInfo[]): void {
    const labeled = tools.map((t) => ({
      ...t,
      serverId: id,
      qualifiedName: formatMcpToolName(id, t.name),
      description: t.description.startsWith('[mcp:')
        ? t.description
        : `[mcp:${id}] ${t.description}`,
    }))
    this.servers.set(id, { client, transport, tools: labeled })
  }

  private async startStdioServer(id: string, config: McpServerConfig): Promise<void> {
    const command = resolveStdioCommand(config.command!)
    const args = config.args ?? []

    for (const a of args) {
      if (looksLikePlaceholderPath(a)) {
        this.setError(
          id,
          `Placeholder path in args: "${a}". Replace with a real folder that exists on disk.`,
        )
        return
      }
    }

    const env = {
      ...getDefaultEnvironment(),
      ...(config.env ?? {}),
    }

    const transport = new StdioClientTransport({
      command,
      args,
      env,
      cwd: config.cwd,
      stderr: 'pipe',
    })

    const stderrChunks: string[] = []
    const stderr = transport.stderr as { on?: (event: string, cb: (buf: Buffer | string) => void) => void } | null
    if (stderr?.on) {
      stderr.on('data', (buf: Buffer | string) => {
        stderrChunks.push(typeof buf === 'string' ? buf : buf.toString('utf8'))
      })
    }

    let client: Client | null = null
    try {
      const connected = await connectClient(transport)
      client = connected.client
      this.attachTools(id, connected.client, transport, connected.tools)
    } catch (e) {
      await safeClose(client, transport)
      const stderrText = stderrChunks.join('').trim().slice(0, 500)
      const base = formatError(e)
      this.setError(
        id,
        stderrText
          ? `${base}. stderr: ${stderrText}`
          : `${base}. If using npx on Windows, ensure Node is installed; for filesystem, pass a real existing path (not C:/path/to/allowed).`,
      )
    }
  }

  private buildRequestInit(config: McpServerConfig): RequestInit | undefined {
    const headers: Record<string, string> = { ...(config.headers ?? {}) }
    // Common Cursor pattern: API keys in env that map to Authorization
    if (config.env) {
      for (const [k, v] of Object.entries(config.env)) {
        if (/authorization/i.test(k) && !headers.Authorization && !headers.authorization) {
          headers.Authorization = v
        } else if (!headers[k] && /api[_-]?key/i.test(k)) {
          // leave env for process; also pass as header if server expects it
          if (!headers['Authorization'] && !headers['X-API-Key']) {
            headers['Authorization'] = v.startsWith('Bearer ') ? v : `Bearer ${v}`
          }
        }
      }
    }
    return Object.keys(headers).length > 0 ? { headers } : undefined
  }

  private async startUrlServer(id: string, config: McpServerConfig): Promise<void> {
    const urlStr = config.url!
    let url: URL
    try {
      url = new URL(urlStr)
    } catch {
      this.setError(id, `Invalid MCP url: ${urlStr}`)
      return
    }

    const requestInit = this.buildRequestInit(config)
    const preferSse = (config.type || '').toLowerCase() === 'sse'
    const errors: string[] = []

    const tryTransport = async (
      label: string,
      make: () => Transport,
    ): Promise<boolean> => {
      const transport = make()
      let client: Client | null = null
      try {
        const connected = await connectClient(transport)
        client = connected.client
        this.attachTools(id, connected.client, transport, connected.tools)
        return true
      } catch (e) {
        errors.push(`${label}: ${formatError(e)}`)
        await safeClose(client, transport)
        return false
      }
    }

    if (preferSse) {
      if (
        await tryTransport(
          'sse',
          () => new SSEClientTransport(url, requestInit ? { requestInit } : undefined),
        )
      ) {
        return
      }
      if (
        await tryTransport(
          'streamable-http',
          () => new StreamableHTTPClientTransport(url, requestInit ? { requestInit } : undefined),
        )
      ) {
        return
      }
    } else {
      if (
        await tryTransport(
          'streamable-http',
          () => new StreamableHTTPClientTransport(url, requestInit ? { requestInit } : undefined),
        )
      ) {
        return
      }
      if (
        await tryTransport(
          'sse',
          () => new SSEClientTransport(url, requestInit ? { requestInit } : undefined),
        )
      ) {
        return
      }
    }

    this.setError(
      id,
      `Failed to connect to ${urlStr}. ${errors.join(' | ')}. ` +
        `If the server needs auth, add "headers": { "Authorization": "Bearer …" }.`,
    )
  }
}

export const mcpManager = new McpManager()
