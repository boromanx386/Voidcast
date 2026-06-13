import type { RefObject } from 'react'
import { RobotIcon } from '@/components/icons/RobotIcon'
import { isWebStandalone } from '@/lib/platform'
import type { VoidcastApp } from '@/hooks/useVoidcastApp'

type Props = {
  app: Pick<
    VoidcastApp,
    | 'settings'
    | 'contextUsageInfo'
    | 'ttsOk'
    | 'audioRef'
  >
}

function activeLlmModel(
  settings: Props['app']['settings'],
): string {
  switch (settings.llmProvider) {
    case 'ollama':
      return settings.ollamaModel
    case 'nvidia':
      return settings.nvidiaModel
    case 'runware':
      return settings.runwareLlmModel
    default:
      return settings.openrouterModel
  }
}

export function ChatSystemStatus({ app }: Props) {
  const { settings, contextUsageInfo, ttsOk, audioRef } = app
  const llmModel = activeLlmModel(settings)

  return (
    <>
      <div className="system-status">
        <div className="status-item min-w-0 shrink gap-2">
          <RobotIcon className="h-3.5 w-3.5 text-void-dim/70 shrink-0" />
          <span
            className="truncate text-void-text/80"
            title={`${settings.llmProvider}: ${llmModel}`}
          >
            {llmModel}
          </span>
          <span className="text-void-dim/30 select-none">|</span>
          <span className="text-void-dim/60 text-[10px]">{isWebStandalone() ? 'TTS' : 'TTS/STT'}</span>
          <span
            className={`dot ${ttsOk === true ? 'online' : ttsOk === false ? 'offline' : 'busy'}`}
            title={`TTS service ${ttsOk === true ? 'READY' : ttsOk === false ? 'OFFLINE' : 'CHECKING'}`}
          />
        </div>
        <div className="footer-context-readout flex min-w-0 max-w-[min(100%,22rem)] flex-col items-end gap-0.5 text-right font-mono">
          {contextUsageInfo ? (
            <>
              <span className="text-[11px] leading-tight text-void-dim tabular-nums">
                <span className="text-void-dim/60">CTX </span>
                <span className="text-void-text">{contextUsageInfo.promptTokens}</span>
                <span className="text-void-dim/50">/</span>
                <span>{contextUsageInfo.maxTokens}</span>
                <span className="ml-1.5 text-void-dim/70">
                  {Math.round(contextUsageInfo.ratio * 100)}%
                </span>
              </span>
              <span className="text-[10px] leading-tight text-void-dim/70 tabular-nums">
                <span className="text-void-dim/50">OUT </span>
                <span>{contextUsageInfo.outputTokens}</span>
              </span>
              <div
                className="h-1 w-full max-w-[14rem] overflow-hidden rounded-sm bg-void-muted/70"
                title={`Context window usage: ${contextUsageInfo.promptTokens} / ${contextUsageInfo.maxTokens} prompt tokens`}
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
            <span className="text-[11px] text-void-dim/45 tabular-nums">CTX —</span>
          )}
        </div>
      </div>

      <audio ref={audioRef as RefObject<HTMLAudioElement>} className="hidden" />
    </>
  )
}
