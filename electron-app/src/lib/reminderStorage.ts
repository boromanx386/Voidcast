const DB_NAME = 'voidcast-reminders-v1'
const STORE = 'reminders'
const DB_VERSION = 1

export interface Reminder {
  id: string
  text: string
  when: number | null
  createdAt: number
  status: 'pending' | 'done' | 'cancelled'
  tags: string[]
  source: 'agent-tool' | 'manual'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('when', 'when', { unique: false })
        store.createIndex('status', 'status', { unique: false })
        store.createIndex('createdAt', 'createdAt', { unique: false })
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

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags?.length) return []
  const out = new Set<string>()
  for (const t of tags) {
    const trimmed = t.trim().toLowerCase()
    if (trimmed) out.add(trimmed)
  }
  return Array.from(out).slice(0, 10)
}

export async function addReminder(candidate: {
  text: string
  when?: number | null
  tags?: string[]
  source?: 'agent-tool' | 'manual'
}): Promise<Reminder> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  const item: Reminder = {
    id: crypto.randomUUID(),
    text: candidate.text.trim(),
    when: candidate.when ?? null,
    createdAt: Date.now(),
    status: 'pending',
    tags: normalizeTags(candidate.tags),
    source: candidate.source ?? 'manual',
  }
  store.put(item)
  await txDone(tx)
  return item
}

export async function listReminders(params?: {
  from?: number
  to?: number
  includeGeneral?: boolean
  status?: 'pending' | 'done' | 'cancelled'
}): Promise<Reminder[]> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readonly')
  const store = tx.objectStore(STORE)
  const req = store.getAll()
  const items: Reminder[] = await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as Reminder[])
    req.onerror = () => reject(req.error ?? new Error('IndexedDB getAll failed'))
  })
  await txDone(tx)

  let out = items
  if (params?.status) {
    out = out.filter((r) => r.status === params.status)
  }
  if (params?.from != null || params?.to != null) {
    out = out.filter((r) => {
      if (r.when == null) return params?.includeGeneral ?? true
      const from = params?.from ?? -Infinity
      const to = params?.to ?? Infinity
      return r.when >= from && r.when <= to
    })
  }
  // Sort: scheduled by when asc, then general by createdAt desc
  out.sort((a, b) => {
    if (a.when != null && b.when != null) return a.when - b.when
    if (a.when != null) return -1
    if (b.when != null) return 1
    return b.createdAt - a.createdAt
  })
  return out
}

export async function deleteReminder(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).delete(id)
  await txDone(tx)
}

export async function markReminderDone(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  const req = store.get(id)
  const item: Reminder | undefined = await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as Reminder | undefined)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'))
  })
  if (item) {
    item.status = 'done'
    store.put(item)
  }
  await txDone(tx)
}

export async function updateReminder(
  id: string,
  patch: Partial<Pick<Reminder, 'text' | 'when' | 'tags'>>,
): Promise<Reminder | null> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  const req = store.get(id)
  const item: Reminder | undefined = await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as Reminder | undefined)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'))
  })
  if (!item) return null
  if (patch.text !== undefined) item.text = patch.text.trim()
  if (patch.when !== undefined) item.when = patch.when
  if (patch.tags !== undefined) item.tags = normalizeTags(patch.tags)
  store.put(item)
  await txDone(tx)
  return item
}

export async function searchRemindersByText(query: string): Promise<Reminder[]> {
  const all = await listReminders()
  const q = query.toLowerCase().trim()
  if (!q) return []
  return all.filter((r) => r.text.toLowerCase().includes(q))
}
