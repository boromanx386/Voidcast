import { BrowserWindow, WebContentsView, nativeImage, session } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { CdpSession } from './cdp'

/**
 * Owns the Voidcast browser: one Chromium view per open page, inside our own window.
 *
 * The same browser the user sees in the coding panel WEB mode is the one the agent
 * drives, so there is no external Chrome dependency and no third-party CLI. Tabs
 * exist for the agent; the panel is a viewport onto the *current* page only — a
 * `WebContentsView` is bound to exactly one `webContents`, so one page = one view.
 *
 * Spike-derived rules baked in here:
 *  - per page: create → addChildView → hide → loadURL('about:blank') → wait → attach.
 *    Any CDP command sent before the first navigation hangs forever.
 *  - one long-lived view per page (never recreate); detach before close.
 *  - LAYOUT vs PAINT are separate: every page keeps a real viewport (parked pages are
 *    positioned off-screen but keep the panel's size) so a parked page still lays out
 *    correctly and switching tabs never reflows. Only the active page is painted, and
 *    only while the WEB panel asks for it, so it can never float over the rest of the UI.
 *  - screenshots force a compositor frame via Page.startScreencast, so they are fast
 *    whether the page is on screen or parked.
 */

export type BrowserRect = { x: number; y: number; width: number; height: number }

export type BrowserPageInfo = { id: string; url: string; title: string; active: boolean }

export type BrowserPage = {
  id: string
  view: WebContentsView
  cdp: CdpSession
  createdAt: number
}

const HOME_URL = 'about:blank'
const LOAD_TIMEOUT_MS = 25000
const MIN_RECT_PX = 8
/** Hard cap: every page is a live Chromium renderer (~40-100MB). */
const MAX_PAGES = 8
/** Viewport used before the WEB panel has ever pushed a rect. */
const FALLBACK_VIEWPORT = { width: 1280, height: 800 }
/** Parked position for the "laid out but not painted" state. */
const OFFSCREEN_ORIGIN = -20000
/** Surfaced when a page creation is overtaken by a profile switch or by shutdown. */
const PROFILE_CHANGED_MESSAGE =
  'The browser profile changed while the page was opening — the page was discarded. Retry the call.'

let ownerWindow: BrowserWindow | null = null
let pages: BrowserPage[] = []
let activeId: string | null = null
let pageSeq = 1
let creating: Promise<BrowserPage> | null = null
/**
 * Bumped whenever the partition changes (profile switch or shutdown). A page still being
 * created for the previous partition re-checks its epoch after every await, so a slow load
 * can never register the old project's session into the new profile.
 */
let profileEpoch = 0
let partitionKey = ''
/**
 * Browser profile selection from settings: '' means one profile per coding project,
 * 'shared' means one profile for the whole app, anything else is a named profile.
 */
let profileSetting = ''
/** True while the WEB panel is mounted and wants the current page painted. */
let visibleFlag = false
/** True once the renderer has pushed a usable panel rect at least once. */
let hasPanelRect = false
let panelRect: BrowserRect = { x: 0, y: 0, width: 0, height: 0 }
let lastError: string | null = null
let shuttingDown = false
let windowHooked = false
/** Browser state is global to the app; serialize operations from concurrent chat runs. */
let browserOperationTail = Promise.resolve()

export async function withBrowserLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = browserOperationTail
  let release!: () => void
  browserOperationTail = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await fn()
  } finally {
    release()
  }
}

function panelSizeKnown(): boolean {
  return hasPanelRect && panelRect.width >= MIN_RECT_PX && panelRect.height >= MIN_RECT_PX
}

/**
 * Parked pages keep the panel's viewport size once it is known. Parking them at the
 * fallback size instead would reflow every page on each tab switch.
 */
function parkedRect(): BrowserRect {
  if (panelSizeKnown()) {
    return {
      x: OFFSCREEN_ORIGIN,
      y: OFFSCREEN_ORIGIN,
      width: panelRect.width,
      height: panelRect.height,
    }
  }
  return {
    x: OFFSCREEN_ORIGIN,
    y: OFFSCREEN_ORIGIN,
    width: FALLBACK_VIEWPORT.width,
    height: FALLBACK_VIEWPORT.height,
  }
}

