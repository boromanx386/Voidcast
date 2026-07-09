import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import {
  discoverAgentSkills,
  rescanAgentSkills,
  type AgentSkillMeta,
} from '@/lib/agentSkills'
import { isElectron, isWebStandalone } from '@/lib/platform'
import type { AppSettings } from '@/lib/settings'

type Props = {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
}

export function SkillsOptionsPanel({ settings, setSettings }: Props) {
  const [skills, setSkills] = useState<AgentSkillMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const desktop = isElectron()

  const load = useCallback(async (force: boolean) => {
    if (!desktop) {
      setSkills([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const list = force ? await rescanAgentSkills() : await discoverAgentSkills()
      setSkills(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSkills([])
    } finally {
      setLoading(false)
    }
  }, [desktop])

  useEffect(() => {
    void load(false)
  }, [load])

  return (
    <div className="space-y-4">
      <p className="text-sm text-void-dim leading-relaxed">
        Agent Skills are instruction packs discovered from standard folders under your user
        profile (<code className="text-void-light">~/.agents/skills</code>,{' '}
        <code className="text-void-light">~/.claude/skills</code>,{' '}
        <code className="text-void-light">~/.cursor/skills</code>). The model sees a catalog of
        names and descriptions; full <code className="text-void-light">SKILL.md</code> bodies load
        on demand via <code className="text-neon-cyan">read_skill</code>.
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
              : `${skills.length} skill${skills.length === 1 ? '' : 's'} found`
            : 'desktop only'}
        </span>
      </div>

      {error && (
        <p className="text-xs text-neon-red font-mono border border-neon-red/30 p-2">{error}</p>
      )}

      {desktop && !loading && skills.length === 0 && !error && (
        <p className="text-xs text-void-dim">
          No skills found. Install skills into one of the folders above (each skill is a directory
          containing <code className="text-void-light">SKILL.md</code>).
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
                <span className="font-mono text-[10px] uppercase tracking-wider text-void-dim">
                  {s.source}
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
