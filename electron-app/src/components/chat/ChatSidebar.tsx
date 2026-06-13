import { useMemo } from 'react'
import { SessionItem } from '@/components/chat/SessionItem'
import { isToday } from '@/lib/chatHints'
import type { VoidcastApp } from '@/hooks/useVoidcastApp'

type Props = {
  app: Pick<
    VoidcastApp,
    | 'menuOpen'
    | 'setMenuOpen'
    | 'appVersion'
    | 'openOptions'
    | 'newChat'
    | 'sessions'
    | 'activeSessionId'
    | 'sidebarCollapsed'
    | 'setSidebarCollapsed'
    | 'pendingDeleteId'
    | 'setPendingDeleteId'
    | 'renamingSessionId'
    | 'renameValue'
    | 'setRenameValue'
    | 'openSession'
    | 'forkSession'
    | 'exportSessionToMarkdown'
    | 'deleteSession'
    | 'startRenameSession'
    | 'cancelRenameSession'
    | 'commitRenameSession'
  >
}

export function ChatSidebar({ app }: Props) {
  const {
    menuOpen,
    setMenuOpen,
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

  if (!menuOpen) return null

  return (
    <>
      <button
        type="button"
        aria-label="Close menu"
        className="fixed inset-0 z-40 bg-void-black/80 backdrop-blur-sm"
        onClick={() => setMenuOpen(false)}
      />
      <nav 
        className="fixed left-0 top-0 z-50 flex h-full w-72 max-w-[85vw] flex-col 
          bg-void-dark/95 border-r border-neon-cyan/20 shadow-[4px_0_30px_rgba(var(--ui-accent-rgb),0.1)]
          backdrop-blur-xl"
      >
        {/* Menu Header */}
        <div className="px-4 py-4 border-b border-void-muted/30">
          <div className="flex items-center gap-3">
            <span className="text-neon-cyan font-mono text-lg">⌘</span>
            <span className="font-display text-sm tracking-widest text-void-light uppercase">NAVIGATION</span>
          </div>
        </div>

        {/* Menu Items */}
        <div className="flex flex-col gap-1 p-2">
          <button
            type="button"
            onClick={() => openOptions('general')}
            className="flex items-center gap-3 rounded px-4 py-3 text-left
              text-void-light hover:text-neon-cyan hover:bg-neon-cyan/5
              border border-transparent hover:border-neon-cyan/20 transition-all"
          >
            <span className="text-neon-cyan">⚙</span>
            <span className="font-mono text-sm">SETTINGS</span>
          </button>
          
          <div className="h-px bg-void-muted/30 my-2" />
          
          <button
            type="button"
            onClick={newChat}
            className="flex items-center gap-3 rounded px-4 py-3 text-left
              text-void-light hover:text-neon-cyan hover:bg-neon-cyan/5
              border border-transparent hover:border-neon-cyan/20 transition-all"
          >
            <span className="text-neon-green">+</span>
            <span className="font-mono text-sm">NEW_SESSION</span>
          </button>
        </div>

        {/* Sessions List */}
        <div className="flex-1 border-t border-void-muted/30 overflow-y-auto p-2">
          <div className="px-2 py-2 text-xs font-mono text-void-dim uppercase tracking-wider">
            CHAT_HISTORY
          </div>
          
          {/* Today */}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((p) => ({ ...p, today: !p.today }))}
            className="flex w-full items-center justify-between px-3 py-2 text-xs font-mono text-void-dim hover:text-void-light"
          >
            <span>TODAY [{todaySessions.length}]</span>
            <span>{sidebarCollapsed.today ? '▶' : '▼'}</span>
          </button>
          
          {!sidebarCollapsed.today && (
            <div className="space-y-1 mt-1">
              {todaySessions.length === 0 && (
                <div className="px-3 py-2 text-xs font-mono text-void-dim/50">NO_SESSIONS</div>
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

          {/* Older */}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((p) => ({ ...p, older: !p.older }))}
            className="flex w-full items-center justify-between px-3 py-2 mt-2 text-xs font-mono text-void-dim hover:text-void-light"
          >
            <span>ARCHIVE [{olderSessions.length}]</span>
            <span>{sidebarCollapsed.older ? '▶' : '▼'}</span>
          </button>
          
          {!sidebarCollapsed.older && (
            <div className="space-y-1 mt-1">
              {olderSessions.length === 0 && (
                <div className="px-3 py-2 text-xs font-mono text-void-dim/50">NO_ARCHIVE</div>
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

        {/* Footer */}
        <div className="p-3 border-t border-void-muted/30">
          <div className="text-xs font-mono text-void-dim/50 text-center">
            {`VOIDCAST_NEXUS // BUILD_${appVersion}`}
          </div>
        </div>
      </nav>
    </>
  )
}
