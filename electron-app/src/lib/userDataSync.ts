import {
  applyMemoryDeletes,
  importMemoryItems,
  listMemories,
} from '@/lib/longMemoryStorage'
import { defaultTtsBaseUrlForRuntime } from '@/lib/platform'
import {
  applyReminderDeletes,
  importReminderItems,
  listReminders,
  reminderUpdatedAt,
  type Reminder,
} from '@/lib/reminderStorage'
import { normalizeBaseUrl } from '@/lib/settings'
import type { LongMemoryItem } from '@/types/longMemory'

const PENDING_MEM_DELETES_KEY = 'voidcast-pending-mem-deletes'
const PENDING_REM_DELETES_KEY = 'voidcast-pending-rem-deletes'

export type UserDataSnapshot = {
  updatedAt?: string | null
  longMemories: LongMemoryItem[]
  reminders: Reminder[]
  deletedMemoryIds: string[]
  deletedReminderIds: string[]
  deletedMemoryAt: Record<string, number>
  deletedReminderAt: Record<string, number>
}

let syncInFlight: Promise<boolean> | null = null
let syncQueued = false

type DeleteAtMap = Record<string, number>

function sanitizeDeleteAtMap(raw: unknown): DeleteAtMap {
  if (!raw || typeof raw !== 'object') return {}
  const out: DeleteAtMap = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!key) continue
    const ts = Number(value)
    if (Number.isFinite(ts) && ts > 0) out[key] = Math.trunc(ts)
  }
  return out
}

function loadPendingDeleteMap(key: string): DeleteAtMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      // Backward-compatible migration from old `string[]` payloads.
      const ts = Date.now()
      const out: DeleteAtMap = {}
      for (const id of parsed) {
        if (typeof id === 'string' && id.length > 0) out[id] = ts
      }
      return out
    }
    return sanitizeDeleteAtMap(parsed)
  } catch {
    return {}
  }
}

function savePendingDeleteMap(key: string, map: DeleteAtMap): void {
  if (typeof window === 'undefined') return
  const cleaned = sanitizeDeleteAtMap(map)
  if (Object.keys(cleaned).length === 0) localStorage.removeItem(key)
  else localStorage.setItem(key, JSON.stringify(cleaned))
}

function mergeDeleteAtMaps(...maps: Array<DeleteAtMap | undefined>): DeleteAtMap {
  const merged: DeleteAtMap = {}
  for (const map of maps) {
    if (!map) continue
    for (const [id, rawTs] of Object.entries(map)) {
      const ts = Number(rawTs)
      if (!Number.isFinite(ts) || ts <= 0) continue
      const next = Math.trunc(ts)
      merged[id] = Math.max(merged[id] ?? 0, next)
    }
  }
  return merged
}

function deleteIdsSet(ids: string[], deletedAt: DeleteAtMap): Set<string> {
  return new Set([
    ...ids.filter((id) => typeof id === 'string' && id.length > 0),
    ...Object.keys(deletedAt),
  ])
}

export function recordMemoryDeleted(id: string, deletedAt = Date.now()): void {
  if (!id) return
  const map = loadPendingDeleteMap(PENDING_MEM_DELETES_KEY)
  map[id] = Math.max(map[id] ?? 0, deletedAt)
  savePendingDeleteMap(PENDING_MEM_DELETES_KEY, map)
}

export function recordReminderDeleted(id: string, deletedAt = Date.now()): void {
  if (!id) return
  const map = loadPendingDeleteMap(PENDING_REM_DELETES_KEY)
  map[id] = Math.max(map[id] ?? 0, deletedAt)
  savePendingDeleteMap(PENDING_REM_DELETES_KEY, map)
}

function clearPendingDeletes(): void {
  savePendingDeleteMap(PENDING_MEM_DELETES_KEY, {})
  savePendingDeleteMap(PENDING_REM_DELETES_KEY, {})
}

