import { BrowserWindow, WebContentsView, app, nativeImage, safeStorage, session } from 'electron'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CdpSession } from './cdp'
import { recordProfileKey, runBrowserMaintenance, trimProfileCaches } from './maintenance'
import { settleNavigation } from './navigationWait'
import { POPUP_BURST, POPUP_WINDOW_MS, allowPopup, popupToEvict } from './popupGuard'

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
  /** Bucket this page belongs to — `bucketKey(projectPath)`. */
  key: string
  /** Opened by a page (window.open / target=_blank): the only kind a popup may evict. */
  popup: boolean
}

/** An HTTP auth request Chromium is holding open until the user answers it. */
type PendingAuth = {
  id: string
  /** webContents id of the page that asked — lets us drop it when the page dies. */
  wcId: number
  pageId: string
  /** Bucket of the page that asked: only that project's panel and agent may see the prompt. */
  projectKey: string
  /** Chromium partition that asked: a remembered sign-in must land in its own store file. */
  partition: string
  /** scheme://host:port (+ proxy marker) — the key remembered credentials are stored under. */
  key: string
  host: string
  realm: string
  url: string
  answer: (username?: string, password?: string) => void
}

/** One remembered credential. The password is safeStorage-encrypted, never plaintext. */
type StoredCredential = { username: string; secret: string }

/** Last download that landed in the project folder — surfaced to the panel and the agent. */
type DownloadNotice = { name: string; path: string; state: string; bytes: number; at: number }

