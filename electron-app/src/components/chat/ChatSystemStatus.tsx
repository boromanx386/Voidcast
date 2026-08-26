import { useEffect, useRef, useState } from 'react'
import { RobotIcon } from '@/components/icons/RobotIcon'
import ModelSwitcherPopup from '@/components/chat/ModelSwitcherPopup'
import { contextLimitSourceLabel } from '@/lib/contextLimit'
import { isWebStandalone } from '@/lib/platform'
import { llmModelLabel, llmProviderTitle } from '@/lib/llmProviderDisplay'
import { applyModelSwitcherSelection } from '@/lib/pinnedModels'
import type { AppSettings, LlmProvider } from '@/lib/settings'
import type { VoidcastApp } from '@/hooks/useVoidcastApp'

function providerShortLabel(settings: AppSettings): string {
  switch (settings.llmProvider) {
    case 'openrouter':
      return 'OpenRouter'
    case 'ollama':
      return 'Ollama'
    case 'nvidia':
      return 'NVIDIA'
    case 'deepseek':
      return 'DeepSeek'
    case 'openai':
      return 'OpenAI'
    case 'opencode-go':
      return 'OpenCode Go'
    case 'crofai':
      return 'CrofAI'
    default:
      return settings.llmProvider
  }
}

type Props = {
  app: Pick<
    VoidcastApp,
    | 'settings'
    | 'setSettings'
    | 'contextUsageInfo'
    | 'ttsOk'
    | 'openOptions'
    | 'busy'
    | 'contextCompressBusy'
    | 'summarizeContextNow'
    | 'messages'
  >
}

