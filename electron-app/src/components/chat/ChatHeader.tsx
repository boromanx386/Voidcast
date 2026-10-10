import { useCallback } from 'react'
import { CodeIcon } from '@/components/icons/CodeIcon'
import { WindowControls } from '@/components/WindowControls'
import type { VoidcastApp } from '@/hooks/useVoidcastApp'
import { invokePickCodingDirectory } from '@/lib/codingTools'

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
    canSaveSession,
    saveOrUpdateSession,
    settings,
    applyCodingProjectPath,
  } = app

  // Coding tools ON in Options + no folder bound to this chat = the agent has no
  // file access here. Warn up front instead of letting the user find out mid-task.
  // Desktop only: binding a folder needs the native picker (web-standalone cannot).
  const codingToolsNeedFolder =
    codingPanelAvailable &&
    settings.toolsEnabled.coding &&
    !(settings.coding.projectPath || '').trim()

  const bindCodingFolder = useCallback(async () => {
    const picked = await invokePickCodingDirectory()
    if (picked.ok) applyCodingProjectPath(picked.path)
  }, [applyCodingProjectPath])

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

      <div className="voidcast-header-brand pointer-events-none ml-2 hidden min-w-0 items-center sm:flex">
        <span className="truncate font-display text-[10px] font-semibold tracking-[0.2em] text-void-text/80">
          VOIDCAST
        </span>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1 sm:gap-3">
        {codingToolsNeedFolder && (
          <button
            type="button"
            onClick={() => void bindCodingFolder()}
            className="flex min-w-0 items-center gap-1 rounded border border-neon-yellow/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-neon-yellow transition-colors hover:border-neon-yellow/70 hover:text-neon-yellow/80"
            title="Coding tools are enabled in Options, but this chat has no project folder — the agent has no file, terminal or git access here. Click to bind a folder."
          >
            <span aria-hidden>⚠</span>
            <span className="hidden truncate sm:inline">coding off · no folder</span>
            <span className="truncate sm:hidden">no folder</span>
          </button>
        )}
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

        {canSaveSession && (
          <button
            type="button"
            onClick={saveOrUpdateSession}
            className="cyber-btn flex h-8 w-8 shrink-0 items-center justify-center p-0"
            title="Save chat session (Ctrl+S)"
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
        <WindowControls />
      </div>
    </header>
  )
}
