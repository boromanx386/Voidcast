import type { RefObject } from 'react'
import { ChatMarkdown } from '@/components/ChatMarkdown'
import { PlanArtifactCard } from '@/components/chat/PlanArtifactCard'
import { SubAgentActivityCard } from '@/components/chat/SubAgentPanel'
import { dedupeNonEmpty } from '@/lib/chatHints'
import { imageDataUrl } from '@/lib/imageAttachment'
import {
  parseRunwareAudioToolMeta,
  parseRunwareImageToolMeta,
  stripGeneratedAudioLinkArtifacts,
  stripRunwareAudioUrlLines,
} from '@/lib/runwareMessageMeta'
import type { ChatMessageRenderContext } from '@/hooks/useChatMessageRender'
import type { VoidcastApp } from '@/hooks/useVoidcastApp'
import type { UiMessage } from '@/types/chat'

type Props = {
  message: UiMessage
  index: number
  render: ChatMessageRenderContext
  app: Pick<
    VoidcastApp,
    | 'settings'
    | 'busy'
    | 'messages'
    | 'assistantGeneratedAudios'
    | 'assistantSavedAudioPaths'
    | 'assistantImageToolMeta'
    | 'assistantImageMessageMeta'
    | 'assistantAudioToolMeta'
    | 'assistantAudioMessageMeta'
    | 'assistantSavedImagePaths'
    | 'editingMessageId'
    | 'editInputValue'
    | 'setEditInputValue'
    | 'startEdit'
    | 'cancelEdit'
    | 'commitEdit'
    | 'updateMessagePlan'
    | 'approveAndBuildPlan'
    | 'revisePlanWithCustomNote'
    | 'playingId'
    | 'ttsOk'
    | 'abortTts'
    | 'onRead'
    | 'setMessageSubAgentActivity'
  >
}

