import type { ChatSession } from '@/types/chat'

type SessionItemProps = {
  session: ChatSession
  isActive: boolean
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
            <div className="text-xs text-void-light truncate font-mono">{session.title}</div>
            <div className="text-[10px] text-void-dim mt-0.5">
              {new Date(session.updatedAt).toLocaleDateString()}{' '}
              {new Date(session.updatedAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
          </button>
          <div className="flex gap-1 mt-1">
            <button
              onClick={onFork}
              className="px-1.5 py-0.5 text-[10px] text-void-dim hover:text-neon-green border border-transparent hover:border-void-dim/30"
            >
              FORK
            </button>
            <button
              onClick={onExport}
              className="px-1.5 py-0.5 text-[10px] text-void-dim hover:text-neon-cyan border border-transparent hover:border-void-dim/30"
            >
              EXP
            </button>
            <button
              onClick={onStartRename}
              className="px-1.5 py-0.5 text-[10px] text-void-dim hover:text-neon-cyan border border-transparent hover:border-void-dim/30"
            >
              REN
            </button>
            <button
              onClick={onStartDelete}
              className="px-1.5 py-0.5 text-[10px] text-void-dim hover:text-neon-red border border-transparent hover:border-void-dim/30"
            >
              DEL
            </button>
          </div>
        </>
      )}
    </div>
  )
}
