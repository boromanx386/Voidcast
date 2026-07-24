import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import QRCode from 'qrcode'
import { isElectron } from '@/lib/platform'
import { normalizeBaseUrl, type AppSettings } from '@/lib/settings'

type Props = {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
}

type SecretsStatus = {
  openrouter: boolean
  runware: boolean
  nvidia: boolean
  deepseek: boolean
  opencode_go: boolean
}

function portFromTtsBaseUrl(ttsBaseUrl: string): number {
  const raw = normalizeBaseUrl(ttsBaseUrl.trim() || 'http://127.0.0.1:8765')
  try {
    const u = new URL(raw.includes('://') ? raw : `http://${raw}`)
    if (u.port) return Number(u.port)
    return u.protocol === 'https:' ? 443 : 80
  } catch {
    return 8765
  }
}

function pickPreferredIp(ips: string[]): string {
  const wifi = ips.find((ip) => ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.'))
  return wifi ?? ips[0] ?? ''
}

export function LanWebAccessPanel({ settings, setSettings }: Props) {
  const enabled = settings.lanWebAccessEnabled
  const [ips, setIps] = useState<string[]>([])
  const [selectedIp, setSelectedIp] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [lanError, setLanError] = useState<string | null>(null)
  const [secretsStatus, setSecretsStatus] = useState<SecretsStatus | null>(null)

  const port = useMemo(() => portFromTtsBaseUrl(settings.ttsBaseUrl), [settings.ttsBaseUrl])
  const lanUrl = selectedIp ? `http://${selectedIp}:${port}/` : ''

  const refreshIps = useCallback(async () => {
    if (!isElectron() || !window.voidcast?.getLanNetworkInfo) {
      setIps([])
      setSelectedIp('')
      setLanError('LAN address lookup requires the desktop app.')
      return
    }
    try {
      const info = await window.voidcast.getLanNetworkInfo()
      const list = Array.isArray(info?.ips) ? info.ips.filter(Boolean) : []
      setIps(list)
      setLanError(list.length === 0 ? 'No LAN address found — check Wi‑Fi or VPN (Tailscale).' : null)
      setSelectedIp((prev) => (prev && list.includes(prev) ? prev : pickPreferredIp(list)))
    } catch (e) {
      setIps([])
      setSelectedIp('')
      setLanError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      setQrDataUrl('')
      setSecretsStatus(null)
      return
    }
    void refreshIps()
  }, [enabled, refreshIps])

  useEffect(() => {
    if (!enabled || !lanUrl) {
      setQrDataUrl('')
      return
    }
    let cancelled = false
    void QRCode.toDataURL(lanUrl, { width: 200, margin: 1, color: { dark: '#0a0a0a', light: '#ffffff' } })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('')
      })
    return () => {
      cancelled = true
    }
  }, [enabled, lanUrl])

  useEffect(() => {
    if (!enabled) return
    const root = normalizeBaseUrl(settings.ttsBaseUrl.trim() || 'http://127.0.0.1:8765')
    let cancelled = false
    const poll = () => {
      void fetch(`${root}/tools/cloud-secrets-status`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return (await res.json()) as SecretsStatus & { ok?: boolean }
        })
        .then((data) => {
          if (cancelled) return
          setSecretsStatus({
            openrouter: Boolean(data.openrouter),
            runware: Boolean(data.runware),
            nvidia: Boolean(data.nvidia),
            deepseek: Boolean(data.deepseek),
            opencode_go: Boolean(data.opencode_go),
          })
        })
        .catch(() => {
          if (!cancelled) setSecretsStatus(null)
        })
    }
    poll()
    const interval = window.setInterval(poll, 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [enabled, settings.ttsBaseUrl])

  const anyKeyRegistered =
    secretsStatus &&
    (secretsStatus.openrouter ||
      secretsStatus.runware ||
      secretsStatus.nvidia ||
      secretsStatus.deepseek ||
      secretsStatus.opencode_go)

  const copyUrl = async () => {
    if (!lanUrl) return
    try {
      await navigator.clipboard.writeText(lanUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="bg-void-black/50 border border-neon-cyan/25 p-4 rounded space-y-3">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-neon-cyan"
          checked={enabled}
          onChange={(e) =>
            setSettings((s) => ({ ...s, lanWebAccessEnabled: e.target.checked }))
          }
        />
        <span>
          <span className="text-xs font-mono text-neon-cyan uppercase tracking-wider">
            LAN_WEB_ACCESS
          </span>
          <span className="mt-1 block text-xs text-void-dim leading-relaxed">
            Allow phone/tablet chat on your home network (or Tailscale). When on, cloud API keys
            are forwarded to the local server for the proxy — never embedded in the phone
            browser. Prefer the same Wi‑Fi / VPN; do not port-forward 8765 to the public internet.
          </span>
        </span>
      </label>

      {enabled && (
        <div className="border-t border-void-muted/25 pt-3 space-y-3">
          <p className="text-xs text-void-dim leading-relaxed">
            Scan the QR code or open the URL on your phone. Keep this desktop app running so keys
            stay registered on the local server.
          </p>

          {lanError && !selectedIp ? (
            <p className="text-xs text-neon-yellow/90">{lanError}</p>
          ) : (
            <div className="flex flex-wrap items-start gap-4">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={`QR code for ${lanUrl}`}
                  className="w-[200px] h-[200px] rounded border border-void-muted/40 bg-white"
                />
              ) : (
                <div className="w-[200px] h-[200px] rounded border border-void-muted/40 bg-void-black/60 flex items-center justify-center text-[10px] text-void-dim font-mono">
                  QR…
                </div>
              )}
              <div className="flex-1 min-w-[14rem] space-y-2">
                {ips.length > 1 && (
                  <div>
                    <label className="form-label text-void-dim">
                      <span className="mr-2">▸</span>NETWORK_INTERFACE
                    </label>
                    <select
                      className="cyber-input mt-1"
                      value={selectedIp}
                      onChange={(e) => setSelectedIp(e.target.value)}
                    >
                      {ips.map((ip) => (
                        <option key={ip} value={ip}>
                          {ip}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="form-label text-void-dim">
                    <span className="mr-2">▸</span>PHONE_URL
                  </label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    <input
                      type="text"
                      readOnly
                      className="cyber-input flex-1 min-w-[12rem] opacity-90 font-mono text-xs"
                      value={lanUrl}
                    />
                    <button type="button" className="cyber-btn text-xs" onClick={() => void copyUrl()}>
                      {copied ? 'COPIED' : 'COPY'}
                    </button>
                    <button type="button" className="cyber-btn text-xs" onClick={() => void refreshIps()}>
                      REFRESH
                    </button>
                  </div>
                </div>
                <p className="text-[10px] font-mono text-void-dim">
                  {secretsStatus == null
                    ? 'Keys status: unreachable (is the local server running?)'
                    : anyKeyRegistered
                      ? 'Keys registered on local server ✓'
                      : 'Waiting for keys… (enter API keys below)'}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
