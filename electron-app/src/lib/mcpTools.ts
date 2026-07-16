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
  state: 'running' | 'error' | 'stopped'
  toolCount: number
  error?: string
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
/** null = never fetched this session; otherwise last project key used for fetch */
let mcpToolsFetchedKey: string | null = null

export function getCachedMcpTools(): McpToolInfo[] {
  return mcpToolsCache
}

export function clearMcpToolsCache(): void {
  mcpToolsCache = []
  mcpToolsCacheProjectPath = ''
  mcpToolsFetchedKey = null
}

export async function fetchMcpTools(projectPath?: string): Promise<McpToolInfo[]> {
  if (!isElectron() || !window.voidcast?.mcpListTools) {
    clearMcpToolsCache()
    return []
  }
  const project = (projectPath || '').trim()
  try {
    const res = await window.voidcast.mcpListTools({
      projectPath: project || undefined,
    })
    mcpToolsCache = res.tools ?? []
    mcpToolsCacheProjectPath = project
    mcpToolsFetchedKey = project
    return mcpToolsCache
  } catch {
    clearMcpToolsCache()
    return []
  }
}

/** Refresh cache when project path changes or force=true. */
export async function ensureMcpToolsCached(
  projectPath?: string,
  force = false,
): Promise<McpToolInfo[]> {
  const project = (projectPath || '').trim()
  if (!force && mcpToolsFetchedKey === project) {
    return mcpToolsCache
  }
  return fetchMcpTools(project)
}

export async function reloadMcpServers(projectPath?: string): Promise<{
  ok: boolean
  status: McpServerStatus[]
  tools: McpToolInfo[]
  error?: string
}> {
  if (!isElectron() || !window.voidcast?.mcpReload) {
    return { ok: false, status: [], tools: [], error: 'MCP is only available in the desktop app.' }
  }
  const project = (projectPath || '').trim()
  const res = await window.voidcast.mcpReload({ projectPath: project || undefined })
  const tools = await fetchMcpTools(project)
  if (!res.ok) {
    return { ok: false, status: res.status ?? [], tools, error: res.error }
  }
  return { ok: true, status: res.status, tools }
}

export async function getMcpStatus(projectPath?: string, ensure = false): Promise<{
  ok: boolean
  status: McpServerStatus[]
  configPath: string
  error?: string
}> {
  if (!isElectron() || !window.voidcast?.mcpStatus) {
    return { ok: false, status: [], configPath: '', error: 'MCP is only available in the desktop app.' }
  }
  const project = (projectPath || '').trim()
  const res = await window.voidcast.mcpStatus({
    projectPath: project || undefined,
    ensure,
  })
  return {
    ok: res.ok,
    status: res.status ?? [],
    configPath: res.configPath ?? '',
    error: res.ok ? undefined : res.error,
  }
}

export async function executeMcpToolCall(
  qualifiedName: string,
  args: Record<string, unknown>,
  projectPath?: string,
): Promise<string> {
  if (!isElectron() || !window.voidcast?.mcpExecuteTool) {
    return 'Error: MCP tools are only available in the desktop app.'
  }
  const parsed = parseMcpToolName(qualifiedName)
  if (!parsed) {
    return `Error: invalid MCP tool name "${qualifiedName}".`
  }
  const project = (projectPath || '').trim()
  const res = await window.voidcast.mcpExecuteTool({
    serverId: parsed.serverId,
    toolName: parsed.toolName,
    qualifiedName,
    args,
    projectPath: project || undefined,
  })
  return res.result
}
