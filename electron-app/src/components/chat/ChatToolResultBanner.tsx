import type { VoidcastApp } from '@/hooks/useVoidcastApp'

type Props = {
  app: Pick<VoidcastApp, 'toolResultBanner' | 'setToolResultBanner'>
}

export function ChatToolResultBanner({ app }: Props) {
  const { toolResultBanner, setToolResultBanner } = app
  if (!toolResultBanner) return null

  return (
    <div className="tool-result-banner mx-4 my-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-mono text-neon-green/70 uppercase tracking-wider">
            PDF_EXPORT_RESULT
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
