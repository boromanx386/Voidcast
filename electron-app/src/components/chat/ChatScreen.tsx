import { useCallback, useEffect, useRef, useState } from 'react'
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
import { clampCodingPanelWidth, CODING_PANEL_WIDTH_MAX, CODING_PANEL_WIDTH_MIN } from '@/lib/settings'

type Props = { app: VoidcastApp }

export function ChatScreen({ app }: Props) {
  const uiDystopian = app.settings.uiTheme === 'dystopian'
  const showCoding = app.showCodingPanel && app.codingPanelAvailable
  const setSettings = app.setSettings
  const savedPanelWidth = app.settings.coding.panelWidthPx
  const splitRef = useRef<HTMLDivElement>(null)
  const [panelWidth, setPanelWidth] = useState(() => clampCodingPanelWidth(savedPanelWidth))
  const [isResizing, setIsResizing] = useState(false)

  useEffect(() => {
    if (!isResizing) {
      setPanelWidth(clampCodingPanelWidth(savedPanelWidth))
    }
  }, [savedPanelWidth, isResizing])

  const persistWidth = useCallback(
    (px: number) => {
      const next = clampCodingPanelWidth(px, splitRef.current?.clientWidth)
      setPanelWidth(next)
      setSettings((s) => ({
        ...s,
        coding: { ...s.coding, panelWidthPx: next },
      }))
    },
    [setSettings],
  )

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const handle = e.currentTarget
      handle.setPointerCapture(e.pointerId)
      setIsResizing(true)
      const prevCursor = document.body.style.cursor
      const prevUserSelect = document.body.style.userSelect
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      const startX = e.clientX
      const startWidth = panelWidth

      const onMove = (ev: PointerEvent) => {
        const delta = startX - ev.clientX
        const next = clampCodingPanelWidth(startWidth + delta, splitRef.current?.clientWidth)
        setPanelWidth(next)
      }

      const onUp = (ev: PointerEvent) => {
        handle.releasePointerCapture(ev.pointerId)
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
        handle.removeEventListener('pointercancel', onUp)
        document.body.style.cursor = prevCursor
        document.body.style.userSelect = prevUserSelect
        setIsResizing(false)
        const delta = startX - ev.clientX
        persistWidth(startWidth + delta)
      }

      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
      handle.addEventListener('pointercancel', onUp)
    },
    [panelWidth, persistWidth],
  )

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

      <div
        ref={splitRef}
        className={`flex min-h-0 min-w-0 w-full flex-1 overflow-hidden${isResizing ? ' select-none' : ''}`}
      >
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
        {showCoding && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize coding panel"
              aria-valuenow={panelWidth}
              aria-valuemin={CODING_PANEL_WIDTH_MIN}
              aria-valuemax={CODING_PANEL_WIDTH_MAX}
              tabIndex={0}
              onPointerDown={onResizePointerDown}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 32 : 16
                if (e.key === 'ArrowLeft') {
                  e.preventDefault()
                  persistWidth(panelWidth + step)
                } else if (e.key === 'ArrowRight') {
                  e.preventDefault()
                  persistWidth(panelWidth - step)
                } else if (e.key === 'Home') {
                  e.preventDefault()
                  persistWidth(CODING_PANEL_WIDTH_MAX)
                } else if (e.key === 'End') {
                  e.preventDefault()
                  persistWidth(CODING_PANEL_WIDTH_MIN)
                }
              }}
              className={`group relative z-10 w-1.5 shrink-0 cursor-col-resize touch-none
                bg-void-muted/20 hover:bg-neon-cyan/40 active:bg-neon-cyan/60
                transition-colors ${isResizing ? 'bg-neon-cyan/50' : ''}`}
            >
              <div
                className={`pointer-events-none absolute inset-y-0 -left-1 -right-1 ${
                  isResizing ? 'bg-neon-cyan/10' : 'group-hover:bg-neon-cyan/5'
                }`}
              />
            </div>
            <CodingPanel
              settings={app.settings}
              widthPx={panelWidth}
              fileTreeRevision={app.codingFileTreeNonce}
              agentShellFeed={app.codingTerminalFeed}
              onCodingUiChange={(patch) =>
                app.setSettings((s) => ({ ...s, coding: { ...s.coding, ...patch } }))
              }
              onUpdateProjectPath={app.applyCodingProjectPath}
            />
          </>
        )}
      </div>

      <ChatSystemStatus app={app} />
    </div>
  )
}
