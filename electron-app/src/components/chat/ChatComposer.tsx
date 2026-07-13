import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { CHAT_IMAGE_ACCEPT, imageDataUrl } from '@/lib/imageAttachment'
import { chatFileAcceptList } from '@/lib/fileAttachment'
import { isWebStandalone } from '@/lib/platform'
import { getChatComposerPlaceholder } from '@/components/chat/chatEmptyState'
import type { VoidcastApp } from '@/hooks/useVoidcastApp'

type Props = {
  app: Pick<
    VoidcastApp,
    | 'settings'
    | 'setSettings'
    | 'input'
    | 'setInput'
    | 'busy'
    | 'onSend'
    | 'pendingImages'
    | 'pendingFiles'
    | 'chatAttachmentInputRef'
    | 'onPickChatAttachments'
    | 'openChatAttachmentPicker'
    | 'removePendingImage'
    | 'removePendingFile'
    | 'isRecording'
    | 'sttPending'
    | 'recordingDuration'
    | 'toggleSttRecording'
  >
}

export function ChatComposer({ app }: Props) {
  const {
    settings,
    setSettings,
    input,
    setInput,
    busy,
    onSend,
    pendingImages,
    pendingFiles,
    chatAttachmentInputRef,
    onPickChatAttachments,
    openChatAttachmentPicker,
    removePendingImage,
    removePendingFile,
    isRecording,
    sttPending,
    recordingDuration,
    toggleSttRecording,
  } = app

  const canSend = useMemo(
    () => (!!input.trim() || pendingImages.length > 0 || pendingFiles.length > 0) && !busy,
    [input, pendingImages.length, pendingFiles.length, busy],
  )

  const chatPlaceholder = useMemo(
    () => getChatComposerPlaceholder(settings.uiTheme, settings.agentMode),
    [settings.uiTheme, settings.agentMode],
  )

  const agentMode = settings.agentMode === 'plan' ? 'plan' : 'agent'
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const modeMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!modeMenuOpen) return
    const onPointerDown = (e: PointerEvent) => {
      if (modeMenuRef.current?.contains(e.target as Node)) return
      setModeMenuOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModeMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [modeMenuOpen])

  const setAgentMode = (mode: 'agent' | 'plan') => {
    setSettings((s) => ({ ...s, agentMode: mode }))
    setModeMenuOpen(false)
  }

  return (
    <footer className="voidcast-input-area">
      <div className="mx-auto max-w-4xl">
        <input
          id="voidcast-chat-attach-input"
          ref={chatAttachmentInputRef as RefObject<HTMLInputElement>}
          type="file"
          accept={
            isWebStandalone()
              ? CHAT_IMAGE_ACCEPT
              : `${CHAT_IMAGE_ACCEPT},${chatFileAcceptList()}`
          }
          multiple
          className={
            isWebStandalone()
              ? 'sr-only'
              : 'hidden'
          }
          aria-hidden={!isWebStandalone()}
          onChange={(e) => void onPickChatAttachments(e)}
        />
        {pendingImages.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2" aria-live="polite">
            {pendingImages.map((p, i) => (
              <div
                key={`pending-${i}-${p.base64.slice(0, 8)}`}
                className="relative shrink-0"
              >
                <img
                  src={imageDataUrl(p.base64, p.mime)}
                  alt=""
                  className="h-12 w-12 rounded border border-void-muted/60 object-cover"
                />
                <button
                  type="button"
                  onClick={() => removePendingImage(i)}
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded border border-void-muted bg-void-black text-[9px] text-void-dim hover:border-neon-red/50 hover:text-neon-red"
                  aria-label="Remove image"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {pendingFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2" aria-live="polite">
            {pendingFiles.map((f, i) => (
              <div
                key={f.id}
                className="relative rounded border border-void-muted/60 bg-void-black/30 px-2 py-1 text-xs font-mono text-void-dim"
              >
                <div>{f.name}{f.truncated ? ' [truncated]' : ''}</div>
                <button
                  type="button"
                  onClick={() => removePendingFile(i)}
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded border border-void-muted bg-void-black text-[9px] text-void-dim hover:border-neon-red/50 hover:text-neon-red"
                  aria-label="Remove file"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="input-wrapper">
          {agentMode === 'plan' && (
            <div className="composer-plan-banner" role="status">
              <span className="composer-plan-banner__title">Plan mode</span>
              <p className="composer-plan-banner__text">
                Read-only exploration — no file writes until you press{' '}
                <span className="text-void-light">Approve &amp; build</span> on the plan card.
              </p>
            </div>
          )}
          <textarea
            className="voidcast-textarea"
            rows={2}
            placeholder={chatPlaceholder}
            value={input}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void onSend()
              }
            }}
          />

          <div className="composer-toolbar">
            <div ref={modeMenuRef} className="composer-mode-menu">
              <button
                type="button"
                disabled={busy}
                aria-haspopup="menu"
                aria-expanded={modeMenuOpen}
                aria-label={`Mode: ${agentMode === 'plan' ? 'Plan' : 'Agent'}`}
                title={agentMode === 'plan' ? 'Plan mode (read-only)' : 'Agent mode'}
                onClick={() => setModeMenuOpen((open) => !open)}
                className={`composer-mode-trigger ${
                  agentMode === 'plan'
                    ? 'composer-mode-trigger--plan'
                    : 'composer-mode-trigger--agent'
                }`}
              >
                <span aria-hidden>{agentMode === 'plan' ? 'Plan' : 'Agent'}</span>
                <svg
                  className={`h-2 w-2 opacity-60 transition-transform ${
                    modeMenuOpen ? 'rotate-180' : ''
                  }`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  aria-hidden
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {modeMenuOpen ? (
                <div className="composer-mode-dropdown" role="menu" aria-label="Agent mode">
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={agentMode === 'agent'}
                    className={`composer-mode-option composer-mode-option--agent${
                      agentMode === 'agent' ? ' composer-mode-option--active' : ''
                    }`}
                    onClick={() => setAgentMode('agent')}
                  >
                    <span className="w-3 text-center" aria-hidden>
                      {agentMode === 'agent' ? '●' : '○'}
                    </span>
                    <span>Agent</span>
                  </button>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={agentMode === 'plan'}
                    className={`composer-mode-option composer-mode-option--plan${
                      agentMode === 'plan' ? ' composer-mode-option--active' : ''
                    }`}
                    onClick={() => setAgentMode('plan')}
                  >
                    <span className="w-3 text-center" aria-hidden>
                      {agentMode === 'plan' ? '●' : '○'}
                    </span>
                    <span>Plan</span>
                  </button>
                </div>
              ) : null}
            </div>

            {isWebStandalone() ? (
              <label
                htmlFor="voidcast-chat-attach-input"
                className={`composer-toolbar-btn text-neon-cyan hover:border-neon-cyan/50 hover:bg-neon-cyan/5 cursor-pointer ${
                  busy ? 'opacity-40 pointer-events-none' : ''
                }`}
                title="Attach image from gallery"
                aria-label="Attach image from gallery"
              >
                +
              </label>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void openChatAttachmentPicker()}
                className="composer-toolbar-btn text-neon-cyan hover:border-neon-cyan/50 hover:bg-neon-cyan/5"
                title="Attach image or file"
                aria-label="Attach files and images"
              >
                +
              </button>
            )}

            {settings.sttProvider === 'openrouter' && !isWebStandalone() && (
              <button
                type="button"
                disabled={busy || sttPending}
                onClick={() => void toggleSttRecording()}
                className={`composer-toolbar-btn ${
                  isRecording
                    ? 'border-neon-red bg-neon-red/10 text-neon-red animate-pulse'
                    : 'text-neon-green hover:border-neon-green/50 hover:bg-neon-green/5'
                }`}
                title={
                  isRecording
                    ? `Recording ${recordingDuration}s (click to stop)`
                    : sttPending
                      ? 'Transcribing...'
                      : 'Voice input'
                }
                aria-label={
                  isRecording ? 'Stop recording' : sttPending ? 'Transcribing' : 'Start voice input'
                }
              >
                {sttPending ? (
                  <svg
                    className="h-3.5 w-3.5 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                ) : isRecording ? (
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                ) : (
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                )}
              </button>
            )}

            <button
              type="button"
              disabled={!canSend}
              onClick={() => void onSend()}
              className="composer-send-btn"
              aria-label="Send message"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Input hints (attachments + unsaved only; model list lives in LLM options) */}
        {(pendingImages.length > 0 ||
          pendingFiles.length > 0) && (
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs font-mono text-void-dim">
            <span>
              {pendingImages.length > 0 && (
                <span className="text-neon-cyan/70">
                  {pendingImages.length} image{pendingImages.length === 1 ? '' : 's'}{' '}
                  attached
                </span>
              )}
              {pendingFiles.length > 0 && (
                <span
                  className={
                    pendingImages.length > 0
                      ? 'ml-2 text-neon-green/70'
                      : 'text-neon-green/70'
                  }
                >
                  {pendingFiles.length} file{pendingFiles.length === 1 ? '' : 's'} attached
                </span>
              )}
            </span>
            
          </div>
        )}
      </div>
    </footer>
  )
}
