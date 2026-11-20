import type { Dispatch, SetStateAction } from 'react'
import { addTrustedMcpProjectPath } from '@/lib/mcpProjectTrust'
import type { AppSettings } from '@/lib/settings'

/**
 * Trust one project folder (and its subfolders): unlocks its .mcp.json servers.
 * AGENTS.md / CLAUDE.md and project skills load without trust, and trust never
 * lifts the Ask / Plan read-only limits.
 */
export function trustProjectFolder(
  setSettings: Dispatch<SetStateAction<AppSettings>>,
  projectPath: string,
): void {
  if (!projectPath.trim()) return
  setSettings((s) => ({
    ...s,
    mcpTrustedProjectPaths: addTrustedMcpProjectPath(s.mcpTrustedProjectPaths, projectPath),
  }))
  // The trust list also unlocks the project's .mcp.json; drop cached tools so the
  // next turn reloads servers with the new list.
  void import('@/lib/mcpTools').then(({ clearMcpToolsCache }) => clearMcpToolsCache())
}
