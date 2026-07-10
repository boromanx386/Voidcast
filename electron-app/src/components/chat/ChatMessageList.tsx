import { useMemo, useState } from 'react'
import { ToolIndicator } from '@/components/chat/ChatChrome'
import { getEmptyStateMessage } from '@/components/chat/chatEmptyState'
import { ChatMessage } from '@/components/chat/ChatMessage'
import { PlanBuildProgress } from '@/components/chat/PlanBuildProgress'
import { useChatMessageRender } from '@/hooks/useChatMessageRender'
import { findActiveBuildingPlan } from '@/lib/planArtifact'
import type { VoidcastApp } from '@/hooks/useVoidcastApp'

type Props = {
  app: Pick<
    VoidcastApp,
    | 'settings'
    | 'messages'
    | 'busy'
    | 'toolPhase'
    | 'setError'
    | 'assistantGeneratedImages'
    | 'assistantSavedImagePaths'
    | 'assistantGeneratedAudios'
    | 'assistantSavedAudioPaths'
    | 'assistantImageToolMeta'
    | 'assistantImageMessageMeta'
    | 'assistantAudioToolMeta'
    | 'assistantAudioMessageMeta'
    | 'editingMessageId'
    | 'editInputValue'
    | 'setEditInputValue'
    | 'startEdit'
    | 'cancelEdit'
    | 'commitEdit'
    | 'updateMessagePlan'
    | 'approveAndBuildPlan'
    | 'playingId'
    | 'ttsOk'
    | 'abortTts'
    | 'onRead'
  >
}

export function ChatMessageList({ app }: Props) {
  const { settings, messages, busy, toolPhase } = app
  const [emptyStateSeed] = useState(() => Math.floor(Math.random() * 1_000_000))
  const agentMode = settings.agentMode === 'plan' ? 'plan' : 'agent'
  const uiDystopian = settings.uiTheme === 'dystopian'

  const emptyStateMessage = useMemo(
    () => getEmptyStateMessage(settings.uiTheme, emptyStateSeed, agentMode),
    [settings.uiTheme, emptyStateSeed, agentMode],
  )

  const render = useChatMessageRender(app)

  const { listEndRef, chatMessagesRef, onChatScroll } = render

  const activeBuildingPlan = useMemo(
    () => findActiveBuildingPlan(messages, busy),
    [messages, busy],
  )

  return (
    <main
      ref={chatMessagesRef}
      onScroll={onChatScroll}
      className="voidcast-messages min-h-0 flex-1 overflow-y-auto"
    >
      <div className="mx-auto max-w-3xl flex flex-col gap-4">
        {/* Empty State */}
        {messages.length === 0 && (
          <div
            className={`relative overflow-hidden rounded-lg p-8 text-center animate-fade-in-up ${
              agentMode === 'plan'
                ? `chat-empty-state--plan border bg-void-mid/70 ${
                    uiDystopian
                      ? 'border-neon-purple/25 bg-void-dark/80'
                      : 'border-void-muted/50'
                  }`
                : uiDystopian
                  ? 'border border-neon-cyan/20 bg-void-dark/80'
                  : 'border border-void-muted/50 bg-void-mid/70'
            }`}
          >
            {uiDystopian && (
              <>
                {/* Decorative glow */}
                <div className="absolute -right-20 -top-20 h-48 w-48 rounded-full bg-neon-cyan/10 blur-3xl" aria-hidden />
                <div className="absolute -left-20 -bottom-20 h-48 w-48 rounded-full bg-neon-magenta/10 blur-3xl" aria-hidden />
              </>
            )}
            
            <div className="relative">
              <p
                className={`mb-6 text-sm animate-fade-in-up ${
                  agentMode === 'plan' ? 'text-void-light leading-relaxed' : 'text-void-text font-mono'
                }`}
                style={{ animationDelay: '0.2s' }}
              >
                {emptyStateMessage}
                {uiDystopian && agentMode !== 'plan' && (
                  <span className="animate-cursor-blink ml-1">_</span>
                )}
              </p>
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.map((m, index) => (
          <ChatMessage
            key={m.id}
            message={m}
            index={index}
            render={render}
            app={app}
          />
        ))}

        {activeBuildingPlan && (
          <PlanBuildProgress plan={activeBuildingPlan.plan} />
        )}

        {/* Busy Indicator */}
        {busy && (
          <div className="flex items-center gap-3 px-4 py-3 bg-void-dark/80 border border-void-muted/30 rounded">
            <div className="typing-dots">
              <span />
              <span />
              <span />
            </div>
            <span className="text-void-text text-sm font-mono">
              {toolPhase ? (
                <ToolIndicator phase={toolPhase} />
              ) : (
                'PROCESSING...'
              )}
            </span>
          </div>
        )}

        <div ref={listEndRef} />
      </div>
    </main>
  )
}
