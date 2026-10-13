import { useEffect } from 'react'
import type { VoidcastApp } from '@/hooks/useVoidcastApp'

// A timeout notice is transient: the busy strip already showed the live countdown,
// so don't leave a stale box pinned above the composer.
const TIMEOUT_AUTO_DISMISS_MS = 8000

type Props = {
  app: Pick<VoidcastApp, 'toolResultBanner' | 'setToolResultBanner'>
}

export function ChatToolResultBanner({ app }: Props) {
  const { toolResultBanner, setToolResultBanner } = app
  const isTimeout = toolResultBanner?.kind === 'timeout'

  useEffect(() => {
    if (!isTimeout) return
    const timer = window.setTimeout(() => setToolResultBanner(null), TIMEOUT_AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [isTimeout, toolResultBanner, setToolResultBanner])

  if (!toolResultBanner) return null

  return (
    <div
      className={`tool-result-banner mx-4 my-2${isTimeout ? ' tool-result-banner--timeout' : ''}`}
    >
      <div
        className={`flex justify-between gap-3 ${isTimeout ? 'items-baseline' : 'items-start'}`}
      >
        {isTimeout ? (
          // One line only: the countdown already told the story, this just records
          // which tool was stopped. Full text stays reachable via the tooltip.
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-xs font-mono uppercase tracking-wider text-neon-red/80">
              TOOL_TIMEOUT
            </span>
            <span className="truncate text-xs font-mono" title={toolResultBanner.text}>
              {toolResultBanner.text}
            </span>
          </div>
        ) : (
          <div className="min-w-0">
            <div className="text-xs font-mono uppercase tracking-wider text-neon-green/70">
              PDF_EXPORT_RESULT
            </div>
            <div className="mt-1 whitespace-pre-wrap break-all text-xs font-mono">
              {toolResultBanner.text}
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => setToolResultBanner(null)}
          className={`shrink-0 px-2 py-1 text-xs font-mono ${
            isTimeout
              ? 'text-neon-red/50 hover:text-neon-red'
              : 'text-neon-green/50 hover:text-neon-green'
          }`}
        >
          DISMISS
        </button>
      </div>
    </div>
  )
}
