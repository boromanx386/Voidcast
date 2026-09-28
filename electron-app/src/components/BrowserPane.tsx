import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Coding panel WEB mode — the Voidcast browser.
 *
 * The page itself is a native `WebContentsView` owned by the main process (the
 * SAME view agent `browser_*` tools drive over CDP), so it is drawn ABOVE the
 * DOM. This component only:
 *  - keeps the native view sized/positioned over its host div (ResizeObserver →
 *    IPC; a native view does not move with CSS), and
 *  - renders the chrome above it (URL bar, history, reload, screenshot).
 *
 * Hiding on unmount is what keeps the view from floating over the rest of the UI.
 */

type BrowserPaneProps = {
  projectPath?: string
}

type BrowserState = 'offline' | 'idle' | 'ready' | 'error'

const STATUS_POLL_MS = 1500

export function BrowserPane({ projectPath }: BrowserPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef(0)
  const urlFocusedRef = useRef(false)
  const [draft, setDraft] = useState('')
  const [url, setUrl] = useState('')
  const [state, setState] = useState<BrowserState>(() =>
    typeof window !== 'undefined' && window.voidcast?.browser ? 'idle' : 'offline',
  )
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Main-process view state — so "why is nothing rendering" is answerable at a glance. */
  const [diag, setDiag] = useState('')
  /** False while main reports the native view is parked off-screen (see the warning block). */
  const [painted, setPainted] = useState(true)
  /** Pages open in the browser — the panel only ever paints the active one. */
  const [pages, setPages] = useState<
    { id: string; url: string; title: string; active: boolean }[]
  >([])

  const browserApi = () => (typeof window !== 'undefined' ? window.voidcast?.browser : undefined)

  const pushBounds = useCallback(() => {
    const api = browserApi()
    const el = hostRef.current
    if (!api || !el) return
    const rect = el.getBoundingClientRect()
    void api.setBounds({
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    })
  }, [])

  const scheduleBounds = useCallback(() => {
    cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(pushBounds)
  }, [pushBounds])

  // Keep the native view glued to the host rect + hide it when WEB mode closes.
  useEffect(() => {
    const api = browserApi()
    const el = hostRef.current
    if (!api || !el) return
    const observer = new ResizeObserver(scheduleBounds)
    observer.observe(el)
    window.addEventListener('resize', scheduleBounds)
    scheduleBounds()
    // Payload shape matters: the bridge contract is { visible }. A bare boolean reads
    // as `undefined` in main and silently kept the native view parked off-screen.
    void api.setVisible({ visible: true })
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', scheduleBounds)
      cancelAnimationFrame(frameRef.current)
      void api.setVisible({ visible: false })
    }
  }, [scheduleBounds])

  const refreshStatus = useCallback(async () => {
    const api = browserApi()
    if (!api) return
    // Re-assert geometry on every poll: a native view does not follow CSS, and one
    // missed resize would otherwise leave it parked off-screen for good.
    pushBounds()
    const res = await api.status()
    if (!res.ok) {
      setState('error')
      setDiag(res.error ?? 'status failed')
      return
    }
    setState(res.attached ? 'ready' : res.state === 'error' ? 'error' : 'idle')
    setUrl(res.url)
    setDiag(
      `${res.bounds.width}×${res.bounds.height} viewport · panel rect ${
        res.panelRect ? 'set' : 'missing'
      }`,
    )
    setPainted(Boolean(res.visible))
    setPages(res.pages ?? [])
    if (!urlFocusedRef.current && res.url && res.url !== 'about:blank') setDraft(res.url)
  }, [pushBounds])

  useEffect(() => {
    if (state === 'offline') return
    void refreshStatus()
    const timer = setInterval(() => void refreshStatus(), STATUS_POLL_MS)
    return () => clearInterval(timer)
  }, [refreshStatus, state])

  const run = useCallback(async (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true)
    try {
      const res = await fn()
      setMessage(res.ok ? null : `${label}: ${res.error ?? 'failed'}`)
      await refreshStatus()
    } catch (e) {
      setMessage(`${label}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [refreshStatus])

  const onNavigate = useCallback(() => {
    const target = draft.trim()
    if (!target) return
    const api = browserApi()
    if (!api) return
    setMessage(null)
    void run('Navigate', () => api.navigate({ url: target, projectPath: projectPath || undefined }))
  }, [draft, projectPath, run])

  const onScreenshot = useCallback(() => {
    const api = browserApi()
    if (!api) return
    void run('Screenshot', async () => {
      const res = await api.screenshot({ projectPath: projectPath || undefined })
      if (res.ok) {
        setMessage(
          `Saved ${res.relativePath ?? res.path} (${res.bytes} bytes) — ask the agent to look at it with image_recall.`,
        )
      }
      return res
    })
  }, [projectPath, run])

  const dotClass =
    state === 'ready'
      ? 'bg-neon-cyan'
      : state === 'error'
        ? 'bg-red-400'
        : state === 'offline'
          ? 'bg-void-dim/60'
          : 'bg-void-dim/40'
  const stateLabel =
    state === 'ready' ? 'LIVE' : state === 'error' ? 'ERROR' : state === 'offline' ? 'DESKTOP APP ONLY' : 'IDLE'

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 pb-1.5">
        <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-void-dim">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden />
          {stateLabel}
        </span>
        {pages.length > 1 ? (
          <>
            <select
              className="max-w-[190px] rounded border border-void-muted/50 bg-transparent px-1 py-0.5 font-mono text-[10px] text-void-dim hover:border-void-dim"
              title="Pages open in the Voidcast browser — the panel shows the current one"
              value={pages.find((p) => p.active)?.id ?? ''}
              onChange={(e) => {
                const pageId = e.target.value
                const api = browserApi()
                if (api && pageId) void run('Select page', () => api.selectPage({ pageId }))
              }}
            >
              {pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {`${p.id} ${p.title || p.url || 'about:blank'}`.slice(0, 48)}
                </option>
              ))}
            </select>
            <span className="font-mono text-[10px] text-void-dim/70">
              {pages.findIndex((p) => p.active) + 1}/{pages.length}
            </span>
          </>
        ) : null}
        <button
          type="button"
          className="rounded border border-void-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-void-dim hover:border-void-dim hover:text-void-text disabled:opacity-40"
          title="Back"
          disabled={state !== 'ready' || busy}
          onClick={() => {
            const api = browserApi()
            if (api) void run('Back', () => api.back())
          }}
        >
          ←
        </button>
        <button
          type="button"
          className="rounded border border-void-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-void-dim hover:border-void-dim hover:text-void-text disabled:opacity-40"
          title="Forward"
          disabled={state !== 'ready' || busy}
          onClick={() => {
            const api = browserApi()
            if (api) void run('Forward', () => api.forward())
          }}
        >
          →
        </button>
        <button
          type="button"
          className="rounded border border-void-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-void-dim hover:border-void-dim hover:text-void-text disabled:opacity-40"
          title="Reload"
          disabled={state !== 'ready' || busy}
          onClick={() => {
            const api = browserApi()
            if (api) void run('Reload', () => api.reload())
          }}
        >
          ⟳
        </button>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => {
            urlFocusedRef.current = true
          }}
          onBlur={() => {
            urlFocusedRef.current = false
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onNavigate()
            }
          }}
          placeholder="https://localhost:5173"
          title="Enter: open in the Voidcast browser (same view the agent drives)"
          disabled={state === 'offline'}
          className="cyber-input min-w-0 flex-1 px-2 py-0.5 text-[11px]"
        />
        <button
          type="button"
          className="cyber-btn px-2 py-0.5 text-[10px] disabled:opacity-40"
          disabled={state === 'offline' || busy || !draft.trim()}
          onClick={onNavigate}
        >
          GO
        </button>
        <button
          type="button"
          className="rounded border border-void-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-void-dim hover:border-void-dim hover:text-void-text disabled:opacity-40"
          title="Capture viewport as JPEG into the coding project (agent can read it with image_recall)"
          disabled={state === 'offline' || busy || state !== 'ready'}
          onClick={onScreenshot}
        >
          SHOT
        </button>
        <button
          type="button"
          className="rounded border border-void-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-void-dim hover:border-void-dim hover:text-void-text disabled:opacity-40"
          title="Open the current URL in the system browser"
          disabled={state === 'offline' || !url || url === 'about:blank'}
          onClick={() => {
            const api = browserApi()
            if (api) void api.openExternal({ url })
          }}
        >
          ↗
        </button>
      </div>

      {message ? (
        <div className="shrink-0 pb-1 font-mono text-[10px] text-void-dim break-all">{message}</div>
      ) : null}

      {/* The native browser view is drawn over this rect; the hint shows only until it exists. */}
      <div
        ref={hostRef}
        className="relative min-h-0 flex-1 overflow-hidden rounded border border-void-muted/40 bg-void-black/40"
      >
        {state === 'ready' && !painted ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center font-mono text-[11px] text-amber-300">
            <span className="uppercase tracking-wide">View not on screen</span>
            <span className="text-void-dim">
              The browser process is running, but the main process reports it is parked.
            </span>
            <span className="break-all text-void-dim/70">{diag || '(no diagnostics)'}</span>
          </div>
        ) : null}
        {state !== 'ready' ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center font-mono text-[11px] text-void-dim">
            {state === 'offline' ? (
              <span>The Voidcast browser runs in the Electron desktop app only.</span>
            ) : (
              <>
                <span className="text-void-light">VOIDCAST BROWSER</span>
                <span>Open a URL above (or let the agent call browser_navigate_page).</span>
                <span className="text-void-dim/70">
                  The agent drives this exact view — you can watch it and take over anytime.
                </span>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
