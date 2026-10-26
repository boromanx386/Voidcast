import type { Dispatch, SetStateAction } from 'react'
import { addTrustedMcpProjectPath } from '@/lib/mcpProjectTrust'
import type { AppSettings } from '@/lib/settings'

/** Trust one project folder: unlocks its AGENTS.md / CLAUDE.md, project skills and .mcp.json. */
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
