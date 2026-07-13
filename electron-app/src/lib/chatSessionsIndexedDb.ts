import type { ChatSession } from '@/types/chat'

const DB_NAME = 'voidcast-chat-sessions-v2'
const DB_VERSION = 1
const SESSIONS_STORE = 'sessions'
const META_STORE = 'meta'

export const META_KEY = 'chat-sessions'

export type ChatSessionsMeta = {
  key: typeof META_KEY
  activeSessionId: string | null
  /** Set after one-time localStorage → IndexedDB migration (or empty first run). */
  migratedFrom?: string
  schemaVersion: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        const store = db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' })
        store.createIndex('updatedAt', 'updatedAt', { unique: false })
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB tx failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB tx aborted'))
  })
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

export async function idbGetMeta(): Promise<ChatSessionsMeta | undefined> {
  const db = await openDb()
  const tx = db.transaction(META_STORE, 'readonly')
  const store = tx.objectStore(META_STORE)
  const meta = await idbRequest(store.get(META_KEY) as IDBRequest<ChatSessionsMeta | undefined>)
  await txDone(tx)
  return meta
}

export async function idbListSessions(): Promise<ChatSession[]> {
  const db = await openDb()
  const tx = db.transaction(SESSIONS_STORE, 'readonly')
  const store = tx.objectStore(SESSIONS_STORE)
  const items = await idbRequest(store.getAll() as IDBRequest<ChatSession[]>)
  await txDone(tx)
  return items ?? []
}

export async function idbPutSessionsAndMeta(
  sessions: ChatSession[],
  meta: Omit<ChatSessionsMeta, 'key'> & { key?: typeof META_KEY },
): Promise<void> {
  const db = await openDb()
  const readTx = db.transaction(SESSIONS_STORE, 'readonly')
  const existing = await idbRequest(
    readTx.objectStore(SESSIONS_STORE).getAllKeys() as IDBRequest<IDBValidKey[]>,
  )
  await txDone(readTx)

  const writeTx = db.transaction([SESSIONS_STORE, META_STORE], 'readwrite')
  const sessionsStore = writeTx.objectStore(SESSIONS_STORE)
  const metaStore = writeTx.objectStore(META_STORE)

  const keep = new Set(sessions.map((s) => s.id))
  for (const key of existing ?? []) {
    if (typeof key === 'string' && !keep.has(key)) {
      sessionsStore.delete(key)
    }
  }
  for (const session of sessions) {
    sessionsStore.put(session)
  }
  metaStore.put({
    key: META_KEY,
    activeSessionId: meta.activeSessionId,
    migratedFrom: meta.migratedFrom,
    schemaVersion: meta.schemaVersion,
  } satisfies ChatSessionsMeta)

  await txDone(writeTx)
}

export async function idbDeleteSession(sessionId: string): Promise<void> {
  const db = await openDb()
  const readTx = db.transaction(META_STORE, 'readonly')
  const meta = await idbRequest(
    readTx.objectStore(META_STORE).get(META_KEY) as IDBRequest<ChatSessionsMeta | undefined>,
  )
  await txDone(readTx)

  const writeTx = db.transaction([SESSIONS_STORE, META_STORE], 'readwrite')
  writeTx.objectStore(SESSIONS_STORE).delete(sessionId)
  if (meta && meta.activeSessionId === sessionId) {
    writeTx.objectStore(META_STORE).put({ ...meta, activeSessionId: null })
  }
  await txDone(writeTx)
}

/** Test helper: drop the DB so unit tests start clean. */
export async function idbResetChatSessionsDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error ?? new Error('IndexedDB deleteDatabase failed'))
    req.onblocked = () => resolve()
  })
}
