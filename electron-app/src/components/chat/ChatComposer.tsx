import { useMemo, type RefObject } from 'react'
import { CHAT_IMAGE_ACCEPT, imageDataUrl } from '@/lib/imageAttachment'
import { chatFileAcceptList } from '@/lib/fileAttachment'
import { isWebStandalone } from '@/lib/platform'
import type { VoidcastApp } from '@/hooks/useVoidcastApp'

type Props = {
  app: Pick<
    VoidcastApp,
    | 'settings'
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

  return (
    <footer className="voidcast-input-area">
      <div className="mx-auto max-w-3xl">
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
          {isWebStandalone() ? (
            <label
              htmlFor="voidcast-chat-attach-input"
              className={`shrink-0 px-3 py-3 mb-px text-xs font-mono border border-void-muted bg-void-black/80 text-neon-cyan hover:border-neon-cyan/50 hover:bg-neon-cyan/5 transition-colors inline-flex items-center justify-center cursor-pointer ${busy ? 'opacity-40 pointer-events-none' : ''}`}
              style={{
                clipPath:
                  'polygon(0 6px, 6px 0, calc(100% - 6px) 0, 100% 6px, 100% calc(100% - 6px), calc(100% - 6px) 100%, 6px 100%, 0 calc(100% - 6px))',
              }}
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
              className="shrink-0 px-3 py-3 mb-px text-xs font-mono border border-void-muted bg-void-black/80 text-neon-cyan hover:border-neon-cyan/50 hover:bg-neon-cyan/5 transition-colors disabled:opacity-40"
              style={{
                clipPath:
                  'polygon(0 6px, 6px 0, calc(100% - 6px) 0, 100% 6px, 100% calc(100% - 6px), calc(100% - 6px) 100%, 6px 100%, 0 calc(100% - 6px))',
              }}
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
              className={`shrink-0 px-3 py-3 mb-px text-xs font-mono border transition-colors disabled:opacity-40 ${
                isRecording
                  ? 'border-neon-red bg-neon-red/10 text-neon-red animate-pulse'
                  : 'border-void-muted bg-void-black/80 text-neon-green hover:border-neon-green/50 hover:bg-neon-green/5'
              }`}
              style={{
                clipPath:
                  'polygon(0 6px, 6px 0, calc(100% - 6px) 0, 100% 6px, 100% calc(100% - 6px), calc(100% - 6px) 100%, 6px 100%, 0 calc(100% - 6px))',
              }}
              title={isRecording ? `Recording ${recordingDuration}s (click to stop)` : sttPending ? 'Transcribing...' : 'Voice input'}
              aria-label={isRecording ? 'Stop recording' : sttPending ? 'Transcribing' : 'Start voice input'}
            >
              {sttPending ? (
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
              ) : isRecording ? (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              )}
            </button>
          )}
          <textarea
            className="voidcast-textarea"
            rows={2}
            placeholder="Type a message..."
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
          
          <button
            type="button"
            disabled={!canSend}
            onClick={() => void onSend()}
            className="send-btn"
            aria-label="Send message"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 2L11 13" />
              <path d="M22 2L15 22L11 13L2 9L22 2Z" />
            </svg>
          </button>
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
