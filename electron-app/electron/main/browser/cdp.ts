import type { WebContents } from 'electron'

/**
 * In-process CDP client for the Voidcast browser view.
 *
 * The view is driven through `webContents.debugger` (a real DevTools protocol
 * session on our own Chromium), so clicks and typing are TRUSTED input events —
 * React/Vue apps react to them exactly as they would to a real user, which
 * synthetic `element.click()` calls via executeJavaScript would not achieve.
 *
 * All rules below come from a spike on Electron 33 / Chromium 130:
 *  - a command sent before the view's first navigation never resolves (no target)
 *    → the caller must load a page before attaching; every command still gets a
 *    timeout so a stall surfaces as an error instead of hanging the agent loop
 *  - the first Input dispatch cost 5.2s cold, later ones ~180ms → warm-up
 *  - Page.captureScreenshot waits for a compositor frame: ~67ms while the view is
 *    visible, but ~3.9s while it is hidden — and >20s (timeout) on an animated
 *    page. Wrapping every capture in Page.startScreencast forces frames and brings
 *    it back to ~50ms in BOTH states, so screenshots no longer depend on whether
 *    the WEB panel happens to be on screen (spike #3)
 */

/** Watchdog for ordinary CDP commands. A hung command never rejects on its own. */
const DEFAULT_TIMEOUT_MS = 8000
/**
 * Screenshot budget. With forced frames a capture takes ~50ms, but the watchdog
 * stays generous: without the screencast the same call can take seconds and a
 * timeout must never look like a hung agent loop.
 */
export const SCREENSHOT_TIMEOUT_MS = 20000
/** Chromium refuses very tall surfaces — full-page shots are clamped to this. */
const MAX_FULL_PAGE_HEIGHT_PX = 16000

/** A region in CDP page (document) coordinates — what `Page.captureScreenshot` clip wants. */
export type ClipRect = { x: number; y: number; width: number; height: number }

const MAX_BUFFER = 200
const MAX_TEXT_LEN = 160
const DEFAULT_MAX_NODES = 400

/** Roles with no actionable meaning — dropped from snapshots to save context. */
const SKIP_ROLES = new Set([
  'none',
  'generic',
  'InlineTextBox',
  'StaticText',
  'LineBreak',
  'presentation',
  'ignored',
])

export type CdpSnapshotNode = {
  uid: string
  role: string
  name: string
  backendDOMNodeId?: number
}

type CdpMessageParams = Record<string, unknown>

