import type { VoidcastApp } from '@/hooks/useVoidcastApp'

type Props = {
  app: Pick<
    VoidcastApp,
    | 'settings'
    | 'subAgentPanelOpen'
    | 'setSubAgentPanelOpen'
    | 'subAgentPanelBusy'
    | 'setSubAgentPanelBusy'
    | 'subAgentPanelText'
    | 'setSubAgentPanelText'
  >
}

export function SubAgentPanel({ app }: Props) {
  const {
    settings,
    subAgentPanelOpen,
    setSubAgentPanelOpen,
    subAgentPanelBusy,
    setSubAgentPanelBusy,
    subAgentPanelText,
    setSubAgentPanelText,
  } = app

  if (
    !subAgentPanelOpen ||
    !settings.subAgent.enabled ||
    settings.subAgent.showAnalysisWindow === false
  ) {
    return null
  }

  return (
    <div
      className="fixed right-4 top-20 z-[65] w-[min(22rem,calc(100vw-2rem))] max-h-[min(70vh,32rem)] flex flex-col rounded border border-neon-cyan/40 bg-void-dark/95 shadow-lg backdrop-blur-sm"
      role="dialog"
      aria-label="Sub-agent vision analysis"
    >
      <div className="flex items-center justify-between gap-2 border-b border-void-muted/30 px-3 py-2">
        <div className="text-xs font-mono text-neon-cyan">
          {subAgentPanelBusy ? 'SUB_AGENT · WORKING' : 'SUB_AGENT · ANALYSIS'}
        </div>
        <button
          type="button"
          onClick={() => {
            setSubAgentPanelOpen(false)
            setSubAgentPanelBusy(false)
            setSubAgentPanelText('')
          }}
          className="px-2 py-0.5 text-[10px] font-mono text-void-dim hover:text-void-light"
        >
          CLOSE
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {subAgentPanelBusy ? (
          <div className="flex items-center gap-2 text-xs font-mono text-void-dim">
            <span
              className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-void-dim border-t-neon-cyan"
              aria-hidden
            />
            {subAgentPanelText}
          </div>
        ) : (
          <pre className="whitespace-pre-wrap break-words text-xs font-mono text-void-light">
            {subAgentPanelText}
          </pre>
        )}
      </div>
    </div>
  )
}