/** What the WEB panel renders as the sign-in bar. */
export type BrowserAuthPrompt = {
  id: string
  host: string
  realm: string
  url: string
  pageId: string
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
let pageSeq = 1
/**
 * Browser profile selection from settings: '' means one profile per coding project,
 * 'shared' means one profile for the whole app, anything else is a named profile.
 */
let profileSetting = ''

/**
 * Per-project browser state.
 *
 * The browser used to keep one active page, one partition and one remembered project for the
 * whole app: opening a page in project B closed project A's pages and stole the active page
 * from whatever the panel was showing. Everything project-scoped lives here now, and every
 * locked entry point points `currentKey` at the caller's bucket.
 */
type BrowserBucket = {
  /** Active page of this bucket — what its agent tools and its panel view act on. */
  activeId: string | null
  /** Partition the bucket's pages live in — a view cannot be re-partitioned in place. */
  partition: string
  /** Coding project the bucket is scoped to; downloads and shots land inside it. */
  projectPath: string
  /**
   * Bumped when this bucket's partition changes (profile switch or shutdown). A page still
   * being created for the previous partition re-checks its epoch after every await, so a slow
   * load can never register the old project's session into the new profile.
   */
  epoch: number
  /** Page creation in flight for this bucket. */
  creating: Promise<BrowserPage> | null
  /**
   * Notices are per project too: a timeout, denied permission or download in one chat must
   * never show up in another project's panel or tool result.
   */
  lastError: string | null
  /** Last permission Chromium denied, so "why is the camera blocked" has an answer. */
  lastPermission: string | null
  /** Last download routed into this project's folder. */
  lastDownload: DownloadNotice | null
  /** Bumped every time a download starts, so a click can tell a new one from a stale notice. */
  downloadSeq: number
  /** Recent popup attempts, for the burst limit in `popupGuard`. */
  popupTimes: number[]
}

const buckets = new Map<string, BrowserBucket>()
/** Bucket of the operation currently inside `withBrowserLock` — the lock is the mutex. */
let currentKey = ''
/** Bucket the WEB panel is showing: the only one that paints, and status' default. */
let panelKey = ''

/** Stable bucket id for a coding project path ('' = no project, the app-wide browser). */
function bucketKey(projectPath?: string): string {
  return sanitizePartitionKey(projectPath)
}

function bucket(key: string = currentKey): BrowserBucket {
  let found = buckets.get(key)
  if (!found) {
    found = {
      activeId: null,
      partition: '',
      projectPath: '',
      epoch: 0,
      creating: null,
      lastError: null,
      lastPermission: null,
      lastDownload: null,
      downloadSeq: 0,
      popupTimes: [],
    }
    buckets.set(key, found)
  }
  return found
}
/** True while the WEB panel is mounted and wants the current page painted. */
let visibleFlag = false
/** True once the renderer has pushed a usable panel rect at least once. */
let hasPanelRect = false
let panelRect: BrowserRect = { x: 0, y: 0, width: 0, height: 0 }
let shuttingDown = false
let windowHooked = false
/** Browser state is global to the app; serialize operations from concurrent chat runs. */
let browserOperationTail = Promise.resolve()
/** Partitions already hardened — session listeners accumulate, so they are attached once. */
const hardenedPartitions = new Set<string>()
/** HTTP auth requests Chromium is holding open until the user answers them (keyed by prompt id). */
const pendingAuth = new Map<string, PendingAuth>()
let authSeq = 1
/** Remembered HTTP credentials for the active profile, read lazily from userData. */
let authStore: Record<string, StoredCredential> | null = null
let authStorePath = ''

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
  const raw = (projectPath ?? '')
    .trim()
    .replace(/[\\/]+$/, '')
    .toLowerCase()
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

/** Close one bucket's pages — used when its profile changes, since pages cannot be re-partitioned. */
function closePagesIn(key: string): void {
  for (const page of [...pages]) {
    if (page.key !== key) continue
    try {
      closeBrowserPageUnsafe(page.id)
    } catch {
      /* already gone */
    }
  }
}

/**
 * Switch the calling bucket to the profile it asked for. Pages live inside their partition,
 * so a profile change closes that bucket's pages instead of silently carrying the wrong
 * cookies — and closes nobody else's: a chat in another project keeps its tabs.
 */
function applyProfile(projectPath?: string): { profile: string; changed: boolean } {
  const st = bucket()
  const next = desiredProfileKey(projectPath)
  if (next === st.partition) return { profile: st.partition, changed: false }
  const previous = st.partition
  closePagesIn(currentKey)
  st.partition = next
  // A page creation still in flight was started against the previous partition: orphan it
  // (its epoch no longer matches) so its late completion cannot add an old-profile page to
  // the new profile, and so the next call starts a fresh page in the right partition.
  st.epoch += 1
  st.creating = null
  st.lastError = null
  // Held sign-in requests and permission notes belong to the partition we just left — this
  // bucket's only. Other projects keep theirs: their pages are still waiting on them.
  for (const entry of [...pendingAuth.values()]) {
    if (entry.projectKey === currentKey) pendingAuth.delete(entry.id)
  }
  st.lastPermission = null
  // We just left that profile: drop its re-downloadable caches. Cookies, local storage and
  // every remembered sign-in survive — hundreds of MB of HTTP/code/service-worker cache do not.
  // Skipped while another project is still working in the same partition.
  if (previous && ![...buckets.values()].some((b) => b.partition === previous)) {
    void trimProfileCaches(previous)
  }
  return { profile: st.partition, changed: true }
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
    const active = !shuttingDown && page.id === bucket(page.key).activeId
    // Only the panel's project paints. Every active page — in any project — stays VISIBLE
    // while parked: a hidden renderer stops requestAnimationFrame outright, so a canvas game
    // in a background chat would freeze the moment the agent keeps driving it.
    const paint = active && page.key === panelKey && visibleFlag && panelSizeKnown()
    try {
      page.view.setBounds(paint ? panelRect : parkedRect())
      if (typeof page.view.setVisible === 'function') page.view.setVisible(active)
    } catch {
      /* view may already be destroyed during teardown */
    }
  }
}

/**
 * Permissions Chromium may grant without asking. Everything else is denied: Electron
 * approves every request when no handler is set, and this browser renders untrusted pages
 * on the agent's behalf — a page could otherwise open the camera, read the clipboard or
 * ask for the location. The three below cannot leak anything to the page: `fullscreen`
 * keeps video players working, `clipboard-sanitized-write` the copy buttons, `pointerLock`
 * canvas/3D apps.
 */
const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock'])

function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

function partitionName(key: string = currentKey): string {
  return `persist:voidcast-browser-${bucket(key).partition || 'default'}`
}

/**
 * Bucket of the page that owns this webContents. A shared or named profile serves several
 * projects from one session, so session-level events must be routed by the asking page,
 * never by the partition.
 */
function keyOfWebContents(wc: Electron.WebContents | null | undefined): string | null {
  if (!wc) return null
  try {
    const id = wc.id
    return pages.find((p) => p.view.webContents.id === id)?.key ?? null
  } catch {
    return null
  }
}

/**
 * Hardening that must be in place before the first page in a partition loads: a
 * deny-by-default permission handler and the download router. Session listeners
 * accumulate, so each partition is hardened exactly once.
 */
