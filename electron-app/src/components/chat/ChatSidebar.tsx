import { useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { SessionItem } from '@/components/chat/SessionItem'
import { FolderIcon } from '@/components/icons/FolderIcon'
import { groupSessionsByProject, sessionBoundProjectPath } from '@/lib/sessionProjectGroups'
import { useBusySessionMap, useUnreadCompleteSessionMap } from '@/lib/sessionAgentStore'
import type { VoidcastApp } from '@/hooks/useVoidcastApp'

type Props = { app: VoidcastApp }

const SIDEBAR_WIDTH_KEY = 'voidcast.sidebarWidth'
const SIDEBAR_WIDTH_DEFAULT = 288
const SIDEBAR_WIDTH_MIN = 220
const SIDEBAR_WIDTH_MAX = 460
/** Age threshold for the ">30d" bulk-select shortcut. */
const OLD_CHAT_DAYS = 30

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, width))
}

/** Persisted drag width; falls back to the default when unset or out of range. */
function readStoredSidebarWidth(): number {
  const saved = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY))
  if (!Number.isFinite(saved) || saved <= 0) return SIDEBAR_WIDTH_DEFAULT
  return clampSidebarWidth(saved)
}

export function ChatSidebar({ app }: Props) {
  const {
    sessionsSidebarCollapsed,
    appVersion,
    openOptions,
    newChat,
    newChatWithPickedFolder,
    newChatForProject,
    sessions,
    activeSessionId,
    sidebarCollapsed,
    setSidebarCollapsed,
    pendingDeleteId,
    setPendingDeleteId,
    renamingSessionId,
    renameValue,
    setRenameValue,
    openSession,
    forkSession,
    exportSessionToMarkdown,
    deleteSessions,
    startRenameSession,
    cancelRenameSession,
    commitRenameSession,
  } = app

  const [filter, setFilter] = useState('')
  const query = filter.trim().toLowerCase()

  /** Drag-resizable width — chat titles truncate fast at the CSS default. */
  const [sidebarWidth, setSidebarWidth] = useState(readStoredSidebarWidth)
  const sidebarRef = useRef<HTMLElement>(null)

  const resizeFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const left = sidebarRef.current?.getBoundingClientRect().left ?? 0
    setSidebarWidth(clampSidebarWidth(event.clientX - left))
  }

  const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(sidebarWidth)))
  }

  /** Filter matches chat title or bound project path, so "vst" finds both. */
  const filteredSessions = useMemo(() => {
    if (!query) return sessions
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(query) ||
        sessionBoundProjectPath(s).toLowerCase().includes(query),
    )
  }, [sessions, query])

  const projectGroups = useMemo(() => groupSessionsByProject(filteredSessions), [filteredSessions])

  // --- Bulk select -------------------------------------------------------------
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const [confirmBulk, setConfirmBulk] = useState(false)
  /** Anchor for shift+click range selection. */
  const lastToggledRef = useRef<string | null>(null)

  /** Running agents are excluded: discarding them would kill work in progress. */
  const isSelectable = (id: string) => !busyBySession[id]
  /** Visible order (groups, then rows) — the axis shift+click ranges run along. */
  const visibleIds = useMemo(
    () => projectGroups.flatMap((g) => g.sessions.map((s) => s.id)),
    [projectGroups],
  )

  const exitSelectMode = () => {
    setSelectMode(false)
    setSelectedIds(new Set())
    setConfirmBulk(false)
    lastToggledRef.current = null
  }

  const replaceSelection = (ids: Iterable<string>) => {
    setConfirmBulk(false)
    setSelectedIds(new Set(Array.from(ids).filter(isSelectable)))
  }

  const toggleSelected = (id: string, shiftKey: boolean) => {
    setConfirmBulk(false)
    const anchor = lastToggledRef.current
    const next = new Set(selectedIds)
    if (shiftKey && anchor && anchor !== id) {
      const from = visibleIds.indexOf(anchor)
      const to = visibleIds.indexOf(id)
      if (from >= 0 && to >= 0) {
        // Range copies the anchor's state, like mail clients do.
        const on = selectedIds.has(anchor)
        for (const rangeId of visibleIds.slice(Math.min(from, to), Math.max(from, to) + 1)) {
          if (!isSelectable(rangeId)) continue
          if (on) next.add(rangeId)
          else next.delete(rangeId)
        }
        setSelectedIds(next)
        lastToggledRef.current = id
        return
      }
    }
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
    lastToggledRef.current = id
  }

  const toggleGroup = (ids: string[]) => {
    setConfirmBulk(false)
    const selectable = ids.filter(isSelectable)
    const allOn = selectable.length > 0 && selectable.every((id) => selectedIds.has(id))
    const next = new Set(selectedIds)
    for (const id of selectable) {
      if (allOn) next.delete(id)
      else next.add(id)
    }
    setSelectedIds(next)
  }

  const runBulkDelete = () => {
    deleteSessions(Array.from(selectedIds).filter(isSelectable))
    exitSelectMode()
  }
  /** Folder group that holds the open chat — highlighted in the list. */
  const activeGroupKey = useMemo(() => {
    if (!activeSessionId) return null
    for (const group of projectGroups) {
      if (group.sessions.some((s) => s.id === activeSessionId)) return group.key
    }
    return null
  }, [projectGroups, activeSessionId])
  const busyBySession = useBusySessionMap()
  const unreadCompleteBySession = useUnreadCompleteSessionMap()

  if (sessionsSidebarCollapsed) return null

  return (
    <aside
      ref={sidebarRef}
      className="voidcast-sidebar shrink-0 min-h-0"
      style={{ width: sidebarWidth }}
    >
      {/* Drag to resize; double-click restores the default. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sessions sidebar"
        title="Drag to resize · double-click to reset"
        className="sidebar-resizer"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          resizeFromPointer(e)
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) resizeFromPointer(e)
        }}
        onPointerUp={endResize}
        onDoubleClick={() => setSidebarWidth(SIDEBAR_WIDTH_DEFAULT)}
      />

      <div className="sidebar-header gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-void-light">Sessions</span>
        <button
          type="button"
          onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
          className={`shrink-0 rounded border px-2 py-1 text-[10px] font-mono transition-colors ${
            selectMode
              ? 'border-neon-red/60 text-neon-red'
              : 'border-void-muted/50 text-void-dim hover:border-void-dim hover:text-void-light'
          }`}
          title="Select several chats to delete them at once"
          aria-pressed={selectMode}
        >
          Select
        </button>
        <button
          type="button"
          onClick={() => openOptions('general')}
          className="shrink-0 rounded border border-void-muted/50 px-2 py-1 text-[10px] font-mono text-void-dim transition-colors hover:border-void-dim hover:text-void-light"
          title="Settings"
          aria-label="Settings"
        >
          Settings
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-void-muted/30 px-2 py-2">
        <button
          type="button"
          onClick={newChat}
          className="flex min-w-0 flex-1 items-center gap-2 rounded px-3 py-2 text-left text-sm text-void-light transition-colors hover:bg-void-mid/50 hover:text-void-white"
          title="New chat (Ctrl+N). Starts General until you pick a folder in Coding panel."
        >
          <span className="text-neon-green" aria-hidden>
            +
          </span>
          <span>New chat</span>
        </button>
        <button
          type="button"
          onClick={() => void newChatWithPickedFolder()}
          className="shrink-0 rounded px-2 py-2 text-void-dim transition-colors hover:bg-void-mid/50 hover:text-neon-green"
          title="New chat in a project folder"
          aria-label="New chat in a project folder"
        >
          <FolderIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="shrink-0 border-b border-void-muted/30 px-2 py-2">
        <div className="relative flex items-center">
          <input
            type="text"
            role="searchbox"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setFilter('')
            }}
            placeholder="Filter chats…"
            aria-label="Filter chats by title or project"
            spellCheck={false}
            className="w-full rounded border border-void-muted/40 bg-void-black/40 py-1.5 pl-3 pr-11 font-mono text-[11px] text-void-light placeholder:text-void-dim/70 focus:border-neon-cyan/60 focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setFilter('')}
              className="absolute right-1 rounded px-1.5 py-0.5 font-mono text-[10px] text-void-dim transition-colors hover:text-void-light"
              title="Clear filter (Esc)"
              aria-label="Clear filter"
            >
              ESC
            </button>
          ) : null}
        </div>
        {query ? (
          <div className="mt-1 px-1 font-mono text-[10px] text-void-dim/80">
            {filteredSessions.length} / {sessions.length} chats
          </div>
        ) : null}
      </div>

      <div className="sidebar-section min-h-0">
        {projectGroups.length === 0 && (
          <div className="px-4 py-2 text-xs text-void-dim/60">
            {query ? 'No chats match the filter' : 'No sessions yet'}
          </div>
        )}
        {projectGroups.map((group, index) => {
          const isActiveGroup = activeGroupKey !== null && group.key === activeGroupKey
          const toggled = sidebarCollapsed[group.key]
          // sidebarCollapsed stores the COLLAPSED state; undefined = auto, where only the
          // folder holding the open chat is open. The old `toggled !== true` read the map
          // inverted, so the first click on the auto-open folder did nothing at all.
          const storedCollapsed = toggled ?? !isActiveGroup
          // While filtering, every folder stays open so matches can't hide.
          const collapsed = query ? false : storedCollapsed
          // Rolls the row status dots up to the folder header: a collapsed folder hides its
          // sessions, so a background run in another project would otherwise be invisible.
          const busyCount = group.sessions.filter((s) => busyBySession[s.id]).length
          const hasUnread = group.sessions.some(
            (s) => unreadCompleteBySession[s.id] && !busyBySession[s.id],
          )
          return (
            <div
              key={group.key}
              className={`session-group group${isActiveGroup ? ' active' : ''}${
                index > 0 ? ' mt-2' : ''
              }`}
            >
              <div className="flex w-full items-center">
                {selectMode ? (
                  <input
                    type="checkbox"
                    aria-label={`Select all chats in ${group.label}`}
                    title={`Select all in ${group.label}`}
                    className="ml-2 shrink-0 accent-neon-red"
                    checked={
                      group.sessions.some((s) => isSelectable(s.id)) &&
                      group.sessions
                        .filter((s) => isSelectable(s.id))
                        .every((s) => selectedIds.has(s.id))
                    }
                    onChange={() => toggleGroup(group.sessions.map((s) => s.id))}
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    setSidebarCollapsed((p) => ({ ...p, [group.key]: !storedCollapsed }))
                  }
                  className="session-group-toggle"
                  title={group.path || 'General chat — no project folder'}
                  aria-current={isActiveGroup ? 'true' : undefined}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {group.path ? <FolderIcon className="h-3.5 w-3.5 shrink-0" /> : null}
                    <span className="truncate">{group.label}</span>
                    <span className="shrink-0 opacity-70">({group.sessions.length})</span>
                    {busyCount > 0 ? (
                      <span
                        className="session-group-status-dot is-busy"
                        title={`Agent running in this folder${busyCount > 1 ? ` (${busyCount})` : ''}`}
                        aria-label={`Agent running${busyCount > 1 ? ` (${busyCount})` : ''}`}
                      />
                    ) : hasUnread ? (
                      <span
                        className="session-group-status-dot is-unread"
                        title="Agent finished in this folder — open to dismiss"
                        aria-label="Agent finished"
                      />
                    ) : null}
                    {isActiveGroup ? (
                      <span
                        className="session-group-active-dot"
                        title="Folder holding the open chat"
                        aria-hidden
                      />
                    ) : null}
                  </span>
                  <span aria-hidden>{collapsed ? '▸' : '▾'}</span>
                </button>
                {group.path && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      newChatForProject(group.path)
                    }}
                    className="shrink-0 pr-3 text-xs font-mono text-void-dim opacity-0 transition-opacity hover:text-neon-green group-hover:opacity-100"
                    title={`New chat for ${group.label}`}
                    aria-label={`New chat for ${group.label}`}
                  >
                    +
                  </button>
                )}
              </div>

              {isActiveGroup && group.path ? (
                <div className="session-group-path" title={group.path}>
                  {group.path}
                </div>
              ) : null}

              {!collapsed && (
                <div className="space-y-0.5">
                  {group.sessions.map((s) => (
                    <SessionItem
                      key={s.id}
                      session={s}
                      isActive={s.id === activeSessionId}
                      isBusy={Boolean(busyBySession[s.id])}
                      isUnreadComplete={Boolean(
                        unreadCompleteBySession[s.id] && !busyBySession[s.id],
                      )}
                      isRenaming={renamingSessionId === s.id}
                      isPendingDelete={pendingDeleteId === s.id}
                      renameValue={renameValue}
                      onOpen={() => openSession(s)}
                      onStartRename={() => startRenameSession(s)}
                      onRenameChange={(v) => setRenameValue(v)}
                      onCommitRename={() => commitRenameSession(s.id)}
                      onCancelRename={cancelRenameSession}
                      onStartDelete={() => setPendingDeleteId(s.id)}
                      onConfirmDelete={() => deleteSessions([s.id])}
                      onCancelDelete={() => setPendingDeleteId(null)}
                      onFork={() => forkSession(s)}
                      onExport={() => exportSessionToMarkdown(s)}
                      selectMode={selectMode}
                      selected={selectedIds.has(s.id)}
                      selectable={isSelectable(s.id)}
                      onToggleSelect={(shiftKey) => toggleSelected(s.id, shiftKey)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {selectMode ? (
        <div className="shrink-0 space-y-2 border-t border-void-muted/30 px-3 py-2 font-mono text-[10px]">
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              className="rounded border border-void-muted/50 px-2 py-0.5 text-void-dim hover:text-void-light"
              onClick={() => replaceSelection(visibleIds)}
              title={query ? 'Select every chat matching the filter' : 'Select every chat'}
            >
              All{query ? ' (filtered)' : ''}
            </button>
            <button
              type="button"
              className="rounded border border-void-muted/50 px-2 py-0.5 text-void-dim hover:text-void-light"
              onClick={() =>
                replaceSelection(
                  filteredSessions.filter((s) => s.messages.length === 0).map((s) => s.id),
                )
              }
              title="Select chats with no messages"
            >
              Empty
            </button>
            <button
              type="button"
              className="rounded border border-void-muted/50 px-2 py-0.5 text-void-dim hover:text-void-light"
              onClick={() => {
                const cutoff = Date.now() - OLD_CHAT_DAYS * 24 * 60 * 60 * 1000
                replaceSelection(
                  filteredSessions.filter((s) => s.updatedAt < cutoff).map((s) => s.id),
                )
              }}
              title={`Select chats not touched in ${OLD_CHAT_DAYS} days`}
            >
              &gt;{OLD_CHAT_DAYS}d
            </button>
            <button
              type="button"
              className="rounded border border-void-muted/50 px-2 py-0.5 text-void-dim hover:text-void-light"
              onClick={() => replaceSelection([])}
            >
              None
            </button>
          </div>
          {confirmBulk ? (
            <div className="flex items-center gap-2">
              <span className="text-neon-red">
                Delete {selectedIds.size} chat{selectedIds.size === 1 ? '' : 's'}?
              </span>
              <button
                type="button"
                onClick={runBulkDelete}
                className="border border-neon-red/30 bg-neon-red/20 px-2 py-0.5 text-neon-red"
              >
                YES
              </button>
              <button
                type="button"
                onClick={() => setConfirmBulk(false)}
                className="border border-void-dim/30 px-2 py-0.5 text-void-dim"
              >
                NO
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={selectedIds.size === 0}
                onClick={() => setConfirmBulk(true)}
                className="border border-neon-red/30 bg-neon-red/20 px-2 py-0.5 text-neon-red disabled:cursor-not-allowed disabled:opacity-40"
              >
                Delete {selectedIds.size || ''}
              </button>
              <button
                type="button"
                onClick={exitSelectMode}
                className="border border-void-dim/30 px-2 py-0.5 text-void-dim"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      ) : null}

      <div className="shrink-0 border-t border-void-muted/30 px-3 py-2 text-center text-[10px] font-mono text-void-dim/50">
        v{appVersion}
      </div>
    </aside>
  )
}