/**
 * Stable-ish partition key so a project keeps its cookies/logins between runs.
 *
 * The path is case-folded and stripped of a trailing separator on purpose: Windows paths
 * are case-insensitive, and two spellings of the same project must not resolve to two
 * partitions — that mismatch would look like a profile change on every other call and
 * close the user's pages each time.
 */
function sanitizePartitionKey(projectPath?: string): string {
  const raw = (projectPath ?? '').trim().replace(/[\\/]+$/, '').toLowerCase()
  if (!raw) return 'default'
  let hash = 0
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) | 0
  }
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-40)
  return `${slug || 'project'}-${(hash >>> 0).toString(36)}`
}

/** Resolve the partition key for the current profile setting + project path. */
function desiredProfileKey(projectPath?: string): string {
  const name = profileSetting.trim()
  if (!name) return sanitizePartitionKey(projectPath)
  if (name.toLowerCase() === 'shared') return sanitizePartitionKey('shared')
  return sanitizePartitionKey(`profile:${name}`)
}

function normalizeProfileSetting(profile: string | undefined): string {
  return typeof profile === 'string' ? profile.trim().slice(0, 60) : ''
}

/** Close every page — used when the profile changes, since pages cannot be re-partitioned. */
function closeAllPages(): void {
  for (const page of [...pages]) {
    try {
      closeBrowserPageUnsafe(page.id)
    } catch {
      /* already gone */
    }
  }
}

/**
 * Switch to the profile the panel asked for. Pages live inside their partition, so a
 * profile change closes them instead of silently carrying the wrong cookies.
 */
function applyProfile(projectPath?: string): { profile: string; changed: boolean } {
  const next = desiredProfileKey(projectPath)
  if (next === partitionKey) return { profile: partitionKey, changed: false }
  closeAllPages()
  partitionKey = next
  // A page creation still in flight was started against the previous partition: orphan it
  // (its epoch no longer matches) so its late completion cannot add an old-profile page to
  // the new profile, and so the next call starts a fresh page in the right partition.
  profileEpoch += 1
  creating = null
  lastError = null
  return { profile: partitionKey, changed: true }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      },
    )
  })
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('Missing URL.')
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  if (/^about:blank$/i.test(withScheme)) return withScheme
  if (!/^(https?|file):/i.test(withScheme)) {
    throw new Error(
      `Blocked URL scheme: ${withScheme.split(':')[0]}: — only http(s), file and about:blank are allowed.`,
    )
  }
  return withScheme
}

/**
 * Paint the active page on screen, park every other page off-screen. Pages are never
 * collapsed to 0x0 — a zero-size view lays the page out at 0px width and every
 * snapshot coordinate becomes a lie.
 */
function applyVisibility(): void {
  for (const page of pages) {
    const paint = !shuttingDown && visibleFlag && panelSizeKnown() && page.id === activeId
    try {
      page.view.setBounds(paint ? panelRect : parkedRect())
      if (typeof page.view.setVisible === 'function') page.view.setVisible(paint)
    } catch {
      /* view may already be destroyed during teardown */
    }
  }
}

async function loadInto(page: BrowserPage, url: string): Promise<string> {
  const target = normalizeUrl(url)
  try {
    await withTimeout(
      page.view.webContents.loadURL(target),
      LOAD_TIMEOUT_MS,
      `Timed out loading ${target}`,
    )
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    throw new Error(`Navigation failed for ${target}: ${detail}`)
  }
  return page.view.webContents.getURL()
}

function findPage(id: string): BrowserPage {
  const page = pages.find((p) => p.id === id)
  if (!page) throw new Error(`Unknown page "${id}" — call browser_list_pages to see the open pages.`)
  return page
}

