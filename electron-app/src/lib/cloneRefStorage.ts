const DB_NAME = 'voidcast-clone-v1'
const STORE = 'clone-ref'
const KEY = 'current'

export type StoredCloneRef = { blob: Blob; fileName: string }

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

export async function saveCloneRef(data: StoredCloneRef): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(data, KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function loadCloneRef(): Promise<StoredCloneRef | null> {
  const db = await openDb()
  const row = await new Promise<StoredCloneRef | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(KEY)
    req.onsuccess = () => resolve(req.result as StoredCloneRef | undefined)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return row ?? null
}

export async function clearCloneRef(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}
