import { useCallback, useEffect, useRef, useState } from 'react'
import { CodingPanel } from '@/components/CodingPanel'
import {
  AmbientParticles,
  CrtOverlay,
  MatrixRain,
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
  const uiMatrix = app.settings.uiTheme === 'matrix'
  const showCoding = app.showCodingPanel && app.codingPanelAvailable
  const setSettings = app.setSettings
  const savedPanelWidth = app.settings.coding.panelWidthPx
  const splitRef = useRef<HTMLDivElement>(null)
  const preferredWidthRef = useRef(savedPanelWidth)
  /** Panel share of the chat↔coding split; kept across maximize/restore. */
  const widthRatioRef = useRef<number | null>(null)
  const [panelWidth, setPanelWidth] = useState(() => clampCodingPanelWidth(savedPanelWidth))
  const [isResizing, setIsResizing] = useState(false)

  useEffect(() => {
    preferredWidthRef.current = savedPanelWidth
    if (!isResizing) widthRatioRef.current = null
  }, [savedPanelWidth, isResizing])

  const applyWidthForContainer = useCallback((containerWidth: number, preferredPx: number) => {
    if (!(containerWidth > 0)) return
    const ratio = widthRatioRef.current
    const raw =
      typeof ratio === 'number' && Number.isFinite(ratio)
        ? ratio * containerWidth
        : preferredPx
    const next = clampCodingPanelWidth(raw, containerWidth)
    if (widthRatioRef.current == null) {
      widthRatioRef.current = next / containerWidth
    }
    setPanelWidth(next)
  }, [])

  useEffect(() => {
    if (!showCoding) return
    const el = splitRef.current
    if (!el) return

    const sync = () => {
      if (isResizing) return
      applyWidthForContainer(el.clientWidth, preferredWidthRef.current)
    }

    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [showCoding, applyWidthForContainer, isResizing, savedPanelWidth])

  const persistWidth = useCallback(
    (px: number) => {
      const containerWidth = splitRef.current?.clientWidth
      const next = clampCodingPanelWidth(px, containerWidth)
      setPanelWidth(next)
      preferredWidthRef.current = next
      if (typeof containerWidth === 'number' && containerWidth > 0) {
        widthRatioRef.current = next / containerWidth
      }
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
      className={`voidcast-app${uiDystopian && !showCoding ? ' grid-bg' : ''}`}
      onDragEnter={app.onChatDragEnter}
      onDragOver={app.onChatDragOver}
      onDragLeave={app.onChatDragLeave}
      onDrop={app.onChatDrop}
    >
      {uiDystopian && !showCoding && (
        <>
          <CrtOverlay />
          <AmbientParticles />
        </>
      )}
      {uiMatrix && <MatrixRain />}
      <ChatDragOverlay isDragOver={app.isDragOver} />
      <ChatHeader app={app} />

      <div className="voidcast-main min-h-0">
        <ChatSidebar app={app} />

        <div
          ref={splitRef}
          className={`flex min-h-0 min-w-0 flex-1 overflow-hidden${isResizing ? ' select-none' : ''}${showCoding ? ' voidcast-split--with-coding' : ''}`}
        >
          <div className="voidcast-chat flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
              className="panel-splitter panel-splitter--vertical"
            >
            </div>
            <CodingPanel
              settings={app.settings}
              widthPx={panelWidth}
              fileTreeRevision={app.codingFileTreeNonce}
              gitRevision={app.codingGitNonce}
              agentShellFeed={app.codingTerminalFeed}
              agentShellEpoch={app.codingTerminalEpoch}
              revealRequest={app.codingRevealRequest}
              commandRunning={Boolean(app.activeCodingRunId)}
              onStopCommand={() => void app.stopCodingCommand()}
              onCodingUiChange={(patch) =>
                app.setSettings((s) => ({ ...s, coding: { ...s.coding, ...patch } }))
              }
              onUpdateProjectPath={app.applyCodingProjectPath}
            />
            </>
          )}
        </div>
      </div>

      <ChatSystemStatus app={app} />
    </div>
  )
}
