import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import QRCode from 'qrcode'
import { isElectron } from '@/lib/platform'
import type { LanSyncState } from '@/lib/cloudSecrets'
import type { AppSettings } from '@/lib/settings'

type Props = {
  lanSync: LanSyncState
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
}

function pickPreferredIp(ips: string[]): string {
  const wifi = ips.find(
    (ip) => ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.'),
  )
  return wifi ?? ips[0] ?? ''
}

export function LanWebAccessPanel({ lanSync, settings, setSettings }: Props) {
  const enabled = settings.lanWebAccessEnabled
  const [ips, setIps] = useState<string[]>([])
  const [selectedIp, setSelectedIp] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [lanError, setLanError] = useState<string | null>(null)
  const pairing = lanSync.pairing
  const lanUrl =
    enabled && selectedIp && pairing
      ? `http://${selectedIp}:${pairing.port}/?t=${encodeURIComponent(pairing.token)}`
      : ''

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
      setLanError(
        list.length === 0 ? 'No LAN address found — check Wi‑Fi or VPN (Tailscale).' : null,
      )
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
    void QRCode.toDataURL(lanUrl, {
      width: 200,
      margin: 1,
      color: { dark: '#0a0a0a', light: '#ffffff' },
    })
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
          onChange={(e) => setSettings((s) => ({ ...s, lanWebAccessEnabled: e.target.checked }))}
        />
        <span>
          <span className="text-xs font-mono text-neon-cyan uppercase tracking-wider">
            LAN_WEB_ACCESS
          </span>
          <span className="mt-1 block text-xs text-void-dim leading-relaxed">
            Allow phone/tablet chat on your home network (or Tailscale). When on, cloud API keys are
            forwarded to the local server for the proxy — never embedded in the phone browser.
            Prefer the same Wi‑Fi / VPN; do not port-forward 8765 to the public internet.
          </span>
        </span>
      </label>

      {lanSync.error && (
        <p role="alert" className="text-xs text-neon-yellow">
          The tools server has not confirmed this LAN setting. Retrying…
        </p>
      )}
      {enabled && (
        <div className="border-t border-void-muted/25 pt-3 space-y-3">
          <p className="text-xs text-void-dim leading-relaxed">
            Scan the QR code or open the URL on your phone. Keep this desktop app running so keys
            stay registered on the local server. The URL carries a shared access token the phone
            sends on every request (then strips from the address bar) so the LAN server only serves
            authenticated clients.
          </p>
          <p className="text-[10px] font-mono text-void-dim">
            NOTE: the token is transmitted over plain HTTP on your LAN (no TLS). Anyone already on
            the same network can sniff it — the same trust boundary as the rest of this no-TLS
            server. Don't port-forward 8765; TLS is out of scope for now.
          </p>

          {lanError && !selectedIp ? (
            <p className="text-xs text-neon-yellow/90">{lanError}</p>
          ) : (
            <div className="flex flex-wrap items-start gap-4">
              {lanUrl && qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="Scan to pair your phone"
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
                    <button
                      type="button"
                      className="cyber-btn text-xs"
                      disabled={!lanUrl}
                      onClick={() => void copyUrl()}
                    >
                      {copied ? 'COPIED' : 'COPY'}
                    </button>
                    <button
                      type="button"
                      className="cyber-btn text-xs"
                      onClick={() => void refreshIps()}
                    >
                      REFRESH
                    </button>
                  </div>
                </div>
                <p className="text-[10px] font-mono text-void-dim">
                  {!pairing
                    ? 'Waiting for the tools server…'
                    : pairing.keysAvailable
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
