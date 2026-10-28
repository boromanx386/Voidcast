import { memo, useCallback, useEffect, useRef, type CSSProperties } from 'react'
import { hasAnsi, parseAnsi, type AnsiStyle } from '@/lib/ansi'
import type { TerminalLine } from '@/types/coding'

function ansiCss(style: AnsiStyle): CSSProperties {
  const fg = style.inverse ? (style.bg ?? 'rgb(var(--color-void-black))') : style.fg
  const bg = style.inverse ? (style.fg ?? 'rgb(var(--color-void-light))') : style.bg
  return {
    color: fg,
    backgroundColor: bg,
    fontWeight: style.bold ? 700 : undefined,
    opacity: style.dim ? 0.7 : undefined,
    fontStyle: style.italic ? 'italic' : undefined,
    textDecoration: style.underline ? 'underline' : undefined,
  }
}

const TerminalLineRow = memo(function TerminalLineRow({ line }: { line: TerminalLine }) {
  return (
    // pre-wrap: indentation in stack traces, tables and tree output must survive.
    <div
      className={`whitespace-pre-wrap break-words ${
        line.stream === 'stderr'
          ? 'coding-terminal-stderr'
          : line.stream === 'stderr-output'
            ? 'coding-terminal-stderr-output'
            : line.stream === 'system'
              ? 'coding-terminal-system'
              : 'text-void-light'
      }`}
    >
      {line.text.length === 0
        ? ' '
        : hasAnsi(line.text)
          ? parseAnsi(line.text).map((span, i) => (
              <span key={i} style={ansiCss(span.style)}>
                {span.text}
              </span>
            ))
          : line.text}
    </div>
  )
})

export type TerminalTab = {
  id: string
  label: string
  title?: string
  /** New output arrived while another tab was shown. */
  unread?: boolean
}

type Props = {
  lines: TerminalLine[]
  /** Tabs replace the TERMINAL label; the parent passes the active tab's lines. */
  tabs?: TerminalTab[]
  activeTab?: string
  onTabChange?: (id: string) => void
  /** When set, shows a small CLEAR control in the header to wipe buffered lines. */
  onClear?: () => void
  /** Foreground command is streaming — show running hint + STOP. */
  running?: boolean
  onStop?: () => void
  emptyText?: string
}

export function TerminalView({
  lines,
  tabs,
  activeTab,
  onTabChange,
  onClear,
  running = false,
  onStop,
  emptyText = 'No terminal output yet.',
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  const pinBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const gap = el.scrollHeight - el.clientHeight - el.scrollTop
    stickToBottomRef.current = gap < 48
  }, [])

  // Follow new output while pinned to the bottom.
  useEffect(() => {
    const id = requestAnimationFrame(pinBottom)
    return () => cancelAnimationFrame(id)
  }, [lines, pinBottom])

  // A tab switch shows a different buffer: start it at its newest line.
  useEffect(() => {
    stickToBottomRef.current = true
    const id = requestAnimationFrame(pinBottom)
    return () => cancelAnimationFrame(id)
  }, [activeTab, pinBottom])

  // When the pane is resized (shrink/grow), re-pin if we were following —
  // otherwise the last lines sit clipped under the viewport with no way to
  // reach them (or look like scroll is broken if overflow wasn't constrained).
  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (!stickToBottomRef.current) return
      requestAnimationFrame(pinBottom)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [pinBottom])

  return (
    // h-full + min-h-0: parent must bound height; without this the body grows
    // with every line and the outer overflow clips — scroll never appears and
    // latest output sits “below” the pane.
    <div className="flex h-full min-h-0 flex-col rounded border border-void-muted/30 bg-void-black/50 p-2">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {tabs && tabs.length > 0 ? (
            <div role="tablist" className="flex items-center gap-1">
              {tabs.map((tab) => {
                const active = tab.id === activeTab
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    title={tab.title}
                    onClick={() => onTabChange?.(tab.id)}
                    className={`relative rounded px-1.5 py-0.5 text-xs font-mono transition-colors ${
                      active
                        ? 'coding-label--terminal bg-void-mid/60'
                        : 'text-void-dim hover:text-void-light'
                    }`}
                  >
                    {tab.label}
                    {tab.unread && !active && (
                      <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-[rgb(var(--coding-terminal-label-fg))]" />
                    )}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="coding-label--terminal text-xs font-mono">TERMINAL</div>
          )}
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
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden font-mono text-xs leading-relaxed"
      >
        {lines.length === 0 && <div className="text-void-dim">{emptyText}</div>}
        {lines.map((line) => (
          <TerminalLineRow key={line.id} line={line} />
        ))}
      </div>
    </div>
  )
}
