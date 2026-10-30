export type McpProjectServerPreview = {
  id: string
  transport: 'stdio' | 'url'
  summary: string
}

type McpServerConfigLike = {
  url?: string
  command?: string
  args?: string[]
  cwd?: string
}

export function describeMcpServerConfig(config: McpServerConfigLike): string {
  if (config.url?.trim()) {
    return `url: ${config.url.trim()}`
  }
  const command = config.command?.trim() ?? ''
  const args = (config.args ?? []).join(' ')
  const cwd = config.cwd?.trim()
  const parts = [command, args].filter(Boolean).join(' ')
  return cwd ? `${parts} (cwd: ${cwd})` : parts || '(invalid server config)'
}

export function buildMcpProjectServerPreviews(
  servers: Record<string, McpServerConfigLike>,
): McpProjectServerPreview[] {
  return Object.entries(servers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, cfg]) => ({
      id,
      transport: cfg.url?.trim() ? 'url' : 'stdio',
      summary: describeMcpServerConfig(cfg),
    }))
}

export function shouldAllowProjectMcpConfig(
  projectPath: string,
  trustedProjectPaths: string[] | undefined,
  hasProjectConfigFile: boolean,
): boolean {
  const root = projectPath.trim()
  if (!root) return true
  if (!hasProjectConfigFile) return true
  return isMcpProjectTrusted(root, trustedProjectPaths)
}

/** Normalize project roots for stable trust comparisons (Windows-safe). */
export function normalizeMcpProjectPath(projectPath: string): string {
  const trimmed = projectPath.trim()
  if (!trimmed) return ''
  // Renderer cannot resolve absolute paths reliably; main process re-normalizes on IPC.
  return trimmed.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** True when `path` is `root` or sits inside it. Both must already be normalized. */
export function isSameOrInsideFolder(path: string, root: string): boolean {
  if (!path || !root) return false
  if (path === root) return true
  // Folder boundary, so trusting c:/code/vst never covers c:/code/vst-old.
  return path.startsWith(root.endsWith('/') ? root : `${root}/`)
}

/** Trusting a folder also trusts everything below it. */
export function isMcpProjectTrusted(
  projectPath: string,
  trustedProjectPaths: string[] | undefined,
): boolean {
  const normalized = normalizeMcpProjectPath(projectPath)
  if (!normalized) return false
  return (trustedProjectPaths ?? [])
    .map(normalizeMcpProjectPath)
    .some((root) => isSameOrInsideFolder(normalized, root))
}

export function addTrustedMcpProjectPath(
  trustedProjectPaths: string[] | undefined,
  projectPath: string,
): string[] {
  const normalized = normalizeMcpProjectPath(projectPath)
  if (!normalized) return trustedProjectPaths ?? []
  const next = new Set((trustedProjectPaths ?? []).map(normalizeMcpProjectPath).filter(Boolean))
  next.add(normalized)
  return [...next].sort()
}
