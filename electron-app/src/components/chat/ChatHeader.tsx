import { BrainIcon } from '@/components/icons/BrainIcon'
import { CodeIcon } from '@/components/icons/CodeIcon'
import { WindowControls } from '@/components/WindowControls'
import type { VoidcastApp } from '@/hooks/useVoidcastApp'

type Props = { app: VoidcastApp }

function SessionsToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4" width="6" height="16" rx="1" className={collapsed ? 'opacity-40' : undefined} />
      <rect x="11" y="4" width="10" height="16" rx="1" />
    </svg>
  )
}

export function ChatHeader({ app }: Props) {
  const {
    sessionsSidebarCollapsed,
    setSessionsSidebarCollapsed,
    codingPanelAvailable,
    showCodingPanel,
    setShowCodingPanel,
    busy,
    longMemoryBusy,
    messages,
    extractLongMemoryNow,
    canSaveSession,
    saveOrUpdateSession,
    onStop,
  } = app
  const canStop = busy

  return (
    <header className="voidcast-header min-w-0">
      <button
        type="button"
        aria-label={sessionsSidebarCollapsed ? 'Show sessions panel' : 'Hide sessions panel'}
        aria-expanded={!sessionsSidebarCollapsed}
        onClick={() => setSessionsSidebarCollapsed((v) => !v)}
        className={`cyber-btn flex h-8 w-8 shrink-0 items-center justify-center p-0 ${
          !sessionsSidebarCollapsed ? 'border-neon-cyan/60 text-neon-cyan' : ''
        }`}
      >
        <SessionsToggleIcon collapsed={sessionsSidebarCollapsed} />
      </button>

      <div className="voidcast-header-brand pointer-events-none ml-2 hidden min-w-0 items-center gap-1.5 sm:flex">
        <span className="voidcast-header-mark" aria-hidden />
        <span className="truncate font-display text-[10px] font-semibold tracking-[0.2em] text-void-text/80">
          VOIDCAST
        </span>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1 sm:gap-3">
        {codingPanelAvailable && (
          <button
            type="button"
            onClick={() => setShowCodingPanel((v) => !v)}
            className={`cyber-btn flex h-8 w-8 shrink-0 items-center justify-center p-0 ${showCodingPanel ? 'border-neon-cyan/60 text-neon-cyan' : ''}`}
            title={showCodingPanel ? 'Hide coding panel' : 'Show coding panel'}
            aria-label={showCodingPanel ? 'Hide coding panel' : 'Show coding panel'}
          >
            <CodeIcon className="h-4 w-4 text-current" />
          </button>
        )}
        <button
          type="button"
          disabled={busy || longMemoryBusy || messages.length === 0}
          onClick={() => void extractLongMemoryNow()}
          className="cyber-btn flex h-8 w-8 shrink-0 items-center justify-center p-0 disabled:opacity-50"
          title="Pick long-term memories from this chat"
          aria-label={
            longMemoryBusy ? 'Extracting long-term memories…' : 'Long memory picker'
          }
        >
          {longMemoryBusy ? (
            <span
              className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-void-dim border-t-neon-cyan"
              aria-hidden
            />
          ) : (
            <BrainIcon className="h-4 w-4 text-current" />
          )}
        </button>

        {canSaveSession && (
          <button
            type="button"
            onClick={saveOrUpdateSession}
            className="cyber-btn flex h-8 w-8 shrink-0 items-center justify-center p-0"
            title="Save chat session"
            aria-label="Save chat session"
          >
            <svg
              className="h-4 w-4 text-current"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
          </button>
        )}

        {canStop && (
          <button
            type="button"
            onClick={onStop}
            className="cyber-btn cyber-btn-danger shrink-0 px-2 text-[11px] sm:px-3 sm:text-xs"
          >
            ABORT
          </button>
        )}
        <WindowControls />
      </div>
    </header>
  )
}
