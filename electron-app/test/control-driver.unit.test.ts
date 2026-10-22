import { describe, expect, test, vi } from 'vitest'
import { createControlDriver, type ControlDriverEnv } from '../src/lib/controlDriver'
import type { ChatSession } from '../src/types/chat'

function chat(id: string): ChatSession {
  return { id, title: id, createdAt: 1, updatedAt: 1, messages: [] }
}

const START = { projectPath: '', mode: 'agent' as const, model: '', background: true }

/** A fake UI: navigation mutates `active`; send() "claims" an id and goes busy. */
function fakeEnv(opts: { startActive: string | null; sendBehavior?: 'busy' | 'reject' | 'noop' }) {
  const sessions = new Map<string, ChatSession>([
    ['prev', chat('prev')],
    ['other', chat('other')],
  ])
  const state = { active: opts.startActive, busy: new Set<string>() }
  const calls: string[] = []
  const env: ControlDriverEnv = {
    getActiveSessionId: () => state.active,
    getSession: (id) => sessions.get(id),
    isBusy: (id) => state.busy.has(id),
    messageCount: () => 0,
    slotError: () => 'Already running 3 agents.',
    newChatForProject: (path) => {
      calls.push(`new:${path}`)
      state.active = null
    },
    setPendingMode: (mode) => calls.push(`mode:${mode}`),
    openSession: (s) => {
      calls.push(`open:${s.id}`)
      state.active = s.id
    },
    setModelForSession: (id, model) => calls.push(`model:${id}:${model}`),
    send: vi.fn(async (o) => {
      calls.push(`send:${o.text}:${o.forceAgentMode ?? '-'}:${o.forceModel ?? '-'}`)
      if (opts.sendBehavior === 'reject') throw new Error('boom')
      if (opts.sendBehavior === 'noop') return
      const id = state.active ?? 'new-1'
      if (!state.active) {
        sessions.set(id, chat(id))
        state.active = id
      }
      state.busy.add(id)
      await new Promise(() => {}) // the turn never ends within the test
    }),
    sleep: async () => {},
  }
  return { env, state, calls }
}

describe('startChat', () => {
  test('creates a chat, sends with mode/model, pins the model and returns to the previous chat', async () => {
    const { env, state, calls } = fakeEnv({ startActive: 'prev' })
    const res = await createControlDriver(env).startChat({
      ...START,
      text: 'build it',
      projectPath: 'C:/p',
      mode: 'team',
      model: 'ollama:m',
    })
    expect(res).toEqual({ id: 'new-1' })
    expect(calls).toEqual([
      'new:C:/p',
      'mode:team',
      'send:build it:team:ollama:m',
      'model:new-1:ollama:m',
      'open:prev',
    ])
    expect(state.active).toBe('prev')
    expect(state.busy.has('new-1')).toBe(true)
  })

  test('foreground stays on the new chat', async () => {
    const { env, state } = fakeEnv({ startActive: 'prev' })
    await createControlDriver(env).startChat({ ...START, text: 't', background: false })
    expect(state.active).toBe('new-1')
  })

  test('does not navigate back to a draft (no previous chat id)', async () => {
    const { env, calls } = fakeEnv({ startActive: null })
    await createControlDriver(env).startChat({ ...START, text: 't' })
    expect(calls.some((c) => c.startsWith('open:'))).toBe(false)
  })

  test('a rejected send surfaces as a 500', async () => {
    const { env } = fakeEnv({ startActive: 'prev', sendBehavior: 'reject' })
    const res = await createControlDriver(env).startChat({ ...START, text: 't' })
    expect(res).toEqual({ error: 'boom', status: 500 })
  })

  test('a send that never starts reports the slot error as 409', async () => {
    const { env } = fakeEnv({ startActive: 'prev', sendBehavior: 'noop' })
    const res = await createControlDriver(env).startChat({ ...START, text: 't' })
    expect(res).toMatchObject({ status: 409 })
  })
})

describe('sendToChat', () => {
  test('opens the target, sends, then returns to the previous chat', async () => {
    const { env, state, calls } = fakeEnv({ startActive: 'prev' })
    const res = await createControlDriver(env).sendToChat('other', 'go', true)
    expect(res).toEqual({ id: 'other' })
    expect(calls).toEqual(['open:other', 'send:go:-:-', 'open:prev'])
    expect(state.active).toBe('prev')
  })

  test('sending to the chat already on screen does not navigate', async () => {
    const { env, calls } = fakeEnv({ startActive: 'other' })
    await createControlDriver(env).sendToChat('other', 'go', true)
    expect(calls).toEqual(['send:go:-:-'])
  })

  test('unknown chat is 404', async () => {
    const { env } = fakeEnv({ startActive: 'prev' })
    expect(await createControlDriver(env).sendToChat('nope', 'go', true)).toEqual({
      error: 'Unknown chat id.',
      status: 404,
    })
  })

  test('actions are serialised: the second waits for the first to finish navigating', async () => {
    const { env, calls } = fakeEnv({ startActive: 'prev' })
    const driver = createControlDriver(env)
    const a = driver.sendToChat('other', 'one', true)
    const b = driver.startChat({ ...START, text: 'two' })
    await Promise.all([a, b])
    expect(calls.indexOf('send:one:-:-')).toBeLessThan(calls.indexOf('new:'))
  })
})
