import { useCallback, useEffect, useState } from 'react'
import { isElectron } from '@/lib/platform'

function isWindowsDesktop(): boolean {
  if (typeof navigator === 'undefined') return false
  return isElectron() && navigator.userAgent.includes('Windows')
}

function MinimizeIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M5 12h14" strokeLinecap="round" />
    </svg>
  )
}

function MaximizeIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="5" y="5" width="14" height="14" rx="1" />
    </svg>
  )
}

function RestoreIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M8 8h10v10H8z" />
      <path d="M6 16V6h10" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  )
}

const btnClass =
  'cyber-btn flex h-8 w-8 shrink-0 items-center justify-center p-0'

/** Custom Windows caption buttons styled like other header cyber-btn icons. */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false)
  const enabled = isWindowsDesktop() && Boolean(window.voidcast?.windowMinimize)

  useEffect(() => {
    if (!enabled || !window.voidcast) return
    let cancelled = false
    void window.voidcast.windowIsMaximized().then((v) => {
      if (!cancelled) setMaximized(v)
    })
    const unsub = window.voidcast.onWindowMaximizedChange((v) => setMaximized(v))
    return () => {
      cancelled = true
      unsub()
    }
  }, [enabled])

  const onMinimize = useCallback(() => {
    void window.voidcast?.windowMinimize()
  }, [])

  const onToggleMaximize = useCallback(() => {
    void window.voidcast?.windowToggleMaximize()
  }, [])

  const onClose = useCallback(() => {
    void window.voidcast?.windowClose()
  }, [])

  if (!enabled) return null

  return (
    <div className="ml-1 flex shrink-0 items-center gap-1 sm:ml-2 sm:gap-1.5">
      <button
        type="button"
        className={btnClass}
        title="Minimize"
        aria-label="Minimize"
        onClick={onMinimize}
      >
        <MinimizeIcon />
      </button>
      <button
        type="button"
        className={btnClass}
        title={maximized ? 'Restore' : 'Maximize'}
        aria-label={maximized ? 'Restore' : 'Maximize'}
        onClick={onToggleMaximize}
      >
        {maximized ? <RestoreIcon /> : <MaximizeIcon />}
      </button>
      <button
        type="button"
        className={`${btnClass} hover:border-neon-magenta/60 hover:text-neon-magenta`}
        title="Close"
        aria-label="Close"
        onClick={onClose}
      >
        <CloseIcon />
      </button>
    </div>
  )
}
