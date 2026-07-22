import { useEffect } from 'react'
import { isElectron } from '@/lib/platform'

function isWindowsDesktop(): boolean {
  if (typeof navigator === 'undefined') return false
  return isElectron() && navigator.userAgent.includes('Windows')
}

/** Marks Windows Electron so the header becomes the drag region (custom caption buttons). */
export function WinChromeBoot() {
  useEffect(() => {
    if (!isWindowsDesktop()) return
    const root = document.documentElement
    root.dataset.winChrome = ''
    return () => {
      delete root.dataset.winChrome
    }
  }, [])

  return null
}
