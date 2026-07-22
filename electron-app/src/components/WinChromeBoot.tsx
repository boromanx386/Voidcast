import { useEffect } from 'react'
import { isElectron } from '@/lib/platform'

function isWindowsDesktop(): boolean {
  if (typeof navigator === 'undefined') return false
  return isElectron() && navigator.userAgent.includes('Windows')
}

type WindowControlsOverlay = {
  getTitlebarAreaRect: () => DOMRect
  addEventListener: (type: 'geometrychange', listener: () => void) => void
  removeEventListener: (type: 'geometrychange', listener: () => void) => void
}

/** Marks Windows Electron chrome and syncs caption-button inset for the merged header. */
export function WinChromeBoot() {
  useEffect(() => {
    if (!isWindowsDesktop()) return

    const root = document.documentElement
    root.dataset.winChrome = ''

    const syncInset = () => {
      const wco = (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlay })
        .windowControlsOverlay
      let inset = 138
      if (wco?.getTitlebarAreaRect) {
        const rect = wco.getTitlebarAreaRect()
        inset = Math.max(0, Math.round(window.innerWidth - rect.right))
        if (inset < 48) inset = 138
      }
      root.style.setProperty('--win-caption-inset', `${inset}px`)
    }

    syncInset()
    const wco = (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlay })
      .windowControlsOverlay
    wco?.addEventListener('geometrychange', syncInset)
    window.addEventListener('resize', syncInset)

    return () => {
      wco?.removeEventListener('geometrychange', syncInset)
      window.removeEventListener('resize', syncInset)
      delete root.dataset.winChrome
      root.style.removeProperty('--win-caption-inset')
    }
  }, [])

  return null
}
