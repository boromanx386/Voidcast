import { useEffect, useState } from 'react'
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

/** Popover height (4 rows + padding) — used to decide whether it opens above the row. */
const MENU_HEIGHT = 132

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
  /** null = closed; false = open below the row; true = open above it. */
  const [menuUp, setMenuUp] = useState<boolean | null>(null)

  // Chromium keeps a native title tooltip open after the click that opened the chat, so the
  // stamp hangs over the list until the pointer moves away. Drop it on press, restore on leave.
  const dismissTooltip = (el: HTMLElement) => el.removeAttribute('title')
  const restoreTooltip = (el: HTMLElement) => {
    if (!el.hasAttribute('title')) el.setAttribute('title', tooltip)
  }

  // A menu left open would follow the list while it scrolls, so close it on Escape or on
  // any press that lands outside the button and the popover.
  useEffect(() => {
    if (menuUp === null) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.session-more, .session-menu')) return
      setMenuUp(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuUp(null)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menuUp])

  /** Flip the popover above the row when there is no room below it inside the list. */
  const openMenu = (button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect()
    const list = button.closest('.sidebar-section')?.getBoundingClientRect()
    const spaceBelow = (list?.bottom ?? window.innerHeight) - rect.bottom
    const spaceAbove = rect.top - (list?.top ?? 0)
    setMenuUp(spaceBelow < MENU_HEIGHT && spaceAbove > spaceBelow)
  }

  const runAction = (action: () => void) => () => {
    setMenuUp(null)
    action()
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

          <button
            type="button"
            className="session-more"
            onClick={(e) => (menuUp === null ? openMenu(e.currentTarget) : setMenuUp(null))}
            title="Chat actions"
            aria-label="Chat actions"
            aria-haspopup="menu"
            aria-expanded={menuUp !== null}
          >
            <svg className="h-3.5 w-3.5" {...ICON_ATTRS}>
              <circle cx="3.5" cy="8" r="1.1" fill="currentColor" stroke="none" />
              <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
              <circle cx="12.5" cy="8" r="1.1" fill="currentColor" stroke="none" />
            </svg>
          </button>

          {menuUp !== null && (
            <div
              className={`session-menu${menuUp ? ' up' : ''}`}
              role="menu"
              aria-label="Chat actions"
            >
              <button
                type="button"
                role="menuitem"
                className="session-menu-item"
                onClick={runAction(onFork)}
              >
                Fork chat
              </button>
              <button
                type="button"
                role="menuitem"
                className="session-menu-item"
                onClick={runAction(onExport)}
              >
                Export .md
              </button>
              <button
                type="button"
                role="menuitem"
                className="session-menu-item"
                onClick={runAction(onStartRename)}
              >
                Rename
              </button>
              <button
                type="button"
                role="menuitem"
                className="session-menu-item session-menu-item-danger"
                onClick={runAction(onStartDelete)}
              >
                Delete
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