/** Remove a page whose renderer died without going through the normal close path. */
function removeDeadPage(id: string, reason: string): void {
  const index = pages.findIndex((p) => p.id === id)
  if (index === -1) return
  const [page] = pages.splice(index, 1)
  try {
    page.cdp.detach()
  } catch {
    /* the renderer may already be gone */
  }
  if (ownerWindow && !ownerWindow.isDestroyed()) {
    try {
      ownerWindow.contentView.removeChildView(page.view)
    } catch {
      /* best effort during renderer/window teardown */
    }
  }
  try {
    if (!page.view.webContents.isDestroyed()) page.view.webContents.close()
  } catch {
    /* best effort */
  }
  if (activeId === id) {
    const neighbor = pages[Math.min(index, pages.length - 1)] ?? null
    activeId = neighbor ? neighbor.id : null
  }
  lastError = `Browser page ${id} was removed because its renderer exited (${reason}).`
  applyVisibility()
}

export function activeBrowserPage(): BrowserPage | null {
  if (!activeId) return null
  return pages.find((p) => p.id === activeId) ?? null
}

function pageSummary(page: BrowserPage): BrowserPageInfo {
  const destroyed = page.view.webContents.isDestroyed()
  return {
    id: page.id,
    url: destroyed ? '' : page.view.webContents.getURL(),
    title: destroyed ? '' : page.view.webContents.getTitle(),
    active: page.id === activeId,
  }
}

export function listBrowserPages(): {
  pages: BrowserPageInfo[]
  activeId: string | null
  text: string
} {
  const info = pages.map(pageSummary)
  const text = info.length
    ? info
        .map(
          (p) =>
            `${p.active ? '*' : ' '} ${p.id} ${p.title ? `"${p.title}" ` : ''}${
              p.url || 'about:blank'
            }`,
        )
        .join('\n')
    : '(no pages open)'
  return { pages: info, activeId, text }
}

/** Re-select the caller's profile without creating a page, then run a read-only query. */
export async function withBrowserContext<T>(
  win: BrowserWindow | null,
  projectPath: string | undefined,
  profile: string | undefined,
  fn: (page: BrowserPage | null) => T | Promise<T>,
): Promise<T> {
  return withBrowserLock(async () => {
    await ensureBrowser(win, projectPath, profile)
    return fn(activeBrowserPage())
  })
}

export async function listBrowserPagesForProject(
  win: BrowserWindow | null,
  projectPath: string | undefined,
  profile: string | undefined,
): Promise<ReturnType<typeof listBrowserPages>> {
  return withBrowserContext(win, projectPath, profile, () => listBrowserPages())
}

/**
 * Create (once) and return the shared browser window binding. No page is created.
 *
 * `authoritative` marks the panel's own entry points (configure / open page / history): the
 * panel is stating "this IS the current project and profile", so an empty project path
 * really means "no project" and the profile may reset to the default one. Agent calls pass
 * no flag, and a call whose project path is unknown never switches: a turn without a coding
 * project would otherwise resolve to the default profile, close the user's pages and flip
 * the session back and forth every time the project changes.
 */
async function ensureBrowser(
  win: BrowserWindow | null,
  projectPath?: string,
  profile?: string,
  authoritative = false,
): Promise<BrowserWindow> {
  const target =
    win && !win.isDestroyed()
      ? win
      : ownerWindow && !ownerWindow.isDestroyed()
        ? ownerWindow
        : null
  if (!target) {
    throw new Error(
      'Main window is not available — the Voidcast browser needs the desktop app window.',
    )
  }
  ownerWindow = target
  if (!windowHooked) {
    windowHooked = true
    target.once('closed', () => disposeBrowserView())
  }
  // A Chromium partition cannot be swapped on a live page, so the key is fixed once a page
  // exists. The WEB panel re-configures it when the project or the profile setting changes —
  // but the panel only exists while WEB mode is open, and the agent drives the same browser
  // without it. So every call that knows the project re-checks here: without this, switching
  // project with the panel closed kept the previous project's cookies and logins.
  if (profile !== undefined) profileSetting = normalizeProfileSetting(profile)
  const desired = desiredProfileKey(projectPath)
  if (!partitionKey) {
    partitionKey = desired
  } else if (desired !== partitionKey && (authoritative || projectPath || profileSetting)) {
    // A named/shared profile resolves without the path, and the panel may always state the
    // context explicitly. The agent path needs a real identity before it resets anything.
    applyProfile(projectPath)
  }
  return target
}

