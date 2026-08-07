import type { VoidcastApp } from '@/hooks/useVoidcastApp'
import {
  formatSubAgentTime,
  type SubAgentPanelEvent,
  type SubAgentWorkerSlot,
} from '@/lib/subAgentPanelState'

type Props = {
  app: Pick<
    VoidcastApp,
    | 'settings'
    | 'subAgentPanel'
    | 'setSubAgentPanelOpen'
    | 'setSubAgentPanelCollapsed'
  >
}

function kindLabel(kind: string, busy: boolean): string {
  const status = busy ? 'WORKING' : 'DONE'
  switch (kind) {
    case 'vision':
      return `VISION · ${status}`
    case 'explore':
      return `EXPLORE · ${status}`
    case 'workers':
      return `WORKERS · ${status}`
    default:
      return `SUB_AGENT · ${status}`
  }
}

function levelClass(level: SubAgentPanelEvent['level']): string {
  switch (level) {
    case 'ok':
      return 'text-neon-green/90'
    case 'warn':
      return 'text-amber-300/90'
    case 'err':
      return 'text-red-400/90'
    default:
      return 'text-void-dim'
  }
}

function workerStatusClass(status: SubAgentWorkerSlot['status']): string {
  switch (status) {
    case 'done':
      return 'border-neon-green/35 text-neon-green'
    case 'error':
      return 'border-red-400/40 text-red-400'
    default:
      return 'border-neon-cyan/35 text-neon-cyan'
  }
}

/** In-chat collapsible card for vision / explore / coding workers activity. */
export function SubAgentPanel({ app }: Props) {
  const {
    settings,
    subAgentPanel: panel,
    setSubAgentPanelOpen,
    setSubAgentPanelCollapsed,
  } = app

  const enabled =
    settings.subAgent.enabled || settings.subAgent.codingEnabled
  const showWindow = settings.subAgent.showAnalysisWindow !== false

  if (!panel.open || !enabled || !showWindow) {
    return null
  }

  const eventsNewestFirst = [...panel.events].reverse()
  const showWorkers = panel.kind === 'workers' && panel.workers.length > 0
  const summaryLine =
    panel.progress ||
    (panel.busy ? panel.text : 'Done — expand for digest')

  return (
    <div
      className="message-container assistant animate-message-in"
      role="region"
      aria-label="Sub-agent activity"
      aria-busy={panel.busy}
    >
      <div className="message-bubble message-assistant border border-neon-cyan/30 bg-void-dark/90">
        <div className="flex items-center justify-between gap-2 border-b border-void-muted/25 px-1 pb-2">
          <button
            type="button"
            onClick={() => setSubAgentPanelCollapsed(!panel.collapsed)}
            className="min-w-0 flex flex-1 items-center gap-2 text-left"
            aria-expanded={!panel.collapsed}
          >
            <span className="shrink-0 text-[10px] font-mono text-void-dim" aria-hidden>
              {panel.collapsed ? '▸' : '▾'}
            </span>
            {panel.busy ? (
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-2 border-void-dim border-t-neon-cyan"
                aria-hidden
              />
            ) : null}
            <span className="min-w-0 truncate text-xs font-mono text-neon-cyan">
              {kindLabel(panel.kind, panel.busy)}
            </span>
            {panel.collapsed && summaryLine ? (
              <span className="min-w-0 truncate text-[10px] font-mono text-void-dim">
                · {summaryLine}
              </span>
            ) : null}
          </button>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              title={panel.collapsed ? 'Expand' : 'Collapse'}
              onClick={() => setSubAgentPanelCollapsed(!panel.collapsed)}
              className="px-1.5 py-0.5 text-[10px] font-mono text-void-dim hover:text-void-light"
            >
              {panel.collapsed ? 'EXPAND' : 'COLLAPSE'}
            </button>
            <button
              type="button"
              title="Dismiss"
              onClick={() => setSubAgentPanelOpen(false)}
              className="px-1.5 py-0.5 text-[10px] font-mono text-void-dim hover:text-void-light"
            >
              DISMISS
            </button>
          </div>
        </div>

        {!panel.collapsed ? (
          <div className="mt-2 flex min-h-0 flex-col gap-2">
            {panel.progress && !panel.busy ? (
              <div className="text-[10px] font-mono text-void-dim">{panel.progress}</div>
            ) : null}

            {showWorkers ? (
              <div className="grid grid-cols-2 gap-1.5">
                {panel.workers.map((w) => (
                  <div
                    key={w.id}
                    className={`rounded border bg-void-black/40 px-2 py-1.5 ${workerStatusClass(w.status)}`}
                  >
                    <div className="flex items-center justify-between gap-1 text-[10px] font-mono">
                      <span className="truncate font-semibold">{w.label}</span>
                      {w.status === 'running' ? (
                        <span
                          className="inline-block h-2 w-2 shrink-0 animate-spin rounded-full border border-current border-t-transparent"
                          aria-hidden
                        />
                      ) : (
                        <span className="shrink-0 uppercase opacity-80">
                          {w.status}
                        </span>
                      )}
                    </div>
                    {w.progress ? (
                      <div className="mt-0.5 truncate text-[10px] font-mono text-void-dim">
                        {w.progress}
                      </div>
                    ) : null}
                    {w.lastLine && w.lastLine !== w.progress ? (
                      <div className="mt-0.5 truncate text-[10px] font-mono text-void-light/70">
                        {w.lastLine}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {eventsNewestFirst.length > 0 ? (
              <div className="max-h-[7.5rem] overflow-y-auto rounded border border-void-muted/25 bg-void-black/30">
                <ul className="divide-y divide-void-muted/15">
                  {eventsNewestFirst.map((ev) => (
                    <li
                      key={ev.id}
                      className={`flex gap-2 px-2 py-1 text-[10px] font-mono ${levelClass(ev.level)}`}
                    >
                      <span className="shrink-0 text-void-dim/80">
                        {formatSubAgentTime(ev.at)}
                      </span>
                      <span className="min-w-0 break-words text-void-light/80">
                        {ev.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="max-h-[14rem] overflow-y-auto">
              {panel.busy && !panel.text.includes('\n') ? (
                <div className="flex items-center gap-2 text-xs font-mono text-void-dim">
                  <span
                    className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-void-dim border-t-neon-cyan"
                    aria-hidden
                  />
                  {panel.text || 'Working…'}
                </div>
              ) : (
                <pre className="whitespace-pre-wrap break-words text-xs font-mono text-void-light">
                  {panel.text || (panel.busy ? 'Working…' : '')}
                </pre>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
