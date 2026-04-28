import type { AppSettings } from '@/lib/settings'
import { isElectron } from '@/lib/platform'
import {
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'

type Props = {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
}

export function GeneralOptionsPanel({ settings, setSettings }: Props) {
  const [updateChecking, setUpdateChecking] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<string | null>(null)

  useEffect(() => {
    const ipc = window.ipcRenderer
    if (!isElectron() || !ipc) return

    const onAvailable = (_event: unknown, payload: { update?: boolean; newVersion?: string }) => {
      if (payload?.update) {
        setUpdateStatus(`Update available: v${payload.newVersion ?? '?'}`)
      } else {
        setUpdateStatus('No update available.')
      }
      setUpdateChecking(false)
    }
    const onError = (_event: unknown, payload: { message?: string }) => {
      setUpdateStatus(payload?.message || 'Update check failed.')
      setUpdateChecking(false)
    }
    const onDownloaded = () => {
      setUpdateStatus('Update downloaded. Restart app to install.')
      setUpdateChecking(false)
    }

    ipc.on('update-can-available', onAvailable)
    ipc.on('update-error', onError)
    ipc.on('update-downloaded', onDownloaded)
    return () => {
      ipc.off('update-can-available', onAvailable)
      ipc.off('update-error', onError)
      ipc.off('update-downloaded', onDownloaded)
    }
  }, [])

  const checkForUpdate = async () => {
    const ipc = window.ipcRenderer
    if (!isElectron() || !ipc) {
      setUpdateStatus('Update check is available only in desktop app.')
      return
    }
    setUpdateChecking(true)
    setUpdateStatus('Checking for updates...')
    try {
      const result = await ipc.invoke('check-update')
      const maybe = result as { error?: { message?: string } } | null
      if (maybe?.error) {
        setUpdateStatus(maybe.error.message || 'Update check failed.')
        setUpdateChecking(false)
      }
    } catch (e) {
      setUpdateStatus(e instanceof Error ? e.message : String(e))
      setUpdateChecking(false)
    }
  }

  return (
    <div className="grid gap-5 text-sm">
      <div className="form-group">
        <label className="form-label">
          <span className="text-neon-cyan mr-2">◆</span> INTERFACE_THEME
        </label>
        <select
          className="form-select"
          value={settings.uiTheme}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              uiTheme:
                e.target.value === 'minimal'
                  ? 'minimal'
                  : e.target.value === 'matrix'
                    ? 'matrix'
                    : e.target.value === 'light'
                      ? 'light'
                    : 'dystopian',
            }))
          }
        >
          <option value="dystopian">Dystopian (neon / CRT)</option>
          <option value="minimal">Minimal (zinc / indigo)</option>
          <option value="matrix">Matrix (soft green terminal)</option>
          <option value="light">Light (warm paper)</option>
        </select>
        <p className="text-xs text-void-dim mt-1">
          Minimal, Matrix, and Light use calmer visuals (scanlines/particles off) with gentler contrast.
        </p>
      </div>

      <div className="form-group">
        <label className="form-label">
          <span className="text-neon-yellow mr-2">⚿</span> RUNWARE_API_KEY
        </label>
        <input
          type="password"
          className="cyber-input"
          value={settings.runwareApiKey}
          onChange={(e) =>
            setSettings((s) => ({ ...s, runwareApiKey: e.target.value }))
          }
          placeholder="rw_..."
          autoComplete="off"
        />
        <p className="text-xs text-neon-yellow/80 mt-1">
          Stored locally on this device (desktop app storage).
        </p>
        <a
          href="https://runware.ai/"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-xs text-neon-cyan underline decoration-neon-cyan/35 underline-offset-2 hover:decoration-neon-cyan"
        >
          Get Runware API key
        </a>
      </div>

      <div className="form-group">
        <label className="form-label">
          <span className="text-neon-cyan mr-2">⚿</span> OPENROUTER_API_KEY
        </label>
        <input
          type="password"
          className="cyber-input"
          value={settings.openrouterApiKey}
          onChange={(e) =>
            setSettings((s) => ({ ...s, openrouterApiKey: e.target.value }))
          }
          placeholder="sk-or-v1-..."
          autoComplete="off"
        />
        <p className="text-xs text-neon-cyan/80 mt-1">
          Stored locally on this device (desktop app storage).
        </p>
        <a
          href="https://openrouter.ai/keys"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-xs text-neon-cyan underline decoration-neon-cyan/35 underline-offset-2 hover:decoration-neon-cyan"
        >
          Get OpenRouter API key
        </a>
      </div>

      {isElectron() && (
        <div className="bg-void-black/50 border border-neon-cyan/25 p-4 rounded">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-neon-cyan"
              checked={settings.autoUpdate}
              onChange={(e) =>
                setSettings((s) => ({ ...s, autoUpdate: e.target.checked }))
              }
            />
            <span>
              <span className="text-xs font-mono text-neon-cyan uppercase tracking-wider">
                AUTO_UPDATE
              </span>
              <span className="mt-1 block text-xs text-void-dim">
                Automatically check updates on startup (desktop app).
              </span>
            </span>
          </label>

          {!settings.autoUpdate && (
            <div className="mt-3">
              <button
                type="button"
                className="cyber-btn text-xs"
                disabled={updateChecking}
                onClick={() => void checkForUpdate()}
              >
                {updateChecking ? 'CHECKING…' : 'CHECK FOR UPDATE'}
              </button>
              {updateStatus && (
                <p className="text-xs text-void-dim mt-2">{updateStatus}</p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="bg-void-black/50 border border-neon-cyan/25 p-4 rounded">
        <p className="text-xs font-mono text-neon-cyan uppercase tracking-wider mb-2">
          <span className="mr-2">⌘</span>TTS_SHORTCUT
        </p>
        <p className="text-xs text-void-dim">
          Global shortcut: <code className="text-neon-cyan">Ctrl+Alt+Shift+V</code>. Reads current
          clipboard text with TTS while Voidcast is running.
        </p>
      </div>

    </div>
  )
}
