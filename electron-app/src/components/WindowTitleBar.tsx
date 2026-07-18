import { isElectron } from '@/lib/platform'

function isWindowsDesktop(): boolean {
  if (typeof navigator === 'undefined') return false
  return isElectron() && navigator.userAgent.includes('Windows')
}

export function WindowTitleBar() {
  if (!isWindowsDesktop()) return null

  return (
    <div className="window-titlebar" aria-hidden>
      <div className="window-titlebar-brand">
        <span className="window-titlebar-mark" />
        <span>VOIDCAST</span>
      </div>
      <div className="window-titlebar-divider" />
    </div>
  )
}
