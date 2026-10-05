/**
 * Browser-profile housekeeping.
 *
 * Every coding project gets its own persistent Chromium partition — that IS the isolation
 * boundary — and with it its own HTTP cache, code cache (compiled JS/WASM), shader cache and
 * service-worker caches. Nothing ever shrank those, so a handful of projects quietly added
 * up to a gigabyte in `userData/Partitions`. The rules here stay deliberately conservative:
 *
 *  - a **trim** drops only re-downloadable caches. Cookies, local storage and IndexedDB (i.e.
 *    every login) survive it, because `clearStorageData` is scoped to the cache-ish types.
 *  - a **delete** removes only profiles this build has never even recorded *and* that nothing
 *    has touched for a week — the leftovers of a project path that no longer resolves to the
 *    same key (renamed folders, keys from before the path normalisation). A project you simply
 *    have not opened lately keeps its session.
 */
import { app, session } from 'electron'
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const PARTITION_PREFIX = 'persist:voidcast-browser-'
const DIR_PREFIX = 'voidcast-browser-'
const REGISTRY_FILE = 'browser-profiles.json'

/** A profile this build has never recorded is deleted only once it is this cold. */
const ORPHAN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** Only trim a profile once its caches are actually worth the churn. */
const TRIM_MIN_BYTES = 100 * 1024 * 1024
/** Cache-ish Chromium storage: all re-downloadable, none of it is a credential. */
const CACHE_STORAGES = ['cachestorage', 'shadercache', 'serviceworkers'] as const

type Registry = { version: number; keys: Record<string, string> }

let registry: Registry | null = null
let registryPromise: Promise<Registry> | null = null
let registryWrite: Promise<void> = Promise.resolve()
let started = false

function profileDir(key: string): string {
  return path.join(app.getPath('userData'), 'Partitions', `${DIR_PREFIX}${key}`)
}

function partitionName(key: string): string {
  return `${PARTITION_PREFIX}${key}`
}

/**
 * The registry is loaded once per run. Caching the *promise* (not just the object) matters:
 * the first `recordProfileKey` and the first housekeeping pass race each other, and two
 * concurrent loads would leave one of them mutating an object that is no longer `registry` —
 * which would lose the record of a profile and later mark it an orphan.
 */
function loadRegistry(): Promise<Registry> {
  if (!registryPromise) {
    registryPromise = (async () => {
      const loaded: Registry = { version: 1, keys: {} }
      try {
        const file = path.join(app.getPath('userData'), REGISTRY_FILE)
        const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<Registry>
        if (parsed?.keys && typeof parsed.keys === 'object') loaded.keys = parsed.keys
      } catch {
        /* first run since this feature exists — the registry starts empty */
      }
      registry = loaded
      return loaded
    })()
  }
  return registryPromise
}

/** Total size of everything under a directory; 0 when it cannot be walked. */
async function dirBytes(dir: string): Promise<number> {
  let total = 0
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => null)
    if (!entries) return
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else {
        const info = await stat(full).catch(() => null)
        if (info) total += info.size
      }
    }
  }
  await walk(dir)
  return total
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

/**
 * Remember that this profile belongs to the app. Profiles in the registry are never treated
 * as orphans, so a project that is merely unopened for a while keeps its cookies.
 */
export function recordProfileKey(key: string): void {
  void (async () => {
    const store = await loadRegistry()
    store.keys[key] = new Date().toISOString()
    const snapshot = JSON.stringify(store)
    const file = path.join(app.getPath('userData'), REGISTRY_FILE)
    registryWrite = registryWrite
      .then(() => writeFile(file, snapshot, 'utf8'))
      .catch(() => undefined)
  })()
}

/** Drop one profile's re-downloadable caches. Cookies and storage are left untouched. */
export async function trimProfileCaches(key: string): Promise<void> {
  try {
    const ses = session.fromPartition(partitionName(key))
    await ses.clearCache()
    await ses.clearCodeCaches({ urls: [] })
    await ses.clearStorageData({ storages: [...CACHE_STORAGES] })
  } catch {
    /* profile mid-write or already gone — nothing here is worth failing a browser call over */
  }
}

/**
 * Trim every recorded profile except the one in use, and only those whose caches have grown
 * past the threshold. The profile in use keeps its warm cache; it gets trimmed when it is
 * left behind (see `applyProfile` in viewManager) or via the panel's clear-data button.
 */
export async function trimInactiveCaches(currentKey: string): Promise<string[]> {
  const store = await loadRegistry()
  const trimmed: string[] = []
  for (const key of Object.keys(store.keys)) {
    if (key === currentKey) continue
    const dir = profileDir(key)
    const bytes = await dirBytes(dir)
    if (bytes < TRIM_MIN_BYTES) continue
    await trimProfileCaches(key)
    trimmed.push(`${key} (~${megabytes(bytes)})`)
  }
  return trimmed
}

/** Newest write we can see for a profile, used to tell "cold" from "in use". */
async function newestMtime(dir: string): Promise<number> {
  let newest = 0
  try {
    newest = (await stat(dir)).mtimeMs
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const info = await stat(path.join(dir, entry.name)).catch(() => null)
      if (info && info.mtimeMs > newest) newest = info.mtimeMs
    }
  } catch {
    /* already gone */
  }
  return newest
}

/**
 * Delete profiles this build has never recorded and that nothing has touched for a week.
 * `inUse` holds the partition names already hardened in this run, so a profile of another
 * concurrently-open window is never deleted from under it.
 */
export async function cleanOrphanProfiles(
  currentKey: string,
  inUse: Set<string>,
): Promise<string[]> {
  const removed: string[] = []
  const store = await loadRegistry()
  const root = path.join(app.getPath('userData'), 'Partitions')
  const entries = await readdir(root, { withFileTypes: true }).catch(() => null)
  if (!entries) return removed
  const cutoff = Date.now() - ORPHAN_MAX_AGE_MS
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(DIR_PREFIX)) continue
    const dir = path.join(root, entry.name)
    const key = entry.name.slice(DIR_PREFIX.length)
    if (key === currentKey) continue
    if (inUse.has(partitionName(key))) continue
    if (key in store.keys) continue
    if ((await newestMtime(dir)) > cutoff) continue
    try {
      await rm(dir, { recursive: true, force: true })
      removed.push(entry.name)
    } catch {
      /* locked by another instance — it will be picked up on a later run */
    }
  }
  return removed
}

/**
 * Run housekeeping once per app run. Triggered from the browser's own hardening path, so it
 * costs nothing until the agent actually opens a page — and it immediately reclaims the space
 * that had already piled up, not only what would accumulate from now on.
 */
export function runBrowserMaintenance(currentKey: string, inUse: Set<string>): void {
  if (started) return
  started = true
  void (async () => {
    const store = await loadRegistry()
    // Belt and braces: the profile we are running on is never an orphan.
    store.keys[currentKey] = store.keys[currentKey] ?? new Date().toISOString()
    const removed = await cleanOrphanProfiles(currentKey, inUse)
    if (removed.length) {
      console.log(`[browser] removed ${removed.length} orphan profile(s): ${removed.join(', ')}`)
    }
    const trimmed = await trimInactiveCaches(currentKey)
    if (trimmed.length) {
      console.log(`[browser] trimmed caches of ${trimmed.length} inactive profile(s): ${trimmed.join(', ')}`)
    }
  })()
}
