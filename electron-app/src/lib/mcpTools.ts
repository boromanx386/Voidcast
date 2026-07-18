/**
 * Renderer-side MCP tool cache + Ollama schema conversion.
 * Process lifecycle lives in Electron main (`mcpManager.ts`).
 */
import { isElectron } from '@/lib/platform'
import type { OllamaToolDefinition, OllamaToolParameterSchema } from '@/lib/toolDefinitions'

export type McpToolInfo = {
  serverId: string
  name: string
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
  authState?: 'none' | 'authenticated' | 'needs_sign_in'
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

export function isMcpToolName(name: string): boolean {
  return name.startsWith('mcp__')
}

export const MCP_LIST_TOOLS_NAME = 'mcp_list_tools'
export const MCP_GET_TOOL_NAME = 'mcp_get_tool'
export const MCP_CALL_NAME = 'mcp_call'
export const MCP_READ_RESULT_NAME = 'mcp_read_result'

export function isMcpMetaToolName(name: string): boolean {
  return (
    name === MCP_LIST_TOOLS_NAME ||
    name === MCP_GET_TOOL_NAME ||
    name === MCP_CALL_NAME ||
    name === MCP_READ_RESULT_NAME
  )
}

function toolMatchesQuery(tool: McpToolInfo, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const hay = [tool.serverId, tool.name, tool.qualifiedName, tool.description]
    .join(' ')
    .toLowerCase()
  return hay.includes(q)
}

function findMcpTool(tools: McpToolInfo[], name: string): McpToolInfo | undefined {
  const want = name.trim()
  if (!want) return undefined
  return tools.find(
    (t) =>
      t.qualifiedName === want ||
      t.name === want ||
      `${t.serverId}/${t.name}` === want ||
      `${t.serverId}__${t.name}` === want,
  )
}

const LIST_DEFAULT_LIMIT = 12
const LIST_MAX_LIMIT = 20
const DESC_MAX_CHARS = 80
/** Hard cap on a single tool schema payload returned to the model (~2–3k tokens). */
const SCHEMA_RESULT_MAX_CHARS = 6000

/** Layer 1 — catalog only (names + short descriptions). Never includes schemas. */
export function formatMcpToolsListResult(
  tools: McpToolInfo[],
  opts?: {
    query?: string
    limit?: number
  },
): string {
  const limitRaw = opts?.limit
  const limit =
    typeof limitRaw === 'number' && Number.isFinite(limitRaw)
      ? Math.min(LIST_MAX_LIMIT, Math.max(1, Math.round(limitRaw)))
      : LIST_DEFAULT_LIMIT

  let filtered = tools
  const query = typeof opts?.query === 'string' ? opts.query : ''
  if (query.trim()) {
    filtered = filtered.filter((t) => toolMatchesQuery(t, query))
  }

  const total = filtered.length
  const sliced = filtered.slice(0, limit)
  if (sliced.length === 0) {
    return 'No MCP tools match. Narrow query, or check Options → Tools → MCP servers are enabled.'
  }

  const byServer = new Map<string, McpToolInfo[]>()
  for (const t of sliced) {
    const list = byServer.get(t.serverId) ?? []
    list.push(t)
    byServer.set(t.serverId, list)
  }

  const blocks: string[] = [
    `MCP catalog (${sliced.length}${total > sliced.length ? ` of ${total}` : ''} matches; summary only — no schemas):`,
  ]
  for (const [serverId, list] of [...byServer.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    blocks.push(`[${serverId}]`)
    for (const t of list) {
      const desc = t.description.replace(/\s+/g, ' ').trim().slice(0, DESC_MAX_CHARS)
      blocks.push(`- ${t.qualifiedName}: ${desc}${t.description.length > DESC_MAX_CHARS ? '…' : ''}`)
    }
  }
  if (total > sliced.length) {
    blocks.push(
      `… ${total - sliced.length} more omitted. Refine query or raise limit (max ${LIST_MAX_LIMIT}).`,
    )
  }
  blocks.push(
    `Next: mcp_get_tool with ONE name to load its schema, then mcp_call. Do not request schemas for many tools at once.`,
  )
  return blocks.join('\n')
}

/** Layer 2 — full schema for exactly one tool. */
export function formatMcpGetToolResult(tools: McpToolInfo[], name: string): string {
  const tool = findMcpTool(tools, name)
  if (!tool) {
    return `Error: MCP tool "${name}" not found. Call mcp_list_tools first to see qualified names (mcp__server__tool).`
  }
  const payload = {
    name: tool.qualifiedName,
    server: tool.serverId,
    description: tool.description.replace(/\s+/g, ' ').trim().slice(0, 400),
    parameters: tool.parameters,
  }
  let json = JSON.stringify(payload, null, 2)
  if (json.length > SCHEMA_RESULT_MAX_CHARS) {
    json =
      json.slice(0, SCHEMA_RESULT_MAX_CHARS) +
      `\n… [schema truncated at ${SCHEMA_RESULT_MAX_CHARS} chars — use required fields only]`
  }
  return [
    `MCP tool schema for ${tool.qualifiedName}:`,
    json,
    'Next: mcp_call with this name + arguments matching parameters.',
  ].join('\n')
}

function toParameterSchema(raw: unknown): OllamaToolParameterSchema {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { type: 'string' }
  }
  const obj = raw as Record<string, unknown>
  const type = typeof obj.type === 'string' ? obj.type : 'string'
  const out: OllamaToolParameterSchema = { type }
  if (typeof obj.description === 'string') out.description = obj.description
  if (Array.isArray(obj.enum) && obj.enum.every((x) => typeof x === 'string')) {
    out.enum = obj.enum as string[]
  }
  if (typeof obj.items === 'object' && obj.items !== null && !Array.isArray(obj.items)) {
    const items = obj.items as Record<string, unknown>
    if (typeof items.type === 'string') {
      out.items = { type: items.type }
      if (typeof items.minimum === 'number') out.items.minimum = items.minimum
    }
  }
  return out
}

export function convertMcpToolToOllama(tool: McpToolInfo): OllamaToolDefinition {
  const params = tool.parameters
  const propertiesRaw =
    typeof params.properties === 'object' &&
    params.properties !== null &&
    !Array.isArray(params.properties)
      ? (params.properties as Record<string, unknown>)
      : {}
  const properties: Record<string, OllamaToolParameterSchema> = {}
  for (const [key, value] of Object.entries(propertiesRaw)) {
    properties[key] = toParameterSchema(value)
  }
  const required = Array.isArray(params.required)
    ? params.required.filter((x): x is string => typeof x === 'string')
    : undefined

  return {
    type: 'function',
    function: {
      name: tool.qualifiedName || formatMcpToolName(tool.serverId, tool.name),
      description: `[mcp:${tool.serverId}] ${tool.description}`.trim(),
      parameters: {
        type: 'object',
        properties,
        ...(required && required.length > 0 ? { required } : {}),
      },
    },
  }
}

let mcpToolsCache: McpToolInfo[] = []
let mcpToolsCacheProjectPath = ''
/** null = never fetched this session; otherwise last project+enabled key used for fetch */
let mcpToolsFetchedKey: string | null = null

export type McpClientOpts = {
  projectPath?: string
  enabledServers?: Record<string, boolean>
  trustedProjectPaths?: string[]
}

function enabledCacheKey(
  projectPath: string,
  enabledServers?: Record<string, boolean>,
): string {
  const off = Object.entries(enabledServers ?? {})
    .filter(([, v]) => v === false)
    .map(([k]) => k)
    .sort()
    .join(',')
  return `${projectPath}::off=${off}`
}

function mcpPayload(opts?: McpClientOpts) {
  const project = (opts?.projectPath || '').trim()
  return {
    projectPath: project || undefined,
    enabledServers: opts?.enabledServers,
    trustedProjectPaths: opts?.trustedProjectPaths,
  }
}

export function getCachedMcpTools(): McpToolInfo[] {
  return mcpToolsCache
}

export function clearMcpToolsCache(): void {
  mcpToolsCache = []
  mcpToolsCacheProjectPath = ''
  mcpToolsFetchedKey = null
}

export async function fetchMcpTools(opts?: McpClientOpts): Promise<McpToolInfo[]> {
  if (!isElectron() || !window.voidcast?.mcpListTools) {
    clearMcpToolsCache()
    return []
  }
  const project = (opts?.projectPath || '').trim()
  const key = enabledCacheKey(project, opts?.enabledServers)
  try {
    const res = await window.voidcast.mcpListTools(mcpPayload(opts))
    mcpToolsCache = res.tools ?? []
    mcpToolsCacheProjectPath = project
    mcpToolsFetchedKey = key
    return mcpToolsCache
  } catch {
    clearMcpToolsCache()
    return []
  }
}

/** Refresh cache when project path / enabled map changes or force=true. */
export async function ensureMcpToolsCached(
  projectPath?: string,
  enabledServers?: Record<string, boolean>,
  force = false,
  trustedProjectPaths?: string[],
): Promise<McpToolInfo[]> {
  const project = (projectPath || '').trim()
  const key = enabledCacheKey(project, enabledServers)
  if (!force && mcpToolsFetchedKey === key) {
    return mcpToolsCache
  }
  return fetchMcpTools({
    projectPath: project,
    enabledServers,
    trustedProjectPaths,
  })
}

export async function reloadMcpServers(opts?: McpClientOpts): Promise<{
  ok: boolean
  status: McpServerStatus[]
  tools: McpToolInfo[]
  error?: string
}> {
  if (!isElectron() || !window.voidcast?.mcpReload) {
    return { ok: false, status: [], tools: [], error: 'MCP is only available in the desktop app.' }
  }
  const res = await window.voidcast.mcpReload(mcpPayload(opts))
  const tools = await fetchMcpTools(opts)
  if (!res.ok) {
    return { ok: false, status: res.status ?? [], tools, error: res.error }
  }
  return { ok: true, status: res.status, tools }
}

export async function getMcpStatus(
  projectPath?: string,
  ensure = false,
  enabledServers?: Record<string, boolean>,
  trustedProjectPaths?: string[],
): Promise<{
  ok: boolean
  status: McpServerStatus[]
  configPath: string
  pendingProjectTrust?: boolean
  error?: string
}> {
  if (!isElectron() || !window.voidcast?.mcpStatus) {
    return { ok: false, status: [], configPath: '', error: 'MCP is only available in the desktop app.' }
  }
  const project = (projectPath || '').trim()
  const res = await window.voidcast.mcpStatus({
    projectPath: project || undefined,
    ensure,
    enabledServers,
    trustedProjectPaths,
  })
  return {
    ok: res.ok,
    status: res.status ?? [],
    configPath: res.configPath ?? '',
    pendingProjectTrust: res.pendingProjectTrust,
    error: res.ok ? undefined : res.error,
  }
}

export async function getMcpProjectConfigPreview(projectPath: string): Promise<{
  ok: boolean
  servers: Array<{ id: string; transport: 'stdio' | 'url'; summary: string }>
  normalizedProjectPath?: string
  error?: string
}> {
  if (!isElectron() || !window.voidcast?.mcpProjectConfigPreview) {
    return { ok: false, servers: [], error: 'MCP preview is only available in the desktop app.' }
  }
  const res = await window.voidcast.mcpProjectConfigPreview({
    projectPath: projectPath.trim() || undefined,
  })
  if (!res.ok) {
    return { ok: false, servers: res.servers ?? [], error: res.error }
  }
  return {
    ok: true,
    servers: res.servers ?? [],
    normalizedProjectPath: res.normalizedProjectPath,
  }
}

export async function cancelActiveMcpCalls(): Promise<void> {
  if (!isElectron() || !window.voidcast?.mcpCancelActiveCalls) return
  await window.voidcast.mcpCancelActiveCalls()
}

export async function signInMcpOAuthServer(
  serverId: string,
  opts?: McpClientOpts,
): Promise<{ ok: boolean; status: McpServerStatus[]; tools: McpToolInfo[]; error?: string }> {
  if (!isElectron() || !window.voidcast?.mcpOAuthSignIn) {
    return { ok: false, status: [], tools: [], error: 'MCP OAuth is only available in the desktop app.' }
  }
  const res = await window.voidcast.mcpOAuthSignIn({
    serverId,
    ...mcpPayload(opts),
  })
  const tools = res.ok ? await fetchMcpTools(opts) : getCachedMcpTools()
  return {
    ok: res.ok,
    status: res.status ?? [],
    tools,
    error: res.ok ? undefined : res.error,
  }
}

export async function signOutMcpOAuthServer(
  serverId: string,
  opts?: McpClientOpts,
): Promise<{ ok: boolean; status: McpServerStatus[]; tools: McpToolInfo[]; error?: string }> {
  if (!isElectron() || !window.voidcast?.mcpOAuthSignOut) {
    return { ok: false, status: [], tools: [], error: 'MCP OAuth is only available in the desktop app.' }
  }
  const res = await window.voidcast.mcpOAuthSignOut({
    serverId,
    ...mcpPayload(opts),
  })
  clearMcpToolsCache()
  const tools = res.ok ? await fetchMcpTools(opts) : []
  return {
    ok: res.ok,
    status: res.status ?? [],
    tools,
    error: res.ok ? undefined : res.error,
  }
}

export async function executeMcpToolCall(
  qualifiedName: string,
  args: Record<string, unknown>,
  opts?: McpClientOpts,
): Promise<string> {
  if (!isElectron() || !window.voidcast?.mcpExecuteTool) {
    return 'Error: MCP tools are only available in the desktop app.'
  }
  const parsed = parseMcpToolName(qualifiedName)
  if (!parsed) {
    return `Error: invalid MCP tool name "${qualifiedName}".`
  }
  const res = await window.voidcast.mcpExecuteTool({
    serverId: parsed.serverId,
    toolName: parsed.toolName,
    qualifiedName,
    args,
    ...mcpPayload(opts),
  })
  return res.result
}

export async function executeMcpReadResult(args: {
  path: string
  startLine?: number
  endLine?: number
  offset?: number
  maxChars?: number
  itemOffset?: number
  itemLimit?: number
  query?: string
}): Promise<string> {
  if (!isElectron() || !window.voidcast?.mcpReadResult) {
    return 'Error: mcp_read_result is only available in the desktop app.'
  }
  const res = await window.voidcast.mcpReadResult({
    path: args.path,
    startLine: args.startLine,
    endLine: args.endLine,
    offset: args.offset,
    maxChars: args.maxChars,
    itemOffset: args.itemOffset,
    itemLimit: args.itemLimit,
    query: args.query,
  })
  return res.result
}