function hardenSession(bucketId: string = currentKey): Electron.Session {
  const name = partitionName(bucketId)
  const ses = session.fromPartition(name)
  if (hardenedPartitions.has(name)) return ses
  hardenedPartitions.add(name)
  // This partition belongs to the app and to a project: record it so housekeeping never treats
  // it as an orphan, and let the once-per-run maintenance go now that we are actually here.
  const profile = bucket(bucketId).partition || 'default'
  recordProfileKey(profile)
  runBrowserMaintenance(profile, hardenedPartitions)

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (ALLOWED_PERMISSIONS.has(permission)) {
      callback(true)
      return
    }
    const key = keyOfWebContents(wc)
    if (key !== null) {
      bucket(key).lastPermission =
        `${permission} denied for ${hostOf(details?.requestingUrl ?? '')}`
    }
    callback(false)
  })
  // Keeps navigator.permissions.query() honest about the denials above.
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission))

  ses.on('will-download', (_event, item, wc) => attachDownload(item, keyOfWebContents(wc), profile))
  return ses
}

/**
 * Downloads never land in the OS Downloads folder: a file the agent was tricked into
 * fetching must not be able to overwrite something the user cares about, and the agent
 * needs to know where the file went. The page's project when it has one, otherwise userData.
 */
function downloadsDir(key: string | null, profile: string): string {
  const projectPath = key !== null ? bucket(key).projectPath : ''
  if (projectPath) return path.join(projectPath, '.voidcast', 'browser', 'downloads')
  return path.join(app.getPath('userData'), 'browser-downloads', profile || 'default')
}

/** Strip anything that could escape the download folder or confuse Windows. */
function safeFileName(raw: string): string {
  const base = path
    .basename((raw || 'download').trim())
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/^\.+/, '_')
  return base.slice(0, 120) || 'download'
}

function uniqueDownloadPath(dir: string, name: string): string {
  const ext = path.extname(name)
  const stem = ext ? name.slice(0, -ext.length) : name
  let candidate = path.join(dir, name)
  for (let n = 1; existsSync(candidate) && n < 500; n++) {
    candidate = path.join(dir, `${stem} (${n})${ext}`)
  }
  return candidate
}

function attachDownload(item: Electron.DownloadItem, key: string | null, profile: string): void {
  const dir = downloadsDir(key, profile)
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* falling back to the default location beats failing the download */
  }
  const target = uniqueDownloadPath(dir, safeFileName(item.getFilename()))
  try {
    // Must happen synchronously inside will-download, before the download starts.
    item.setSavePath(target)
  } catch {
    /* let Chromium pick if the path is rejected */
  }
  // Announce the download before it finishes: a click that starts one must be able to name
  // the file in its own result instead of leaving the agent to hunt for it later (or look
  // in the OS Downloads folder). downloadSeq lets a click tell a download that began while
  // it was running apart from an earlier, stale notice. A download from a page we no longer
  // track still lands safely, it just has no project to report to.
  if (key === null) return
  const st = bucket(key)
  st.lastDownload = {
    name: path.basename(target),
    path: target,
    state: 'started',
    bytes: 0,
    at: Date.now(),
  }
  st.downloadSeq += 1
  const seq = st.downloadSeq
  item.once('done', (_event, state) => {
    // Never let a slow, older download overwrite the notice of a newer one.
    if (st.downloadSeq !== seq) return
    st.lastDownload = {
      name: path.basename(target),
      path: target,
      state,
      bytes: item.getReceivedBytes(),
      at: Date.now(),
    }
  })
}

/** Monotonic count of downloads started from one project's pages; a click diffs it. */
export function downloadMark(key: string): number {
  return bucket(key).downloadSeq
}

/** That project's most recent download notice if one began after `mark`, else null. */
export function downloadNoticeSince(key: string, mark: number): DownloadNotice | null {
  const st = bucket(key)
  return st.downloadSeq > mark ? st.lastDownload : null
}

function authKey(authInfo: Electron.AuthInfo): string {
  return `${authInfo.isProxy ? 'proxy' : 'site'}:${authInfo.scheme || 'basic'}://${authInfo.host}:${authInfo.port}`
}

function authFilePath(partition: string = bucket().partition): string {
  return path.join(
    app.getPath('userData'),
    'browser-auth',
    `${sanitizePartitionKey(partition)}.json`,
  )
}

