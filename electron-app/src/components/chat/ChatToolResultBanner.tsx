import type { VoidcastApp } from '@/hooks/useVoidcastApp'

type Props = {
  app: Pick<VoidcastApp, 'toolResultBanner' | 'setToolResultBanner'>
}

export function ChatToolResultBanner({ app }: Props) {
  const { toolResultBanner, setToolResultBanner } = app
  if (!toolResultBanner) return null

  const isTimeout = toolResultBanner.kind === 'timeout'

  return (
    <div
      className={`tool-result-banner mx-4 my-2${isTimeout ? ' tool-result-banner--timeout' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div
            className={`text-xs font-mono uppercase tracking-wider ${
              isTimeout ? 'text-neon-red/80' : 'text-neon-green/70'
            }`}
          >
            {isTimeout ? 'TOOL_TIMEOUT' : 'PDF_EXPORT_RESULT'}
          </div>
          <div className="mt-1 whitespace-pre-wrap break-all text-xs font-mono">
            {toolResultBanner.text}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setToolResultBanner(null)}
          className="text-neon-green/50 hover:text-neon-green px-2 py-1 text-xs font-mono"
        >
          DISMISS
        </button>
      </div>
    </div>
  )
}
