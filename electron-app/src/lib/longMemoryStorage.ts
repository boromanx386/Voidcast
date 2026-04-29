import type { LongMemoryCandidate, LongMemoryItem } from '@/types/longMemory'

const DB_NAME = 'voidcast-long-memory-v1'
const STORE = 'long_memories'
const DB_VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('updatedAt', 'updatedAt', { unique: false })
        store.createIndex('lastUsedAt', 'lastUsedAt', { unique: false })
        store.createIndex('kind', 'kind', { unique: false })
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

function clamp01(v: number | undefined, fallback: number): number {
  if (!Number.isFinite(v)) return fallback
  return Math.max(0, Math.min(1, Number(v)))
}

function normalizeText(v: string): string {
  return v.trim().replace(/\s+/g, ' ')
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags?.length) return []
  const out = new Set<string>()
  for (const t of tags) {
    const trimmed = t.trim().toLowerCase()
    if (trimmed) out.add(trimmed)
  }
  return Array.from(out).slice(0, 20)
}

function tokens(input: string): Set<string> {
  const out = new Set<string>()
  for (const p of input.toLowerCase().split(/[^a-z0-9_]+/g)) {
    if (!p || p.length < 2) continue
    out.add(p)
  }
  return out
}

function overlapScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let common = 0
  for (const t of a) if (b.has(t)) common += 1
  return common / Math.max(1, Math.min(a.size, b.size))
}

export function scoreMemoryForQuery(
  query: string,
  memory: Pick<LongMemoryItem, 'text' | 'tags' | 'importance' | 'confidence' | 'lastUsedAt' | 'updatedAt'>,
  now = Date.now(),
): number {
  const queryTokens = tokens(query || '')
  const recencyHours = Math.max(1, (now - Math.max(memory.lastUsedAt, memory.updatedAt)) / (1000 * 60 * 60))
  const recency = 1 / Math.log2(recencyHours + 2)
  const textTokens = tokens(`${memory.text} ${memory.tags.join(' ')}`)
  const relevance = overlapScore(queryTokens, textTokens)
  return relevance * 0.6 + memory.importance * 0.2 + memory.confidence * 0.15 + recency * 0.05
}

export async function listMemories(limit = 200): Promise<LongMemoryItem[]> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readonly')
  const store = tx.objectStore(STORE)
  const req = store.getAll()
  const rows = await new Promise<LongMemoryItem[]>((resolve, reject) => {
    req.onsuccess = () => resolve((req.result ?? []) as LongMemoryItem[])
    req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'))
  })
  await txDone(tx)
  return rows
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(1, limit))
}

export async function upsertMemories(
  candidates: LongMemoryCandidate[],
  sourceSessionId: string,
): Promise<LongMemoryItem[]> {
  const now = Date.now()
  const prepared = candidates
    .map((c): LongMemoryItem | null => {
      const text = normalizeText(c.text)
      if (!text) return null
      return {
        id: crypto.randomUUID(),
        kind: c.kind,
        text: text.slice(0, 400),
        tags: normalizeTags(c.tags),
        importance: clamp01(c.importance, 0.5),
        confidence: clamp01(c.confidence, 0.7),
        createdAt: now,
        updatedAt: now,
        lastUsedAt: 0,
        sourceSessionId,
      }
    })
    .filter((x): x is LongMemoryItem => Boolean(x))
  if (prepared.length === 0) return []

  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  for (const item of prepared) store.put(item)
  await txDone(tx)
  return prepared
}

export async function deleteMemory(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).delete(id)
  await txDone(tx)
}

export async function touchMemoryUsage(ids: string[]): Promise<void> {
  if (!ids.length) return
  const unique = Array.from(new Set(ids))
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  const now = Date.now()
  await Promise.all(unique.map((id) => new Promise<void>((resolve) => {
    const req = store.get(id)
    req.onsuccess = () => {
      const row = req.result as LongMemoryItem | undefined
      if (!row) return resolve()
      store.put({ ...row, lastUsedAt: now, updatedAt: now })
      resolve()
    }
    req.onerror = () => resolve()
  })))
  await txDone(tx)
}

export async function dedupeMemories(): Promise<number> {
  const all = await listMemories(5000)
  const seen = new Map<string, LongMemoryItem>()
  const toDelete: string[] = []
  for (const row of all) {
    const key = `${row.kind}::${normalizeText(row.text).toLowerCase()}`
    const prev = seen.get(key)
    if (!prev) {
      seen.set(key, row)
      continue
    }
    if (row.updatedAt > prev.updatedAt) {
      toDelete.push(prev.id)
      seen.set(key, row)
    } else {
      toDelete.push(row.id)
    }
  }
  if (!toDelete.length) return 0
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  for (const id of toDelete) store.delete(id)
  await txDone(tx)
  return toDelete.length
}

export async function searchMemories(params: {
  query: string
  limit?: number
  minConfidence?: number
}): Promise<LongMemoryItem[]> {
  const minConfidence = clamp01(params.minConfidence, 0.25)
  const limit = Math.max(1, params.limit ?? 8)
  const all = await listMemories(1500)
  const now = Date.now()
  const scored = all
    .filter((m) => m.confidence >= minConfidence)
    .map((m) => {
      const score = scoreMemoryForQuery(params.query, m, now)
      return { m, score }
    })
    .filter((x) => x.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.m)
  return scored
}