/** Trim + collapse whitespace + cap length in one place (snapshot lines must stay small). */
function compact(raw: unknown, max = MAX_TEXT_LEN): string {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function quote(raw: string): string {
  return raw.replace(/"/g, "'")
}

function formatSnapshotLine(entry: CdpSnapshotNode, node: CdpMessageParams): string {
  const props = new Map<string, unknown>()
  for (const p of (node.properties as { name?: string; value?: { value?: unknown } }[] | undefined) ?? []) {
    props.set(String(p?.name ?? ''), p?.value?.value)
  }
  const flags: string[] = []
  if (props.get('disabled')) flags.push('[disabled]')
  const checked = props.get('checked')
  if (checked && checked !== 'false') flags.push('[checked]')
  if (props.get('focused')) flags.push('[focused]')
  const expanded = props.get('expanded')
  if (expanded === true || expanded === 'true') flags.push('[expanded]')

  const value = compact((node.value as { value?: unknown } | undefined)?.value)
  const parts = [entry.uid, entry.role]
  if (entry.name) parts.push(`name="${quote(entry.name)}"`)
  if (value) parts.push(`value="${quote(value)}"`)
  if (flags.length) parts.push(flags.join(''))
  return parts.join(' ')
}

const KEY_TABLE: Record<string, { code: string; vk: number; text?: string }> = {
  Enter: { code: 'Enter', vk: 13, text: '\r' },
  Tab: { code: 'Tab', vk: 9 },
  Escape: { code: 'Escape', vk: 27 },
  Backspace: { code: 'Backspace', vk: 8 },
  Delete: { code: 'Delete', vk: 46 },
  ArrowDown: { code: 'ArrowDown', vk: 40 },
  ArrowUp: { code: 'ArrowUp', vk: 38 },
  ArrowLeft: { code: 'ArrowLeft', vk: 37 },
  ArrowRight: { code: 'ArrowRight', vk: 39 },
  Home: { code: 'Home', vk: 36 },
  End: { code: 'End', vk: 35 },
  PageUp: { code: 'PageUp', vk: 33 },
  PageDown: { code: 'PageDown', vk: 34 },
  Space: { code: 'Space', vk: 32, text: ' ' },
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class CdpSession {
  private readonly wc: WebContents
  private attached = false
  private uidMap = new Map<string, CdpSnapshotNode>()
  private consoleLines: string[] = []
  private requestLines: string[] = []
  private pendingRequests = new Map<string, { method: string; url: string }>()
  private screencastFrames = 0
  /** Requests without a response yet — browser_wait_for's networkIdle is this hitting 0. */
  private inflightRequests = 0
  private dialogPolicy: { accept: boolean; promptText?: string } = { accept: true }
  private dialogs: string[] = []

  constructor(wc: WebContents) {
    this.wc = wc
  }

  get isAttached(): boolean {
    try {
      return this.attached && this.wc.debugger.isAttached()
    } catch {
      return false
    }
  }

  /** Attach + enable the domains the browser tools need, then warm up input. */
  async attach(): Promise<void> {
    if (this.isAttached) return
    try {
      this.wc.debugger.attach('1.3')
    } catch (e) {
      // "Debugger is already attached" happens when DevTools was opened by hand.
      if (!/already attached/i.test(String(e))) throw e
    }
    this.attached = true
    this.wc.debugger.on('message', this.onDebuggerMessage)
    for (const domain of ['Page', 'Runtime', 'Accessibility', 'Network', 'Log', 'DOM']) {
      await this.send(`${domain}.enable`, {})
    }
    // Cold-start warm-up (5.2s first dispatch → ~180ms afterwards). Fire and forget.
    void this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 }).catch(() => {})
  }

  detach(): void {
    if (!this.attached) return
    this.attached = false
    try {
      this.wc.debugger.removeListener('message', this.onDebuggerMessage)
    } catch {
      /* listener already gone */
    }
    try {
      if (this.wc.debugger.isAttached()) this.wc.debugger.detach()
    } catch {
      /* detach is best effort — Electron crashes in main if destroy runs first */
    }
  }

  send<T = unknown>(
    method: string,
    params?: CdpMessageParams,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    if (!this.isAttached) {
      return Promise.reject(new Error('Voidcast browser debugger is not attached.'))
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`CDP timeout after ${timeoutMs}ms: ${method}`)),
        timeoutMs,
      )
      this.wc.debugger.sendCommand(method, params ?? {}).then(
        (res) => {
          clearTimeout(timer)
          resolve(res as T)
        },
        (err) => {
          clearTimeout(timer)
          reject(err instanceof Error ? err : new Error(String(err)))
        },
      )
    })
  }

  private onDebuggerMessage = (_event: unknown, method: string, params: CdpMessageParams): void => {
    switch (method) {
      case 'Runtime.consoleAPICalled': {
        const args = ((params.args as { value?: unknown; description?: unknown; type?: unknown }[]) ?? [])
          .map((a) => a?.value ?? a?.description ?? a?.type ?? '')
          .join(' ')
        this.pushConsole(`${compact(params.type ?? 'log')}: ${args}`)
        break
      }
      case 'Log.entryAdded': {
        const entry = (params.entry as { level?: unknown; text?: unknown } | undefined) ?? {}
        this.pushConsole(`${compact(entry.level ?? 'log')}: ${String(entry.text ?? '')}`)
        break
      }
      case 'Network.requestWillBeSent': {
        const req = (params.request as { method?: unknown; url?: unknown } | undefined) ?? {}
        this.pendingRequests.set(String(params.requestId ?? ''), {
          method: compact(req.method ?? 'GET', 12),
          url: String(req.url ?? ''),
        })
        this.inflightRequests += 1
        break
      }
      case 'Network.responseReceived': {
        const id = String(params.requestId ?? '')
        const pending = this.pendingRequests.get(id)
        const res = (params.response as { status?: unknown; url?: unknown } | undefined) ?? {}
        this.pushRequest(
          `${pending?.method ?? 'GET'} ${compact(res.status ?? '?', 8)} ${String(res.url ?? pending?.url ?? '')}`,
        )
        this.pendingRequests.delete(id)
        this.inflightRequests = Math.max(0, this.inflightRequests - 1)
        break
      }
      case 'Network.loadingFailed': {
        const id = String(params.requestId ?? '')
        const pending = this.pendingRequests.get(id)
        this.pushRequest(`FAILED ${pending?.url ?? ''} (${compact(params.errorText ?? 'error')})`)
        this.pendingRequests.delete(id)
        this.inflightRequests = Math.max(0, this.inflightRequests - 1)
        break
      }
      case 'Page.javascriptDialogOpening': {
        const kind = compact(params.type ?? 'alert', 24)
        const message = compact(params.message ?? '')
        const policy = this.dialogPolicy
        const line = `dialog(${kind}) "${message}" — ${policy.accept ? 'accepted' : 'dismissed'}`
        this.dialogs.push(line)
        if (this.dialogs.length > 20) this.dialogs.shift()
        this.pushConsole(line)
        // An unanswered dialog blocks the renderer, and every later CDP command then
        // times out with no hint why. Dialogs are therefore always answered, per policy.
        const ack: Record<string, unknown> = { accept: policy.accept }
        if (policy.accept && policy.promptText !== undefined) ack.promptText = policy.promptText
        void this.send('Page.handleJavaScriptDialog', ack, 4000).catch(() => {})
        break
      }
      case 'Page.screencastFrame': {
        // Frames must be acked or the stream stalls — this is what unblocks
        // Page.captureScreenshot while the view is off-screen.
        this.screencastFrames += 1
        const sessionId = params.sessionId
        if (sessionId !== undefined) {
          void this.send('Page.screencastFrameAck', { sessionId }, 3000).catch(() => {})
        }
        break
      }
      default:
        break
    }
  }

  private pushConsole(line: string): void {
    // Electron injects its own security warnings into every page console.
    if (line.includes('Electron Security Warning')) return
    this.consoleLines.push(line)
    if (this.consoleLines.length > MAX_BUFFER) this.consoleLines.splice(0, this.consoleLines.length - MAX_BUFFER)
  }

  private pushRequest(line: string): void {
    this.requestLines.push(line)
    if (this.requestLines.length > MAX_BUFFER) this.requestLines.splice(0, this.requestLines.length - MAX_BUFFER)
  }

  /** `uid role name="..." value="..." [flags]` lines, interactive-first. */
  async snapshot(maxNodes = DEFAULT_MAX_NODES): Promise<string> {
    const res = await this.send<{ nodes?: CdpMessageParams[] }>('Accessibility.getFullAXTree', {})
    const nodes = res?.nodes ?? []
    const map = new Map<string, CdpSnapshotNode>()
    const lines: string[] = []
    for (const node of nodes) {
      if (lines.length >= maxNodes) break
      if (!node || node.ignored) continue
      const role = compact((node.role as { value?: unknown } | undefined)?.value, 40)
      if (!role || SKIP_ROLES.has(role)) continue
      const uid = String(node.nodeId ?? '')
      if (!uid) continue
      const entry: CdpSnapshotNode = {
        uid,
        role,
        name: compact((node.name as { value?: unknown } | undefined)?.value),
        backendDOMNodeId:
          typeof node.backendDOMNodeId === 'number' ? (node.backendDOMNodeId as number) : undefined,
      }
      map.set(uid, entry)
      lines.push(formatSnapshotLine(entry, node))
    }
    this.uidMap = map
    const head = [`url: ${this.wc.getURL() || 'about:blank'}`, `title: ${this.wc.getTitle()}`]
    const truncated =
      nodes.length > lines.length ? [`(truncated to ${lines.length} of ${nodes.length} nodes)`] : []
    return [...head, ...lines, ...truncated].join('\n')
  }

  private resolveUid(uid: string): CdpSnapshotNode {
    const entry = this.uidMap.get(uid)
    if (!entry) {
      throw new Error(`Unknown uid "${uid}" — call browser_take_snapshot first and use its uids.`)
    }
    if (typeof entry.backendDOMNodeId !== 'number') {
      throw new Error(`uid "${uid}" (${entry.role}) cannot be addressed — take a fresh snapshot.`)
    }
    return entry
  }

  /**
   * Border box of a snapshot uid, in viewport AND document coordinates.
   *
   * Two spike-#5 findings shape this: `model.content` is inset by padding (use
   * `model.border` — that is what a user sees and clicks), and the quad is in
   * VIEWPORT space while a screenshot clip needs DOCUMENT space.
   */
  private async elementBox(
    backendDOMNodeId: number,
    scrollIntoView: boolean,
  ): Promise<{ viewport: ClipRect; document: ClipRect }> {
    if (scrollIntoView) {
      // An element below the fold is not hit-testable — dispatching at its off-screen
      // coordinates silently does nothing at all, which reads to the agent as "the
      // click worked but the page did not react".
      await this.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: backendDOMNodeId }, 5000).catch(
        () => undefined,
      )
    }
    const box = await this.send<{ model?: { border?: number[]; content?: number[] } }>(
      'DOM.getBoxModel',
      { backendNodeId: backendDOMNodeId },
    )
    const quad = box?.model?.border ?? box?.model?.content
    if (!Array.isArray(quad) || quad.length < 8) {
      throw new Error('Element has no visible box — it may be hidden, detached or zero-sized.')
    }
    const xs = [quad[0], quad[2], quad[4], quad[6]]
    const ys = [quad[1], quad[3], quad[5], quad[7]]
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    const width = Math.max(...xs) - x
    const height = Math.max(...ys) - y
    if (width < 1 || height < 1) {
      throw new Error('Element has no visible size — it may be collapsed or clipped away.')
    }
    const scroll = await this.scrollOffset()
    return {
      viewport: { x, y, width, height },
      document: { x: x + scroll.x, y: y + scroll.y, width, height },
    }
  }

  private async scrollOffset(): Promise<{ x: number; y: number }> {
    const raw = String(
      await this.evaluate('JSON.stringify({ x: window.scrollX, y: window.scrollY })'),
    )
    try {
      const parsed = JSON.parse(raw) as { x?: number; y?: number }
      return { x: Number(parsed.x) || 0, y: Number(parsed.y) || 0 }
    } catch {
      return { x: 0, y: 0 }
    }
  }

  private async viewportSize(): Promise<string> {
    const raw = await this.evaluate('window.innerWidth + "x" + window.innerHeight')
    return compact(raw, 24) || 'unknown'
  }

  /** Document-space rect of a uid, ready to use as a screenshot clip. */
  async elementClip(uid: string): Promise<ClipRect> {
    const entry = this.resolveUid(uid)
    const { document: rect } = await this.elementBox(entry.backendDOMNodeId as number, true)
    return rect
  }

  async clickByUid(uid: string): Promise<string> {
    const entry = this.resolveUid(uid)
    // Scroll into view first — coordinates of an element below the fold hit nothing.
    const { viewport } = await this.elementBox(entry.backendDOMNodeId as number, true)
    const x = viewport.x + viewport.width / 2
    const y = viewport.y + viewport.height / 2
    const size = await this.viewportSize()
    const [vw, vh] = size.split('x').map((n) => Number(n) || 0)
    if (vw && vh && (x < 0 || y < 0 || x > vw || y > vh)) {
      throw new Error(
        `Element "${entry.name || entry.role}" sits outside the ${size} viewport even after scrolling.`,
      )
    }
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    })
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    })
    await delay(150)
    const title = await this.evaluate('document.title')
    return `Clicked ${entry.role} "${entry.name}" at (${Math.round(x)}, ${Math.round(y)}). Page title: ${compact(title)}`
  }

  async fillByUid(uid: string, text: string, submit = false): Promise<string> {
    const entry = this.resolveUid(uid)
    await this.send('DOM.focus', { backendNodeId: entry.backendDOMNodeId as number })
    await this.send('Input.insertText', { text })
    if (submit) await this.pressKey('Enter')
    await delay(120)
    const value = await this.evaluate(
      'document.activeElement && "value" in document.activeElement ? String(document.activeElement.value) : ""',
    )
    return `Filled ${entry.role} "${entry.name}" — current value: "${compact(value)}"`
  }

  async pressKey(rawKey: string): Promise<string> {
    const known = KEY_TABLE[rawKey]
    const single = rawKey.length === 1
    const spec = known ?? {
      code: single ? `Key${rawKey.toUpperCase()}` : rawKey,
      vk: single ? rawKey.toUpperCase().charCodeAt(0) : 0,
      text: single ? rawKey : undefined,
    }
    const base = {
      key: known ? rawKey : single ? rawKey : rawKey,
      code: spec.code,
      windowsVirtualKeyCode: spec.vk,
      nativeVirtualKeyCode: spec.vk,
    }
    await this.send('Input.dispatchKeyEvent', {
      type: spec.text ? 'keyDown' : 'rawKeyDown',
      ...base,
      ...(spec.text ? { text: spec.text, unmodifiedText: spec.text } : {}),
    })
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      ...base,
    })
    await delay(80)
    return `Pressed key "${rawKey}".`
  }

  /** Frames received from the forced screencast — a liveness signal in diagnostics. */
  get screencastFrameCount(): number {
    return this.screencastFrames
  }

  /**
   * Run `fn` while a screencast keeps the compositor producing frames.
   *
   * A hidden view paints rarely, so `Page.captureScreenshot` can wait seconds for
   * a frame (spike #3: 3.9s hidden vs 67ms visible on a static page; >20s on an
   * animated one). The screencast is an accelerator only — if it fails, the capture
   * still runs and simply keeps the slow path.
   */
  private async withForcedFrames<T>(fn: () => Promise<T>): Promise<T> {
    let started = false
    try {
      await this.send(
        'Page.startScreencast',
        { format: 'jpeg', quality: 30, maxWidth: 1600, maxHeight: 1200, everyNthFrame: 1 },
        5000,
      )
      started = true
    } catch {
      /* fall through to the plain capture */
    }
    try {
      if (started) await this.waitForFrames(2, 400)
      return await fn()
    } finally {
      if (started) {
        try {
          await this.send('Page.stopScreencast', {}, 3000)
        } catch {
          /* best effort */
        }
      }
    }
  }

  private waitForFrames(min: number, timeoutMs: number): Promise<void> {
    const target = this.screencastFrames + min
    const deadline = Date.now() + timeoutMs
    return new Promise((resolve) => {
      const tick = (): void => {
        if (this.screencastFrames >= target || Date.now() >= deadline) {
          resolve()
          return
        }
        setTimeout(tick, 25)
      }
      tick()
    })
  }

  /**
   * JPEG bytes of a region of the page — the viewport by default, one element's box or
   * the whole document on request.
   *
   * Frames are forced (see `withForcedFrames`), so this never depends on the view being
   * on screen, and clip-based captures work for elements below the fold (spike #5).
   */
  async screenshot(options: { clip?: ClipRect; fullPage?: boolean } = {}): Promise<{
    bytes: Buffer
    label: string
  }> {
    let clip = options.clip
    let label = 'viewport'
    if (options.fullPage) {
      const metrics = await this.send<{
        cssContentSize?: { width?: number; height?: number }
        contentSize?: { width?: number; height?: number }
      }>('Page.getLayoutMetrics', {})
      const css = metrics?.cssContentSize ?? metrics?.contentSize
      const width = Math.max(1, Math.round(Number(css?.width) || 0))
      const full = Math.max(1, Math.round(Number(css?.height) || 0))
      const height = Math.min(full, MAX_FULL_PAGE_HEIGHT_PX)
      clip = { x: 0, y: 0, width, height }
      label = full > height ? `full page (clamped to ${height}px of ${full}px)` : 'full page'
    } else if (clip) {
      label = 'element'
    }
    const params: Record<string, unknown> = { format: 'jpeg', quality: 70 }
    if (clip) {
      params.clip = { ...clip, scale: 1 }
      params.captureBeyondViewport = true
    }
    const res = await this.withForcedFrames(() =>
      this.send<{ data?: string }>('Page.captureScreenshot', params, SCREENSHOT_TIMEOUT_MS),
    )
    if (!res?.data) throw new Error('Page.captureScreenshot returned no data.')
    return { bytes: Buffer.from(res.data, 'base64'), label }
  }

  /**
   * Emulate a device viewport and/or a colour scheme for this page.
   *
   * Overrides are per page and survive until reset — the point is QA of responsive
   * layouts without opening a second browser. Verified in spike #5: a 390x844 /
   * dsf 3 override renders at 1170x2532 device pixels and dark mode flips
   * `prefers-color-scheme`.
   */
  async emulate(opts: {
    width?: number
    height?: number
    deviceScaleFactor?: number
    mobile?: boolean
    darkMode?: boolean
    reset?: boolean
  }): Promise<string> {
    if (opts.reset) {
      await this.send('Emulation.clearDeviceMetricsOverride', {}, 4000).catch(() => undefined)
      await this.send('Emulation.setEmulatedMedia', { features: [] }, 4000).catch(() => undefined)
      await delay(120)
      return `Emulation reset — layout viewport is back to ${await this.viewportSize()}.`
    }
    const parts: string[] = []
    if (opts.width || opts.height) {
      const width = Math.max(120, Math.round(opts.width ?? 390))
      const height = Math.max(120, Math.round(opts.height ?? 844))
      const dsf = Math.max(0.5, Number(opts.deviceScaleFactor) || 1)
      await this.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: dsf,
        mobile: Boolean(opts.mobile),
        screenWidth: width,
        screenHeight: height,
      })
      parts.push(`viewport ${width}x${height} (dsf ${dsf}${opts.mobile ? ', mobile' : ''})`)
    }
    if (opts.darkMode !== undefined) {
      await this.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: opts.darkMode ? 'dark' : 'light' }],
      })
      parts.push(`prefers-color-scheme: ${opts.darkMode ? 'dark' : 'light'}`)
    }
    if (!parts.length) {
      throw new Error('Nothing to emulate — pass width/height, dark_mode, or reset.')
    }
    await delay(150)
    return `Emulating ${parts.join(', ')}. Layout viewport is now ${await this.viewportSize()}. Screenshots will be scaled by the device scale factor.`
  }

  async evaluate(expression: string): Promise<unknown> {
    const res = await this.send<{ result?: { value?: unknown } }>('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    return res?.result?.value
  }

  consoleLogText(limit = 25): string {
    if (!this.consoleLines.length) return '(no console messages)'
    return this.consoleLines.slice(-limit).join('\n')
  }

  networkRequestText(limit = 25): string {
    if (!this.requestLines.length) return '(no network requests)'
    return this.requestLines.slice(-limit).join('\n')
  }

  /**
   * Wait until every requested condition holds.
   *
   * Polling rather than events: SPA route changes fire no navigation event, and the
   * whole point of this tool is to replace the guesswork (`press_key End` plus
   * sleeps) an agent otherwise falls back on.
   */
  async waitFor(opts: {
    selector?: string
    text?: string
    urlPattern?: string
    networkIdle?: boolean
    timeoutMs?: number
  }): Promise<string> {
    const timeoutMs = Math.max(250, opts.timeoutMs ?? 10000)
    const wanted: string[] = []
    if (opts.selector) wanted.push(`selector "${opts.selector}"`)
    if (opts.text) wanted.push(`text "${opts.text}"`)
    if (opts.urlPattern) wanted.push(`url ~ "${opts.urlPattern}"`)
    if (opts.networkIdle) wanted.push('network idle')
    const waitForReady = wanted.length === 0
    if (waitForReady) wanted.push('document ready')

    const selectorJs = opts.selector
      ? `!!document.querySelector(${JSON.stringify(opts.selector)})`
      : ''
    const textJs = opts.text
      ? `((document.body && document.body.innerText) || "").toLowerCase().includes(${JSON.stringify(
          opts.text.toLowerCase(),
        )})`
      : ''
    const started = Date.now()
    const deadline = started + timeoutMs
    let missing = wanted

    while (Date.now() < deadline) {
      missing = []
      if (selectorJs && (await this.evaluate(selectorJs)) !== true) {
        missing.push(`selector "${opts.selector}"`)
      }
      if (textJs && (await this.evaluate(textJs)) !== true) {
        missing.push(`text "${opts.text}"`)
      }
      if (
        opts.urlPattern &&
        !this.wc.getURL().toLowerCase().includes(opts.urlPattern.toLowerCase())
      ) {
        missing.push(`url ~ "${opts.urlPattern}"`)
      }
      if (opts.networkIdle && this.inflightRequests > 0) missing.push('network idle')
      if (waitForReady && (await this.evaluate('document.readyState')) !== 'complete') {
        missing.push('document ready')
      }
      if (!missing.length) {
        const took = Date.now() - started
        return `Waited ${took}ms — satisfied: ${wanted.join(', ')}. url: ${this.wc.getURL()}`
      }
      await delay(150)
    }
    throw new Error(
      `Timed out after ${timeoutMs}ms waiting for ${wanted.join(', ')}. Still missing: ${
        missing.join(', ') || 'unknown'
      }. url: ${this.wc.getURL()} — check browser_take_snapshot / browser_list_console_messages.`,
    )
  }

  /** Set how the NEXT JS dialog is answered (dialogs are never left open), and report recent ones. */
  async handleDialog(opts: { accept: boolean; promptText?: string }): Promise<string> {
    this.dialogPolicy = { accept: opts.accept, promptText: opts.promptText }
    const recent = this.dialogs.length ? ` Recent: ${this.dialogs.slice(-5).join(' | ')}` : ''
    return `Dialogs will now be ${opts.accept ? 'accepted' : 'dismissed'}${
      opts.promptText ? ` (prompt text "${opts.promptText}")` : ''
    }.${recent || ' No dialog has been shown yet.'}`
  }

  get uidCount(): number {
    return this.uidMap.size
  }
}