async function loadAuthStore(
  partition: string = bucket().partition,
): Promise<Record<string, StoredCredential>> {
  const file = authFilePath(partition)
  if (authStore && authStorePath === file) return authStore
  authStorePath = file
  authStore = {}
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as {
      entries?: Record<string, StoredCredential>
    }
    if (parsed?.entries && typeof parsed.entries === 'object') authStore = parsed.entries
  } catch {
    /* no remembered credentials for this profile yet */
  }
  return authStore
}

async function saveAuthStore(
  store: Record<string, StoredCredential>,
  partition: string = bucket().partition,
): Promise<void> {
  const file = authFilePath(partition)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify({ version: 1, entries: store }), 'utf8')
  authStore = store
  authStorePath = file
}

/** Encrypt through the OS keychain (DPAPI on Windows) — a password is never written in clear. */
async function saveCredential(
  key: string,
  username: string,
  password: string,
  partition: string,
): Promise<boolean> {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
    const store = await loadAuthStore(partition)
    store[key] = { username, secret: safeStorage.encryptString(password).toString('base64') }
    await saveAuthStore({ ...store }, partition)
    return true
  } catch {
    return false
  }
}

function decryptSecret(secret: string): string | null {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(Buffer.from(secret, 'base64'))
  } catch {
    return null
  }
}

function firstPendingAuth(match: (entry: PendingAuth) => boolean): PendingAuth | null {
  for (const entry of pendingAuth.values()) {
    if (match(entry)) return entry
  }
  return null
}

/** The held sign-in of one project — another project's prompt is never surfaced here. */
function authPrompt(key: string): BrowserAuthPrompt | null {
  const entry = firstPendingAuth((e) => e.projectKey === key)
  if (!entry) return null
  return {
    id: entry.id,
    host: entry.host,
    realm: entry.realm,
    url: entry.url,
    pageId: entry.pageId,
  }
}

/** Why a page is stuck, in words the agent can act on (and the panel can show). */
function pendingAuthNote(entry: PendingAuth | null): string | null {
  if (!entry) return null
  const realm = entry.realm ? ` (realm "${entry.realm}")` : ''
  return `HTTP authentication required by ${entry.host}${realm} — the page stays pending until the user answers the sign-in bar in the coding panel WEB view (they can tick "remember" to store it for this profile).`
}

/**
 * Forget the held sign-ins of one page. `cancel` answers the old request with nothing,
 * which is what Chromium reads as "cancel the authentication" — used when a newer request
 * supersedes it, so the older subresource fails fast instead of waiting forever.
 */
function dropAuthForPage(wcId: number, cancel = false): void {
  for (const entry of [...pendingAuth.values()]) {
    if (entry.wcId !== wcId) continue
    pendingAuth.delete(entry.id)
    if (cancel) {
      try {
        entry.answer()
      } catch {
        /* the page may already be gone */
      }
    }
  }
}

/**
 * HTTP Basic/Digest. With no `login` listener Electron cancels the authentication, so a
 * password-protected staging site just hangs on a 401 with no explanation. Remembered
 * credentials are answered silently (encrypted in userData per profile); anything else is
 * held open for the user — never auto-filled from the OS.
 */
function wireLogin(view: WebContentsView, wcId: number): void {
  view.webContents.on('login', (event, _details, authInfo, callback) => {
    event.preventDefault()
    void handleLogin(wcId, authInfo, callback)
  })
}

async function handleLogin(
  wcId: number,
  authInfo: Electron.AuthInfo,
  callback: (username?: string, password?: string) => void,
): Promise<void> {
  const key = authKey(authInfo)
  // Resolve the asking page's own partition: this event can fire long after the call that
  // opened the page, so `currentKey` may already point at another project.
  const asking = pages.find((p) => p.view.webContents.id === wcId)
  const partition = asking ? bucket(asking.key).partition : bucket().partition
  const saved = (await loadAuthStore(partition))[key]
  const password = saved ? decryptSecret(saved.secret) : null
  if (saved && password !== null) {
    try {
      callback(saved.username, password)
    } catch {
      /* the page went away while the encrypted store was being read */
    }
    return
  }
  // One held prompt per page: a newer request replaces the older one (and the older one is
  // cancelled, so its subresource fails immediately instead of hanging on a dead callback).
  dropAuthForPage(wcId, true)
  const id = `auth${authSeq++}`
  pendingAuth.set(id, {
    id,
    wcId,
    pageId: asking?.id ?? '',
    projectKey: asking?.key ?? currentKey,
    partition,
    key,
    host: authInfo.host,
    realm: authInfo.realm ?? '',
    url: safeCurrentUrl(wcId),
    answer: callback,
  })
}

