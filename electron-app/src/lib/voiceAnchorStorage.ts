const DB_NAME = 'voidcast-voice-anchor-v1'
const STORE = 'anchor'
const KEY = 'current'

export type VoiceAnchorSourceMode = 'design'

export type StoredVoiceAnchor = {
  blob: Blob
  refText: string
  sourceMode: VoiceAnchorSourceMode
  /** `voiceInstruct` at bake time (design only); for stale-warning in UI */
  instructSnapshot?: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE)
    }
  })
}

export async function saveVoiceAnchor(data: StoredVoiceAnchor): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(data, KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function loadVoiceAnchor(): Promise<StoredVoiceAnchor | null> {
  const db = await openDb()
  const row = await new Promise<StoredVoiceAnchor | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(KEY)
    req.onsuccess = () => resolve(req.result as StoredVoiceAnchor | undefined)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return row ?? null
}

export async function clearVoiceAnchor(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}
