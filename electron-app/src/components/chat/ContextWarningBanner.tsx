import type { VoidcastApp } from '@/hooks/useVoidcastApp'

type Props = {
  app: Pick<
    VoidcastApp,
    | 'settings'
    | 'contextUsageInfo'
    | 'contextWarnDismissed'
    | 'setContextWarnDismissed'
    | 'contextCompressBusy'
    | 'busy'
    | 'summarizeContextNow'
  >
}

export function ContextWarningBanner({ app }: Props) {
  const {
    settings,
    contextUsageInfo,
    contextWarnDismissed,
    setContextWarnDismissed,
    contextCompressBusy,
    busy,
    summarizeContextNow,
  } = app

  return (
    <>
      {contextUsageInfo?.shouldWarn &&
        !settings.contextAutoCompress &&
        !contextWarnDismissed && (
        <div className="border-t border-neon-yellow/30 bg-neon-yellow/5 px-4 py-3 mx-4 my-2 rounded">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-mono text-neon-yellow">
              <span className="opacity-70">CONTEXT_WARNING:</span>
              {' '}CTX_USAGE {Math.round(contextUsageInfo.ratio * 100)}%
              ({contextUsageInfo.promptTokens}/{contextUsageInfo.maxTokens})
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy || contextCompressBusy}
                onClick={() => void summarizeContextNow()}
                className="cyber-btn text-xs"
              >
                {contextCompressBusy ? 'COMPRESSING...' : 'COMPRESS'}
              </button>
              <button
                type="button"
                onClick={() => setContextWarnDismissed(true)}
                className="px-3 py-1 text-xs font-mono text-void-dim hover:text-void-light"
              >
                IGNORE
              </button>
            </div>
          </div>
          <div className="context-bar mt-2">
            <div
              className={`context-fill ${contextUsageInfo.ratio > 0.9 ? 'danger' : contextUsageInfo.ratio > 0.7 ? 'warning' : ''}`}
              style={{ width: `${Math.min(100, contextUsageInfo.ratio * 100)}%` }}
            />
          </div>
        </div>
      )}
      {settings.contextAutoCompress &&
        contextUsageInfo?.shouldCompress &&
        (contextCompressBusy || busy) && (
        <div className="border-t border-neon-cyan/25 bg-neon-cyan/5 px-4 py-2 mx-4 my-2 rounded">
          <div className="text-sm font-mono text-neon-cyan">
            <span className="opacity-70">CONTEXT:</span>
            {' '}CTX {Math.round(contextUsageInfo.ratio * 100)}%
            {contextCompressBusy ? ' · auto-compressing…' : ' · auto-compress when idle'}
          </div>
        </div>
      )}
    </>
  )
}
