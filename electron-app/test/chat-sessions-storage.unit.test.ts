import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { idbGetMeta } from '../src/lib/chatSessionsIndexedDb'
import {
  deleteChatSession,
  LEGACY_CHAT_SESSIONS_KEY,
  loadChatSessions,
  saveChatSessions,
} from '../src/lib/chatSessionsStorage'
import type { ChatSession } from '../src/types/chat'

/** Minimal localStorage for Node vitest (no happy-dom/jsdom). */
function installLocalStoragePolyfill(): void {
  const store = new Map<string, string>()
  const localStorageMock: Storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => {
      store.delete(key)
    },
    setItem: (key, value) => {
      store.set(key, String(value))
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    configurable: true,
    writable: true,
  })
}

function resetIndexedDb(): void {
  Object.defineProperty(globalThis, 'indexedDB', {
    value: new IDBFactory(),
    configurable: true,
    writable: true,
  })
}

installLocalStoragePolyfill()
resetIndexedDb()

function makeSession(partial: Partial<ChatSession> & { id: string; title: string }): ChatSession {
  const now = Date.now()
  return {
    createdAt: now,
    updatedAt: now,
    messages: [{ id: `${partial.id}-m1`, role: 'user', content: 'hello' }],
    ...partial,
  }
}

beforeEach(() => {
  localStorage.clear()
  resetIndexedDb()
})

afterEach(() => {
  localStorage.clear()
  resetIndexedDb()
})

describe('chat sessions IndexedDB storage', () => {
  it('round-trips two sessions', async () => {
    const a = makeSession({ id: 'a', title: 'Alpha', updatedAt: 200 })
    const b = makeSession({ id: 'b', title: 'Beta', updatedAt: 100 })
    await saveChatSessions({ sessions: [a, b], activeSessionId: 'a' })

    const loaded = await loadChatSessions()
    expect(loaded.activeSessionId).toBe('a')
    expect(loaded.sessions.map((s) => s.id)).toEqual(['a', 'b'])
    expect(loaded.sessions[0].title).toBe('Alpha')
    expect(loaded.sessions[1].title).toBe('Beta')
  })

  it('migrates once from localStorage and keeps the legacy key', async () => {
    const legacy = {
      sessions: [
        makeSession({ id: 'legacy-1', title: 'Old chat', updatedAt: 50 }),
        makeSession({ id: 'legacy-2', title: 'Older', updatedAt: 40 }),
      ],
      activeSessionId: 'legacy-1',
    }
    localStorage.setItem(LEGACY_CHAT_SESSIONS_KEY, JSON.stringify(legacy))

    const first = await loadChatSessions()
    expect(first.sessions).toHaveLength(2)
    expect(first.activeSessionId).toBe('legacy-1')
    expect(first.sessions.map((s) => s.id).sort()).toEqual(['legacy-1', 'legacy-2'])

    const meta = await idbGetMeta()
    expect(meta?.migratedFrom).toBe('localStorage-v1')
    expect(meta?.schemaVersion).toBe(1)

    // Legacy key preserved for rollback.
    expect(localStorage.getItem(LEGACY_CHAT_SESSIONS_KEY)).toBeTruthy()

    // Second load is idempotent (no duplicates).
    localStorage.setItem(
      LEGACY_CHAT_SESSIONS_KEY,
      JSON.stringify({
        sessions: [makeSession({ id: 'should-not-appear', title: 'Nope', updatedAt: 999 })],
        activeSessionId: 'should-not-appear',
      }),
    )
    const second = await loadChatSessions()
    expect(second.sessions).toHaveLength(2)
    expect(second.sessions.map((s) => s.id).sort()).toEqual(['legacy-1', 'legacy-2'])
    expect(second.activeSessionId).toBe('legacy-1')
  })

  it('deleteChatSession removes one session', async () => {
    const a = makeSession({ id: 'keep', title: 'Keep', updatedAt: 2 })
    const b = makeSession({ id: 'drop', title: 'Drop', updatedAt: 1 })
    await saveChatSessions({ sessions: [a, b], activeSessionId: 'drop' })

    await deleteChatSession('drop')
    const loaded = await loadChatSessions()
    expect(loaded.sessions.map((s) => s.id)).toEqual(['keep'])
    expect(loaded.activeSessionId).toBeNull()
  })

  it('save replaces removed sessions', async () => {
    const a = makeSession({ id: 'a', title: 'A', updatedAt: 3 })
    const b = makeSession({ id: 'b', title: 'B', updatedAt: 2 })
    await saveChatSessions({ sessions: [a, b], activeSessionId: 'a' })
    await saveChatSessions({ sessions: [a], activeSessionId: 'a' })

    const loaded = await loadChatSessions()
    expect(loaded.sessions.map((s) => s.id)).toEqual(['a'])
  })
})
