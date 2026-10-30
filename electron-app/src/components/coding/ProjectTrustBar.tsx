import { useEffect, useState } from 'react'
import { isMcpProjectTrusted } from '@/lib/mcpProjectTrust'

type Props = {
  projectPath: string
  trustedProjectPaths: string[] | undefined
  /** Project .mcp.json only loads with MCP on, so there is nothing to ask otherwise. */
  mcpEnabled: boolean
  onTrust: (projectPath: string) => void
}

// Folders the user waved off with "Not now". Module-level so it survives switching
// chats in one run, but a restart asks again.
const dismissedPaths = new Set<string>()

/**
 * Trust only gates project .mcp.json, because those servers start processes.
 * Binding a folder never prompts, so say so where the folder is shown, and only
 * when the folder actually has servers waiting.
 */
export function ProjectTrustBar({ projectPath, trustedProjectPaths, mcpEnabled, onTrust }: Props) {
  const trusted = isMcpProjectTrusted(projectPath, trustedProjectPaths)
  const [servers, setServers] = useState(0)
  const [dismissed, setDismissed] = useState(() => dismissedPaths.has(projectPath))

  useEffect(() => {
    setDismissed(dismissedPaths.has(projectPath))
    setServers(0)
    if (!projectPath || trusted || !mcpEnabled) return
    let cancelled = false
    void import('@/lib/mcpTools')
      .then((m) => m.getMcpProjectConfigPreview(projectPath))
      .then((preview) => {
        if (!cancelled) setServers(preview.servers.length)
      })
      .catch(() => {
        // A failed scan just means no bar; Options → Tools still shows the details.
      })
    return () => {
      cancelled = true
    }
  }, [projectPath, trusted, mcpEnabled])

  if (!projectPath || trusted || dismissed || servers === 0) return null

  return (
    <div
      role="status"
      className="shrink-0 flex flex-wrap items-center gap-2 rounded border border-neon-yellow/40 bg-neon-yellow/5 px-2 py-1.5 text-[11px] font-mono"
    >
      <span
        className="min-w-0 flex-1 text-neon-yellow"
        title="Project MCP servers run commands on this machine, so they wait until you trust the folder. Trusting a folder also covers its subfolders."
      >
        .mcp.json has {servers} server{servers === 1 ? '' : 's'} — not started until you trust this
        folder
      </span>
      <button type="button" className="cyber-btn text-[10px]" onClick={() => onTrust(projectPath)}>
        TRUST
      </button>
      <button
        type="button"
        className="text-void-dim transition-colors hover:text-void-light"
        onClick={() => {
          dismissedPaths.add(projectPath)
          setDismissed(true)
        }}
      >
        Not now
      </button>
    </div>
  )
}
