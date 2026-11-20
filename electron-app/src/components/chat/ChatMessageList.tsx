import { useMemo, useState } from 'react'
import { ToolIndicator } from '@/components/chat/ChatChrome'
import { ChatSetupCard } from '@/components/chat/ChatSetupCard'
import { getEmptyStateMessage } from '@/components/chat/chatEmptyState'
import { ChatMessage } from '@/components/chat/ChatMessage'
import { useChatMessageRender } from '@/hooks/useChatMessageRender'
import type { VoidcastApp } from '@/hooks/useVoidcastApp'
import { chatSetupNeed } from '@/lib/chatSetup'
import { normalizeAgentChatMode } from '@/types/chat'

type Props = {
  app: Pick<
    VoidcastApp,
    | 'settings'
    | 'setSettings'
    | 'ollamaModels'
    | 'modelsLoading'
    | 'modelsError'
    | 'loadModels'
    | 'openOptions'
    | 'messages'
    | 'busy'
    | 'toolPhase'
    | 'toolActivities'
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
    | 'activeAgentMode'
    | 'revisePlanWithCustomNote'
    | 'playingId'
    | 'ttsOk'
    | 'abortTts'
    | 'onRead'
    | 'setMessageSubAgentActivity'
  >
}

export function ChatMessageList({ app }: Props) {
  const { settings, messages, busy, toolPhase, toolActivities, activeAgentMode } = app
  const [emptyStateSeed] = useState(() => Math.floor(Math.random() * 1_000_000))
  const agentMode = normalizeAgentChatMode(activeAgentMode)
  const uiDystopian = settings.uiTheme === 'dystopian'

  const emptyStateMessage = useMemo(
    () => getEmptyStateMessage(settings.uiTheme, emptyStateSeed, agentMode),
    [settings.uiTheme, emptyStateSeed, agentMode],
  )

  const setupNeed = chatSetupNeed(settings, {
    models: app.ollamaModels,
    loading: app.modelsLoading,
    error: app.modelsError,
  })

  const render = useChatMessageRender(app)

  const { listEndRef, chatMessagesRef, onChatScroll } = render

  return (
    <main
      ref={chatMessagesRef}
      onScroll={onChatScroll}
      className="voidcast-messages min-h-0 flex-1 overflow-y-auto"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-4 2xl:max-w-6xl">
        {messages.length === 0 && setupNeed.kind !== 'ready' && (
          <ChatSetupCard need={setupNeed} app={app} />
        )}

        {/* Empty State */}
        {messages.length === 0 && setupNeed.kind === 'ready' && (
          <div
            className={`relative overflow-hidden rounded-lg p-8 text-center animate-fade-in-up ${
              agentMode === 'plan'
                ? `chat-empty-state--plan border bg-void-mid/70 ${
                    uiDystopian ? 'border-neon-purple/25 bg-void-dark/80' : 'border-void-muted/50'
                  }`
                : uiDystopian
                  ? 'border border-neon-cyan/20 bg-void-dark/80'
                  : 'border border-void-muted/50 bg-void-mid/70'
            }`}
          >
            {uiDystopian && (
              <>
                {/* Decorative glow */}
                <div
                  className="absolute -right-20 -top-20 h-48 w-48 rounded-full bg-neon-cyan/10 blur-3xl"
                  aria-hidden
                />
                <div
                  className="absolute -left-20 -bottom-20 h-48 w-48 rounded-full bg-neon-magenta/10 blur-3xl"
                  aria-hidden
                />
              </>
            )}

            <div className="relative">
              <p
                className={`mb-6 text-sm animate-fade-in-up ${
                  agentMode === 'plan'
                    ? 'text-void-light leading-relaxed'
                    : 'text-void-text font-mono'
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
          <ChatMessage key={m.id} message={m} index={index} render={render} app={app} />
        ))}

        {/* Busy Indicator */}
        {busy && (
          <div className="flex items-center gap-3 px-4 py-3 bg-void-dark/80 border border-void-muted/30 rounded">
            <div className="typing-dots">
              <span />
              <span />
              <span />
            </div>
            <span className="text-void-text text-sm font-mono">
              {toolActivities.length > 0 ? (
                <ToolIndicator phase={toolPhase} activities={toolActivities} />
              ) : toolPhase ? (
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
