import type { ChatSession } from '@/types/chat'

type SessionItemProps = {
  session: ChatSession
  isActive: boolean
  /** Agent run in progress (including background). */
  isBusy?: boolean
  /** Background run finished; session not opened since. */
  isUnreadComplete?: boolean
  isRenaming: boolean
  isPendingDelete: boolean
  renameValue: string
  onOpen: () => void
  onStartRename: () => void
  onRenameChange: (v: string) => void
  onCommitRename: () => void
  onCancelRename: () => void
  onStartDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
  onFork: () => void
  onExport: () => void
}

export function SessionItem({
  session,
  isActive,
  isBusy = false,
  isUnreadComplete = false,
  isRenaming,
  isPendingDelete,
  renameValue,
  onOpen,
  onStartRename,
  onRenameChange,
  onCommitRename,
  onCancelRename,
  onStartDelete,
  onConfirmDelete,
  onCancelDelete,
  onFork,
  onExport,
}: SessionItemProps) {
  return (
    <div className={`session-item ${isActive ? 'active' : ''}`}>
      {isRenaming ? (
        <div className="space-y-2">
          <input
            type="text"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitRename()
              else if (e.key === 'Escape') onCancelRename()
            }}
            className="w-full px-2 py-1 bg-void-black border border-void-dim text-void-light text-xs font-mono"
            autoFocus
          />
          <div className="flex gap-1">
            <button
              onClick={onCommitRename}
              className="px-2 py-0.5 text-xs bg-neon-green/20 text-neon-green border border-neon-green/30"
            >
              SAVE
            </button>
            <button
              onClick={onCancelRename}
              className="px-2 py-0.5 text-xs text-void-dim border border-void-dim/30"
            >
              CXL
            </button>
          </div>
        </div>
      ) : isPendingDelete ? (
        <div className="space-y-1">
          <div className="text-xs text-neon-red font-mono">CONFIRM_DELETE?</div>
          <div className="flex gap-1">
            <button
              onClick={onConfirmDelete}
              className="px-2 py-0.5 text-xs bg-neon-red/20 text-neon-red border border-neon-red/30"
            >
              YES
            </button>
            <button
              onClick={onCancelDelete}
              className="px-2 py-0.5 text-xs text-void-dim border border-void-dim/30"
            >
              NO
            </button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" className="w-full text-left" onClick={onOpen}>
            <div className="flex min-w-0 items-center gap-1.5">
              {isUnreadComplete && (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-neon-cyan"
                  title="Agent finished"
                  aria-label="Agent finished"
                />
              )}
              <div
                className={`min-w-0 flex-1 truncate font-mono text-xs ${
                  isUnreadComplete ? 'text-void-white' : 'text-void-light'
                }`}
              >
                {session.title}
              </div>
              {session.unsaved ? (
                <span
                  className="shrink-0 font-mono text-[9px] tracking-wide text-void-dim"
                  title="Not saved to disk — click Save in the chat header"
                  aria-label="Unsaved"
                >
                  DRAFT
                </span>
              ) : null}
              {isBusy ? (
                <span
                  className="shrink-0 font-mono text-[9px] tracking-wide text-neon-green"
                  title="Agent running"
                  aria-label="Agent running"
                >
                  ● RUN
                </span>
              ) : isUnreadComplete ? (
                <span
                  className="shrink-0 font-mono text-[9px] tracking-wide text-neon-cyan"
                  title="Finished — open to dismiss"
                  aria-label="Agent finished"
                >
                  DONE
                </span>
              ) : null}
            </div>
            <div className="mt-0.5 text-[10px] text-void-dim">
              {new Date(session.updatedAt).toLocaleDateString()}{' '}
              {new Date(session.updatedAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
          </button>
          <div className="mt-1 flex gap-1">
            <button
              onClick={onFork}
              className="border border-transparent px-1.5 py-0.5 text-[10px] text-void-dim hover:border-void-dim/30 hover:text-neon-green"
            >
              FORK
            </button>
            <button
              onClick={onExport}
              className="border border-transparent px-1.5 py-0.5 text-[10px] text-void-dim hover:border-void-dim/30 hover:text-neon-cyan"
            >
              EXP
            </button>
            <button
              onClick={onStartRename}
              className="border border-transparent px-1.5 py-0.5 text-[10px] text-void-dim hover:border-void-dim/30 hover:text-neon-cyan"
            >
              REN
            </button>
            <button
              onClick={onStartDelete}
              className="border border-transparent px-1.5 py-0.5 text-[10px] text-void-dim hover:border-void-dim/30 hover:text-neon-red"
            >
              DEL
            </button>
          </div>
        </>
      )}
    </div>
  )
}
