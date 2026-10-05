/**
 * Browser-profile housekeeping.
 *
 * Every project gets its own persistent Chromium partition (that is the isolation boundary),
 * which also means its own HTTP cache, V8 code cache, shader cache and service-worker caches.
 * Nothing ever shrank those, so a handful of projects quietly turned into a gigabyte. The work
 * here is deliberately conservative:
 *
 *  - caches are trimmed, never storage: cookies, local storage and IndexedDB (i.e. the logins)
 *    survive a trim, because `clearStorageData` is scoped to the cache-ish storage types;
 *  - the profile in use is left alone, so what you are working in keeps its warm cache;
 *  - a profile is only *deleted* when this build has never recorded it, nothing has touched it
 *    for a week and it is not in use, so a project you simply have not opened lately keeps its
 *    session instead of being swept away.
 */
import { app, session } from 'electron'
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const PARTITION_PREFIX = 'persist:voidcast-browser-'
const DIR_PREFIX = 'voidcast-browser-'
const REGISTRY_FILE = 'browser-profiles.json'
/** A profile this build never recorded is deleted only once it is this cold. */
const ORPHAN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** Caches smaller than this are not worth the trim (and would just crawl back). */
const TRIM_MIN_BYTES = 100 * 1024 * 1024

type Registry = { version: number; keys: Record<string, string> }

let registry: Registry | null = null
let registryPromise: Promise<Registry> | null = null
let registryWrite: Promise<void> = Promise.resolve()
let maintenanceStarted = false

function partitionsRoot(): string {
  return path.join(app.getPath('userData'), 'Partitions')
}

function profileRegistryFile(): string {
  return path.join(app.getPath('userData'), REGISTRY_FILE)
}

function partitionName(key: string): string {
  return `${PARTITION_PREFIX}${key}`
}

/**
 * The registry is loaded once per run. Caching the *promise* (not just the object) matters:
 * the first `recordProfileKey` and the first housekeeping pass race each other, and two
 * concurrent loads would leave one of them mutating an object that is no longer `registry` —
 * which would lose the record of a profile and later mark a live profile as an orphan.
 */
function loadRegistry(): Promise<Registry> {
  if (!registryPromise) {
    registryPromise = (async () => {
      const loaded: Registry = { version: 1, keys: {} }
      try {
        const parsed = JSON.parse(await readFile(profileRegistryFile(), 'utf8')) as Partial<Registry>
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

/** Remember that this profile belongs to the app, so housekeeping never deletes it. */
export function recordProfileKey(key: string): void {
  void (async () => {
    const store = await loadRegistry()
    store.keys[key] = new Date().toISOString()
    const snapshot = JSON.stringify(store)
    const file = profileRegistryFile()
    registryWrite = registryWrite
      .then(() => writeFile(file, snapshot, 'utf8'))
      .catch(() => undefined)
  })()
}

/** Drop the re-downloadable caches of one profile; cookies and logins are left alone. */
export async function trimProfileCaches(key: string): Promise<void> {
  try {
    const ses = session.fromPartition(partitionName(key))
    await ses.clearCache()
    await ses.clearCodeCaches({ urls: [] })
    await ses.clearStorageData({
      storages: ['cachestorage', 'shadercache', 'serviceworkers'],
    })
  } catch {
    /* a profile that is mid-write or already gone: nothing here is worth failing a call over */
  }
}

async function dirBytes(dir: string): Promise<number> {
  let total = 0
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      const info = await stat(full).catch(() => null)
      if (info) total += info.size
    }
  }
  await walk(dir)
  return total
}

/** Newest write we can see, used to decide whether a profile is still in use. */
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
 * Trim every profile on disk except the one in use. Iterates the directory rather than the
 * registry on purpose: a profile the app has not recorded yet still deserves its caches
 * dropped, and the registry only exists to protect profiles from *deletion*.
 */
export async function trimInactiveCaches(
  currentKey: string,
  minBytes = TRIM_MIN_BYTES,
): Promise<{ trimmed: string[]; megabytes: number }> {
  const trimmed: string[] = []
  let bytes = 0
  const entries = await readdir(partitionsRoot(), { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(DIR_PREFIX)) continue
    const key = entry.name.slice(DIR_PREFIX.length)
    if (key === currentKey) continue
    const full = path.join(partitionsRoot(), entry.name)
    const size = await dirBytes(full)
    if (size < minBytes) continue
    await trimProfileCaches(key)
    trimmed.push(entry.name)
    bytes += size
  }
  return { trimmed, megabytes: Math.round(bytes / (1024 * 1024)) }
}

/**
 * Delete profiles this build has never used and nothing has touched for a week: the leftovers
 * of project paths that no longer resolve to the same partition key (renamed folders, and the
 * pre-normalisation keys that made one project path produce two partitions). It is not the
 * profiles of projects you simply have not opened lately.
 */
async function cleanOrphanProfiles(currentKey: string, inUse: Set<string>): Promise<string[]> {
  const removed: string[] = []
  const store = await loadRegistry()
  const cutoff = Date.now() - ORPHAN_MAX_AGE_MS
  const entries = await readdir(partitionsRoot(), { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(DIR_PREFIX)) continue
    const key = entry.name.slice(DIR_PREFIX.length)
    if (key === currentKey) continue
    if (inUse.has(partitionName(key))) continue
    if (key in store.keys) continue
    const full = path.join(partitionsRoot(), entry.name)
    if ((await newestMtime(full)) > cutoff) continue
    try {
      await rm(full, { recursive: true, force: true })
      removed.push(entry.name)
    } catch {
      /* locked by another instance — try again on the next run */
    }
  }
  return removed
}

/**
 * Housekeeping, once per app run. Called from every entry point that means "the browser is in
 * use" (hardening a page, opening/clearing from the panel) — never from page creation alone,
 * because that also meant it never ran at all when the agent only ever cleared data.
 */
export function runBrowserMaintenance(currentKey: string, inUse: Set<string>): void {
  if (maintenanceStarted) return
  maintenanceStarted = true
  recordProfileKey(currentKey)
  void (async () => {
    const removed = await cleanOrphanProfiles(currentKey, inUse)
    if (removed.length) {
      console.log(`[browser] removed ${removed.length} orphan profile(s): ${removed.join(', ')}`)
    }
    const { trimmed, megabytes } = await trimInactiveCaches(currentKey)
    if (trimmed.length) {
      console.log(
        `[browser] trimmed caches of ${trimmed.length} inactive profile(s) (~${megabytes} MB before the trim): ${trimmed.join(', ')}`,
      )
    }
  })()
}