function itemUpdatedAtMs(item: { updatedAt?: number; createdAt?: number }): number {
  if (typeof item.updatedAt === 'number' && item.updatedAt > 0) return item.updatedAt
  if (typeof item.createdAt === 'number' && item.createdAt > 0) return item.createdAt
  return 0
}

function mergeMemories(a: LongMemoryItem[], b: LongMemoryItem[]): LongMemoryItem[] {
  const map = new Map<string, LongMemoryItem>()
  for (const item of [...a, ...b]) {
    const prev = map.get(item.id)
    if (!prev || item.updatedAt >= prev.updatedAt) map.set(item.id, item)
  }
  return Array.from(map.values())
}

function mergeReminders(a: Reminder[], b: Reminder[]): Reminder[] {
  const map = new Map<string, Reminder>()
  for (const item of [...a, ...b]) {
    const normalized: Reminder = {
      ...item,
      updatedAt: itemUpdatedAtMs(item),
      createdAt: item.createdAt > 0 ? item.createdAt : Date.now(),
    }
    const prev = map.get(normalized.id)
    if (!prev) {
      map.set(normalized.id, normalized)
      continue
    }
    const pick = reminderUpdatedAt(normalized) >= reminderUpdatedAt(prev) ? normalized : prev
    const other = pick === normalized ? prev : normalized
    const notifiedAt =
      typeof pick.notifiedAt === 'number' || typeof other.notifiedAt === 'number'
        ? Math.max(pick.notifiedAt ?? 0, other.notifiedAt ?? 0) || undefined
        : undefined
    map.set(normalized.id, notifiedAt != null ? { ...pick, notifiedAt } : pick)
  }
  return Array.from(map.values())
}

function parseSnapshot(data: unknown): UserDataSnapshot | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  const longMemories = Array.isArray(d.longMemories) ? (d.longMemories as LongMemoryItem[]) : []
  const reminders = Array.isArray(d.reminders) ? (d.reminders as Reminder[]) : []
  const deletedMemoryIds = Array.isArray(d.deletedMemoryIds)
    ? d.deletedMemoryIds.filter((x): x is string => typeof x === 'string')
    : []
  const deletedReminderIds = Array.isArray(d.deletedReminderIds)
    ? d.deletedReminderIds.filter((x): x is string => typeof x === 'string')
    : []
  const deletedMemoryAt =
    d.deletedMemoryAt && typeof d.deletedMemoryAt === 'object' ? sanitizeDeleteAtMap(d.deletedMemoryAt) : {}
  const deletedReminderAt =
    d.deletedReminderAt && typeof d.deletedReminderAt === 'object'
      ? sanitizeDeleteAtMap(d.deletedReminderAt)
      : {}
  return {
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : null,
    longMemories,
    reminders,
    deletedMemoryIds,
    deletedReminderIds,
    deletedMemoryAt,
    deletedReminderAt,
  }
}

export type UserDataSyncPlan = {
  activeMemories: LongMemoryItem[]
  activeReminders: Reminder[]
  deletedMemoryIds: string[]
  deletedReminderIds: string[]
  deletedMemoryAt: DeleteAtMap
  deletedReminderAt: DeleteAtMap
}

