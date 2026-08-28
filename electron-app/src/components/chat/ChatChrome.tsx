import { useEffect, useRef } from 'react'
import type { AgentToolActivity, AgentToolUiPhase } from '@/lib/agentToolPhase'

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

const MATRIX_GLYPHS =
  'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789ABCDEF<>*+#='

/** Classic falling green code rain for the Matrix UI theme. */
export function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const parent = canvas.parentElement
    let width = 0
    let height = 0
    let columns = 0
    let drops: number[] = []
    let speeds: number[] = []
    let raf = 0
    let last = 0

    const resize = () => {
      const rect = parent?.getBoundingClientRect()
      width = Math.max(1, Math.floor(rect?.width ?? window.innerWidth))
      height = Math.max(1, Math.floor(rect?.height ?? window.innerHeight))
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const fontSize = width < 640 ? 12 : 14
      columns = Math.max(1, Math.floor(width / fontSize))
      drops = Array.from({ length: columns }, () => Math.random() * -40)
      speeds = Array.from({ length: columns }, () => 0.55 + Math.random() * 0.9)
      ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
    }

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      if (now - last < 33) return
      last = now

      const fontSize = width < 640 ? 12 : 14
      ctx.fillStyle = 'rgba(0, 0, 0, 0.08)'
      ctx.fillRect(0, 0, width, height)

      for (let i = 0; i < columns; i++) {
        const x = i * fontSize
        const y = drops[i]! * fontSize
        const ch = MATRIX_GLYPHS[(Math.random() * MATRIX_GLYPHS.length) | 0]!

        ctx.fillStyle = 'rgba(180, 255, 190, 0.95)'
        ctx.fillText(ch, x, y)
        ctx.fillStyle = 'rgba(0, 255, 65, 0.55)'
        ctx.fillText(ch, x, y - fontSize)

        if (y > height && Math.random() > 0.975) {
          drops[i] = Math.random() * -20
        } else {
          drops[i]! += speeds[i]!
        }
      }
    }

    resize()
    raf = requestAnimationFrame(draw)
    const ro = parent ? new ResizeObserver(resize) : null
    if (parent && ro) ro.observe(parent)
    window.addEventListener('resize', resize)

    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={canvasRef} className="matrix-rain" aria-hidden="true" />
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
  coding_outline: { icon: '⎘', label: 'CODING_OUTLINE', className: 'coding' },
  coding_git: { icon: '⎇', label: 'CODING_GIT', className: 'coding' },
  coding_typecheck: { icon: 'τ', label: 'TYPECHECK', className: 'coding' },
  coding_shell: { icon: '$', label: 'CODING_SHELL', className: 'coding' },
  coding_explore: { icon: '◎', label: 'CODING_EXPLORE', className: 'coding' },
  settings: { icon: '⚙', label: 'APP_SETTINGS', className: 'settings' },
  reminder: { icon: '⧗', label: 'REMINDER', className: 'reminder' },
  skill: { icon: '✦', label: 'READ_SKILL', className: 'skill' },
  plan: { icon: '✎', label: 'PLAN_MODE', className: 'plan' },
  plan_progress: { icon: '✓', label: 'PLAN_PROGRESS', className: 'plan' },
  mcp: { icon: '⬡', label: 'MCP', className: 'other' },
  other: { icon: '◈', label: 'TOOL', className: 'other' },
}

export function ToolIndicator({
  phase,
  activities,
}: {
  phase: AgentToolUiPhase | null
  activities?: AgentToolActivity[]
}) {
  if (activities?.length) {
    return (
      <div className="space-y-1" aria-live="polite" aria-label="Active tool calls">
        {activities.length > 1 ? (
          <div className="text-[10px] font-mono text-void-dim">
            PARALLEL_TOOLS · {activities.length} ACTIVE
          </div>
        ) : null}
        {activities.map((activity) => {
          const tool = TOOL_PHASE_UI[activity.phase || 'other']
          return (
            <div key={activity.id} className={`tool-indicator ${tool.className}`}>
              <span className="opacity-70">{tool.icon}</span>
              <span>{tool.label}</span>
              <span className="ml-2 text-[10px] opacity-60">{activity.name}</span>
              <span className="ml-2 animate-pulse">_</span>
            </div>
          )
        })}
      </div>
    )
  }

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
