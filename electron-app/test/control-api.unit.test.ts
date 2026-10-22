import { describe, expect, test, vi } from 'vitest'
import { handleControlRequest, type ControlDeps } from '../src/lib/controlApi'
import type { SessionAgentSlot } from '../src/lib/sessionAgentStore'
import type { ChatSession, UiMessage } from '../src/types/chat'

function msg(id: string, role: UiMessage['role'], content: string): UiMessage {
  return { id, role, content }
}

function session(id: string, over: Partial<ChatSession> = {}): ChatSession {
  return {
    id,
    title: `chat ${id}`,
    createdAt: 1,
    updatedAt: 1,
    messages: [msg('m1', 'user', 'hello'), msg('m2', 'assistant', 'hi there')],
    ...over,
  }
}

function slot(over: Partial<SessionAgentSlot>): SessionAgentSlot {
  return { messages: [], busy: false, error: null, toolPhase: null, ...over } as SessionAgentSlot
}

function deps(sessions: ChatSession[], slots: Record<string, SessionAgentSlot> = {}) {
  const stop = vi.fn()
  const d: ControlDeps = {
    listSessions: () => sessions,
    getSlot: (id) => slots[id],
    stop,
  }
  return { d, stop }
}

describe('chats.list', () => {
  test('lists chats newest first with live busy state', async () => {
    const { d } = deps([session('a', { updatedAt: 1 }), session('b', { updatedAt: 9 })], {
      a: slot({ busy: true }),
    })
    const res = await handleControlRequest('chats.list', {}, d)
    expect(res.ok).toBe(true)
    const chats = (res as { ok: true; data: { chats: Array<{ id: string; busy: boolean }> } }).data
      .chats
    expect(chats.map((c) => c.id)).toEqual(['b', 'a'])
    expect(chats.find((c) => c.id === 'a')?.busy).toBe(true)
    expect(chats.find((c) => c.id === 'b')?.busy).toBe(false)
  })
})

describe('chats.get', () => {
  test('prefers live slot messages over the persisted copy', async () => {
    const { d } = deps([session('a')], {
      a: slot({
        messages: [msg('x', 'user', 'a'), msg('y', 'assistant', 'b'), msg('z', 'user', 'c')],
      }),
    })
    const res = await handleControlRequest('chats.get', { id: 'a' }, d)
    expect((res as { ok: true; data: { messageCount: number } }).data.messageCount).toBe(3)
  })

  test('falls back to persisted messages when the slot is empty', async () => {
    const { d } = deps([session('a')], { a: slot({}) })
    const res = await handleControlRequest('chats.get', { id: 'a' }, d)
    const data = (
      res as { ok: true; data: { messageCount: number; lastMessage: { preview: string } } }
    ).data
    expect(data.messageCount).toBe(2)
    expect(data.lastMessage.preview).toBe('hi there')
  })

  test('unknown id is a 404', async () => {
    const { d } = deps([session('a')])
    expect(await handleControlRequest('chats.get', { id: 'nope' }, d)).toMatchObject({
      ok: false,
      status: 404,
    })
    expect(await handleControlRequest('chats.get', {}, d)).toMatchObject({ ok: false, status: 404 })
  })
})

describe('chats.transcript', () => {
  const many = session('a', {
    messages: Array.from({ length: 10 }, (_, i) =>
      msg(`m${i}`, i % 2 ? 'assistant' : 'user', `t${i}`),
    ),
  })

  test('pages from `since` and reports the total for the next poll', async () => {
    const { d } = deps([many])
    const res = await handleControlRequest(
      'chats.transcript',
      { id: 'a', since: '4', limit: '3' },
      d,
    )
    const data = (
      res as { ok: true; data: { total: number; from: number; messages: Array<{ index: number }> } }
    ).data
    expect(data.total).toBe(10)
    expect(data.from).toBe(4)
    expect(data.messages.map((m) => m.index)).toEqual([4, 5, 6])
  })

  test('since past the end is an empty page, not an error', async () => {
    const { d } = deps([many])
    const res = await handleControlRequest('chats.transcript', { id: 'a', since: 99 }, d)
    expect((res as { ok: true; data: { messages: unknown[] } }).data.messages).toEqual([])
  })

  test('clips long messages and flags them', async () => {
    const { d } = deps([session('a', { messages: [msg('m', 'assistant', 'x'.repeat(50))] })])
    const res = await handleControlRequest('chats.transcript', { id: 'a', maxChars: 10 }, d)
    const m = (
      res as { ok: true; data: { messages: Array<{ content: string; truncated: boolean }> } }
    ).data.messages[0]!
    expect(m.content).toBe(`${'x'.repeat(10)}…`)
    expect(m.truncated).toBe(true)
  })

  test('intermediate agent drafts are opt-in via progress=1', async () => {
    const withDrafts = session('a', {
      messages: [
        {
          ...msg('m', 'assistant', 'final answer'),
          agentProgress: [
            { round: 0, content: 'Let me look at the files.' },
            { round: 1, content: 'x'.repeat(50) },
          ],
        },
      ],
    })
    const { d } = deps([withDrafts])
    const plain = await handleControlRequest('chats.transcript', { id: 'a' }, d)
    expect(JSON.stringify(plain)).not.toContain('Let me look')
    const res = await handleControlRequest(
      'chats.transcript',
      { id: 'a', progress: '1', maxChars: 10 },
      d,
    )
    const m = (
      res as {
        ok: true
        data: { messages: Array<{ progress: Array<{ round: number; content: string }> }> }
      }
    ).data.messages[0]!
    expect(m.progress.map((b) => b.round)).toEqual([0, 1])
    expect(m.progress[1]!.content).toBe(`${'x'.repeat(10)}…`)
  })

  test('never leaks image payloads', async () => {
    const { d } = deps([
      session('a', { messages: [{ ...msg('m', 'user', 'see'), images: ['AAAA'] }] }),
    ])
    const res = await handleControlRequest('chats.transcript', { id: 'a' }, d)
    expect(JSON.stringify(res)).not.toContain('AAAA')
  })

  test('garbage numeric params fall back to defaults', async () => {
    const { d } = deps([many])
    const res = await handleControlRequest(
      'chats.transcript',
      { id: 'a', since: 'x', limit: -5 },
      d,
    )
    expect((res as { ok: true; data: { from: number; messages: unknown[] } }).data.from).toBe(0)
    expect((res as { ok: true; data: { messages: unknown[] } }).data.messages).toHaveLength(1)
  })
})

