import { useState, useRef, useEffect } from 'react'
import { BookmarkIcon } from '@/components/icons/BookmarkIcon'
import { BrainIcon } from '@/components/icons/BrainIcon'
import { CodeIcon } from '@/components/icons/CodeIcon'
import { WindowControls } from '@/components/WindowControls'
import type { VoidcastApp } from '@/hooks/useVoidcastApp'
import {
  LLM_PROMPT_PRESETS,
  LLM_PROMPT_PRESET_NAMES,
} from '@/lib/settings'

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
    settings,
    setSettings,
    sessions,
    activeSessionId,
    setSessions,
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
  } = app

  const [presetsOpen, setPresetsOpen] = useState(false)
  const presetsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!presetsOpen) return
    function handleClick(e: MouseEvent) {
      if (presetsRef.current && !presetsRef.current.contains(e.target as Node)) {
        setPresetsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [presetsOpen])

  const activeSession = activeSessionId
    ? sessions.find((s) => s.id === activeSessionId)
    : undefined
  const activePresetKey = activeSession?.promptPreset ?? 'void'
  const presetKeys = Object.keys(LLM_PROMPT_PRESETS)

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

        <div className="relative" ref={presetsRef}>
          <button
            type="button"
            onClick={() => setPresetsOpen((v) => !v)}
            className={`cyber-btn flex h-8 w-8 shrink-0 items-center justify-center p-0 ${
              activePresetKey !== 'void' ? 'border-neon-cyan/60 text-neon-cyan' : ''
            }`}
            title={`System prompt preset: ${LLM_PROMPT_PRESET_NAMES[activePresetKey] ?? 'Custom'}`}
            aria-label="System prompt presets"
            aria-expanded={presetsOpen}
            aria-haspopup="listbox"
          >
            <BrainIcon className="h-4 w-4 text-current" />
          </button>
          {presetsOpen && (
            <div
              className="absolute right-0 top-full z-50 mt-1 w-40 border border-void-border bg-void-black/95 shadow-lg backdrop-blur-sm"
              role="listbox"
              aria-label="System prompt presets"
            >
              {presetKeys.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="option"
                  aria-selected={activePresetKey === key}
                  onClick={() => {
                    if (activeSessionId) {
                      setSessions((prev) =>
                        prev.map((s) =>
                          s.id === activeSessionId
                            ? { ...s, promptPreset: key }
                            : s,
                        ),
                      )
                    }
                    setSettings((s) => ({
                      ...s,
                      llmSystemPrompt: LLM_PROMPT_PRESETS[key],
                    }))
                    setPresetsOpen(false)
                  }}
                  className={`block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-void-surface/60 ${
                    activePresetKey === key
                      ? 'text-neon-cyan'
                      : 'text-void-text/80'
                  }`}
                >
                  {LLM_PROMPT_PRESET_NAMES[key]}
                </button>
              ))}
              <div className="border-t border-void-border" />
              <button
                type="button"
                role="option"
                aria-selected={activePresetKey === 'custom'}
                onClick={() => {
                  if (activeSessionId) {
                    setSessions((prev) =>
                      prev.map((s) =>
                        s.id === activeSessionId
                          ? { ...s, promptPreset: 'custom' }
                          : s,
                      ),
                    )
                  }
                  setPresetsOpen(false)
                }}
                className={`block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-void-surface/60 ${
                  activePresetKey === 'custom' || !LLM_PROMPT_PRESETS[activePresetKey]
                    ? 'text-neon-cyan'
                    : 'text-void-dim'
                }`}
              >
                Custom
              </button>
            </div>
          )}
        </div>

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
            <BookmarkIcon className="h-4 w-4 text-current" />
          )}
        </button>

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
