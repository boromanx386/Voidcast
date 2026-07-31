import { useRef, useState } from 'react'
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
    default:
      return settings.llmProvider
  }
}

type Props = {
  app: Pick<
    VoidcastApp,
    'settings' | 'setSettings' | 'contextUsageInfo' | 'ttsOk' | 'openOptions'
  >
}

export function ChatSystemStatus({ app }: Props) {
  const { settings, setSettings, contextUsageInfo, ttsOk, openOptions } = app
  const [showModelSwitcher, setShowModelSwitcher] = useState(false)
  const switcherWrapRef = useRef<HTMLDivElement>(null)

  const handleModelSelect = (selection: { provider: LlmProvider; modelId: string }) => {
    setSettings((prev) =>
      applyModelSwitcherSelection(prev, selection.provider, selection.modelId),
    )
  }

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
            onClick={() => setShowModelSwitcher((v) => !v)}
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
      <div className="footer-context-readout flex min-w-0 max-w-[min(100%,22rem)] flex-col items-end gap-0.5 text-right font-mono">
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
            </span>
            <span className="text-[10px] tabular-nums leading-tight text-void-dim/70">
              <span className="text-void-dim/50">OUT </span>
              <span>{contextUsageInfo.outputTokens}</span>
            </span>
            <div
              className="h-1 w-full max-w-[14rem] overflow-hidden rounded-sm bg-void-muted/70"
              title={
                contextUsageInfo.limitSource
                  ? `Context: ${contextUsageInfo.promptTokens} / ${contextUsageInfo.maxTokens} prompt tokens · limit from ${contextLimitSourceLabel(contextUsageInfo.limitSource)}${contextUsageInfo.modelId ? ` · ${contextUsageInfo.modelId}` : ''}`
                  : `Context window usage: ${contextUsageInfo.promptTokens} / ${contextUsageInfo.maxTokens} prompt tokens`
              }
            >
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
      </div>
    </div>
  )
}
