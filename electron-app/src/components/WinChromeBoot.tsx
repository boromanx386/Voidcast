import { useEffect } from 'react'
import { usesCustomWindowChrome } from '@/lib/platform'

/**
 * Marks Electron desktop shells (Windows + Linux) so the header becomes the drag region
 * (custom caption buttons). macOS keeps its native title bar.
 */
export function WinChromeBoot() {
  useEffect(() => {
    if (!usesCustomWindowChrome()) return
    const root = document.documentElement
    root.dataset.winChrome = ''
    return () => {
      delete root.dataset.winChrome
    }
  }, [])

  return null
}
