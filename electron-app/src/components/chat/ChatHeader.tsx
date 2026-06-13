import { BrainIcon } from '@/components/icons/BrainIcon'
import { CodeIcon } from '@/components/icons/CodeIcon'
import type { VoidcastApp } from '@/hooks/useVoidcastApp'

type Props = {
  app: Pick<
    VoidcastApp,
    | 'menuOpen'
    | 'setMenuOpen'
    | 'codingPanelAvailable'
    | 'showCodingPanel'
    | 'setShowCodingPanel'
    | 'busy'
    | 'longMemoryBusy'
    | 'messages'
    | 'extractLongMemoryNow'
    | 'canSaveSession'
    | 'saveOrUpdateSession'
    | 'onStop'
  >
}

export function ChatHeader({ app }: Props) {
  const {
    menuOpen,
    setMenuOpen,
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
      {/* Menu Button */}
      <button
        type="button"
        aria-label="Open sessions menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        className="group relative flex h-8 w-8 shrink-0 items-center justify-center
          bg-void-mid border border-void-dim/50 hover:border-neon-cyan/50
          transition-all duration-300 hover:shadow-[0_0_12px_rgba(var(--ui-accent-rgb),0.25)]"
        style={{ clipPath: 'polygon(3px 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%, 0 3px)' }}
      >
        <span
          className="font-mono text-lg text-neon-cyan transition-colors group-hover:text-neon-cyan"
          aria-hidden
        >
          ⌘
        </span>
      </button>

      {/* Status & Actions */}
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
          title="Summarize this chat and save relevant long-term memory"
          aria-label={
            longMemoryBusy ? 'Saving long-term memory…' : 'Save long-term memory'
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

        {/* Save Button */}
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

        {/* Stop Button */}
        {canStop && (
          <button
            type="button"
            onClick={onStop}
            className="cyber-btn cyber-btn-danger shrink-0 px-2 text-[11px] sm:px-3 sm:text-xs"
          >
            ABORT
          </button>
        )}
      </div>
    </header>
  )
}