describe('chats.stop', () => {
  test('stops a busy chat', async () => {
    const { d, stop } = deps([session('a')], { a: slot({ busy: true }) })
    const res = await handleControlRequest('chats.stop', { id: 'a' }, d)
    expect(res).toEqual({ ok: true, data: { stopped: true } })
    expect(stop).toHaveBeenCalledWith('a')
  })

  test('an idle chat is a no-op', async () => {
    const { d, stop } = deps([session('a')], { a: slot({ busy: false }) })
    expect(await handleControlRequest('chats.stop', { id: 'a' }, d)).toEqual({
      ok: true,
      data: { stopped: false },
    })
    expect(stop).not.toHaveBeenCalled()
  })
})

test('unknown method is a 404', async () => {
  const { d } = deps([])
  expect(await handleControlRequest('chats.delete', {}, d)).toMatchObject({
    ok: false,
    status: 404,
  })
})

describe('chats.create / chats.send', () => {
  function sendDeps(
    allowed: boolean,
    sessions = [session('a')],
    slots: Record<string, SessionAgentSlot> = {},
  ) {
    const startChat = vi.fn(async () => ({ id: 'new-1' }))
    const sendToChat = vi.fn(async (id: string) => ({ id }))
    const base = deps(sessions, slots)
    const d: ControlDeps = { ...base.d, sendAllowed: () => allowed, startChat, sendToChat }
    return { d, startChat, sendToChat }
  }

  test('refused with 403 until the user allows starting turns', async () => {
    const { d, startChat, sendToChat } = sendDeps(false)
    expect(await handleControlRequest('chats.create', { text: 'hi' }, d)).toMatchObject({
      ok: false,
      status: 403,
    })
    expect(await handleControlRequest('chats.send', { id: 'a', text: 'hi' }, d)).toMatchObject({
      ok: false,
      status: 403,
    })
    expect(startChat).not.toHaveBeenCalled()
    expect(sendToChat).not.toHaveBeenCalled()
  })

  test('create applies defaults and passes validated input through', async () => {
    const { d, startChat } = sendDeps(true)
    const res = await handleControlRequest(
      'chats.create',
      { text: '  do it  ', projectPath: ' C:/proj ', model: 'ollama:x' },
      d,
    )
    expect(res).toEqual({ ok: true, data: { id: 'new-1', started: true } })
    expect(startChat).toHaveBeenCalledWith({
      text: 'do it',
      projectPath: 'C:/proj',
      mode: 'agent',
      model: 'ollama:x',
      background: true,
    })
  })

  test('create rejects empty text, bad mode and oversize text', async () => {
    const { d } = sendDeps(true)
    expect(await handleControlRequest('chats.create', { text: '   ' }, d)).toMatchObject({
      status: 400,
    })
    expect(
      await handleControlRequest('chats.create', { text: 'x', mode: 'root' }, d),
    ).toMatchObject({ status: 400 })
    expect(
      await handleControlRequest('chats.create', { text: 'x'.repeat(100_001) }, d),
    ).toMatchObject({ status: 400 })
  })

  test('background can be switched off', async () => {
    const { d, startChat } = sendDeps(true)
    await handleControlRequest('chats.create', { text: 'x', background: false }, d)
    expect(startChat).toHaveBeenCalledWith(expect.objectContaining({ background: false }))
  })

  test('send to an unknown chat is 404, to a busy chat is 409', async () => {
    const { d, sendToChat } = sendDeps(true, [session('a')], { a: slot({ busy: true }) })
    expect(await handleControlRequest('chats.send', { id: 'zz', text: 'x' }, d)).toMatchObject({
      status: 404,
    })
    expect(await handleControlRequest('chats.send', { id: 'a', text: 'x' }, d)).toMatchObject({
      status: 409,
    })
    expect(sendToChat).not.toHaveBeenCalled()
  })

  test('send to an idle chat calls the driver', async () => {
    const { d, sendToChat } = sendDeps(true)
    const res = await handleControlRequest('chats.send', { id: 'a', text: 'again' }, d)
    expect(res).toEqual({ ok: true, data: { id: 'a', started: true } })
    expect(sendToChat).toHaveBeenCalledWith('a', 'again', true)
  })

  test('a driver error is surfaced with its status', async () => {
    const { d } = sendDeps(true)
    d.startChat = async () => ({ error: 'Already running 3 agents.', status: 409 })
    expect(await handleControlRequest('chats.create', { text: 'x' }, d)).toEqual({
      ok: false,
      status: 409,
      error: 'Already running 3 agents.',
    })
  })
})
