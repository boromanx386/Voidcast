/**
 * Persisted user-selected notification sounds (chat reply / chat error).
 * Stored as IndexedDB Blobs because they can be tens to hundreds of KB —
 * too large for the localStorage settings payload.
 */

const DB_NAME = 'voidcast-notification-sounds-v1'
const STORE = 'sounds'

export type NotificationSoundKind = 'reply' | 'error'

export const NOTIFICATION_SOUND_KINDS: readonly NotificationSoundKind[] = ['reply', 'error']

export type StoredNotificationSound = {
  blob: Blob
  fileName: string
  mime: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
  })
}

export async function saveNotificationSound(
  kind: NotificationSoundKind,
  data: StoredNotificationSound,
): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(data, kind)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function loadNotificationSound(
  kind: NotificationSoundKind,
): Promise<StoredNotificationSound | null> {
  const db = await openDb()
  const row = await new Promise<StoredNotificationSound | undefined>(
    (resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(kind)
      req.onsuccess = () => resolve(req.result as StoredNotificationSound | undefined)
      req.onerror = () => reject(req.error)
    },
  )
  db.close()
  return row ?? null
}

export async function clearNotificationSound(kind: NotificationSoundKind): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(kind)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}
