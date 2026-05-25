import { describe, expect, test } from 'vitest'
import type { Reminder } from '../src/lib/reminderStorage'
import { planUserDataSync, type UserDataSnapshot } from '../src/lib/userDataSync'
import type { LongMemoryItem } from '../src/types/longMemory'

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'rem-1',
    text: 'Pay the bill',
    when: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    status: 'pending',
    tags: [],
    source: 'manual',
    ...overrides,
  }
}

function makeMemory(overrides: Partial<LongMemoryItem> = {}): LongMemoryItem {
  return {
    id: 'mem-1',
    kind: 'fact',
    text: 'User prefers dark mode.',
    tags: ['ui'],
    importance: 0.8,
    confidence: 0.9,
    createdAt: 1_000,
    updatedAt: 1_000,
    lastUsedAt: 0,
    sourceSessionId: 'session-1',
    ...overrides,
  }
}

function makeSnapshot(overrides: Partial<UserDataSnapshot> = {}): UserDataSnapshot {
  return {
    updatedAt: null,
    longMemories: [],
    reminders: [],
    deletedMemoryIds: [],
    deletedReminderIds: [],
    deletedMemoryAt: {},
    deletedReminderAt: {},
    ...overrides,
  }
}

describe('planUserDataSync', () => {
  test('pending reminder delete suppresses stale remote reminder resurrection', () => {
    const staleRemoteReminder = makeReminder({ id: 'rem-stale', updatedAt: 1_000, createdAt: 900 })
    const plan = planUserDataSync({
      localMemories: [],
      localReminders: [],
      remote: makeSnapshot({ reminders: [staleRemoteReminder] }),
      pendingMemoryDeletes: {},
      pendingReminderDeletes: { 'rem-stale': 2_000 },
    })

    expect(plan.deletedReminderIds).toContain('rem-stale')
    expect(plan.deletedReminderAt['rem-stale']).toBe(2_000)
    expect(plan.activeReminders).toEqual([])
  })

  test('pending long-memory delete suppresses stale remote memory resurrection', () => {
    const staleRemoteMemory = makeMemory({ id: 'mem-stale', updatedAt: 1_500 })
    const plan = planUserDataSync({
      localMemories: [],
      localReminders: [],
      remote: makeSnapshot({ longMemories: [staleRemoteMemory] }),
      pendingMemoryDeletes: { 'mem-stale': 2_500 },
      pendingReminderDeletes: {},
    })

    expect(plan.deletedMemoryIds).toContain('mem-stale')
    expect(plan.deletedMemoryAt['mem-stale']).toBe(2_500)
    expect(plan.activeMemories).toEqual([])
  })
})
