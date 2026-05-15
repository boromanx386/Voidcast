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

function loadPendingIds(key: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : []
  } catch {
    return []
  }
}

function savePendingIds(key: string, ids: string[]): void {
  if (typeof window === 'undefined') return
  const unique = Array.from(new Set(ids))
  if (unique.length === 0) localStorage.removeItem(key)
  else localStorage.setItem(key, JSON.stringify(unique))
}

export function recordMemoryDeleted(id: string): void {
  const ids = loadPendingIds(PENDING_MEM_DELETES_KEY)
  if (!ids.includes(id)) ids.push(id)
  savePendingIds(PENDING_MEM_DELETES_KEY, ids)
}

export function recordReminderDeleted(id: string): void {
  const ids = loadPendingIds(PENDING_REM_DELETES_KEY)
  if (!ids.includes(id)) ids.push(id)
  savePendingIds(PENDING_REM_DELETES_KEY, ids)
}

function clearPendingDeletes(): void {
  savePendingIds(PENDING_MEM_DELETES_KEY, [])
  savePendingIds(PENDING_REM_DELETES_KEY, [])
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
    d.deletedMemoryAt && typeof d.deletedMemoryAt === 'object'
      ? (d.deletedMemoryAt as Record<string, number>)
      : {}
  const deletedReminderAt =
    d.deletedReminderAt && typeof d.deletedReminderAt === 'object'
      ? (d.deletedReminderAt as Record<string, number>)
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

  const pendingMemDeletes = loadPendingIds(PENDING_MEM_DELETES_KEY)
  const pendingRemDeletes = loadPendingIds(PENDING_REM_DELETES_KEY)

  const localMemories = await listMemories(2000)
  const localReminders = await listReminders()
  const remote = await fetchRemoteSnapshot(root)

  const mergedMemories = mergeMemories(
    localMemories,
    remote?.longMemories ?? [],
  )
  const mergedReminders = mergeReminders(
    localReminders,
    remote?.reminders ?? [],
  )

  const deletedMemoryIds = Array.from(
    new Set([...(remote?.deletedMemoryIds ?? []), ...pendingMemDeletes]),
  )
  const deletedReminderIds = Array.from(
    new Set([...(remote?.deletedReminderIds ?? []), ...pendingRemDeletes]),
  )
  const deletedMemoryAt = remote?.deletedMemoryAt ?? {}
  const deletedReminderAt = remote?.deletedReminderAt ?? {}

  const activeMemories = mergedMemories.filter((m) => {
    const tomb = deletedMemoryAt[m.id]
    return tomb == null || tomb < m.updatedAt
  })
  const activeReminders = mergedReminders.filter((r) => {
    const tomb = deletedReminderAt[r.id]
    return tomb == null || tomb < reminderUpdatedAt(r)
  })

  await applyMemoryDeletes(deletedMemoryIds, deletedMemoryAt)
  await applyReminderDeletes(deletedReminderIds, deletedReminderAt)
  await importMemoryItems(activeMemories)
  await importReminderItems(activeReminders)

  const pushed = await pushSnapshot(root, {
    longMemories: activeMemories,
    reminders: activeReminders,
    deletedMemoryIds,
    deletedReminderIds,
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
