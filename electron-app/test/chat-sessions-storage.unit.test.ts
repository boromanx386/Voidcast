import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { idbGetMeta } from '../src/lib/chatSessionsIndexedDb'
import {
  deleteChatSession,
  deleteSessionsByIds,
  flushSaveChatSessions,
  LEGACY_CHAT_SESSIONS_KEY,
  loadChatSessions,
  saveChatSessions,
  scheduleSaveChatSessions,
  setChatSessionsPersistence,
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
  it.each([false, true])(
    'keeps saved chats after a temporary read failure (legacy copy: %s)',
    async (hasLegacyCopy) => {
      const chat = makeSession({ id: 'saved', title: 'Saved chat' })
      await saveChatSessions({ sessions: [chat], activeSessionId: chat.id })
      if (hasLegacyCopy) {
        const old = makeSession({ id: 'old', title: 'Old chat' })
        localStorage.setItem(
          LEGACY_CHAT_SESSIONS_KEY,
          JSON.stringify({ sessions: [old], activeSessionId: old.id }),
        )
      }
      const open = vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => {
        throw new Error('Temporary database failure')
      })
      try {
        // A completed load reaches the same debounced autosave as startup hydration.
        await expect(loadChatSessions().then(scheduleSaveChatSessions)).rejects.toThrow(
          'Temporary database failure',
        )
      } finally {
        open.mockRestore()
        await flushSaveChatSessions()
      }
      const recovered = await loadChatSessions()
      expect(recovered.activeSessionId).toBe(chat.id)
      expect(recovered.sessions).toMatchObject([chat])
    },
  )

  it('retries legacy migration after a temporary localStorage read failure', async () => {
    const chat = makeSession({ id: 'legacy', title: 'Before migration' })
    localStorage.setItem(
      LEGACY_CHAT_SESSIONS_KEY,
      JSON.stringify({ sessions: [chat], activeSessionId: chat.id }),
    )
    const read = vi.spyOn(localStorage, 'getItem').mockImplementationOnce(() => {
      throw new Error('Legacy storage unavailable')
    })
    try {
      await expect(loadChatSessions()).rejects.toThrow('Legacy storage unavailable')
      expect(await idbGetMeta()).toBeUndefined()
    } finally {
      read.mockRestore()
    }
    expect((await loadChatSessions()).sessions).toMatchObject([chat])
  })

  it('starts empty instead of failing forever on an unparseable legacy copy', async () => {
    localStorage.setItem(LEGACY_CHAT_SESSIONS_KEY, '{not json')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(await loadChatSessions()).toEqual({ sessions: [], activeSessionId: null })
    } finally {
      warn.mockRestore()
    }
    expect(await idbGetMeta()).toMatchObject({ migratedFrom: 'localStorage-v1' })
  })

  it('leaves migration pending if a parsed legacy chat cannot be normalized', async () => {
    const chat = makeSession({ id: 'keep', title: 'Saved chat' })
    const invalid = { ...chat, id: 'invalid', messages: [null] }
    const raw = JSON.stringify({ sessions: [chat, invalid], activeSessionId: chat.id })
    localStorage.setItem(LEGACY_CHAT_SESSIONS_KEY, raw)

    await expect(loadChatSessions()).rejects.toThrow()
    expect(await idbGetMeta()).toBeUndefined()
    expect(localStorage.getItem(LEGACY_CHAT_SESSIONS_KEY)).toBe(raw)
  })

  it('writes nothing while persistence is off', async () => {
    const chat = makeSession({ id: 'saved', title: 'Saved chat' })
    await saveChatSessions({ sessions: [chat], activeSessionId: chat.id })
    const fresh = makeSession({ id: 'fresh', title: 'Offline chat' })
    scheduleSaveChatSessions({ sessions: [fresh], activeSessionId: fresh.id })
    setChatSessionsPersistence(false)
    try {
      scheduleSaveChatSessions({ sessions: [fresh], activeSessionId: fresh.id })
      await flushSaveChatSessions()
    } finally {
      setChatSessionsPersistence(true)
    }
    const loaded = await loadChatSessions()
    expect(loaded.activeSessionId).toBe(chat.id)
    expect(loaded.sessions).toMatchObject([chat])
  })

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

  it('omits sticky unsaved sessions from disk and clears active if only draft', async () => {
    const durable = makeSession({ id: 'd', title: 'Durable', updatedAt: 300 })
    const sticky = makeSession({
      id: 'u',
      title: 'Sticky',
      updatedAt: 400,
      unsaved: true,
    })
    await saveChatSessions({ sessions: [sticky, durable], activeSessionId: 'u' })

    const loaded = await loadChatSessions()
    expect(loaded.sessions.map((s) => s.id)).toEqual(['d'])
    expect(loaded.activeSessionId).toBeNull()
    expect(loaded.sessions[0]?.unsaved).toBeUndefined()
  })

  it('keeps the legacy copy available for retry if migration cannot commit', async () => {
    const chat = makeSession({ id: 'legacy', title: 'Legacy chat' })
    localStorage.setItem(
      LEGACY_CHAT_SESSIONS_KEY,
      JSON.stringify({ sessions: [chat], activeSessionId: chat.id }),
    )
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function () {
      this.transaction.abort()
      throw new Error('Migration interrupted')
    })
    try {
      await expect(loadChatSessions()).rejects.toThrow('Migration interrupted')
      expect(await idbGetMeta()).toBeUndefined()
    } finally {
      put.mockRestore()
    }
    const recovered = await loadChatSessions()
    expect(recovered.activeSessionId).toBe(chat.id)
    expect(recovered.sessions).toMatchObject([chat])
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

  it('deleteSessionsByIds drops many at once and moves active only when it was removed', () => {
    const a = makeSession({ id: 'a', title: 'A', updatedAt: 3 })
    const b = makeSession({ id: 'b', title: 'B', updatedAt: 2 })
    const c = makeSession({ id: 'c', title: 'C', updatedAt: 1 })

    const keepsActive = deleteSessionsByIds({ sessions: [a, b, c], activeSessionId: 'a' }, [
      'b',
      'c',
    ])
    expect(keepsActive.sessions.map((s) => s.id)).toEqual(['a'])
    expect(keepsActive.activeSessionId).toBe('a')

    const movesActive = deleteSessionsByIds({ sessions: [a, b, c], activeSessionId: 'a' }, [
      'a',
      'b',
    ])
    expect(movesActive.sessions.map((s) => s.id)).toEqual(['c'])
    expect(movesActive.activeSessionId).toBe('c')

    const empty = deleteSessionsByIds({ sessions: [a], activeSessionId: 'a' }, ['a'])
    expect(empty).toEqual({ sessions: [], activeSessionId: null })
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
