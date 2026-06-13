import { CodingPanel } from '@/components/CodingPanel'
import {
  AmbientParticles,
  CrtOverlay,
} from '@/components/chat/ChatChrome'
import { ChatComposer } from '@/components/chat/ChatComposer'
import { ChatDragOverlay } from '@/components/chat/ChatDragOverlay'
import { ChatErrorBanner } from '@/components/chat/ChatErrorBanner'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { ChatMessageList } from '@/components/chat/ChatMessageList'
import { ChatSidebar } from '@/components/chat/ChatSidebar'
import { ChatSystemStatus } from '@/components/chat/ChatSystemStatus'
import { ChatToolResultBanner } from '@/components/chat/ChatToolResultBanner'
import { ContextWarningBanner } from '@/components/chat/ContextWarningBanner'
import { MemoryPreviewModal } from '@/components/chat/MemoryPreviewModal'
import { SubAgentPanel } from '@/components/chat/SubAgentPanel'
import type { VoidcastApp } from '@/hooks/useVoidcastApp'

type Props = { app: VoidcastApp }

export function ChatScreen({ app }: Props) {
  const uiDystopian = app.settings.uiTheme === 'dystopian'

  return (
    <div
      className={`voidcast-app${uiDystopian ? ' grid-bg' : ''}`}
      onDragEnter={app.onChatDragEnter}
      onDragOver={app.onChatDragOver}
      onDragLeave={app.onChatDragLeave}
      onDrop={app.onChatDrop}
    >
      {uiDystopian && (
        <>
          <CrtOverlay />
          <AmbientParticles />
        </>
      )}
      <ChatDragOverlay isDragOver={app.isDragOver} />
      <ChatHeader app={app} />

      <div className="flex min-h-0 min-w-0 w-full flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <ChatSidebar app={app} />
          <ChatMessageList app={app} />
          <ChatToolResultBanner app={app} />
          <ChatErrorBanner app={app} />
          <ContextWarningBanner app={app} />
          <SubAgentPanel app={app} />
          <MemoryPreviewModal app={app} />
          <ChatComposer app={app} />
        </div>
        {app.showCodingPanel && app.codingPanelAvailable && (
          <CodingPanel
            settings={app.settings}
            fileTreeRevision={app.codingFileTreeNonce}
            agentShellFeed={app.codingTerminalFeed}
            onCodingUiChange={(patch) =>
              app.setSettings((s) => ({ ...s, coding: { ...s.coding, ...patch } }))
            }
            onUpdateProjectPath={app.applyCodingProjectPath}
          />
        )}
      </div>

      <ChatSystemStatus app={app} />
    </div>
  )
}
