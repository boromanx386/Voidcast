/**
 * MCP (Model Context Protocol) client manager.
 * Supports stdio (`command`) and remote (`url`) servers — Cursor-compatible mcp.json.
 */
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
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
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  clearMcpOAuthSession,
  createVoidcastMcpOAuthProvider,
  isMcpOAuthEnabled,
  mcpOAuthEvents,
  transportHasFinishAuth,
  type McpOAuthConfig,
  type McpServerAuthState,
} from './mcpOAuth.js'

export type { McpOAuthConfig, McpServerAuthState } from './mcpOAuth.js'

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
  /** Enable MCP OAuth (browser sign-in) for remote servers */
  oauth?: boolean | McpOAuthConfig
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
  state: 'running' | 'error' | 'stopped' | 'disabled'
  toolCount: number
  error?: string
  oauthEnabled?: boolean
  authState?: McpServerAuthState
}

type RunningServer = {
  client: Client
  transport: Transport
  tools: McpToolInfo[]
  error?: string
  oauthEnabled?: boolean
  authState?: McpServerAuthState
}

type PendingOAuthSession = {
  transport: Transport
  config: McpServerConfig
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

function parseOAuthConfig(raw: unknown): boolean | McpOAuthConfig | undefined {
  if (raw === true) return true
  if (!isPlainObject(raw)) return undefined
  const out: McpOAuthConfig = {}
  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled
  if (typeof raw.clientId === 'string' && raw.clientId.trim()) out.clientId = raw.clientId.trim()
  if (typeof raw.clientSecret === 'string' && raw.clientSecret.trim()) {
    out.clientSecret = raw.clientSecret.trim()
  }
  if (typeof raw.redirectUri === 'string' && raw.redirectUri.trim()) {
    out.redirectUri = raw.redirectUri.trim()
  }
  if (typeof raw.scope === 'string' && raw.scope.trim()) out.scope = raw.scope.trim()
  return out
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
  const oauth = parseOAuthConfig(raw.oauth)

  if (url) {
    return { url, headers, env, type: type || 'http', ...(oauth !== undefined ? { oauth } : {}) }
  }
  if (command) {
    return { command, args, env, cwd, type: type || 'stdio' }
  }
  return null
}

export function parseMcpConfigJson(raw: string): McpConfig {
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

export type LoadMcpConfigOpts = {
  /** When false, only ~/.voidcast/mcp.json is used (project .mcp.json is ignored). */
  allowProjectConfig?: boolean
}

export function mergeMcpConfigs(globalCfg: McpConfig, projectCfg: McpConfig): McpConfig {
  return {
    mcpServers: {
      ...globalCfg.mcpServers,
      ...projectCfg.mcpServers,
    },
  }
}

export async function loadMcpConfig(
  projectPath?: string,
  opts?: LoadMcpConfigOpts,
): Promise<McpConfig> {
  const globalCfg = await readConfigFile(getGlobalMcpConfigPath())
  const projectRoot = (projectPath || '').trim()
  if (!projectRoot || opts?.allowProjectConfig === false) return globalCfg
  const projectCfg = await readConfigFile(path.join(projectRoot, '.mcp.json'))
  return mergeMcpConfigs(globalCfg, projectCfg)
}
export async function loadProjectMcpConfig(projectPath: string): Promise<McpConfig> {
  const projectRoot = projectPath.trim()
  if (!projectRoot) return EMPTY_CONFIG
  return readConfigFile(projectMcpConfigFile(projectRoot))
}

export function normalizeMcpProjectPathResolved(projectPath: string): string {
  const trimmed = projectPath.trim()
  if (!trimmed) return ''
  return path.resolve(trimmed).replace(/\\/g, '/').toLowerCase()
}

export function isMcpProjectTrustedResolved(
  projectPath: string,
  trustedProjectPaths: string[] | undefined,
): boolean {
  const normalized = normalizeMcpProjectPathResolved(projectPath)
  if (!normalized) return false
  const trusted = new Set(
    (trustedProjectPaths ?? [])
      .map((entry) => {
        const trimmed = entry.trim()
        if (!trimmed) return ''
        try {
          return path.resolve(trimmed).replace(/\\/g, '/').toLowerCase()
        } catch {
          return trimmed.replace(/\\/g, '/').toLowerCase()
        }
      })
      .filter(Boolean),
  )
  return trusted.has(normalized)
}

export function projectMcpConfigFile(projectPath: string): string {
  return path.join(projectPath.trim(), '.mcp.json')
}

export function projectHasMcpConfigFile(projectPath: string): boolean {
  const root = projectPath.trim()
  if (!root) return false
  return existsSync(projectMcpConfigFile(root))
}

/** Default connect timeout per MCP server (stdio spawn + initialize + tools/list). */
export const MCP_CONNECT_TIMEOUT_MS = 30_000
/** Default timeout for a single MCP tool call. */
export const MCP_CALL_TIMEOUT_MS = 120_000

export type McpServerReconciliationPlan = {
  toClose: string[]
  toStart: string[]
}

/** Pure helper: which running servers should close vs start for the desired config. */
export function planMcpServerReconciliation(params: {
  configServerIds: string[]
  enabledMap?: Record<string, boolean>
  connectedServerIds: string[]
  connectedHealthyIds?: string[]
}): McpServerReconciliationPlan {
  const desired = params.configServerIds.filter((id) => isServerEnabled(id, params.enabledMap))
  const desiredSet = new Set(desired)
  const healthy = new Set(params.connectedHealthyIds ?? [])
  const toClose = params.connectedServerIds.filter((id) => !desiredSet.has(id))
  const toStart = desired.filter((id) => !healthy.has(id))
  return { toClose, toStart }
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

/** Below this size, full MCP tool output stays in the model context (Claude ~50k layer). */
export const MCP_RESULT_INLINE_MAX_CHARS = 50_000
/** Preview size when full output is spilled to disk (Claude-style ~2KB). */
export const MCP_RESULT_PREVIEW_CHARS = 2_000

export function getMcpResultsDir(): string {
  return path.join(os.homedir(), '.voidcast', 'mcp-results')
}

function safeToolFileStem(label: string): string {
  const stem = label.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  return (stem || 'mcp-result').slice(0, 80)
}

/**
 * Claude/Cursor pattern: keep full payload on disk; model gets path + short preview.
 * Nothing is discarded — use mcp_read_result (or filters) to inspect the rest.
 */
export async function persistIfLargeMcpResult(
  text: string,
  toolLabel: string,
): Promise<string> {
  const raw = String(text ?? '')
  if (raw.startsWith('Error:') || raw.length <= MCP_RESULT_INLINE_MAX_CHARS) {
    return raw
  }
  const dir = getMcpResultsDir()
  await mkdir(dir, { recursive: true })
  const filePath = path.join(dir, `${Date.now()}-${safeToolFileStem(toolLabel)}.txt`)
  await writeFile(filePath, raw, 'utf8')
  const kb = (raw.length / 1024).toFixed(1)
  const preview = raw.slice(0, MCP_RESULT_PREVIEW_CHARS)
  return [
    '<persisted-output>',
    `Output too large (${kb}KB / ${raw.length.toLocaleString()} chars). Full output saved to:`,
    filePath,
    '',
    'This is ONLY a preview — do not answer as if you saw the complete result.',
    'To inspect more: mcp_read_result with this path + start_line/end_line, offset/max_chars,',
    'or item_offset/item_limit/query when the file is a JSON array.',
    'Prefer re-calling the MCP tool with a narrower filter when the server supports it.',
    '',
    `Preview (first ${MCP_RESULT_PREVIEW_CHARS} chars):`,
    preview,
    raw.length > MCP_RESULT_PREVIEW_CHARS ? '...' : '',
    '</persisted-output>',
  ].join('\n')
}

async function assertPathInsideMcpResults(filePath: string): Promise<string> {
  const dir = path.resolve(getMcpResultsDir())
  await mkdir(dir, { recursive: true })
  const abs = path.resolve(filePath)
  let realFile: string
  let realDir: string
  try {
    realFile = await realpath(abs)
    realDir = await realpath(dir)
  } catch {
    throw new Error(`MCP result file not found: ${filePath}`)
  }
  const rel = path.relative(realDir, realFile)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('mcp_read_result can only read files under ~/.voidcast/mcp-results/')
  }
  return realFile
}

export type McpReadResultOpts = {
  path: string
  startLine?: number
  endLine?: number
  offset?: number
  maxChars?: number
  itemOffset?: number
  itemLimit?: number
  query?: string
}

/**
 * Page a previously persisted MCP tool result (full data stays on disk).
 */
export async function readPersistedMcpResult(opts: McpReadResultOpts): Promise<string> {
  const filePath = String(opts.path ?? '').trim()
  if (!filePath) return 'Error: missing path for mcp_read_result.'
  let abs: string
  try {
    abs = await assertPathInsideMcpResults(filePath)
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`
  }
  const content = await readFile(abs, 'utf8')
  const query = typeof opts.query === 'string' ? opts.query.trim() : ''
  const itemOffset =
    typeof opts.itemOffset === 'number' && Number.isFinite(opts.itemOffset)
      ? Math.max(0, Math.floor(opts.itemOffset))
      : undefined
  const itemLimit =
    typeof opts.itemLimit === 'number' && Number.isFinite(opts.itemLimit)
      ? Math.min(100, Math.max(1, Math.floor(opts.itemLimit)))
      : undefined

  const trimmed = content.trim()
  if (
    (itemOffset !== undefined || itemLimit !== undefined || query) &&
    ((trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      (trimmed.startsWith('{') && trimmed.endsWith('}')))
  ) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      let items: unknown[] | null = null
      let wrapperKey: string | null = null
      if (Array.isArray(parsed)) {
        items = parsed
      } else if (parsed && typeof parsed === 'object') {
        for (const key of ['models', 'data', 'items', 'results', 'tools']) {
          const v = (parsed as Record<string, unknown>)[key]
          if (Array.isArray(v)) {
            items = v
            wrapperKey = key
            break
          }
        }
      }
      if (items) {
        let filtered = items
        if (query) {
          const q = query.toLowerCase()
          filtered = items.filter((item) => JSON.stringify(item).toLowerCase().includes(q))
        }
        const from = itemOffset ?? 0
        const lim = itemLimit ?? 20
        const slice = filtered.slice(from, from + lim)
        const payload =
          wrapperKey != null
            ? {
                [wrapperKey]: slice,
                _meta: {
                  path: abs,
                  total: filtered.length,
                  from,
                  count: slice.length,
                  query: query || undefined,
                },
              }
            : {
                items: slice,
                _meta: {
                  path: abs,
                  total: filtered.length,
                  from,
                  count: slice.length,
                  query: query || undefined,
                },
              }
        return JSON.stringify(payload, null, 2)
      }
    } catch {
      /* fall through to text paging */
    }
  }

  const startLine =
    typeof opts.startLine === 'number' && Number.isFinite(opts.startLine)
      ? Math.max(1, Math.floor(opts.startLine))
      : undefined
  const endLine =
    typeof opts.endLine === 'number' && Number.isFinite(opts.endLine)
      ? Math.max(1, Math.floor(opts.endLine))
      : undefined
  const offset =
    typeof opts.offset === 'number' && Number.isFinite(opts.offset)
      ? Math.max(0, Math.floor(opts.offset))
      : 0
  const maxChars =
    typeof opts.maxChars === 'number' && Number.isFinite(opts.maxChars)
      ? Math.min(50_000, Math.max(1, Math.floor(opts.maxChars)))
      : 8_000

  if (startLine !== undefined || endLine !== undefined) {
    const lines = content.split(/\r?\n/)
    const total = lines.length
    const from = (startLine ?? 1) - 1
    const to = (endLine ?? Math.min(from + 80, total)) - 1
    const safeFrom = Math.max(0, Math.min(from, Math.max(0, total - 1)))
    const safeTo = Math.max(safeFrom, Math.min(to, Math.max(0, total - 1)))
    const numbered = lines.slice(safeFrom, safeTo + 1).map((line, i) => `${safeFrom + i + 1}| ${line}`)
    return `${numbered.join('\n')}\n\n(lines ${safeFrom + 1}-${safeTo + 1} of ${total} in ${abs})`
  }

  const chunk = content.slice(offset, offset + maxChars)
  const more = offset + maxChars < content.length
  return [
    chunk,
    '',
    `(chars ${offset + 1}-${offset + chunk.length} of ${content.length} in ${abs}` +
      (more ? `; pass offset=${offset + maxChars} for next chunk` : '') +
      ')',
  ].join('\n')
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

function abortError(): Error {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}

function mergeAbortSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const active = signals.filter((s): s is AbortSignal => Boolean(s))
  if (active.length === 0) return undefined
  if (active.length === 1) return active[0]
  const ac = new AbortController()
  const onAbort = () => ac.abort()
  for (const signal of active) {
    if (signal.aborted) {
      ac.abort()
      break
    }
    signal.addEventListener('abort', onAbort, { once: true })
  }
  return ac.signal
}

export async function withMcpTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw abortError()
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

async function connectClient(
  transport: Transport,
  signal?: AbortSignal,
): Promise<{
  client: Client
  tools: McpToolInfo[]
}> {
  const client = new Client({ name: 'voidcast', version: '1.0.0' }, { capabilities: {} })
  await withMcpTimeout(
    client.connect(transport),
    MCP_CONNECT_TIMEOUT_MS,
    'MCP connect',
    signal,
  )
  const listed = await withMcpTimeout(
    client.listTools(),
    MCP_CONNECT_TIMEOUT_MS,
    'MCP list tools',
    signal,
  )
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

function isServerEnabled(serverId: string, enabledMap?: Record<string, boolean>): boolean {
  if (!enabledMap || !(serverId in enabledMap)) return true
  return enabledMap[serverId] !== false
}

function enabledMapKey(projectPath: string, enabledMap?: Record<string, boolean>): string {
  const sorted = Object.entries(enabledMap ?? {})
    .filter(([, v]) => v === false)
    .map(([k]) => k)
    .sort()
  return `${projectPath}::off=${sorted.join(',')}`
}

export class McpManager {
  private servers = new Map<string, RunningServer>()
  /** null = never connected; string = project+enabled key for last successful ensure/reload */
  private connectedKey: string | null = null
  private connectPromise: Promise<void> | null = null
  private lastConfigIds: string[] = []
  private lastEnabledMap: Record<string, boolean> = {}
  private lastProjectPath = ''
  private lastServerConfigs: Record<string, McpServerConfig> = {}
  private lastConnectionOpts: { allowProjectConfig?: boolean } = {}
  private activeCallAbort: AbortController | null = null
  private pendingOAuth = new Map<string, PendingOAuthSession>()

  constructor() {
    mcpOAuthEvents.on('authorization_code', ({ serverId, code }) => {
      void this.completeOAuthConnect(serverId, code)
    })
  }

  getStatus(): McpServerStatus[] {
    const out: McpServerStatus[] = []
    const ids =
      this.lastConfigIds.length > 0 ? this.lastConfigIds : [...this.servers.keys()]
    for (const id of ids) {
      const oauthEnabled = isMcpOAuthEnabled(this.lastServerConfigs[id])
      if (!isServerEnabled(id, this.lastEnabledMap)) {
        out.push({
          id,
          state: 'disabled',
          toolCount: 0,
          oauthEnabled,
          authState: 'none',
        })
        continue
      }
      const entry = this.servers.get(id)
      if (!entry) {
        out.push({
          id,
          state: 'stopped',
          toolCount: 0,
          oauthEnabled,
          authState: oauthEnabled ? 'needs_sign_in' : 'none',
        })
        continue
      }
      const authState = entry.authState ?? (oauthEnabled ? 'authenticated' : 'none')
      if (entry.error) {
        out.push({
          id,
          state: 'error',
          toolCount: entry.tools.length,
          error: entry.error,
          oauthEnabled,
          authState,
        })
      } else {
        out.push({
          id,
          state: 'running',
          toolCount: entry.tools.length,
          oauthEnabled,
          authState,
        })
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id))
  }

  listTools(): McpToolInfo[] {
    const out: McpToolInfo[] = []
    for (const [id, entry] of this.servers.entries()) {
      if (entry.error) continue
      if (!isServerEnabled(id, this.lastEnabledMap)) continue
      out.push(...entry.tools)
    }
    return out
  }

  async ensureConnected(
    projectPath?: string,
    enabledMap?: Record<string, boolean>,
    opts?: { allowProjectConfig?: boolean; signal?: AbortSignal },
  ): Promise<void> {
    const project = (projectPath || '').trim()
    const map = enabledMap ?? {}
    const key = enabledMapKey(project, map)
    while (true) {
      if (this.connectPromise) {
        await this.connectPromise
        if (this.connectedKey === key) return
        continue
      }
      if (this.connectedKey === key) return
      this.connectPromise = this.connectAll(project, map, opts)
      try {
        await this.connectPromise
        this.connectedKey = key
        return
      } finally {
        this.connectPromise = null
      }
    }
  }

  async reload(
    projectPath?: string,
    enabledMap?: Record<string, boolean>,
    opts?: { allowProjectConfig?: boolean; signal?: AbortSignal },
  ): Promise<{ ok: true; status: McpServerStatus[] }> {
    await this.stopAll()
    const project = (projectPath || '').trim()
    const map = enabledMap ?? {}
    await this.connectAll(project, map, opts)
    this.connectedKey = enabledMapKey(project, map)
    return { ok: true, status: this.getStatus() }
  }

  cancelActiveCalls(): void {
    this.activeCallAbort?.abort()
    this.activeCallAbort = null
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<string> {
    const entry = this.servers.get(serverId)
    if (!entry) {
      return `Error: MCP server "${serverId}" is not running.`
    }
    if (entry.error) {
      return `Error: MCP server "${serverId}" failed to start: ${entry.error}`
    }
    const callAbort = new AbortController()
    this.activeCallAbort = callAbort
    const signal = mergeAbortSignals([opts?.signal, callAbort.signal])
    const timeoutMs = opts?.timeoutMs ?? MCP_CALL_TIMEOUT_MS
    try {
      const result = await withMcpTimeout(
        entry.client.callTool({
          name: toolName,
          arguments: args,
        }),
        timeoutMs,
        `MCP tool "${formatMcpToolName(serverId, toolName)}"`,
        signal,
      )
      const text = toolResultToString(
        result as { content?: unknown[]; isError?: boolean; structuredContent?: unknown },
      )
      return await persistIfLargeMcpResult(text, formatMcpToolName(serverId, toolName))
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        return `Error: MCP tool "${formatMcpToolName(serverId, toolName)}" was cancelled.`
      }
      return `Error: MCP tool "${formatMcpToolName(serverId, toolName)}" failed: ${formatError(e)}`
    } finally {
      if (this.activeCallAbort === callAbort) {
        this.activeCallAbort = null
      }
    }
  }

  async stopAll(): Promise<void> {
    this.cancelActiveCalls()
    this.pendingOAuth.clear()
    const entries = [...this.servers.entries()]
    this.servers.clear()
    this.connectedKey = null
    this.lastConfigIds = []
    this.lastEnabledMap = {}
    this.lastProjectPath = ''
    this.lastServerConfigs = {}
    this.lastConnectionOpts = {}
    await Promise.all(entries.map(([, entry]) => safeClose(entry.client, entry.transport)))
  }

  async signOutOAuth(serverId: string): Promise<void> {
    this.pendingOAuth.delete(serverId)
    await clearMcpOAuthSession(serverId)
    const entry = this.servers.get(serverId)
    if (entry) {
      await safeClose(entry.client, entry.transport)
      this.servers.delete(serverId)
    }
  }

  async signInOAuth(
    serverId: string,
    projectPath?: string,
    enabledMap?: Record<string, boolean>,
    opts?: { allowProjectConfig?: boolean; signal?: AbortSignal },
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const project = (projectPath ?? this.lastProjectPath).trim()
    const map = enabledMap ?? this.lastEnabledMap
    const config = await loadMcpConfig(project || undefined, {
      allowProjectConfig: opts?.allowProjectConfig ?? this.lastConnectionOpts.allowProjectConfig,
    })
    const cfg = config.mcpServers[serverId]
    if (!cfg?.url) {
      return { ok: false, error: `MCP server "${serverId}" is not a remote OAuth server.` }
    }
    if (!isMcpOAuthEnabled(cfg)) {
      return { ok: false, error: `MCP server "${serverId}" does not have OAuth enabled in mcp.json.` }
    }
    this.lastProjectPath = project
    this.lastEnabledMap = { ...map }
    this.lastServerConfigs = config.mcpServers
    this.lastConnectionOpts = { allowProjectConfig: opts?.allowProjectConfig }
    const existing = this.servers.get(serverId)
    if (existing) {
      await safeClose(existing.client, existing.transport)
      this.servers.delete(serverId)
    }
    await this.startUrlServer(serverId, cfg, opts?.signal)
    const entry = this.servers.get(serverId)
    if (entry?.error) {
      return { ok: false, error: entry.error }
    }
    return { ok: true }
  }

  async completeOAuthConnect(
    serverId: string,
    authorizationCode: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const pending = this.pendingOAuth.get(serverId)
    if (!pending || !transportHasFinishAuth(pending.transport)) {
      return { ok: false, error: `No pending OAuth session for "${serverId}".` }
    }
    try {
      await pending.transport.finishAuth(authorizationCode)
      this.pendingOAuth.delete(serverId)
      const connected = await connectClient(pending.transport)
      this.attachTools(serverId, connected.client, pending.transport, connected.tools, {
        oauthEnabled: true,
        authState: 'authenticated',
      })
      return { ok: true }
    } catch (e) {
      const message = formatError(e)
      this.setError(serverId, message, {
        oauthEnabled: true,
        authState: 'needs_sign_in',
      })
      return { ok: false, error: message }
    }
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

  private async connectAll(
    projectPath: string,
    enabledMap: Record<string, boolean> = {},
    opts?: { allowProjectConfig?: boolean; signal?: AbortSignal },
  ): Promise<void> {
    const config = await loadMcpConfig(projectPath || undefined, {
      allowProjectConfig: opts?.allowProjectConfig,
    })
    const ids = Object.keys(config.mcpServers).sort()
    this.lastConfigIds = ids
    this.lastEnabledMap = { ...enabledMap }
    this.lastProjectPath = projectPath
    this.lastServerConfigs = config.mcpServers
    this.lastConnectionOpts = { allowProjectConfig: opts?.allowProjectConfig }

    const connectedIds = [...this.servers.keys()]
    const healthyIds = connectedIds.filter((id) => {
      const entry = this.servers.get(id)
      return Boolean(entry && !entry.error)
    })
    const plan = planMcpServerReconciliation({
      configServerIds: ids,
      enabledMap,
      connectedServerIds: connectedIds,
      connectedHealthyIds: healthyIds,
    })

    const toCloseEntries = plan.toClose
      .map((id) => {
        const entry = this.servers.get(id)
        return entry ? ([id, entry] as const) : null
      })
      .filter((x): x is readonly [string, RunningServer] => x != null)
    for (const [id] of toCloseEntries) {
      this.servers.delete(id)
    }
    await Promise.all(toCloseEntries.map(([, entry]) => safeClose(entry.client, entry.transport)))

    if (plan.toStart.length === 0) return

    await Promise.all(
      plan.toStart.map(async (id) => {
        const cfg = config.mcpServers[id]
        if (!cfg) return
        const existing = this.servers.get(id)
        if (existing) {
          this.servers.delete(id)
          await safeClose(existing.client, existing.transport)
        }
        await this.startServer(id, cfg, opts?.signal)
      }),
    )
  }

  private setError(
    id: string,
    message: string,
    extras?: { oauthEnabled?: boolean; authState?: McpServerAuthState },
  ): void {
    this.servers.set(id, {
      client: new Client({ name: 'voidcast', version: '1.0.0' }, { capabilities: {} }),
      transport: {
        start: async () => {},
        send: async () => {},
        close: async () => {},
      },
      tools: [],
      error: message,
      oauthEnabled: extras?.oauthEnabled,
      authState: extras?.authState,
    })
  }

  private async startServer(id: string, config: McpServerConfig, signal?: AbortSignal): Promise<void> {
    try {
      if (config.url) {
        await this.startUrlServer(id, config, signal)
      } else if (config.command) {
        await this.startStdioServer(id, config, signal)
      } else {
        this.setError(id, 'Invalid MCP config: need either "url" or "command".')
      }
    } catch (e) {
      this.setError(id, formatError(e))
    }
  }

  private attachTools(
    id: string,
    client: Client,
    transport: Transport,
    tools: McpToolInfo[],
    extras?: { oauthEnabled?: boolean; authState?: McpServerAuthState },
  ): void {
    const labeled = tools.map((t) => ({
      ...t,
      serverId: id,
      qualifiedName: formatMcpToolName(id, t.name),
      description: t.description.startsWith('[mcp:')
        ? t.description
        : `[mcp:${id}] ${t.description}`,
    }))
    this.servers.set(id, {
      client,
      transport,
      tools: labeled,
      oauthEnabled: extras?.oauthEnabled,
      authState: extras?.authState,
    })
  }

  private async startStdioServer(
    id: string,
    config: McpServerConfig,
    signal?: AbortSignal,
  ): Promise<void> {
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
      const connected = await connectClient(transport, signal)
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

  private async startUrlServer(
    id: string,
    config: McpServerConfig,
    signal?: AbortSignal,
  ): Promise<void> {
    const urlStr = config.url!
    let url: URL
    try {
      url = new URL(urlStr)
    } catch {
      this.setError(id, `Invalid MCP url: ${urlStr}`)
      return
    }

    const oauthEnabled = isMcpOAuthEnabled(config)
    const authProvider = oauthEnabled
      ? await createVoidcastMcpOAuthProvider(id, config, url.toString())
      : undefined
    const staticRequestInit = oauthEnabled ? undefined : this.buildRequestInit(config)
    const preferSse = (config.type || '').toLowerCase() === 'sse'
    const errors: string[] = []

    const makeTransportOpts = () =>
      authProvider
        ? { authProvider }
        : staticRequestInit
          ? { requestInit: staticRequestInit }
          : undefined

    const tryTransport = async (
      label: string,
      make: () => Transport,
    ): Promise<boolean> => {
      const transport = make()
      let client: Client | null = null
      try {
        const connected = await connectClient(transport, signal)
        client = connected.client
        this.pendingOAuth.delete(id)
        this.attachTools(id, connected.client, transport, connected.tools, {
          oauthEnabled,
          authState: oauthEnabled ? 'authenticated' : 'none',
        })
        return true
      } catch (e) {
        if (oauthEnabled && e instanceof UnauthorizedError) {
          this.pendingOAuth.set(id, { transport, config })
          await safeClose(client, null)
          this.setError(
            id,
            'OAuth sign-in required. Complete sign-in in your browser, or click SIGN_IN in MCP settings.',
            { oauthEnabled: true, authState: 'needs_sign_in' },
          )
          return false
        }
        errors.push(`${label}: ${formatError(e)}`)
        await safeClose(client, transport)
        return false
      }
    }

    if (preferSse) {
      if (
        await tryTransport('sse', () => new SSEClientTransport(url, makeTransportOpts()))
      ) {
        return
      }
      if (
        await tryTransport(
          'streamable-http',
          () => new StreamableHTTPClientTransport(url, makeTransportOpts()),
        )
      ) {
        return
      }
    } else {
      if (
        await tryTransport(
          'streamable-http',
          () => new StreamableHTTPClientTransport(url, makeTransportOpts()),
        )
      ) {
        return
      }
      if (
        await tryTransport('sse', () => new SSEClientTransport(url, makeTransportOpts()))
      ) {
        return
      }
    }

    const authHint = oauthEnabled
      ? 'OAuth sign-in may be required.'
      : `If the server needs auth, add "headers": { "Authorization": "Bearer …" } or enable "oauth": true.`
    this.setError(
      id,
      `Failed to connect to ${urlStr}. ${errors.join(' | ')}. ${authHint}`,
      oauthEnabled ? { oauthEnabled: true, authState: 'needs_sign_in' } : undefined,
    )
  }
}

export const mcpManager = new McpManager()
