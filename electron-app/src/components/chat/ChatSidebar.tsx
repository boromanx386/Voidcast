import { useMemo } from 'react'
import { SessionItem } from '@/components/chat/SessionItem'
import { isToday } from '@/lib/chatHints'
import type { VoidcastApp } from '@/hooks/useVoidcastApp'

type Props = { app: VoidcastApp }

export function ChatSidebar({ app }: Props) {
  const {
    sessionsSidebarCollapsed,
    appVersion,
    openOptions,
    newChat,
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
    deleteSession,
    startRenameSession,
    cancelRenameSession,
    commitRenameSession,
  } = app

  const todaySessions = useMemo(() => sessions.filter((s) => isToday(s.updatedAt)), [sessions])
  const olderSessions = useMemo(() => sessions.filter((s) => !isToday(s.updatedAt)), [sessions])

  if (sessionsSidebarCollapsed) return null

  return (
    <aside className="voidcast-sidebar shrink-0 min-h-0">
      <div className="sidebar-header gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-void-light">Sessions</span>
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

      <div className="shrink-0 border-b border-void-muted/30 px-2 py-2">
        <button
          type="button"
          onClick={newChat}
          className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-void-light transition-colors hover:bg-void-mid/50 hover:text-void-white"
        >
          <span className="text-neon-green" aria-hidden>
            +
          </span>
          <span>New chat</span>
        </button>
      </div>

      <div className="sidebar-section min-h-0">
        <button
          type="button"
          onClick={() => setSidebarCollapsed((p) => ({ ...p, today: !p.today }))}
          className="flex w-full items-center justify-between px-4 py-2 text-xs font-mono text-void-dim hover:text-void-light"
        >
          <span>Today ({todaySessions.length})</span>
          <span aria-hidden>{sidebarCollapsed.today ? '▸' : '▾'}</span>
        </button>

        {!sidebarCollapsed.today && (
          <div className="space-y-0.5">
            {todaySessions.length === 0 && (
              <div className="px-4 py-2 text-xs text-void-dim/60">No sessions yet</div>
            )}
            {todaySessions.map((s) => (
              <SessionItem
                key={s.id}
                session={s}
                isActive={s.id === activeSessionId}
                isRenaming={renamingSessionId === s.id}
                isPendingDelete={pendingDeleteId === s.id}
                renameValue={renameValue}
                onOpen={() => openSession(s)}
                onStartRename={() => startRenameSession(s)}
                onRenameChange={(v) => setRenameValue(v)}
                onCommitRename={() => commitRenameSession(s.id)}
                onCancelRename={cancelRenameSession}
                onStartDelete={() => setPendingDeleteId(s.id)}
                onConfirmDelete={() => deleteSession(s.id)}
                onCancelDelete={() => setPendingDeleteId(null)}
                onFork={() => forkSession(s)}
                onExport={() => exportSessionToMarkdown(s)}
              />
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setSidebarCollapsed((p) => ({ ...p, older: !p.older }))}
          className="mt-2 flex w-full items-center justify-between px-4 py-2 text-xs font-mono text-void-dim hover:text-void-light"
        >
          <span>Older ({olderSessions.length})</span>
          <span aria-hidden>{sidebarCollapsed.older ? '▸' : '▾'}</span>
        </button>

        {!sidebarCollapsed.older && (
          <div className="space-y-0.5">
            {olderSessions.length === 0 && (
              <div className="px-4 py-2 text-xs text-void-dim/60">No older sessions</div>
            )}
            {olderSessions.map((s) => (
              <SessionItem
                key={s.id}
                session={s}
                isActive={s.id === activeSessionId}
                isRenaming={renamingSessionId === s.id}
                isPendingDelete={pendingDeleteId === s.id}
                renameValue={renameValue}
                onOpen={() => openSession(s)}
                onStartRename={() => startRenameSession(s)}
                onRenameChange={(v) => setRenameValue(v)}
                onCommitRename={() => commitRenameSession(s.id)}
                onCancelRename={cancelRenameSession}
                onStartDelete={() => setPendingDeleteId(s.id)}
                onConfirmDelete={() => deleteSession(s.id)}
                onCancelDelete={() => setPendingDeleteId(null)}
                onFork={() => forkSession(s)}
                onExport={() => exportSessionToMarkdown(s)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-void-muted/30 px-3 py-2 text-center text-[10px] font-mono text-void-dim/50">
        v{appVersion}
      </div>
    </aside>
  )
}
