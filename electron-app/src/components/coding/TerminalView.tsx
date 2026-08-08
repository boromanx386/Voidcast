import { memo, useCallback, useEffect, useRef } from 'react'
import type { TerminalLine } from '@/types/coding'

const TerminalLineRow = memo(function TerminalLineRow({ line }: { line: TerminalLine }) {
  return (
    <div
      className={
        line.stream === 'stderr'
          ? 'coding-terminal-stderr'
          : line.stream === 'system'
            ? 'coding-terminal-system'
            : 'text-void-light'
      }
    >
      {line.text}
    </div>
  )
})

type Props = {
  lines: TerminalLine[]
  /** When set, shows a small CLEAR control in the header to wipe buffered lines. */
  onClear?: () => void
  /** Foreground command is streaming — show running hint + STOP. */
  running?: boolean
  onStop?: () => void
}

export function TerminalView({ lines, onClear, running = false, onStop }: Props) {
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
        <div className="flex min-w-0 items-center gap-2">
          <div className="coding-label--terminal text-xs font-mono">TERMINAL</div>
          {running && (
            <span className="truncate text-[10px] font-mono uppercase tracking-wide text-void-dim">
              running…
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {running && onStop && (
            <button
              type="button"
              onClick={onStop}
              title="Stop running command"
              aria-label="Stop running command"
              className="rounded border border-void-muted/50 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-void-dim transition-colors hover:border-red-400/50 hover:text-red-300"
            >
              STOP
            </button>
          )}
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              disabled={lines.length === 0}
              title="Clear terminal output"
              aria-label="Clear terminal output"
              className="rounded border border-void-muted/50 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-void-dim transition-colors hover:border-[rgb(var(--coding-terminal-label-fg)/0.4)] hover:text-[rgb(var(--coding-terminal-label-fg))] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-void-muted/50 disabled:hover:text-void-dim"
            >
              CLEAR
            </button>
          )}
        </div>
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
