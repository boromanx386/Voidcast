import type { AgentToolUiPhase } from '@/lib/agentToolPhase'

export function CrtOverlay() {
  return <div className="crt-overlay" aria-hidden="true" />
}

export function AmbientParticles() {
  return (
    <div className="ambient-particles" aria-hidden="true">
      {Array.from({ length: 20 }).map((_, i) => (
        <div
          key={i}
          className="particle"
          style={{
            left: `${Math.random() * 100}%`,
            animationDelay: `${Math.random() * 10}s`,
            animationDuration: `${10 + Math.random() * 10}s`,
          }}
        />
      ))}
    </div>
  )
}

export function GlitchText({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span className={`glitch-text ${className}`} data-text={children}>
      {children}
    </span>
  )
}

const TOOL_PHASE_UI: Record<
  AgentToolUiPhase,
  { icon: string; label: string; className: string }
> = {
  search: { icon: '⌕', label: 'SEARCHING_NET', className: 'search' },
  youtube: { icon: '▶', label: 'YOUTUBE_PROC', className: 'youtube' },
  reddit: { icon: '⬢', label: 'REDDIT_FEED', className: 'reddit' },
  weather: { icon: '◐', label: 'WEATHER_API', className: 'weather' },
  scrape: { icon: '⬡', label: 'SCRAPING', className: 'scrap' },
  pdf: { icon: '⬡', label: 'PDF_EXPORT', className: 'pdf' },
  image: { icon: '◌', label: 'IMAGE_GEN', className: 'image' },
  vision: { icon: '◎', label: 'IMAGE_RECALL', className: 'vision' },
  music: { icon: '♫', label: 'MUSIC_GEN', className: 'music' },
  coding_list: { icon: '⊢', label: 'CODING_FILES', className: 'coding' },
  coding_read: { icon: '◊', label: 'CODING_READ', className: 'coding' },
  coding_write: { icon: '▹', label: 'CODING_WRITE', className: 'coding' },
  coding_edit: { icon: '✎', label: 'CODING_EDIT', className: 'coding' },
  coding_search: { icon: '◇', label: 'CODING_FIND', className: 'coding' },
  coding_glob: { icon: '◎', label: 'CODING_GLOB', className: 'coding' },
  coding_git: { icon: '⎇', label: 'CODING_GIT', className: 'coding' },
  coding_typecheck: { icon: 'τ', label: 'TYPECHECK', className: 'coding' },
  coding_shell: { icon: '$', label: 'CODING_SHELL', className: 'coding' },
  settings: { icon: '⚙', label: 'APP_SETTINGS', className: 'settings' },
  reminder: { icon: '⧗', label: 'REMINDER', className: 'reminder' },
  skill: { icon: '✦', label: 'READ_SKILL', className: 'skill' },
  plan: { icon: '✎', label: 'PLAN_MODE', className: 'plan' },
  plan_progress: { icon: '✓', label: 'PLAN_PROGRESS', className: 'plan' },
  other: { icon: '◈', label: 'TOOL', className: 'other' },
}

export function ToolIndicator({ phase }: { phase: AgentToolUiPhase | null }) {
  if (!phase) return null

  const tool = TOOL_PHASE_UI[phase]

  return (
    <div className={`tool-indicator ${tool.className}`}>
      <span className="opacity-70">{tool.icon}</span>
      <span>{tool.label}</span>
      <span className="ml-2 animate-pulse">_</span>
    </div>
  )
}
