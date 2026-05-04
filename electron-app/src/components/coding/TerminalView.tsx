import { memo, useCallback, useEffect, useRef } from 'react'
import type { TerminalLine } from '@/types/coding'

const TerminalLineRow = memo(function TerminalLineRow({ line }: { line: TerminalLine }) {
  return (
    <div
      className={
        line.stream === 'stderr'
          ? 'text-neon-red/90'
          : line.stream === 'system'
            ? 'text-neon-cyan/80'
            : 'text-void-light'
      }
      style={{ contentVisibility: 'auto' as const }}
    >
      {line.text}
    </div>
  )
})

type Props = {
  lines: TerminalLine[]
  /** When set, shows a small CLEAR control in the header to wipe buffered lines. */
  onClear?: () => void
}

export function TerminalView({ lines, onClear }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const gap = el.scrollHeight - el.clientHeight - el.scrollTop
    stickToBottomRef.current = gap < 48
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !stickToBottomRef.current) return
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(id)
  }, [lines])

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded border border-void-muted/30 bg-void-black/50 p-2">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <div className="text-xs font-mono text-neon-yellow">TERMINAL</div>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            disabled={lines.length === 0}
            title="Clear terminal output"
            aria-label="Clear terminal output"
            className="rounded border border-void-muted/50 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-void-dim transition-colors hover:border-neon-yellow/40 hover:text-neon-yellow disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-void-muted/50 disabled:hover:text-void-dim"
          >
            CLEAR
          </button>
        )}
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 space-y-1 overflow-auto font-mono text-xs"
      >
        {lines.length === 0 && <div className="text-void-dim">No terminal output yet.</div>}
        {lines.map((line) => (
          <TerminalLineRow key={line.id} line={line} />
        ))}
      </div>
    </div>
  )
}
