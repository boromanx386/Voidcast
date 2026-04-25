import type { AppSettings } from '@/lib/settings'
import { isElectron } from '@/lib/platform'
import QRCode from 'qrcode'
import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'

type Props = {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
}

export function GeneralOptionsPanel({ settings, setSettings }: Props) {
  const [mobileLanUrls, setMobileLanUrls] = useState<string[]>([])
  const [mobileQrDataUrl, setMobileQrDataUrl] = useState<string | null>(null)

  const ttsPort = useMemo(() => {
    try {
      const raw = settings.ttsBaseUrl.trim()
      const u = new URL(raw.includes('://') ? raw : `http://${raw}`)
      return u.port || (u.protocol === 'https:' ? '443' : '80')
    } catch {
      return '8765'
    }
  }, [settings.ttsBaseUrl])

  useEffect(() => {
    if (!isElectron() || !window.voidcast?.getLanNetworkInfo) return
    let cancelled = false
    void window.voidcast.getLanNetworkInfo().then((r) => {
      if (cancelled) return
      const urls = r.ips.map((ip) => `http://${ip}:${ttsPort}`)
      setMobileLanUrls(urls)
      // Prefer 192.x.x.x over 169.x.x.x (link-local)
      const preferred = urls.find((u) => u.includes('192.')) ?? urls[0]
      if (preferred) {
        void QRCode.toDataURL(preferred, {
          width: 168,
          margin: 1,
          color: { dark: '#0a0a0f', light: '#00f5ff80' },
        }).then((dataUrl) => {
          if (!cancelled) setMobileQrDataUrl(dataUrl)
        })
      } else {
        setMobileQrDataUrl(null)
      }
    })
    return () => {
      cancelled = true
    }
  }, [ttsPort])

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
                    : 'dystopian',
            }))
          }
        >
          <option value="dystopian">Dystopian (neon / CRT)</option>
          <option value="minimal">Minimal (zinc / indigo)</option>
          <option value="matrix">Matrix (soft green terminal)</option>
        </select>
        <p className="text-xs text-void-dim mt-1">
          Minimal and Matrix use calmer visuals (scanlines/particles off) with gentler contrast.
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
          Stored locally on this device (browser/electron storage).
        </p>
      </div>

      <div className="bg-void-black/50 border border-neon-cyan/25 p-4 rounded">
        <p className="text-xs font-mono text-neon-cyan uppercase tracking-wider mb-2">
          <span className="mr-2">⌘</span>TTS_SHORTCUT
        </p>
        <p className="text-xs text-void-dim">
          Global shortcut: <code className="text-neon-cyan">Ctrl+Alt+Shift+V</code>. Reads current
          clipboard text with TTS while Voidcast is running.
        </p>
      </div>

      {isElectron() && (
        <div className="bg-void-black/50 border border-neon-green/25 p-4 rounded">
          <p className="text-xs font-mono text-neon-green uppercase tracking-wider mb-2">
            <span className="mr-2">📱</span>MOBILE_WEB_UI
          </p>
          <p className="text-xs text-void-dim mb-3">
            With TTS listening on <code className="text-neon-cyan">0.0.0.0</code> (see workspace{' '}
            <code className="text-void-light">npm run dev:tts</code>), open the same UI on your phone
            on the LAN. Port matches <span className="text-void-light">TTS_SERVER_URL</span> in the
            TTS tab ({ttsPort}).
          </p>
          {mobileLanUrls.length === 0 ? (
            <p className="text-xs text-void-dim font-mono">NO_LAN_IPV4_FOUND</p>
          ) : (
            <div className="flex flex-wrap gap-4 items-start">
              {mobileQrDataUrl && (
                <img
                  src={mobileQrDataUrl}
                  alt="QR code for mobile URL"
                  className="w-[168px] h-[168px] rounded border border-void-muted/40 bg-white p-1"
                />
              )}
              <ul className="text-xs font-mono text-void-text space-y-1 min-w-0 flex-1">
                {mobileLanUrls.map((u) => (
                  <li key={u} className="break-all">
                    <a
                      href={u}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-neon-cyan underline decoration-neon-cyan/30"
                    >
                      {u}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[11px] text-void-dim mt-3">
            Run <code className="text-void-light">cd electron-app && npm run build:web</code> once so
            the server can serve the web UI from <code className="text-void-light">/</code>.
          </p>
        </div>
      )}
    </div>
  )
}
