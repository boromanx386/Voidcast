import { useEffect, useRef } from 'react'
import type { TerminalLine } from '@/types/coding'

type Props = {
  lines: TerminalLine[]
}

export function TerminalView({ lines }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [lines])

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded border border-void-muted/30 bg-void-black/50 p-2">
      <div className="mb-2 shrink-0 text-xs font-mono text-neon-yellow">TERMINAL</div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-1 overflow-auto font-mono text-xs"
      >
        {lines.length === 0 && <div className="text-void-dim">No terminal output yet.</div>}
        {lines.map((line) => (
          <div
            key={line.id}
            className={line.stream === 'stderr' ? 'text-neon-red/90' : line.stream === 'system' ? 'text-neon-cyan/80' : 'text-void-light'}
          >
            {line.text}
          </div>
        ))}
      </div>
    </div>
  )
}