/**
 * Called by the WEB panel on mount and whenever the project or the browser profile
 * setting changes. Returns whether the profile actually changed (pages were reset).
 */
export async function configureBrowser(
  win: BrowserWindow | null,
  projectPath: string | undefined,
  profile: string | undefined,
): Promise<{ profile: string; changed: boolean }> {
  return withBrowserLock(async () => {
    const previous = partitionKey
    // The panel owns the context: it may state "no project", which resets to the default profile.
    await ensureBrowser(win, projectPath, profile, true)
    return { profile: partitionKey, changed: previous !== partitionKey }
  })
}

/** Wipe cookies/localStorage/IndexedDB/cache for the active profile (explicit user action). */
export async function clearBrowserData(
  win: BrowserWindow | null,
  projectPath: string | undefined,
  profile: string | undefined,
): Promise<string> {
  return withBrowserLock(async () => {
    await ensureBrowser(win, projectPath, profile)
    const target = session.fromPartition(`persist:voidcast-browser-${partitionKey}`)
    await target.clearStorageData()
    await target.clearCache()
    lastError = null
    return `Cleared cookies, storage and cache for profile "${partitionKey}". Already-open pages keep their in-memory state until they are reloaded.`
  })
}

async function newPageInWindow(
  win: BrowserWindow,
  url?: string,
  epoch = profileEpoch,
): Promise<BrowserPage> {
  const id = `p${pageSeq++}`
  const view = new WebContentsView({
    webPreferences: {
      partition: `persist:voidcast-browser-${partitionKey || 'default'}`,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  win.contentView.addChildView(view)
  view.setBounds(parkedRect())
  if (typeof view.setVisible === 'function') view.setVisible(false)

  view.webContents.setWindowOpenHandler(({ url: target }) => {
    // target=_blank / window.open stay inside the Voidcast browser (never the system
    // browser), so the flow keeps running in the panel and the agent can drive it.
    if (/^https?:/i.test(target)) void openPopup(target).catch(() => undefined)
    return { action: 'deny' }
  })

  // detach() before close (Electron crashes in main if the debugger outlives the view).
  const discard = (): void => {
    try {
      win.contentView.removeChildView(view)
    } catch {
      /* window or view already gone */
    }
    try {
      if (!view.webContents.isDestroyed()) view.webContents.close()
    } catch {
      /* best effort */
    }
  }

  let cdp: CdpSession | null = null
  try {
    // SPIKE RULE: the view must have navigated at least once before any CDP command,
    // otherwise every command waits for a target that never appears.
    await withTimeout(
      view.webContents.loadURL(HOME_URL),
      15000,
      'Timed out bootstrapping the Voidcast browser page.',
    )

    cdp = new CdpSession(view.webContents)
    await cdp.attach()
    // The partition cannot be re-assigned, so a view booted for a partition that is no
    // longer current must never enter `pages` — that is how an old profile's session used
    // to leak into a newly selected project.
    if (shuttingDown || epoch !== profileEpoch) throw new Error(PROFILE_CHANGED_MESSAGE)
  } catch (e) {
    try {
      cdp?.detach()
    } catch {
      /* best effort */
    }
    discard()
    throw e
  }

  if (!cdp) {
    // Unreachable — the catch above always rethrows. Keeps the registration below non-null.
    discard()
    throw new Error('Could not create the Voidcast browser page.')
  }

  const page: BrowserPage = { id, view, cdp, createdAt: Date.now() }
  pages.push(page)
  activeId = id
  applyVisibility()

  const onRendererGone = (details?: { reason?: string }) => {
    removeDeadPage(page.id, details?.reason ?? 'unknown reason')
  }
  view.webContents.on('render-process-gone', (_event, details) => onRendererGone(details))
  view.webContents.once('destroyed', () => onRendererGone({ reason: 'destroyed' }))

  if (url && url !== HOME_URL) await loadInto(page, url)
  return page
}

/** A page requested by the page itself (popup) — evicts the oldest background page at the cap. */
async function openPopup(url: string): Promise<void> {
  await withBrowserLock(async () => {
    const win = ownerWindow
    if (!win || win.isDestroyed() || shuttingDown) return
    if (pages.length >= MAX_PAGES) {
      const oldest = [...pages]
        .sort((a, b) => a.createdAt - b.createdAt)
        .find((p) => p.id !== activeId)
      if (oldest) closeBrowserPageUnsafe(oldest.id)
    }
    if (pages.length >= MAX_PAGES) return
    await newPageInWindow(win, url)
  })
}

async function ensureActivePage(): Promise<BrowserPage> {
  const existing = activeBrowserPage()
  if (existing && !existing.view.webContents.isDestroyed()) return existing
  const alive = pages.find((p) => !p.view.webContents.isDestroyed())
  if (alive) {
    activeId = alive.id
    applyVisibility()
    return alive
  }
  if (!creating) {
    // Capture the epoch up front: if the profile switches while this page boots, the
    // creation is discarded by newPageInWindow instead of joining the new profile.
    const epoch = profileEpoch
    const pending = newPageInWindow(ownerWindow as BrowserWindow, undefined, epoch)
      .then((page) => {
        lastError = null
        return page
      })
      .catch((e) => {
        lastError = e instanceof Error ? e.message : String(e)
        throw e
      })
      .finally(() => {
        // Release only the slot we own — a profile switch may already have replaced it.
        if (creating === pending) creating = null
      })
    creating = pending
  }
  return creating
}

/** Run `fn` against the current page, creating a blank one if nothing is open yet. */
export async function withSession<T>(
  win: BrowserWindow | null,
  projectPath: string | undefined,
  profile: string | undefined,
  fn: (page: BrowserPage) => Promise<T>,
): Promise<T> {
  return withBrowserLock(async () => {
    await ensureBrowser(win, projectPath, profile)
    const page = await ensureActivePage()
    return fn(page)
  })
}

export async function openBrowserPage(
  win: BrowserWindow | null,
  url: string,
  background: boolean,
  projectPath?: string,
  profile?: string,
): Promise<{ pageId: string; url: string; text: string }> {
  return withBrowserLock(async () => {
    // Panel-driven (GO / URL bar): the path and profile come from the panel's own context.
    const target = await ensureBrowser(win, projectPath, profile, true)
    if (pages.length >= MAX_PAGES) {
      throw new Error(
        `Too many pages open (max ${MAX_PAGES}) — close one with browser_close_page first.`,
      )
    }
    const previousId = activeId
    const page = await newPageInWindow(target, url)
    if (background && previousId) {
      activeId = previousId
      applyVisibility()
    }
    const finalUrl = page.view.webContents.getURL() || url
    return {
      pageId: page.id,
      url: finalUrl,
      text:
        `Opened ${page.id} — ${finalUrl}.` +
        (background
          ? ' It stays in the background; the current page is unchanged.'
          : ' It is now the current page and the coding panel shows it.'),
    }
  })
}

function selectBrowserPageUnsafe(id: string): { url: string; text: string } {
  const page = findPage(id)
  activeId = page.id
  applyVisibility()
  const url = page.view.webContents.getURL()
  return {
    url,
    text: `Current page is now ${page.id} — ${
      url || 'about:blank'
    }. Agent tools and the coding panel follow this selection.`,
  }
}

function closeBrowserPageUnsafe(id: string): { text: string; activeId: string | null } {
  const index = pages.findIndex((p) => p.id === id)
  if (index === -1) {
    throw new Error(`Unknown page "${id}" — call browser_list_pages to see the open pages.`)
  }
  const [page] = pages.splice(index, 1)
  try {
    page.cdp.detach()
  } catch {
    /* best effort */
  }
  if (ownerWindow && !ownerWindow.isDestroyed()) {
    try {
      ownerWindow.contentView.removeChildView(page.view)
    } catch {
      /* best effort */
    }
  }
  try {
    if (!page.view.webContents.isDestroyed()) page.view.webContents.close()
  } catch {
    /* best effort */
  }
  if (activeId === id) {
    const neighbor = pages[Math.min(index, pages.length - 1)] ?? null
    activeId = neighbor ? neighbor.id : null
  }
  applyVisibility()
  return {
    text: `Closed ${id}.${
      activeId ? ` Current page is ${activeId}.` : ' No pages are open any more.'
    }`,
    activeId,
  }
}

export async function selectBrowserPageForProject(
  win: BrowserWindow | null,
  projectPath: string | undefined,
  profile: string | undefined,
  id: string,
): Promise<{ url: string; text: string }> {
  return withBrowserLock(async () => {
    await ensureBrowser(win, projectPath, profile)
    return selectBrowserPageUnsafe(id)
  })
}

export async function closeBrowserPageForProject(
  win: BrowserWindow | null,
  projectPath: string | undefined,
  profile: string | undefined,
  id: string,
): Promise<{ text: string; activeId: string | null }> {
  return withBrowserLock(async () => {
    await ensureBrowser(win, projectPath, profile)
    return closeBrowserPageUnsafe(id)
  })
}

export function setBrowserBounds(rect: BrowserRect): void {
  panelRect = {
    x: Math.max(0, Math.round(rect.x)),
    y: Math.max(0, Math.round(rect.y)),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height)),
  }
  // Deliberately NOT clamped against the window size: a stale window measurement
  // used to collapse the rect to 0x0, which looked like "nothing renders" plus
  // "every screenshot times out". The renderer rect is authoritative.
  hasPanelRect = panelRect.width >= MIN_RECT_PX && panelRect.height >= MIN_RECT_PX
  applyVisibility()
}

export function setBrowserVisible(visible: boolean): void {
  visibleFlag = Boolean(visible)
  applyVisibility()
}

export async function navigateTo(url: string, wait = true): Promise<string> {
  const page = activeBrowserPage()
  if (!page) throw new Error('Browser page is not running yet — open the coding panel WEB view first.')
  if (wait) return loadInto(page, url)
  // wait:false — the URL is still validated synchronously (a blocked scheme must stay an
  // error, not a silent no-op), then the navigation runs in the background and the reply
  // returns at once. The final URL is not known yet, so the requested one is reported.
  const target = normalizeUrl(url)
  void page.view.webContents.loadURL(target).catch((e) => {
    lastError = e instanceof Error ? e.message : String(e)
  })
  return target
}

export async function historyStep(direction: 'back' | 'forward'): Promise<string> {
  const page = activeBrowserPage()
  if (!page) throw new Error('Browser page is not running yet.')
  const history = await page.cdp.send<{
    entries?: unknown[]
    currentIndex?: number
  }>('Page.getNavigationHistory', {})
  const entries = history?.entries ?? []
  const current = typeof history?.currentIndex === 'number' ? history.currentIndex : 0
  const next = direction === 'back' ? current - 1 : current + 1
  if (next < 0 || next >= entries.length) {
    throw new Error(`Cannot go ${direction} — no further history entry.`)
  }
  await page.cdp.send('Page.navigateToHistoryEntry', {
    entryId: (entries[next] as { id?: number })?.id,
  })
  await new Promise((resolve) => setTimeout(resolve, 400))
  return page.view.webContents.getURL()
}

export async function reloadPage(): Promise<string> {
  const page = activeBrowserPage()
  if (!page) throw new Error('Browser page is not running yet.')
  await page.cdp.send('Page.reload', {})
  await new Promise((resolve) => setTimeout(resolve, 400))
  return page.view.webContents.getURL()
}

export async function takeBrowserScreenshot(
  projectPath?: string,
  options: { uid?: string; fullPage?: boolean } = {},
): Promise<{
  path: string
  relativePath?: string
  bytes: number
  width: number
  height: number
  label: string
}> {
  const page = activeBrowserPage()
  if (!page) throw new Error('Browser page is not running yet.')
  // An element clip is resolved to DOCUMENT coordinates (spike #5) and works even for
  // elements that are below the fold.
  const clip = options.uid ? await page.cdp.elementClip(options.uid) : undefined
  const shot = await page.cdp.screenshot({ clip, fullPage: options.fullPage })
  let width = 0
  let height = 0
  try {
    const size = nativeImage.createFromBuffer(shot.bytes).getSize()
    width = size.width
    height = size.height
  } catch {
    /* dimensions are cosmetic — never fail a capture over them */
  }
  const shotsDir = projectPath
    ? path.join(projectPath, '.voidcast', 'browser', 'shots')
    : path.join(os.tmpdir(), 'voidcast-browser-shots')
  await mkdir(shotsDir, { recursive: true })
  const suffix = options.uid ? `-${options.uid}` : options.fullPage ? '-full' : ''
  const name = `shot-${new Date().toISOString().replace(/[:.]/g, '-')}${suffix}.jpg`
  const abs = path.join(shotsDir, name)
  await writeFile(abs, shot.bytes)
  const relativePath = projectPath
    ? path.relative(projectPath, abs).split(path.sep).join('/')
    : undefined
  return {
    path: abs,
    relativePath,
    bytes: shot.bytes.length,
    width,
    height,
    label: shot.label,
  }
}

/** Device/viewport + colour-scheme emulation for the current page (QA of responsive layouts). */
export async function emulateBrowser(opts: {
  width?: number
  height?: number
  deviceScaleFactor?: number
  mobile?: boolean
  darkMode?: boolean
  reset?: boolean
}): Promise<string> {
  const page = activeBrowserPage()
  if (!page) throw new Error('Browser page is not running yet.')
  return page.cdp.emulate(opts)
}

export function browserStatus(): {
  state: 'idle' | 'ready' | 'error'
  url: string
  title: string
  attached: boolean
  bounds: BrowserRect
  visible: boolean
  panelRect: boolean
  forcedFrames: number
  pages: BrowserPageInfo[]
  activeId: string | null
  /** Chromium partition key in use ('' until the browser has been configured). */
  profile: string
  error: string | null
} {
  const info = pages.map(pageSummary)
  const page = activeBrowserPage()
  const painting = Boolean(page && !shuttingDown && visibleFlag && panelSizeKnown())
  const bounds: BrowserRect = page
    ? painting
      ? panelRect
      : parkedRect()
    : { x: 0, y: 0, width: 0, height: 0 }

  if (!page || page.view.webContents.isDestroyed()) {
    return {
      state: pages.length ? 'error' : lastError ? 'error' : 'idle',
      url: '',
      title: '',
      attached: false,
      bounds,
      visible: false,
      panelRect: hasPanelRect,
      forcedFrames: 0,
      pages: info,
      activeId,
      profile: partitionKey,
      error: lastError,
    }
  }
  return {
    state: page.cdp.isAttached ? 'ready' : 'error',
    url: page.view.webContents.getURL(),
    title: page.view.webContents.getTitle(),
    attached: page.cdp.isAttached,
    bounds,
    visible: painting,
    panelRect: hasPanelRect,
    forcedFrames: page.cdp.screencastFrameCount,
    pages: info,
    activeId,
    profile: partitionKey,
    error: lastError,
  }
}

/** detach() before close (Electron crashes in main if the debugger outlives the view). */
export function disposeBrowserView(): void {
  if (shuttingDown) return
  shuttingDown = true
  for (const page of pages) {
    try {
      page.cdp.detach()
    } catch {
      /* best effort */
    }
    if (ownerWindow && !ownerWindow.isDestroyed()) {
      try {
        ownerWindow.contentView.removeChildView(page.view)
      } catch {
        /* best effort */
      }
    }
    try {
      if (!page.view.webContents.isDestroyed()) page.view.webContents.close()
    } catch {
      /* best effort */
    }
  }
  pages = []
  activeId = null
  creating = null
  // Orphan any page creation still in flight so it cannot join `pages` after shutdown.
  profileEpoch += 1
  visibleFlag = false
}

export function markBrowserShutdown(): void {
  shuttingDown = true
}
