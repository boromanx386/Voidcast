import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import {
  discoverAgentSkills,
  loadProjectAgentInstructions,
  rescanAgentSkills,
  type AgentSkillMeta,
  type ProjectAgentInstructions,
} from '@/lib/agentSkills'
import { isMcpProjectTrusted } from '@/lib/mcpProjectTrust'
import { trustProjectFolder } from '@/lib/projectTrustActions'
import { isElectron, isWebStandalone } from '@/lib/platform'
import type { AppSettings } from '@/lib/settings'

type Props = {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
  /** Folder of the chat on screen — the project whose skills / AGENTS.md this tab reads. */
  activeCodingProjectPath: string
}

export function SkillsOptionsPanel({ settings, setSettings, activeCodingProjectPath }: Props) {
  const [skills, setSkills] = useState<AgentSkillMeta[]>([])
  const [projectFiles, setProjectFiles] = useState<ProjectAgentInstructions[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const desktop = isElectron()
  const projectPath = activeCodingProjectPath.trim()

  const load = useCallback(
    async (force: boolean) => {
      if (!desktop) {
        setSkills([])
        setProjectFiles([])
        return
      }
      setLoading(true)
      setError(null)
      try {
        const list = force
          ? await rescanAgentSkills(projectPath || undefined)
          : await discoverAgentSkills({ projectPath: projectPath || undefined })
        setSkills(list)
        if (projectPath) {
          const files = await loadProjectAgentInstructions({
            force,
            projectPath,
          })
          setProjectFiles(files)
        } else {
          setProjectFiles([])
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setSkills([])
        setProjectFiles([])
      } finally {
        setLoading(false)
      }
    },
    [desktop, projectPath],
  )

  useEffect(() => {
    void load(false)
  }, [load])

  const projectSkillCount = skills.filter((s) => s.source === 'project').length
  const projectTrusted = isMcpProjectTrusted(projectPath, settings.mcpTrustedProjectPaths)

  const onTrustProject = useCallback(
    () => trustProjectFolder(setSettings, projectPath),
    [projectPath, setSettings],
  )

  return (
    <div className="space-y-4">
      <p className="text-sm text-void-dim leading-relaxed">
        Agent Skills are instruction packs: one folder per skill, each with a{' '}
        <code className="text-void-light">SKILL.md</code>. Global skills come from{' '}
        <code className="text-void-light">~/.agents/skills</code> only &mdash;{' '}
        <code className="text-void-light">~/.claude/skills</code> and{' '}
        <code className="text-void-light">~/.cursor/skills</code> are not scanned. When a coding
        project is open, its <code className="text-void-light">.cursor/skills</code>,{' '}
        <code className="text-void-light">.claude/skills</code>,{' '}
        <code className="text-void-light">.agents/skills</code> and{' '}
        <code className="text-void-light">skills/</code> folders are scanned too, and a project
        skill wins over a global one with the same name. The model sees a catalog of names and
        descriptions; full <code className="text-void-light">SKILL.md</code> bodies load via{' '}
        <code className="text-neon-cyan">read_skill</code>.
      </p>

      <p className="text-sm text-void-dim leading-relaxed">
        With coding tools on, Voidcast also injects{' '}
        <code className="text-void-light">AGENTS.md</code> /{' '}
        <code className="text-void-light">CLAUDE.md</code> from the project root into the system
        prompt (repo conventions for every turn) &mdash; only for a{' '}
        <span className="text-void-light">trusted</span> project, since a cloned repo could use them
        to steer the agent. Trust is shared with the project{' '}
        <code className="text-void-light">.mcp.json</code> trust in Options → Tools.
      </p>

      {isWebStandalone() && (
        <p className="text-xs text-void-dim border border-void-muted/30 bg-void-black/40 p-3">
          Skills discovery requires the desktop app (filesystem access). The LAN web client cannot
          read skill folders on this device.
        </p>
      )}

      <label
        className={`flex items-start gap-3 p-4 transition-all cursor-pointer ${
          settings.skillsEnabled
            ? 'bg-neon-cyan/5 border border-neon-cyan/30'
            : 'bg-void-black/50 border border-void-muted/30 hover:border-void-dim/50'
        } ${!desktop ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-neon-cyan"
          checked={settings.skillsEnabled}
          disabled={!desktop}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              skillsEnabled: e.target.checked,
            }))
          }
        />
        <span className="flex-1">
          <span
            className={`font-mono text-sm ${
              settings.skillsEnabled ? 'text-neon-cyan' : 'text-void-light'
            }`}
          >
            <span className="text-neon-purple mr-2">✦</span>
            AGENT_SKILLS
          </span>
          <span className="block text-xs text-void-dim mt-1 leading-relaxed">
            Inject the skills catalog into the system prompt and register{' '}
            <code className="text-void-light">read_skill</code>.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="cyber-btn text-xs"
          disabled={!desktop || loading}
          onClick={() => void load(true)}
        >
          {loading ? 'SCANNING…' : 'RESCAN'}
        </button>
        <span className="text-xs text-void-dim font-mono">
          {desktop
            ? loading
              ? '…'
              : `${skills.length} skill${skills.length === 1 ? '' : 's'}${
                  projectSkillCount > 0 ? ` (${projectSkillCount} project)` : ''
                }`
            : 'desktop only'}
        </span>
      </div>

      {projectPath ? (
        <>
          <p className="text-xs text-void-dim font-mono break-all">
            Coding project: {projectPath}
            {projectFiles.length > 0
              ? ` · instructions: ${projectFiles.map((f) => f.fileName).join(', ')}${
                  projectTrusted ? '' : ' (not loaded — untrusted)'
                }`
              : ' · no AGENTS.md / CLAUDE.md'}
          </p>
          {(projectFiles.length > 0 || projectSkillCount > 0) && !projectTrusted && (
            <div className="rounded border border-neon-yellow/40 bg-neon-yellow/5 px-3 py-3 space-y-2">
              <p className="text-xs text-neon-yellow font-mono">
                Untrusted project — its instruction files and project skills are not sent to the
                model. Trust it only if you know what the repository contains.
              </p>
              <button type="button" className="cyber-btn text-xs" onClick={onTrustProject}>
                TRUST_PROJECT
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-void-dim">
          This chat has no coding folder. Bind one in the chat header (or the coding panel) to load
          project skills and AGENTS.md / CLAUDE.md.
        </p>
      )}

      {error && (
        <p className="text-xs text-neon-red font-mono border border-neon-red/30 p-2">{error}</p>
      )}

      {desktop && !loading && skills.length === 0 && !error && (
        <p className="text-xs text-void-dim">
          No skills found. Install skills into a global folder above, or add{' '}
          <code className="text-void-light">.cursor/skills/&lt;name&gt;/SKILL.md</code> in the
          coding project.
        </p>
      )}

      {skills.length > 0 && (
        <ul className="space-y-2 max-h-[28rem] overflow-y-auto">
          {skills.map((s) => (
            <li
              key={`${s.source}:${s.dirPath}`}
              className="bg-void-black/50 border border-void-muted/30 p-3"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-sm text-neon-cyan">{s.name}</span>
                <span
                  className={`font-mono text-[10px] uppercase tracking-wider ${
                    s.source === 'project' ? 'text-neon-purple' : 'text-void-dim'
                  }`}
                >
                  {s.source}
                  {s.source === 'project' && !projectTrusted ? ' · not loaded — untrusted' : ''}
                </span>
              </div>
              <p className="text-xs text-void-dim mt-1 leading-relaxed">
                {s.description.trim() || '(no description)'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
