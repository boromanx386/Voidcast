import { useEffect, useState } from 'react'
import { discoverAgentSkills, loadProjectAgentInstructions } from '@/lib/agentSkills'
import { isMcpProjectTrusted } from '@/lib/mcpProjectTrust'

type Props = {
  projectPath: string
  trustedProjectPaths: string[] | undefined
  /** Only mention .mcp.json when MCP is on; otherwise it would not load anyway. */
  mcpEnabled: boolean
  onTrust: (projectPath: string) => void
}

type Skipped = { instructionFiles: string[]; projectSkills: number; mcpServers: number }

const NOTHING: Skipped = { instructionFiles: [], projectSkills: 0, mcpServers: 0 }

// Folders the user waved off with "Not now". Module-level so it survives switching
// chats in one run, but a restart asks again.
const dismissedPaths = new Set<string>()

/**
 * Binding a folder never prompts, and an untrusted folder silently drops its
 * AGENTS.md / CLAUDE.md, project skills and .mcp.json. Say so where the folder is
 * shown, and only when something was actually skipped.
 */
export function ProjectTrustBar({ projectPath, trustedProjectPaths, mcpEnabled, onTrust }: Props) {
  const trusted = isMcpProjectTrusted(projectPath, trustedProjectPaths)
  const [skipped, setSkipped] = useState<Skipped>(NOTHING)
  const [dismissed, setDismissed] = useState(() => dismissedPaths.has(projectPath))

  useEffect(() => {
    setDismissed(dismissedPaths.has(projectPath))
    setSkipped(NOTHING)
    if (!projectPath || trusted) return
    let cancelled = false
    void (async () => {
      const [files, skills, mcp] = await Promise.all([
        loadProjectAgentInstructions({ projectPath }),
        discoverAgentSkills({ projectPath }),
        mcpEnabled
          ? import('@/lib/mcpTools').then((m) => m.getMcpProjectConfigPreview(projectPath))
          : Promise.resolve({ servers: [] }),
      ])
      if (cancelled) return
      setSkipped({
        instructionFiles: files.map((f) => f.fileName),
        projectSkills: skills.filter((s) => s.source === 'project').length,
        mcpServers: mcp.servers.length,
      })
    })().catch(() => {
      // A failed scan just means no bar; the Options panels still show the details.
    })
    return () => {
      cancelled = true
    }
  }, [projectPath, trusted, mcpEnabled])

  if (!projectPath || trusted || dismissed) return null
  const parts = [
    ...skipped.instructionFiles,
    skipped.projectSkills > 0
      ? `${skipped.projectSkills} project skill${skipped.projectSkills === 1 ? '' : 's'}`
      : '',
    skipped.mcpServers > 0
      ? `.mcp.json (${skipped.mcpServers} server${skipped.mcpServers === 1 ? '' : 's'})`
      : '',
  ].filter(Boolean)
  if (parts.length === 0) return null

  return (
    <div
      role="status"
      className="shrink-0 flex flex-wrap items-center gap-2 rounded border border-neon-yellow/40 bg-neon-yellow/5 px-2 py-1.5 text-[11px] font-mono"
    >
      <span
        className="min-w-0 flex-1 text-neon-yellow"
        title="This folder is not trusted, so the agent does not get these files. Trust it only if you know what the repository contains. Trust applies to this exact folder, for every chat bound to it."
      >
        Untrusted folder — not loaded: {parts.join(', ')}
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