export function planUserDataSync(params: {
  localMemories: LongMemoryItem[]
  localReminders: Reminder[]
  remote: UserDataSnapshot | null
  pendingMemoryDeletes?: DeleteAtMap
  pendingReminderDeletes?: DeleteAtMap
}): UserDataSyncPlan {
  const mergedMemories = mergeMemories(params.localMemories, params.remote?.longMemories ?? [])
  const mergedReminders = mergeReminders(params.localReminders, params.remote?.reminders ?? [])
  const deletedMemoryAt = mergeDeleteAtMaps(
    params.remote?.deletedMemoryAt ?? {},
    params.pendingMemoryDeletes,
  )
  const deletedReminderAt = mergeDeleteAtMaps(
    params.remote?.deletedReminderAt ?? {},
    params.pendingReminderDeletes,
  )
  const deletedMemoryIds = Array.from(
    deleteIdsSet(params.remote?.deletedMemoryIds ?? [], deletedMemoryAt),
  )
  const deletedReminderIds = Array.from(
    deleteIdsSet(params.remote?.deletedReminderIds ?? [], deletedReminderAt),
  )
  const deletedMemoryIdSet = new Set(deletedMemoryIds)
  const deletedReminderIdSet = new Set(deletedReminderIds)
  const activeMemories = mergedMemories.filter((m) => {
    if (!deletedMemoryIdSet.has(m.id)) return true
    const tomb = deletedMemoryAt[m.id]
    return tomb != null ? tomb < m.updatedAt : false
  })
  const activeReminders = mergedReminders.filter((r) => {
    if (!deletedReminderIdSet.has(r.id)) return true
    const tomb = deletedReminderAt[r.id]
    return tomb != null ? tomb < reminderUpdatedAt(r) : false
  })
  return {
    activeMemories,
    activeReminders,
    deletedMemoryIds,
    deletedReminderIds,
    deletedMemoryAt,
    deletedReminderAt,
  }
}

async function fetchRemoteSnapshot(root: string): Promise<UserDataSnapshot | null> {
  try {
    const res = await fetch(`${root}/tools/user-data`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    return parseSnapshot(await res.json())
  } catch {
    return null
  }
}

async function pushSnapshot(
  root: string,
  payload: {
    longMemories: LongMemoryItem[]
    reminders: Reminder[]
    deletedMemoryIds: string[]
    deletedReminderIds: string[]
    deletedMemoryAt: DeleteAtMap
    deletedReminderAt: DeleteAtMap
  },
): Promise<UserDataSnapshot | null> {
  try {
    const res = await fetch(`${root}/tools/user-data-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return null
    return parseSnapshot(await res.json())
  } catch {
    return null
  }
}

/**
 * Bidirectional sync: merge local IndexedDB with TTS server snapshot, apply deletes, push back.
 * Returns true if local data may have changed.
 */
export async function syncUserDataNow(ttsBaseUrl?: string): Promise<boolean> {
  if (typeof window === 'undefined') return false
  const root = normalizeBaseUrl(ttsBaseUrl?.trim() || defaultTtsBaseUrlForRuntime())

  const pendingMemDeletes = loadPendingDeleteMap(PENDING_MEM_DELETES_KEY)
  const pendingRemDeletes = loadPendingDeleteMap(PENDING_REM_DELETES_KEY)

  const localMemories = await listMemories(2000)
  const localReminders = await listReminders()
  const remote = await fetchRemoteSnapshot(root)

  const plan = planUserDataSync({
    localMemories,
    localReminders,
    remote,
    pendingMemoryDeletes: pendingMemDeletes,
    pendingReminderDeletes: pendingRemDeletes,
  })

  await applyMemoryDeletes(plan.deletedMemoryIds, plan.deletedMemoryAt)
  await applyReminderDeletes(plan.deletedReminderIds, plan.deletedReminderAt)
  await importMemoryItems(plan.activeMemories)
  await importReminderItems(plan.activeReminders)

  const pushed = await pushSnapshot(root, {
    longMemories: plan.activeMemories,
    reminders: plan.activeReminders,
    deletedMemoryIds: plan.deletedMemoryIds,
    deletedReminderIds: plan.deletedReminderIds,
    deletedMemoryAt: plan.deletedMemoryAt,
    deletedReminderAt: plan.deletedReminderAt,
  })

  if (pushed) clearPendingDeletes()
  return true
}

export function scheduleUserDataSync(ttsBaseUrl?: string): void {
  if (typeof window === 'undefined') return
  if (syncInFlight) {
    syncQueued = true
    return
  }
  syncInFlight = syncUserDataNow(ttsBaseUrl)
    .catch(() => false)
    .finally(() => {
      syncInFlight = null
      if (syncQueued) {
        syncQueued = false
        scheduleUserDataSync(ttsBaseUrl)
      }
    }) as Promise<boolean>
}