/** The URL of the page that is asking, resolved from the live page list. */
function safeCurrentUrl(wcId: number): string {
  const page = pages.find((p) => p.view.webContents.id === wcId)
  try {
    return page?.view.webContents.getURL() ?? ''
  } catch {
    return ''
  }
}

/**
 * Reject a load early when the site parks it behind HTTP authentication: Chromium holds
 * the request open, so the plain load timeout would leave the agent waiting 25s and then
 * reporting a generic timeout instead of "the user has to sign in".
 */
function withAuthWatch<T>(wcId: number, promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setInterval(() => {
      const held = firstPendingAuth((entry) => entry.wcId === wcId)
      if (!held) return
      clearInterval(timer)
      reject(new Error(pendingAuthNote(held) ?? 'HTTP authentication required.'))
    }, 500)
    promise.then(
      (value) => {
        clearInterval(timer)
        resolve(value)
      },
      (err) => {
        clearInterval(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      },
    )
  })
}

async function loadInto(page: BrowserPage, url: string): Promise<string> {
  const target = normalizeUrl(url)
  const wcId = page.view.webContents.id
  // A new navigation supersedes whatever the page was holding. Without this, a sign-in
  // request the user never answered would keep every later load on this page blocked.
  dropAuthForPage(wcId, true)
  try {
    await withTimeout(
      withAuthWatch(wcId, page.view.webContents.loadURL(target)),
      LOAD_TIMEOUT_MS,
      `Timed out loading ${target}`,
    )
  } catch (e) {
    // This page's own sign-in only: another project's held prompt says nothing about this load.
    const note = pendingAuthNote(firstPendingAuth((entry) => entry.wcId === wcId))
    if (note) {
      // Not a broken load: Chromium is holding it until the user signs in. Say it once —
      // withAuthWatch already rejected with this same note.
      throw new Error(note)
    }
    const detail = e instanceof Error ? e.message : String(e)
    throw new Error(`Navigation failed for ${target}: ${detail}`)
  }
  return page.view.webContents.getURL()
}

function findPage(id: string): BrowserPage {
  const page = pages.find((p) => p.id === id)
  if (!page)
    throw new Error(`Unknown page "${id}" — call browser_list_pages to see the open pages.`)
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
  const dead = bucket(page.key)
  if (dead.activeId === id) dead.activeId = pages.find((p) => p.key === page.key)?.id ?? null
  dead.lastError = `Browser page ${id} was removed because its renderer exited (${reason}).`
  applyVisibility()
}

export function activeBrowserPage(key: string = currentKey): BrowserPage | null {
  const activeId = bucket(key).activeId
  if (!activeId) return null
  return pages.find((p) => p.id === activeId) ?? null
}

function pageSummary(page: BrowserPage): BrowserPageInfo {
  const destroyed = page.view.webContents.isDestroyed()
  return {
    id: page.id,
    url: destroyed ? '' : page.view.webContents.getURL(),
    title: destroyed ? '' : page.view.webContents.getTitle(),
    active: page.id === bucket(page.key).activeId,
  }
}