export function ChatMessage({
  message: m,
  index,
  render,
  app,
}: Props) {
  const {
    settings,
    busy,
    messages,
    assistantGeneratedAudios,
    assistantSavedAudioPaths,
    assistantImageToolMeta,
    assistantImageMessageMeta,
    assistantAudioToolMeta,
    assistantAudioMessageMeta,
    assistantSavedImagePaths,
    editingMessageId,
    editInputValue,
    setEditInputValue,
    startEdit,
    cancelEdit,
    commitEdit,
    updateMessagePlan,
    approveAndBuildPlan,
    revisePlanWithCustomNote,
    playingId,
    ttsOk,
    abortTts,
    onRead,
    setMessageSubAgentActivity,
  } = app
  const {
    thinkingScrollRef,
    thinkingPinned,
    setThinkingPinned,
    assistantRenderCache,
    localImagePreviews,
    downloadImage,
    openLocalImage,
    desktopRuntime,
  } = render

  return (
    <div 
      className={`message-container ${m.role === 'user' ? 'user' : 'assistant'} animate-message-in group`}
      style={{ animationDelay: `${index * 0.05}s` }}
    >
      <div className={`message-bubble ${m.role === 'user' ? 'message-user' : 'message-assistant'}`}>
        {/* Role indicator */}
        <div className="message-meta">
          <span className={`message-role ${m.role === 'user' ? 'text-neon-purple' : 'text-neon-cyan'}`}>
            {m.role === 'user' ? 'USER' : 'Void Agent'}
          </span>
          {m.role === 'user' && m.steered ? (
            <span
              className="ml-2 rounded border border-neon-yellow/40 bg-neon-yellow/10 px-1.5 py-px text-[9px] font-mono text-neon-yellow/90"
              title="This message steered a running agent turn"
            >
              STEER
            </span>
          ) : null}
        </div>
        
        {/* Content */}
        {m.role === 'assistant' ? (
          <div className="min-w-0 space-y-3">
            {(() => {
              const cached = assistantRenderCache[m.id]
              const trustedAudio = dedupeNonEmpty([...(assistantGeneratedAudios[m.id] || [])])
              const markdownContent = cached?.markdownContent || stripGeneratedAudioLinkArtifacts(
                stripRunwareAudioUrlLines(m.content),
                trustedAudio,
              )
              const inlineImageUrls = cached?.inlineImageUrls || []
              const localImagePaths = cached?.localImagePaths || []
              const renderItems = localImagePaths.length > 0
                ? localImagePaths.map((p, i) => ({
                    key: `${m.id}-local-${i}`,
                    src: localImagePreviews[p]
                      ? imageDataUrl(localImagePreviews[p].base64, localImagePreviews[p].mime)
                      : '',
                    url: inlineImageUrls[i] || '',
                    localPath: p,
                    hasPreview: Boolean(localImagePreviews[p]),
                  }))
                : desktopRuntime
                  ? []
                  : inlineImageUrls.map((url, i) => ({
                      key: `${m.id}-url-${i}`,
                      src: url,
                      url,
                      localPath: '',
                      hasPreview: true,
                    }))
              return (
                <>
                  {m.planHandoffDraft ? (
                    <div className="mb-2 rounded border border-dashed border-neon-cyan/30 bg-neon-cyan/5 px-3 py-1.5 text-[11px] font-mono text-neon-cyan/80">
                      → Plan mode · kept as draft before plan
                    </div>
                  ) : null}
                  {m.thinking?.trim() ? (
                    <details
                      className="rounded border border-neon-cyan/25 bg-void-black/40"
                      open={busy && index === messages.length - 1}
                    >
                      <summary className="cursor-pointer px-3 py-2 text-[11px] font-mono text-neon-cyan/90 hover:text-neon-cyan flex items-center gap-2">
                        <span>THINKING</span>
                        {busy && index === messages.length - 1 ? (
                          <button
                            type="button"
                            className="ml-auto text-[10px] px-1.5 py-0.5 rounded border border-neon-cyan/30 hover:bg-neon-cyan/10 transition-colors"
                            title={thinkingPinned ? 'Auto-scroll: ON' : 'Auto-scroll: OFF'}
                            onClick={(e) => {
                              e.preventDefault()
                              setThinkingPinned((p) => !p)
                            }}
                          >
                            {thinkingPinned ? 'FOLLOW ON' : 'FOLLOW OFF'}
                          </button>
                        ) : null}
                      </summary>
                      <div
                        ref={thinkingScrollRef as RefObject<HTMLDivElement>}
                        className="max-h-64 overflow-y-auto border-t border-void-muted/30 px-3 py-2 text-xs font-mono text-void-dim whitespace-pre-wrap break-words"
                      >
                        {m.thinking}
                      </div>
                    </details>
                  ) : null}
                  {m.agentProgress?.map((progress) => (
                    <details
                      key={`${m.id}-agent-progress-${progress.round}`}
                      className="rounded border border-neon-purple/25 bg-neon-purple/5"
                    >
                      <summary className="cursor-pointer px-3 py-2 text-[11px] font-mono text-neon-purple/90 hover:text-neon-purple flex items-center gap-2">
                        <span>AGENT ROUND {progress.round + 1}</span>
                        <span className="text-[10px] opacity-60">BEFORE TOOLS</span>
                      </summary>
                      <div className="border-t border-void-muted/30 px-3 py-2 text-sm">
                        <ChatMarkdown content={progress.content} />
                      </div>
                    </details>
                  ))}
                  {m.subAgentActivity?.open &&
                  (settings.subAgent.enabled || settings.subAgent.codingEnabled) &&
                  settings.subAgent.showAnalysisWindow !== false ? (
                    <SubAgentActivityCard
                      embedded
                      panel={m.subAgentActivity}
                      onCollapse={(collapsed) =>
                        setMessageSubAgentActivity(m.id, {
                          ...m.subAgentActivity!,
                          collapsed,
                        })
                      }
                      onDismiss={() => setMessageSubAgentActivity(m.id, null)}
                    />
                  ) : null}
                  <ChatMarkdown content={markdownContent} />
                  {m.plan ? (
                    <PlanArtifactCard
                      messageId={m.id}
                      plan={m.plan}
                      busy={busy}
                      onChange={updateMessagePlan}
                      onApproveAndBuild={approveAndBuildPlan}
                      onReviseWithCustomNote={revisePlanWithCustomNote}
                    />
                  ) : null}
                  {renderItems.length > 0 ? (
                    <div className="flex flex-wrap gap-3">
                      {renderItems.map((item) => (
                        <div
                          key={item.key}
                          className="rounded border border-void-muted/40 p-2 bg-void-black/30"
                        >
                          <a
                            href={item.localPath || item.url || item.src}
                            target={item.localPath ? undefined : '_blank'}
                            rel={item.localPath ? undefined : 'noreferrer'}
                            className="block"
                            onClick={item.localPath ? (e) => {
                              e.preventDefault()
                              void openLocalImage(item.localPath)
                            } : undefined}
                          >
                            {item.hasPreview ? (
                              <img
                                src={item.src}
                                alt="Generated"
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                className="max-h-64 max-w-full rounded border border-void-muted/40 object-contain"
                              />
                            ) : (
                              <div className="max-h-64 w-[220px] rounded border border-void-muted/40 bg-void-black/40 px-3 py-2 text-xs font-mono text-void-dim">
                                Loading local image preview...
                              </div>
                            )}
                          </a>
                          <div className="mt-2 flex gap-2">
                            {!item.localPath && !settings.runwareAutoSaveImages ? (
                              <button
                                type="button"
                                onClick={() => void downloadImage(item.url)}
                                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono
                                  border border-neon-green/30 text-neon-green
                                  hover:bg-neon-green/10 hover:border-neon-green/50
                                  transition-all"
                              >
                                ⬇ DOWNLOAD
                              </button>
                            ) : !item.localPath ? (
                              <span className="text-xs font-mono text-void-dim">
                                Local image unavailable on this platform.
                              </span>
                            ) : null}
                          </div>
                          {assistantImageToolMeta[m.id]?.[item.localPath || item.url] ? (
                          <details className="mt-2 border border-void-muted/30 rounded bg-void-black/30">
                            <summary className="cursor-pointer px-2 py-1 text-[11px] font-mono text-neon-cyan/80 hover:text-neon-cyan">
                              IMAGE_INFO
                            </summary>
                            <div className="px-2 pb-2 pt-1 text-[11px] font-mono text-void-dim whitespace-pre-wrap break-all">
                              {(() => {
                                const meta =
                                  assistantImageToolMeta[m.id]?.[item.localPath || item.url]
                                  || assistantImageMessageMeta[m.id]
                                  || parseRunwareImageToolMeta(m.content)
                                if (!meta) return ''
                                const lines: string[] = []
                                if (meta.model) lines.push(`model: ${meta.model}`)
                                if (meta.size) lines.push(`size: ${meta.size}`)
                                if (meta.prompt) lines.push(`prompt: ${meta.prompt}`)
                                if (typeof meta.steps === 'number') lines.push(`steps: ${meta.steps}`)
                                if (typeof meta.cfgScale === 'number') lines.push(`cfg_scale: ${meta.cfgScale}`)
                                if (typeof meta.seed === 'number') lines.push(`seed: ${meta.seed}`)
                                if (typeof meta.costUsd === 'number') lines.push(`cost_usd: ${meta.costUsd.toFixed(6)}`)
                                if (typeof meta.elapsedMs === 'number') lines.push(`elapsed_ms: ${meta.elapsedMs}`)
                                if (meta.taskUuid) lines.push(`task_uuid: ${meta.taskUuid}`)
                                if (meta.imageUuid) lines.push(`image_uuid: ${meta.imageUuid}`)
                                return lines.join('\n')
                              })()}
                            </div>
                          </details>
                        ) : (
                          assistantImageMessageMeta[m.id] || parseRunwareImageToolMeta(m.content)
                        ) ? (
                          <details className="mt-2 border border-void-muted/30 rounded bg-void-black/30">
                            <summary className="cursor-pointer px-2 py-1 text-[11px] font-mono text-neon-cyan/80 hover:text-neon-cyan">
                              IMAGE_INFO
                            </summary>
                            <div className="px-2 pb-2 pt-1 text-[11px] font-mono text-void-dim whitespace-pre-wrap break-all">
                              {(() => {
                                const meta = assistantImageMessageMeta[m.id] || parseRunwareImageToolMeta(m.content)
                                if (!meta) return ''
                                const lines: string[] = []
                                if (meta.model) lines.push(`model: ${meta.model}`)
                                if (meta.size) lines.push(`size: ${meta.size}`)
                                if (meta.prompt) lines.push(`prompt: ${meta.prompt}`)
                                if (typeof meta.steps === 'number') lines.push(`steps: ${meta.steps}`)
                                if (typeof meta.cfgScale === 'number') lines.push(`cfg_scale: ${meta.cfgScale}`)
                                if (typeof meta.seed === 'number') lines.push(`seed: ${meta.seed}`)
                                if (typeof meta.costUsd === 'number') lines.push(`cost_usd: ${meta.costUsd.toFixed(6)}`)
                                if (typeof meta.elapsedMs === 'number') lines.push(`elapsed_ms: ${meta.elapsedMs}`)
                                if (meta.taskUuid) lines.push(`task_uuid: ${meta.taskUuid}`)
                                if (meta.imageUuid) lines.push(`image_uuid: ${meta.imageUuid}`)
                                return lines.join('\n')
                              })()}
                            </div>
                          </details>
                        ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              )
            })()}
            {(() => {
              // Only URLs confirmed by a real generate_music_runware tool result.
              const inlineAudioUrls = dedupeNonEmpty([
                ...(assistantGeneratedAudios[m.id] || []),
              ])
              return inlineAudioUrls.length > 0 ? (
                <div className="space-y-2">
                  {inlineAudioUrls.map((url, i) => {
                    const savedPath = assistantSavedAudioPaths[m.id]?.[i]
                    return (
                      <div
                        key={`${m.id}-runware-audio-${i}`}
                        className="rounded border border-void-muted/40 p-2 bg-void-black/30"
                      >
                        <div className="mb-2 text-[11px] font-mono text-neon-cyan/80">
                          GENERATED_AUDIO_{i + 1}
                          {savedPath ? ' (local)' : ' (url)'}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {savedPath && (
                            <button
                              type="button"
                              onClick={() => void openLocalImage(savedPath)}
                              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono
                                border border-neon-green/30 text-neon-green
                                hover:bg-neon-green/10 hover:border-neon-green/50
                                transition-all"
                            >
                              ▶ OPEN_LOCAL
                            </button>
                          )}
                          {!savedPath && (
                            <span className="text-xs font-mono text-void-dim">
                              Enable auto-save to open local file.
                            </span>
                          )}
                        </div>
                        {(assistantAudioToolMeta[m.id]?.[url] ||
                          assistantAudioMessageMeta[m.id] ||
                          parseRunwareAudioToolMeta(m.content)) ? (
                          <details className="mt-2 border border-void-muted/30 rounded bg-void-black/30">
                            <summary className="cursor-pointer px-2 py-1 text-[11px] font-mono text-neon-cyan/80 hover:text-neon-cyan">
                              AUDIO_INFO
                            </summary>
                            <div className="px-2 pb-2 pt-1 text-[11px] font-mono text-void-dim whitespace-pre-wrap break-all">
                              {(() => {
                                const meta =
                                  assistantAudioToolMeta[m.id]?.[url]
                                  || assistantAudioMessageMeta[m.id]
                                  || parseRunwareAudioToolMeta(m.content)
                                if (!meta) return ''
                                const lines: string[] = []
                                if (meta.model) lines.push(`model: ${meta.model}`)
                                if (meta.prompt) lines.push(`prompt: ${meta.prompt}`)
                                if (meta.outputFormat) lines.push(`output_format: ${meta.outputFormat}`)
                                if (typeof meta.durationSec === 'number') lines.push(`duration_sec: ${meta.durationSec}`)
                                if (typeof meta.steps === 'number') lines.push(`steps: ${meta.steps}`)
                                if (typeof meta.cfgScale === 'number') lines.push(`cfg_scale: ${meta.cfgScale}`)
                                if (meta.guidanceType) lines.push(`guidance_type: ${meta.guidanceType}`)
                                if (meta.vocalLanguage) lines.push(`vocal_language: ${meta.vocalLanguage}`)
                                if (typeof meta.seed === 'number') lines.push(`seed: ${meta.seed}`)
                                if (typeof meta.costUsd === 'number') lines.push(`cost_usd: ${meta.costUsd.toFixed(6)}`)
                                if (typeof meta.elapsedMs === 'number') lines.push(`elapsed_ms: ${meta.elapsedMs}`)
                                if (meta.taskUuid) lines.push(`task_uuid: ${meta.taskUuid}`)
                                if (meta.audioUuid) lines.push(`audio_uuid: ${meta.audioUuid}`)
                                return lines.join('\n')
                              })()}
                            </div>
                          </details>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              ) : null
            })()}
          </div>
        ) : editingMessageId === m.id ? (
          <div className="space-y-2">
            <textarea
              className="voidcast-textarea w-full"
              rows={3}
              value={editInputValue}
              onChange={(e) => setEditInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  commitEdit(m.id)
                } else if (e.key === 'Escape') {
                  cancelEdit()
                }
              }}
              autoFocus
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => commitEdit(m.id)}
                className="cyber-btn text-xs"
              >
                RESEND
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="px-3 py-1 text-xs font-mono text-void-dim hover:text-void-light"
              >
                CANCEL
              </button>
            </div>
          </div>
        ) : (
          <div
            className="min-w-0 max-w-full overflow-hidden text-void-white whitespace-pre-wrap break-words space-y-2 rounded px-1 -mx-1"
          >
            {m.images && m.images.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {m.images.map((b64, i) => (
                  <img
                    key={`${m.id}-img-${i}`}
                    src={imageDataUrl(b64, m.imageMimes?.[i] ?? 'image/png')}
                    alt=""
                    className="max-h-48 max-w-full rounded border border-void-muted/40 object-contain"
                  />
                ))}
              </div>
            )}
            {m.fileAttachments && m.fileAttachments.length > 0 && (
              <div className="space-y-1 rounded border border-void-muted/40 bg-void-black/20 p-2 text-xs font-mono">
                {m.fileAttachments.map((f) => (
                  <div key={f.id} className="text-void-dim">
                    FILE: {f.name} ({f.ext || 'unknown'}) {f.truncated ? '[truncated]' : ''}
                    <div className="break-all text-[10px] text-void-dim/80">{f.path}</div>
                  </div>
                ))}
              </div>
            )}
            {m.content.length > 0 ? (
              m.content
            ) : m.images?.length ? (
              <span className="text-void-dim text-xs font-mono">(no caption)</span>
            ) : m.fileAttachments?.length ? (
              <span className="text-void-dim text-xs font-mono">(file attached)</span>
            ) : (
              <span className="text-void-dim text-xs font-mono">
                (no text content)
              </span>
            )}
          </div>
        )}
        
        {/* Actions for user */}
        {m.role === 'user' && !editingMessageId && (
          <div className="mt-2 flex flex-wrap gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => startEdit(m)}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono
                border border-void-muted/50 text-void-dim
                hover:border-neon-cyan/50 hover:text-neon-cyan
                transition-all"
            >
              ✎ EDIT
            </button>
          </div>
        )}
        
        {/* Actions for assistant */}
        {m.role === 'assistant' && m.content.trim().length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-void-muted/30 pt-3">
            <button
              type="button"
              disabled={ttsOk === false}
              onClick={() => {
                if (playingId === m.id) {
                  abortTts()
                  return
                }
                void onRead(m)
              }}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono
                border border-neon-cyan/30 text-neon-cyan
                hover:bg-neon-cyan/10 hover:border-neon-cyan/50
                disabled:opacity-40 disabled:cursor-not-allowed
                transition-all"
            >
              <span className={playingId === m.id ? 'animate-pulse' : ''}>
                {playingId === m.id ? '◼' : '▶'}
              </span>
              {playingId === m.id ? 'STOP' : 'SPEAK'}
            </button>
            {dedupeNonEmpty([...(m.generatedImagePaths || []), ...(assistantSavedImagePaths[m.id] || [])]).length > 0 ? (
              <button
                type="button"
                onClick={() =>
                  void openLocalImage(
                    dedupeNonEmpty([
                      ...(m.generatedImagePaths || []),
                      ...(assistantSavedImagePaths[m.id] || []),
                    ]).slice(-1)[0],
                  )
                }
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono
                  border border-neon-green/30 text-neon-green
                  hover:bg-neon-green/10 hover:border-neon-green/50
                  transition-all"
              >
                🖼 OPEN IMG
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