export function ChatSystemStatus({ app }: Props) {
  const {
    settings,
    setSettings,
    contextUsageInfo,
    ttsOk,
    openOptions,
    busy,
    contextCompressBusy,
    summarizeContextNow,
    messages,
  } = app
  const [showModelSwitcher, setShowModelSwitcher] = useState(false)
  const [showCtxPopup, setShowCtxPopup] = useState(false)
  const switcherWrapRef = useRef<HTMLDivElement>(null)
  const ctxWrapRef = useRef<HTMLDivElement>(null)

  const handleModelSelect = (selection: { provider: LlmProvider; modelId: string }) => {
    setSettings((prev) =>
      applyModelSwitcherSelection(prev, selection.provider, selection.modelId),
    )
  }

  const canCompress =
    !busy && !contextCompressBusy && messages.some((m) => m.role === 'user' || m.role === 'assistant')

  useEffect(() => {
    if (!showCtxPopup) return
    const onPointerDown = (e: PointerEvent) => {
      const root = ctxWrapRef.current
      if (root && e.target instanceof Node && !root.contains(e.target)) {
        setShowCtxPopup(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowCtxPopup(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [showCtxPopup])

  const barTitle = contextUsageInfo
    ? contextUsageInfo.limitSource
      ? `Context: ${contextUsageInfo.promptTokens} / ${contextUsageInfo.maxTokens} prompt tokens · limit from ${contextLimitSourceLabel(contextUsageInfo.limitSource)}${contextUsageInfo.modelId ? ` · ${contextUsageInfo.modelId}` : ''} · click for compress`
      : `Context window usage: ${contextUsageInfo.promptTokens} / ${contextUsageInfo.maxTokens} prompt tokens · click for compress`
    : 'Context usage · click for compress options'

  return (
    <div className="system-status">
      <div className="status-item min-w-0 shrink gap-2">
        <RobotIcon className="h-3.5 w-3.5 shrink-0 text-void-dim/70" />
        <div ref={switcherWrapRef} className="relative">
          <button
            type="button"
            className="max-w-[220px] cursor-pointer truncate text-left text-[11px] text-void-text/80 outline-none transition-colors hover:text-void-text focus-visible:outline-none focus-visible:ring-0"
            title={llmProviderTitle(settings)}
            aria-expanded={showModelSwitcher}
            aria-haspopup="dialog"
            onClick={() => {
              setShowCtxPopup(false)
              setShowModelSwitcher((v) => !v)
            }}
          >
            {llmModelLabel(settings)}{' '}
            <span className="text-void-dim/50">({providerShortLabel(settings)})</span>
          </button>
          {showModelSwitcher && (
            <ModelSwitcherPopup
              settings={settings}
              rootRef={switcherWrapRef}
              onSelectModel={handleModelSelect}
              onManageModels={() => openOptions('llm')}
              onClose={() => setShowModelSwitcher(false)}
            />
          )}
        </div>
        <span className="select-none text-void-dim/30">|</span>
        <span className="text-[10px] text-void-dim/60">
          {isWebStandalone() ? 'TTS' : 'TTS/STT'}
        </span>
        <span
          className={`dot ${ttsOk === true ? 'online' : ttsOk === false ? 'offline' : 'busy'}`}
          title={`TTS service ${ttsOk === true ? 'READY' : ttsOk === false ? 'OFFLINE' : 'CHECKING'}`}
        />
      </div>
      <div ref={ctxWrapRef} className="relative">
        <button
          type="button"
          className="footer-context-readout flex min-w-0 max-w-[min(100%,22rem)] cursor-pointer flex-col items-end gap-0.5 rounded px-1 py-0.5 text-right font-mono outline-none transition-colors hover:bg-void-muted/25 focus-visible:bg-void-muted/25"
          title={barTitle}
          aria-expanded={showCtxPopup}
          aria-haspopup="dialog"
          onClick={() => {
            setShowModelSwitcher(false)
            setShowCtxPopup((v) => !v)
          }}
        >
          {contextUsageInfo ? (
            <>
              <span className="text-[11px] tabular-nums leading-tight text-void-dim">
                <span className="text-void-dim/60">CTX </span>
                <span className="text-void-text">{contextUsageInfo.promptTokens}</span>
                <span className="text-void-dim/50">/</span>
                <span>{contextUsageInfo.maxTokens}</span>
                <span className="ml-1.5 text-void-dim/70">
                  {Math.round(contextUsageInfo.ratio * 100)}%
                </span>
                {contextCompressBusy ? (
                  <span className="ml-1.5 text-neon-cyan/80">…</span>
                ) : null}
              </span>
              <span className="text-[10px] tabular-nums leading-tight text-void-dim/70">
                <span className="text-void-dim/50">OUT </span>
                <span>{contextUsageInfo.outputTokens}</span>
              </span>
              <div className="h-1 w-full max-w-[14rem] overflow-hidden rounded-sm bg-void-muted/70">
                <div
                  className={`h-full transition-[width] duration-500 ${
                    contextUsageInfo.ratio > 0.9
                      ? 'bg-neon-red/90'
                      : contextUsageInfo.ratio > 0.7
                        ? 'bg-neon-yellow/85'
                        : 'bg-neon-cyan/75'
                  }`}
                  style={{
                    width: `${Math.min(100, contextUsageInfo.ratio * 100)}%`,
                  }}
                />
              </div>
            </>
          ) : (
            <span className="text-[11px] tabular-nums text-void-dim/45">CTX —</span>
          )}
        </button>

        {showCtxPopup ? (
          <div
            role="dialog"
            aria-label="Context compression"
            className="absolute bottom-full right-0 z-40 mb-2 w-[16.5rem] rounded border border-void-muted/50 bg-void-black/95 p-3 shadow-lg backdrop-blur-sm"
          >
            <div className="mb-2 text-[10px] font-mono uppercase tracking-wide text-void-dim/70">
              Context
            </div>
            {contextUsageInfo ? (
              <div className="mb-3 space-y-0.5 text-[11px] font-mono tabular-nums text-void-dim">
                <div>
                  <span className="text-void-dim/60">Prompt </span>
                  <span className="text-void-text">{contextUsageInfo.promptTokens}</span>
                  <span className="text-void-dim/50"> / </span>
                  <span>{contextUsageInfo.maxTokens}</span>
                  <span className="ml-1 text-void-dim/70">
                    ({Math.round(contextUsageInfo.ratio * 100)}%)
                  </span>
                </div>
                <div>
                  <span className="text-void-dim/60">Output </span>
                  <span>{contextUsageInfo.outputTokens}</span>
                </div>
                {contextUsageInfo.limitSource ? (
                  <div className="truncate text-[10px] text-void-dim/55">
                    limit · {contextLimitSourceLabel(contextUsageInfo.limitSource)}
                    {contextUsageInfo.modelId ? ` · ${contextUsageInfo.modelId}` : ''}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mb-3 text-[11px] font-mono text-void-dim/60">
                No usage yet — compress after a few turns if you want.
              </p>
            )}

            <label className="mb-3 flex cursor-pointer items-center gap-2 text-[11px] font-mono text-void-dim">
              <input
                type="checkbox"
                className="accent-neon-cyan"
                checked={settings.contextAutoCompress}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, contextAutoCompress: e.target.checked }))
                }
              />
              <span>
                Auto at <span className="text-void-text/80">90%</span>
              </span>
            </label>

            <button
              type="button"
              disabled={!canCompress}
              onClick={() => {
                void summarizeContextNow().finally(() => setShowCtxPopup(false))
              }}
              className="cyber-btn w-full text-xs disabled:cursor-not-allowed disabled:opacity-40"
            >
              {contextCompressBusy ? 'COMPRESSING…' : 'COMPRESS NOW'}
            </button>
            <p className="mt-2 text-[10px] leading-snug text-void-dim/55">
              Summarizes older turns into hidden memory. Chat UI stays full. Works before 90% —
              useful on large-context models.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
