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

const ICON_ATTRS = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

/** Row tooltip stamp: "14.10. 18:03" (year only when it is not the current one). */
function formatStamp(ts: number): string {
  const date = new Date(ts)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  const day = date.toLocaleDateString(
    [],
    sameYear
      ? { day: '2-digit', month: '2-digit' }
      : { day: '2-digit', month: '2-digit', year: 'numeric' },
  )
  const clock = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return `${day} ${clock}`
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
  const stamp = formatStamp(session.updatedAt)
  const hasStatus = isBusy || isUnreadComplete
  const tooltip = `${session.title} · ${stamp}`

  // Chromium keeps a native title tooltip open after the click that opened the chat, so the
  // stamp hangs over the list until the pointer moves away. Drop it on press, restore on leave.
  const dismissTooltip = (el: HTMLElement) => el.removeAttribute('title')
  const restoreTooltip = (el: HTMLElement) => {
    if (!el.hasAttribute('title')) el.setAttribute('title', tooltip)
  }

  return (
    <div className={`session-item ${isActive ? 'active' : ''}`}>
      {isRenaming ? (
        <div className="w-full space-y-2 px-3 py-2">
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
        <div className="w-full space-y-1 px-3 py-2">
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
          <button
            type="button"
            className="session-item-open"
            onClick={onOpen}
            onPointerDown={(e) => dismissTooltip(e.currentTarget)}
            onMouseLeave={(e) => restoreTooltip(e.currentTarget)}
            title={tooltip}
          >
            {hasStatus && (
              <span
                className={`session-item-dot ${isBusy ? 'bg-neon-green animate-pulse' : 'bg-neon-cyan'}`}
                title={isBusy ? 'Agent running' : 'Agent finished — open to dismiss'}
                aria-label={isBusy ? 'Agent running' : 'Agent finished'}
              />
            )}
            <span
              className={`session-item-title${
                isUnreadComplete && !isBusy ? ' text-void-white' : ''
              }`}
            >
              {session.title}
            </span>
            {session.unsaved ? (
              <span
                className="session-item-flag text-void-dim"
                title="Not saved to disk — click Save in the chat header"
                aria-label="Unsaved"
              >
                DRAFT
              </span>
            ) : null}
          </button>

          <div className="session-item-actions">
            <button
              type="button"
              className="session-act"
              onClick={onFork}
              title="Fork session"
              aria-label="Fork session"
            >
              <svg className="h-3 w-3" {...ICON_ATTRS}>
                <rect x="2.5" y="2.5" width="7" height="7" rx="1.2" />
                <rect x="6.5" y="6.5" width="7" height="7" rx="1.2" />
              </svg>
            </button>
            <button
              type="button"
              className="session-act"
              onClick={onExport}
              title="Export as Markdown"
              aria-label="Export session as Markdown"
            >
              <svg className="h-3 w-3" {...ICON_ATTRS}>
                <path d="M8 2.5v7" />
                <path d="M4.75 6.5 8 9.75l3.25-3.25" />
                <path d="M2.75 12.5h10.5" />
              </svg>
            </button>
            <button
              type="button"
              className="session-act"
              onClick={onStartRename}
              title="Rename session"
              aria-label="Rename session"
            >
              <svg className="h-3 w-3" {...ICON_ATTRS}>
                <path d="M10.9 2.9l2.2 2.2-7.6 7.6-2.7.6.6-2.7z" />
                <path d="M9.7 4.1l2.2 2.2" />
              </svg>
            </button>
            <button
              type="button"
              className="session-act session-act-danger"
              onClick={onStartDelete}
              title="Delete session"
              aria-label="Delete session"
            >
              <svg className="h-3 w-3" {...ICON_ATTRS}>
                <path d="M4 4l8 8" />
                <path d="M12 4l-8 8" />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