export function listBrowserPages(key: string = currentKey): {
  pages: BrowserPageInfo[]
  activeId: string | null
  text: string
} {
  const info = pages.filter((p) => p.key === key).map(pageSummary)
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
  return { pages: info, activeId: bucket(key).activeId, text }
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
    win && !win.isDestroyed() ? win : ownerWindow && !ownerWindow.isDestroyed() ? ownerWindow : null
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
  // Every entry point states the project it is calling for: that is this call's bucket, and
  // nothing below can reach into another project's pages.
  currentKey = bucketKey(projectPath)
  const st = bucket()
  if (authoritative) panelKey = currentKey
  // A Chromium partition cannot be swapped on a live page, so the key is fixed once a page
  // exists. The WEB panel re-configures it when the project or the profile setting changes —
  // but the panel only exists while WEB mode is open, and the agent drives the same browser
  // without it. So every call that knows the project re-checks here: without this, switching
  // project with the panel closed kept the previous project's cookies and logins.
  if (profile !== undefined) profileSetting = normalizeProfileSetting(profile)
  // Remember the project so downloads land inside it. Only the panel may clear it — an
  // agent call without a project path must not forget where we are.
  if (projectPath) st.projectPath = projectPath
  else if (authoritative) st.projectPath = ''
  const desired = desiredProfileKey(projectPath)
  if (!st.partition) {
    st.partition = desired
  } else if (desired !== st.partition && (authoritative || projectPath || profileSetting)) {
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
    const previous = bucket(bucketKey(projectPath)).partition
    // The panel owns the context: it may state "no project", which resets to the default profile.
    await ensureBrowser(win, projectPath, profile, true)
    // Opening the panel (or switching project/profile) is a "the browser is in use" signal.
    // It is also the only trigger that fires when the agent never opens a page of its own.
    runBrowserMaintenance(bucket().partition || 'default', hardenedPartitions)
    return { profile: bucket().partition, changed: previous !== bucket().partition }
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
    const target = session.fromPartition(partitionName())
    await target.clearStorageData()
    await target.clearCache()
    // Drop the in-memory HTTP auth cache too: without this a page signed in with a
    // remembered credential keeps working until the app restarts, even after CLR.
    await target.clearAuthCache().catch(() => undefined)
    // Remembered HTTP credentials belong to the profile too — this is the only way to
    // remove them from the encrypted store.
    const file = authFilePath(bucket().partition)
    await rm(file, { force: true }).catch(() => undefined)
    authStore = {}
    authStorePath = ''
    const st = bucket()
    st.lastError = null
    st.lastPermission = null
    st.lastDownload = null
    // Clearing is an explicit "sort my browser data out" action: housekeeping for the other
    // profiles runs here too, instead of only wiping the one on screen.
    runBrowserMaintenance(bucket().partition || 'default', hardenedPartitions)
    return `Cleared cookies, storage, cache and remembered sign-ins for profile "${bucket().partition}". Already-open pages keep their in-memory state until they are reloaded.`
  })
}

/**
 * Answer a held HTTP auth request. Reached from the WEB panel's sign-in bar only — the
 * agent has no tool for it and never sees the password.
 */
export async function answerBrowserAuth(input: {
  id?: string
  username?: string
  password?: string
  remember?: boolean
  cancel?: boolean
}): Promise<string> {
  return withBrowserLock(async () => {
    const entry = [...pendingAuth.values()].find((p) => p.id === input.id)
    if (!entry) {
      throw new Error('That sign-in request is no longer waiting — reload the page and try again.')
    }
    const username = (input.username ?? '').trim()
    if (!input.cancel && !username) throw new Error('Missing user name for the sign-in request.')
    // Drop it only once the input is known to be usable — otherwise the page waits forever.
    pendingAuth.delete(entry.id)
    if (input.cancel) {
      // Calling the callback with no arguments cancels the authentication: Chromium then
      // shows its own 401 page instead of waiting for credentials that never arrive.
      entry.answer()
      return `Cancelled the sign-in request for ${entry.host}.`
    }
    try {
      entry.answer(username, input.password ?? '')
    } catch {
      throw new Error('The page went away before the sign-in could be applied.')
    }
    const saved = input.remember
      ? await saveCredential(entry.key, username, input.password ?? '', entry.partition)
      : false
    const note = input.remember
      ? saved
        ? ' Stored encrypted for this browser profile.'
        : ' Could not store it (no OS keychain available) — used for this request only.'
      : ''
    return `Signed in to ${entry.host} as "${username}".${note}`
  })
}

