import { useMemo } from 'react'
import { SessionItem } from '@/components/chat/SessionItem'
import { groupSessionsByProject } from '@/lib/sessionProjectGroups'
import {
  useBusySessionMap,
  useUnreadCompleteSessionMap,
} from '@/lib/sessionAgentStore'
import type { VoidcastApp } from '@/hooks/useVoidcastApp'

type Props = { app: VoidcastApp }

export function ChatSidebar({ app }: Props) {
  const {
    sessionsSidebarCollapsed,
    appVersion,
    openOptions,
    newChat,
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
    deleteSession,
    startRenameSession,
    cancelRenameSession,
    commitRenameSession,
  } = app

  const projectGroups = useMemo(() => groupSessionsByProject(sessions), [sessions])
  const busyBySession = useBusySessionMap()
  const unreadCompleteBySession = useUnreadCompleteSessionMap()

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
          title="New chat (Ctrl+N). Starts General until you pick a folder in Coding panel."
        >
          <span className="text-neon-green" aria-hidden>
            +
          </span>
          <span>New chat</span>
        </button>
      </div>

      <div className="sidebar-section min-h-0">
        {projectGroups.length === 0 && (
          <div className="px-4 py-2 text-xs text-void-dim/60">No sessions yet</div>
        )}
        {projectGroups.map((group, index) => {
          const collapsed = sidebarCollapsed[group.key] !== true
          return (
            <div key={group.key} className={index > 0 ? 'mt-2' : undefined}>
              <div className="group flex w-full items-center">
                <button
                  type="button"
                  onClick={() =>
                    setSidebarCollapsed((p) => ({ ...p, [group.key]: !p[group.key] }))
                  }
                  className="flex min-w-0 flex-1 items-center justify-between px-4 py-2 text-xs font-mono text-void-dim hover:text-void-light"
                  title={group.path || 'General chat — no project folder'}
                >
                  <span className="min-w-0 truncate">
                    {group.label} ({group.sessions.length})
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
                      onConfirmDelete={() => deleteSession(s.id)}
                      onCancelDelete={() => setPendingDeleteId(null)}
                      onFork={() => forkSession(s)}
                      onExport={() => exportSessionToMarkdown(s)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="shrink-0 border-t border-void-muted/30 px-3 py-2 text-center text-[10px] font-mono text-void-dim/50">
        v{appVersion}
      </div>
    </aside>
  )
}
