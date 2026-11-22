import { makeUuidV4 } from '@/lib/runwareUuid'
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

/** Identity of a memory for duplicate checks: the text, case- and whitespace-insensitive. */
export function memoryKey(text: string): string {
  return normalizeText(text).toLowerCase()
}

function tokens(input: string): Set<string> {
  const out = new Set<string>()
  // Unicode letters, so Serbian (č, ć, š, ž, đ) and Cyrillic words stay whole.
  for (const p of input.toLowerCase().split(/[^\p{L}\p{N}_]+/gu)) {
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

export function memoryRelevance(
  query: string,
  memory: Pick<LongMemoryItem, 'text' | 'tags'>,
): number {
  return overlapScore(tokens(query || ''), tokens(`${memory.text} ${memory.tags.join(' ')}`))
}

export function scoreMemoryForQuery(
  query: string,
  memory: Pick<
    LongMemoryItem,
    'text' | 'tags' | 'importance' | 'confidence' | 'lastUsedAt' | 'updatedAt'
  >,
  now = Date.now(),
): number {
  const recencyHours = Math.max(
    1,
    (now - Math.max(memory.lastUsedAt, memory.updatedAt)) / (1000 * 60 * 60),
  )
  const recency = 1 / Math.log2(recencyHours + 2)
  const relevance = memoryRelevance(query, memory)
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
  return rows.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, Math.max(1, limit))
}

/**
 * Rows to write for new candidates. A candidate whose text is already stored refreshes that
 * row instead of adding a copy, so saving the same fact twice keeps one memory.
 */
export function mergeMemoryCandidates(
  existing: LongMemoryItem[],
  candidates: LongMemoryCandidate[],
  sourceSessionId: string,
  now = Date.now(),
): LongMemoryItem[] {
  const byKey = new Map<string, LongMemoryItem>()
  for (const row of existing) byKey.set(memoryKey(row.text), row)
  const out = new Map<string, LongMemoryItem>()
  for (const c of candidates) {
    const text = normalizeText(c.text).slice(0, 400)
    if (!text) continue
    const key = memoryKey(text)
    const prev = out.get(key) ?? byKey.get(key)
    const importance = clamp01(c.importance, 0.5)
    const confidence = clamp01(c.confidence, 0.7)
    if (prev) {
      out.set(key, {
        ...prev,
        tags: normalizeTags([...prev.tags, ...(c.tags ?? [])]),
        importance: Math.max(prev.importance, importance),
        confidence: Math.max(prev.confidence, confidence),
        updatedAt: now,
      })
      continue
    }
    out.set(key, {
      id: makeUuidV4(),
      kind: c.kind,
      text,
      tags: normalizeTags(c.tags),
      importance,
      confidence,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: 0,
      sourceSessionId,
    })
  }
  return [...out.values()]
}

export async function upsertMemories(
  candidates: LongMemoryCandidate[],
  sourceSessionId: string,
): Promise<LongMemoryItem[]> {
  if (candidates.length === 0) return []
  const prepared = mergeMemoryCandidates(await listMemories(5000), candidates, sourceSessionId)
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

export async function updateMemoryText(id: string, text: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  const req = store.get(id)
  await new Promise<void>((resolve, reject) => {
    req.onsuccess = () => {
      const row = req.result as LongMemoryItem | undefined
      if (!row) return resolve()
      store.put({ ...row, text: text.slice(0, 400), updatedAt: Date.now() })
      resolve()
    }
    req.onerror = () => reject(req.error ?? new Error('IndexedDB update failed'))
  })
  await txDone(tx)
}

export async function touchMemoryUsage(ids: string[]): Promise<void> {
  if (!ids.length) return
  const unique = Array.from(new Set(ids))
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  const now = Date.now()
  await Promise.all(
    unique.map(
      (id) =>
        new Promise<void>((resolve) => {
          const req = store.get(id)
          req.onsuccess = () => {
            const row = req.result as LongMemoryItem | undefined
            if (!row) return resolve()
            store.put({ ...row, lastUsedAt: now, updatedAt: now })
            resolve()
          }
          req.onerror = () => resolve()
        }),
    ),
  )
  await txDone(tx)
}

export async function dedupeMemories(): Promise<number> {
  const all = await listMemories(5000)
  const seen = new Map<string, LongMemoryItem>()
  const toDelete: string[] = []
  for (const row of all) {
    const key = memoryKey(row.text)
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

export async function importMemoryItems(items: LongMemoryItem[]): Promise<void> {
  if (items.length === 0) return
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  for (const item of items) store.put(item)
  await txDone(tx)
}

export async function applyMemoryDeletes(
  deletedIds: string[],
  deletedAt: Record<string, number>,
): Promise<void> {
  if (deletedIds.length === 0) return
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  for (const id of deletedIds) {
    const tomb = deletedAt[id]
    if (tomb == null) {
      store.delete(id)
      continue
    }
    const req = store.get(id)
    await new Promise<void>((resolve) => {
      req.onsuccess = () => {
        const row = req.result as LongMemoryItem | undefined
        if (!row) return resolve()
        if (tomb >= row.updatedAt) store.delete(id)
        resolve()
      }
      req.onerror = () => resolve()
    })
  }
  await txDone(tx)
}

/**
 * Preferences and constraints shape every answer, so they are always eligible. Other kinds
 * must share at least one word with the query; importance alone used to let unrelated
 * memories through.
 */
export function rankMemoriesForQuery(
  memories: LongMemoryItem[],
  query: string,
  opts: { limit: number; minConfidence: number; now?: number },
): LongMemoryItem[] {
  const now = opts.now ?? Date.now()
  return memories
    .filter((m) => m.confidence >= opts.minConfidence)
    .filter(
      (m) => m.kind === 'preference' || m.kind === 'constraint' || memoryRelevance(query, m) > 0,
    )
    .map((m) => ({ m, score: scoreMemoryForQuery(query, m, now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, opts.limit))
    .map((x) => x.m)
}

/** Prompt block for retrieved memories; drops whole items rather than cutting one mid-text. */
export function formatLongMemoryContext(
  memories: LongMemoryItem[],
  maxChars = 1200,
): string | undefined {
  const lines: string[] = []
  let used = 0
  for (const m of memories) {
    const line = `- ${lines.length + 1}. [${m.kind}] ${m.text}`
    if (lines.length > 0 && used + line.length + 1 > maxChars) break
    lines.push(line)
    used += line.length + 1
  }
  return lines.length > 0 ? lines.join('\n') : undefined
}

export async function searchMemories(params: {
  query: string
  limit?: number
  minConfidence?: number
}): Promise<LongMemoryItem[]> {
  return rankMemoriesForQuery(await listMemories(1500), params.query, {
    limit: params.limit ?? 8,
    minConfidence: clamp01(params.minConfidence, 0.25),
  })
}
