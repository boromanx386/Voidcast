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
        <div className="min-w-0">
          <div className="text-xs font-mono uppercase tracking-wider text-neon-green/70">
            PDF_EXPORT_RESULT
          </div>
          <div className="mt-1 whitespace-pre-wrap break-all text-xs font-mono">
            {toolResultBanner.text}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setToolResultBanner(null)}
          className="shrink-0 px-2 py-1 text-xs font-mono text-neon-green/50 hover:text-neon-green"
        >
          DISMISS
        </button>
      </div>
    </div>
  )
}
