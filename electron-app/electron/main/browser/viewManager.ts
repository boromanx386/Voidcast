import { BrowserWindow, WebContentsView, nativeImage } from 'electron'
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

let ownerWindow: BrowserWindow | null = null
let pages: BrowserPage[] = []
let activeId: string | null = null
let pageSeq = 1
let creating: Promise<BrowserPage> | null = null
let partitionKey = ''
/** True while the WEB panel is mounted and wants the current page painted. */
let visibleFlag = false
/** True once the renderer has pushed a usable panel rect at least once. */
let hasPanelRect = false
let panelRect: BrowserRect = { x: 0, y: 0, width: 0, height: 0 }
let lastError: string | null = null
let shuttingDown = false
let windowHooked = false

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

/** Stable-ish partition key so a project keeps its cookies/logins between runs. */
function sanitizePartitionKey(projectPath?: string): string {
  const raw = (projectPath ?? '').trim()
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

/** Create (once) and return the shared browser window binding. No page is created. */
async function ensureBrowser(win: BrowserWindow | null, projectPath?: string): Promise<BrowserWindow> {
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
  // Partition is fixed at first use — switching project later keeps the profile.
  if (!partitionKey) partitionKey = sanitizePartitionKey(projectPath)
  return target
}

async function newPageInWindow(win: BrowserWindow, url?: string): Promise<BrowserPage> {
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

  // SPIKE RULE: the view must have navigated at least once before any CDP command,
  // otherwise every command waits for a target that never appears.
  await withTimeout(
    view.webContents.loadURL(HOME_URL),
    15000,
    'Timed out bootstrapping the Voidcast browser page.',
  )

  const cdp = new CdpSession(view.webContents)
  await cdp.attach()

  const page: BrowserPage = { id, view, cdp, createdAt: Date.now() }
  pages.push(page)
  activeId = id
  applyVisibility()

  if (url && url !== HOME_URL) await loadInto(page, url)
  return page
}

/** A page requested by the page itself (popup) — evicts the oldest background page at the cap. */
async function openPopup(url: string): Promise<void> {
  const win = ownerWindow
  if (!win || win.isDestroyed() || shuttingDown) return
  if (pages.length >= MAX_PAGES) {
    const oldest = [...pages]
      .sort((a, b) => a.createdAt - b.createdAt)
      .find((p) => p.id !== activeId)
    if (oldest) closeBrowserPage(oldest.id)
  }
  if (pages.length >= MAX_PAGES) return
  await newPageInWindow(win, url)
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
    creating = newPageInWindow(ownerWindow as BrowserWindow)
      .then((page) => {
        lastError = null
        return page
      })
      .catch((e) => {
        lastError = e instanceof Error ? e.message : String(e)
        throw e
      })
      .finally(() => {
        creating = null
      })
  }
  return creating
}

/** Run `fn` against the current page, creating a blank one if nothing is open yet. */
export async function withSession<T>(
  win: BrowserWindow | null,
  projectPath: string | undefined,
  fn: (page: BrowserPage) => Promise<T>,
): Promise<T> {
  await ensureBrowser(win, projectPath)
  const page = await ensureActivePage()
  return fn(page)
}

export async function openBrowserPage(
  win: BrowserWindow | null,
  url: string,
  background: boolean,
  projectPath?: string,
): Promise<{ pageId: string; url: string; text: string }> {
  const target = await ensureBrowser(win, projectPath)
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
}

export function selectBrowserPage(id: string): { url: string; text: string } {
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

export function closeBrowserPage(id: string): { text: string; activeId: string | null } {
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

export async function navigateTo(url: string): Promise<string> {
  const page = activeBrowserPage()
  if (!page) throw new Error('Browser page is not running yet — open the coding panel WEB view first.')
  return loadInto(page, url)
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
  visibleFlag = false
}

export function markBrowserShutdown(): void {
  shuttingDown = true
}
