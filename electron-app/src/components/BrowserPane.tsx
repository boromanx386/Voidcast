import { useCallback, useEffect, useRef, useState } from 'react'
import { hostContentRect, overlayCovers, sameRect, type Rect } from '@/lib/browserOverlay'

/**
 * Coding panel WEB mode — the Voidcast browser.
 *
 * The page itself is a native `WebContentsView` owned by the main process (the
 * SAME view agent `browser_*` tools drive over CDP), so it is drawn ABOVE the
 * DOM. This component only:
 *  - keeps the native view sized/positioned over its host div (per-frame check →
 *    IPC; a native view does not move with CSS),
 *  - swaps the view for a still frame while a DOM popup or modal overlaps it
 *    (see `lib/browserOverlay`), since nothing in the DOM can be drawn above it, and
 *  - renders the chrome above it (URL bar, history, reload, screenshot).
 *
 * Hiding on unmount is what keeps the view from floating over the rest of the UI.
 */

type BrowserPaneProps = {
  projectPath?: string
  /** '' = one profile per project, 'shared' = one app-wide, anything else = a named profile. */
  browserProfile?: string
}

type BrowserState = 'offline' | 'idle' | 'ready' | 'error'

const STATUS_POLL_MS = 1500

export function BrowserPane({ projectPath, browserProfile = '' }: BrowserPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const urlFocusedRef = useRef(false)
  const [draft, setDraft] = useState('')
  const [url, setUrl] = useState('')
  /** Chromium partition key main is actually using (shown in the header). */
  const [profile, setProfile] = useState('')
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
  const [pages, setPages] = useState<{ id: string; url: string; title: string; active: boolean }[]>(
    [],
  )
  /** Held HTTP auth request — the panel is the only place the user can answer it. */
  const [auth, setAuth] = useState<{
    id: string
    host: string
    realm: string
    url: string
    pageId: string
  } | null>(null)
  const [authUser, setAuthUser] = useState('')
  const [authPass, setAuthPass] = useState('')
  const [authRemember, setAuthRemember] = useState(true)
  /** Last denied permission / held sign-in reported by main. */
  const [notice, setNotice] = useState<string | null>(null)
  /** Last download routed into the project folder (never the OS Downloads folder). */
  const [download, setDownload] = useState<{
    name: string
    path: string
    state: string
  } | null>(null)
  const downloadsDirRef = useRef('')
  /** Which prompt the typed credentials belong to — a new one starts from empty fields. */
  const authIdRef = useRef('')

  const browserApi = () => (typeof window !== 'undefined' ? window.voidcast?.browser : undefined)

  /** Last rect pushed to main — the frame loop only sends a change. */
  const lastRectRef = useRef<Rect | null>(null)
  /** True while a DOM overlay overlaps the page and the native view is hidden. */
  const coveredRef = useRef(false)
  /** Bumped on every cover change, so a slow capture cannot act on a stale one. */
  const coverSeqRef = useRef(0)
  const [covered, setCovered] = useState(false)
  /** Still of the page, shown in place of the native view while it is hidden. */
  const [frozenFrame, setFrozenFrame] = useState<string | null>(null)

  const pushBounds = useCallback((force = false) => {
    const api = browserApi()
    const el = hostRef.current
    if (!api || !el) return
    const rect = hostContentRect(el)
    if (!force && sameRect(lastRectRef.current, rect)) return
    lastRectRef.current = rect
    void api.setBounds(rect)
  }, [])

  const applyCover = useCallback(async (next: boolean) => {
    const api = browserApi()
    if (!api) return
    coveredRef.current = next
    setCovered(next)
    const seq = ++coverSeqRef.current
    if (next) {
      // Capture before hiding: the overlay then opens over a still of the page rather than
      // over an empty panel.
      const res = await api.captureFrame().catch(() => null)
      if (seq !== coverSeqRef.current) return
      setFrozenFrame(res && res.ok ? res.dataUrl : null)
      void api.setVisible({ visible: false })
    } else {
      await api.setVisible({ visible: true })
      if (seq !== coverSeqRef.current) return
      // Drop the still only once the live view is back on top, so nothing flashes.
      setFrozenFrame(null)
    }
  }, [])

  // Keep the native view glued to the host rect, step aside for DOM overlays, and hide it
  // when WEB mode closes. A per-frame check because a native view follows neither CSS nor
  // layout: ResizeObserver misses pure moves (a sidebar or splitter shifting the panel), and
  // a popup must not open underneath the page for even one poll interval.
  useEffect(() => {
    const api = browserApi()
    const el = hostRef.current
    if (!api || !el) return
    let frame = 0
    const tick = () => {
      pushBounds()
      const next = overlayCovers(document, el, lastRectRef.current ?? hostContentRect(el))
      if (next !== coveredRef.current) void applyCover(next)
      frame = requestAnimationFrame(tick)
    }
    coveredRef.current = false
    lastRectRef.current = null
    // Payload shape matters: the bridge contract is { visible }. A bare boolean reads
    // as `undefined` in main and silently kept the native view parked off-screen.
    void api.setVisible({ visible: true })
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      // Orphan a capture still in flight so it cannot re-show the view after unmount.
      coverSeqRef.current += 1
      coveredRef.current = false
      void api.setVisible({ visible: false })
    }
  }, [applyCover, pushBounds])

  const refreshStatus = useCallback(async () => {
    const api = browserApi()
    if (!api) return
    // Re-assert geometry on every poll: the frame loop stops while the window is hidden,
    // and one missed update would otherwise leave the view parked off-screen for good.
    pushBounds(true)
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
    setProfile(res.profile ?? '')
    setPages(res.pages ?? [])
    const nextAuth = res.auth ?? null
    if ((nextAuth?.id ?? '') !== authIdRef.current) {
      // A different prompt (or none at all): never carry credentials across requests.
      authIdRef.current = nextAuth?.id ?? ''
      setAuthUser('')
      setAuthPass('')
      setAuthRemember(true)
    }
    setAuth(nextAuth)
    setNotice(res.notice ?? null)
    setDownload(res.download ?? null)
    downloadsDirRef.current = res.downloadsDir ?? ''
    if (!urlFocusedRef.current && res.url && res.url !== 'about:blank') setDraft(res.url)
  }, [pushBounds])

  useEffect(() => {
    if (state === 'offline') return
    void refreshStatus()
    const timer = setInterval(() => void refreshStatus(), STATUS_POLL_MS)
    return () => clearInterval(timer)
  }, [refreshStatus, state])

  const run = useCallback(
    async (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
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
    },
    [refreshStatus],
  )

  const onNavigate = useCallback(() => {
    const target = draft.trim()
    if (!target) return
    const api = browserApi()
    if (!api) return
    setMessage(null)
    void run('Navigate', () =>
      api.navigate({
        url: target,
        projectPath: projectPath || undefined,
        profile: browserProfile,
      }),
    )
  }, [browserProfile, draft, projectPath, run])

  const onScreenshot = useCallback(() => {
    const api = browserApi()
    if (!api) return
    void run('Screenshot', async () => {
      const res = await api.screenshot({
        projectPath: projectPath || undefined,
        profile: browserProfile,
      })
      if (res.ok) {
        setMessage(
          `Saved ${res.relativePath ?? res.path} (${res.bytes} bytes) — ask the agent to look at it with image_recall.`,
        )
      }
      return res
    })
  }, [browserProfile, projectPath, run])

  // Tell main which profile this panel wants BEFORE a page exists: a Chromium partition
  // is fixed once a page lives in it, so a project or profile switch resets the browser
  // instead of silently reusing the previous project's cookies.
  useEffect(() => {
    const api = browserApi()
    if (!api) return
    const timer = window.setTimeout(() => {
      void api
        .configure({ projectPath, profile: browserProfile })
        .then((res) => {
          if (res.ok && res.changed) setMessage(`Browser profile: ${res.profile}`)
        })
        .catch(() => undefined)
    }, 200)
    return () => window.clearTimeout(timer)
  }, [projectPath, browserProfile])

  const dotClass =
    state === 'ready'
      ? 'bg-neon-cyan'
      : state === 'error'
        ? 'bg-red-400'
        : state === 'offline'
          ? 'bg-void-dim/60'
          : 'bg-void-dim/40'
  const stateLabel =
    state === 'ready'
      ? 'LIVE'
      : state === 'error'
        ? 'ERROR'
        : state === 'offline'
          ? 'DESKTOP APP ONLY'
          : 'IDLE'

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 pb-1.5">
        <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-void-dim">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden />
          {stateLabel}
        </span>
        {profile ? (
          <span
            className="max-w-[130px] truncate font-mono text-[10px] text-void-dim/60"
            title={`Browser profile (Chromium partition): ${profile}`}
          >
            {profile}
          </span>
        ) : null}
        {pages.length > 1 ? (
          <>
            <select
              className="max-w-[190px] rounded border border-void-muted/50 bg-transparent px-1 py-0.5 font-mono text-[10px] text-void-dim hover:border-void-dim"
              title="Pages open in the Voidcast browser — the panel shows the current one"
              value={pages.find((p) => p.active)?.id ?? ''}
              onChange={(e) => {
                const pageId = e.target.value
                const api = browserApi()
                if (api && pageId) {
                  void run('Select page', () =>
                    api.selectPage({
                      pageId,
                      projectPath: projectPath || undefined,
                      profile: browserProfile,
                    }),
                  )
                }
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
          className="rounded border border-void-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-void-dim hover:border-red-400 hover:text-red-300"
          title="Clear cookies, storage and cache for this browser profile"
          onClick={() => {
            const api = browserApi()
            if (!api) return
            if (
              !window.confirm(
                `Clear cookies, storage and cache for browser profile "${profile || 'default'}"?\n\nThis logs you out of every site in this profile.`,
              )
            ) {
              return
            }
            void run('Clear data', () =>
              api.clearData({
                projectPath: projectPath || undefined,
                profile: browserProfile,
              }),
            )
          }}
        >
          CLR
        </button>
        <button
          type="button"
          className="rounded border border-void-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-void-dim hover:border-void-dim hover:text-void-text disabled:opacity-40"
          title="Back"
          disabled={state !== 'ready' || busy}
          onClick={() => {
            const api = browserApi()
            if (api) {
              void run('Back', () =>
                api.back({ projectPath: projectPath || undefined, profile: browserProfile }),
              )
            }
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
            if (api) {
              void run('Forward', () =>
                api.forward({ projectPath: projectPath || undefined, profile: browserProfile }),
              )
            }
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
            if (api) {
              void run('Reload', () =>
                api.reload({ projectPath: projectPath || undefined, profile: browserProfile }),
              )
            }
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
        <button
          type="button"
          className="rounded border border-void-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-void-dim hover:border-void-dim hover:text-void-text disabled:opacity-40"
          title={
            downloadsDirRef.current
              ? `Open the browser downloads folder: ${downloadsDirRef.current}`
              : 'Downloads folder — available once the browser is configured'
          }
          disabled={!downloadsDirRef.current}
          onClick={() => {
            const open = typeof window !== 'undefined' ? window.voidcast?.openPath : undefined
            if (open && downloadsDirRef.current) void open(downloadsDirRef.current)
          }}
        >
          ↓
        </button>
      </div>

      {message ? (
        <div className="shrink-0 pb-1 font-mono text-[10px] text-void-dim break-all">{message}</div>
      ) : null}

      {/* HTTP auth cannot be answered anywhere else: Chromium holds the page open until
          the user replies here. The agent never sees the password. */}
      {auth ? (
        <form
          className="mb-1 shrink-0 rounded border border-amber-400/40 bg-amber-400/5 p-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            const api = browserApi()
            if (!api || !auth) return
            void run('Sign in', async () => {
              const res = await api.authAnswer({
                id: auth.id,
                username: authUser,
                password: authPass,
                remember: authRemember,
              })
              if (res.ok) {
                setAuthPass('')
                setMessage(res.text)
              }
              return res
            })
          }}
        >
          <div className="pb-1 font-mono text-[10px] text-amber-300">
            {`${auth.host} requires HTTP authentication${
              auth.realm ? ` (realm "${auth.realm}")` : ''
            } — the page is waiting.`}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <input
              type="text"
              value={authUser}
              onChange={(e) => setAuthUser(e.target.value)}
              placeholder="user name"
              autoFocus
              className="cyber-input min-w-0 flex-1 px-2 py-0.5 text-[11px]"
            />
            <input
              type="password"
              value={authPass}
              onChange={(e) => setAuthPass(e.target.value)}
              placeholder="password"
              className="cyber-input min-w-0 flex-1 px-2 py-0.5 text-[11px]"
            />
            <label
              className="flex items-center gap-1 font-mono text-[10px] text-void-dim"
              title="Store it encrypted in the OS keychain, for this browser profile only"
            >
              <input
                type="checkbox"
                checked={authRemember}
                onChange={(e) => setAuthRemember(e.target.checked)}
              />
              remember
            </label>
            <button
              type="submit"
              className="cyber-btn px-2 py-0.5 text-[10px] disabled:opacity-40"
              disabled={busy || !authUser.trim()}
            >
              SIGN IN
            </button>
            <button
              type="button"
              className="rounded border border-void-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-void-dim hover:border-red-400 hover:text-red-300"
              title="Cancel the request — the site keeps answering 401"
              onClick={() => {
                const api = browserApi()
                if (api && auth)
                  void run('Cancel sign-in', () => api.authAnswer({ id: auth.id, cancel: true }))
              }}
            >
              CANCEL
            </button>
          </div>
        </form>
      ) : null}

      {notice ? (
        <div className="shrink-0 pb-1 font-mono text-[10px] text-amber-300/90 break-all">
          {notice}
        </div>
      ) : null}

      {download ? (
        <div
          className="shrink-0 pb-1 font-mono text-[10px] text-void-dim/80 break-all"
          title={
            downloadsDirRef.current ? `Downloads folder: ${downloadsDirRef.current}` : undefined
          }
        >
          {`download ${download.state}: ${download.name}`}
        </div>
      ) : null}

      {/* The native browser view is drawn over this rect; the hint shows only until it exists. */}
      <div
        ref={hostRef}
        className="relative min-h-0 flex-1 overflow-hidden rounded border border-void-muted/40 bg-void-black/40"
      >
        {frozenFrame ? (
          <img
            src={frozenFrame}
            alt=""
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full select-none"
          />
        ) : null}
        {state === 'ready' && !painted && !covered ? (
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