async function newPageInWindow(
  win: BrowserWindow,
  url?: string,
  key: string = currentKey,
  epoch = bucket(key).epoch,
  popup = false,
): Promise<BrowserPage> {
  const st = bucket(key)
  // Hardening must be in place before the first page in this partition loads.
  hardenSession(key)
  const id = `p${pageSeq++}`
  const view = new WebContentsView({
    webPreferences: {
      partition: partitionName(key),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  const wcId = view.webContents.id
  win.contentView.addChildView(view)
  view.setBounds(parkedRect())
  if (typeof view.setVisible === 'function') view.setVisible(false)

  view.webContents.setWindowOpenHandler(({ url: target }) => {
    // target=_blank / window.open stay inside the Voidcast browser (never the system
    // browser), so the flow keeps running in the panel and the agent can drive it.
    if (!/^https?:/i.test(target)) return { action: 'deny' }
    const st = bucket(key)
    // Checked here, synchronously, so a window.open loop never even queues behind the lock.
    if (!allowPopup(st.popupTimes, Date.now())) {
      st.lastPermission = `popup to ${hostOf(target)} blocked — more than ${POPUP_BURST} in ${POPUP_WINDOW_MS / 1000}s`
      return { action: 'deny' }
    }
    void openPopup(target, key).catch((e) => {
      st.lastError = e instanceof Error ? e.message : String(e)
    })
    return { action: 'deny' }
  })
  // HTTP Basic/Digest: answered silently from the encrypted store, or held for the user.
  wireLogin(view, wcId)

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
    if (shuttingDown || epoch !== st.epoch) throw new Error(PROFILE_CHANGED_MESSAGE)
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

  const page: BrowserPage = { id, view, cdp, createdAt: Date.now(), key, popup }
  const previousActive = st.activeId
  pages.push(page)
  st.activeId = id
  applyVisibility()

  const onRendererGone = (details?: { reason?: string }) => {
    // A held sign-in dies with its page — never leave the panel prompting for a dead tab.
    dropAuthForPage(wcId)
    removeDeadPage(page.id, details?.reason ?? 'unknown reason')
  }
  view.webContents.on('render-process-gone', (_event, details) => onRendererGone(details))
  view.webContents.once('destroyed', () => onRendererGone({ reason: 'destroyed' }))

  if (url && url !== HOME_URL) {
    try {
      await loadInto(page, url)
    } catch (e) {
      // A page held for HTTP sign-in is waiting for the user, not broken: keep it.
      if (firstPendingAuth((entry) => entry.wcId === wcId)) throw e
      // Otherwise the caller gets an error, so it must not also get a blank page that took
      // over as the current one and counts toward MAX_PAGES.
      try {
        closeBrowserPageUnsafe(id)
      } catch {
        /* already gone */
      }
      if (previousActive && pages.some((p) => p.id === previousActive && p.key === key)) {
        st.activeId = previousActive
        applyVisibility()
      }
      const detail = e instanceof Error ? e.message : String(e)
      throw new Error(`${detail.replace(/\.?\s*$/, '.')} The new page was closed.`)
    }
  }
  return page
}

/**
 * A page requested by the page itself (popup). At the cap it may only evict an earlier
 * popup: the tabs the user or the agent opened are never closed to make room for one.
 */
async function openPopup(url: string, key: string): Promise<void> {
  await withBrowserLock(async () => {
    const win = ownerWindow
    if (!win || win.isDestroyed() || shuttingDown) return
    const st = bucket(key)
    const mine = (): BrowserPage[] => pages.filter((p) => p.key === key)
    // The cap is per project: a tab storm in one chat must not evict another project's pages.
    if (mine().length >= MAX_PAGES) {
      const evict = popupToEvict(mine(), st.activeId)
      if (evict) closeBrowserPageUnsafe(evict)
    }
    if (mine().length >= MAX_PAGES) {
      st.lastPermission = `popup to ${hostOf(url)} blocked — ${MAX_PAGES} pages are open; close one first`
      return
    }
    await newPageInWindow(win, url, key, bucket(key).epoch, true)
  })
}

async function ensureActivePage(key: string = currentKey): Promise<BrowserPage> {
  const st = bucket(key)
  const existing = activeBrowserPage(key)
  if (existing && !existing.view.webContents.isDestroyed()) return existing
  const alive = pages.find((p) => p.key === key && !p.view.webContents.isDestroyed())
  if (alive) {
    st.activeId = alive.id
    applyVisibility()
    return alive
  }
  if (!st.creating) {
    // Capture the epoch up front: if the profile switches while this page boots, the
    // creation is discarded by newPageInWindow instead of joining the new profile.
    const epoch = st.epoch
    const pending = newPageInWindow(ownerWindow as BrowserWindow, undefined, key, epoch)
      .then((page) => {
        st.lastError = null
        return page
      })
      .catch((e) => {
        st.lastError = e instanceof Error ? e.message : String(e)
        throw e
      })
      .finally(() => {
        // Release only the slot we own — a profile switch may already have replaced it.
        if (st.creating === pending) st.creating = null
      })
    st.creating = pending
  }
  return st.creating
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
    // Agent-driven (browser_new_page), so not authoritative: a background chat must not
    // re-point the panel at its own project or reset a profile from an empty path.
    const target = await ensureBrowser(win, projectPath, profile)
    const st = bucket()
    if (pages.filter((p) => p.key === currentKey).length >= MAX_PAGES) {
      throw new Error(
        `Too many pages open (max ${MAX_PAGES}) — close one with browser_close_page first.`,
      )
    }
    const previousId = st.activeId
    const page = await newPageInWindow(target, url)
    if (background && previousId) {
      st.activeId = previousId
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
  const st = bucket()
  // Scoped to the calling project: one chat cannot re-point the panel at another one's tab.
  const page = findPage(id)
  if (page.key !== currentKey) {
    throw new Error(`Unknown page "${id}" — call browser_list_pages to see the open pages.`)
  }
  st.activeId = page.id
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
    // A held sign-in dies with its page: never leave the panel prompting for a closed tab.
    dropAuthForPage(page.view.webContents.id, false)
  } catch {
    /* the renderer may already be gone — the prompt died with it */
  }
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
  const st = bucket(page.key)
  if (st.activeId === id) {
    st.activeId = pages.find((p) => p.key === page.key)?.id ?? null
  }
  applyVisibility()
  return {
    text: `Closed ${id}.${
      st.activeId ? ` Current page is ${st.activeId}.` : ' No pages are open any more.'
    }`,
    activeId: st.activeId,
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
  if (!page)
    throw new Error('Browser page is not running yet — open the coding panel WEB view first.')
  if (wait) return loadInto(page, url)
  // wait:false — the URL is still validated synchronously (a blocked scheme must stay an
  // error, not a silent no-op), then the navigation runs in the background and the reply
  // returns at once. The final URL is not known yet, so the requested one is reported.
  const target = normalizeUrl(url)
  void page.view.webContents.loadURL(target).catch((e) => {
    bucket(page.key).lastError = e instanceof Error ? e.message : String(e)
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
  await settleNavigation(
    page.view.webContents,
    () =>
      page.cdp.send('Page.navigateToHistoryEntry', {
        entryId: (entries[next] as { id?: number })?.id,
      }),
    LOAD_TIMEOUT_MS,
  )
  return page.view.webContents.getURL()
}

export async function reloadPage(): Promise<string> {
  const page = activeBrowserPage()
  if (!page) throw new Error('Browser page is not running yet.')
  await settleNavigation(
    page.view.webContents,
    () => page.cdp.send('Page.reload', {}),
    LOAD_TIMEOUT_MS,
  )
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

export function browserStatus(projectPath?: string): {
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
  /** A held HTTP auth request — the panel renders its sign-in bar while this is set. */
  auth: BrowserAuthPrompt | null
  /** Last denied permission or held sign-in, for the panel's status line. */
  notice: string | null
  /** Where downloads land for the current project/profile. */
  downloadsDir: string
  /** Last download routed through the browser. */
  download: DownloadNotice | null
  error: string | null
} {
  // The panel asks for its own bucket; the agent passes its project path so a background
  // run reports its own tabs instead of whatever the panel happens to be showing.
  const key = projectPath === undefined ? panelKey || currentKey : bucketKey(projectPath)
  const info = pages.filter((p) => p.key === key).map(pageSummary)
  const page = activeBrowserPage(key)
  const painting = Boolean(
    page && !shuttingDown && page.key === panelKey && visibleFlag && panelSizeKnown(),
  )
  const bounds: BrowserRect = page
    ? painting
      ? panelRect
      : parkedRect()
    : { x: 0, y: 0, width: 0, height: 0 }
  const st = bucket(key)
  const notice = pendingAuthNote(firstPendingAuth((e) => e.projectKey === key)) ?? st.lastPermission
  const downloads = downloadsDir(key, st.partition || 'default')

  if (!page || page.view.webContents.isDestroyed()) {
    return {
      // Only this project's pages count: tabs open in another project are not an error here.
      state: info.length || st.lastError ? 'error' : 'idle',
      url: '',
      title: '',
      attached: false,
      bounds,
      visible: false,
      panelRect: hasPanelRect,
      forcedFrames: 0,
      pages: info,
      activeId: bucket(key).activeId,
      profile: bucket(key).partition,
      auth: authPrompt(key),
      notice,
      downloadsDir: downloads,
      download: st.lastDownload,
      error: st.lastError,
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
    activeId: bucket(key).activeId,
    profile: bucket(key).partition,
    auth: authPrompt(key),
    notice,
    downloadsDir: downloads,
    download: st.lastDownload,
    error: st.lastError,
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
  for (const st of buckets.values()) {
    st.activeId = null
    st.creating = null
    // Orphan any page creation still in flight so it cannot join `pages` after shutdown.
    st.epoch += 1
  }
  currentKey = ''
  panelKey = ''
  // Held sign-ins have no page to return to; the callbacks die with the process anyway.
  pendingAuth.clear()
  visibleFlag = false
}

export function markBrowserShutdown(): void {
  shuttingDown = true
}
