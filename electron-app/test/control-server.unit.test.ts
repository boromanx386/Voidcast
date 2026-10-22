import { mkdtemp, readFile, rm } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  CONTROL_INFO_FILE,
  createRendererRequester,
  routeControlRequest,
  startControlServer,
  waitForIdle,
  type ControlDispatch,
  type ControlServerHandle,
} from '../electron/main/controlServer'

type Res = { status: number; body: unknown }

function request(
  port: number,
  opts: { method?: string; path: string; headers?: Record<string, string> },
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: opts.method ?? 'GET',
        path: opts.path,
        headers: opts.headers,
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null }),
        )
      },
    )
    req.on('error', reject)
    req.end()
  })
}

describe('routeControlRequest', () => {
  const route = (m: string, p: string) => routeControlRequest(m, new URL(p, 'http://x'))

  test('maps the phase-1 routes', () => {
    expect(route('GET', '/chats')).toEqual({ method: 'chats.list', params: {} })
    expect(route('GET', '/chats/abc')).toEqual({ method: 'chats.get', params: { id: 'abc' } })
    expect(route('GET', '/chats/abc/transcript?since=3&limit=5')).toEqual({
      method: 'chats.transcript',
      params: { since: '3', limit: '5', id: 'abc' },
    })
    expect(route('POST', '/chats/abc/stop')).toEqual({
      method: 'chats.stop',
      params: { id: 'abc' },
    })
  })

  test('a query string cannot override the path id', () => {
    expect(route('GET', '/chats/real/transcript?id=evil')?.params.id).toBe('real')
  })

  test('maps create, send and wait, with the path id winning over the body', () => {
    expect(routeControlRequest('POST', new URL('/chats', 'http://x'), { text: 'hi' })).toEqual({
      method: 'chats.create',
      params: { text: 'hi' },
    })
    expect(
      routeControlRequest('POST', new URL('/chats/abc/send', 'http://x'), {
        text: 'hi',
        id: 'evil',
      }),
    ).toEqual({ method: 'chats.send', params: { text: 'hi', id: 'abc' } })
    expect(route('GET', '/chats/abc/wait?timeout=5')).toEqual({
      method: 'chats.wait',
      params: { timeout: '5', id: 'abc' },
    })
  })

  test('rejects wrong verbs and unknown paths', () => {
    expect(route('GET', '/chats/abc/stop')).toBeNull()
    expect(route('DELETE', '/chats')).toBeNull()
    expect(route('GET', '/chats/abc/send')).toBeNull()
    expect(route('GET', '/other')).toBeNull()
  })
})

describe('createRendererRequester', () => {
  test('correlates the reply by id', async () => {
    let sent: { id: string } | null = null
    const r = createRendererRequester({
      send: (req) => {
        sent = req
        return true
      },
    })
    const pending = r.dispatch('chats.list', {})
    r.resolve({ id: sent!.id, result: { ok: true, data: [1] } })
    expect(await pending).toEqual({ ok: true, data: [1] })
  })

  test('times out with 504', async () => {
    const r = createRendererRequester({ send: () => true, timeoutMs: 20 })
    expect(await r.dispatch('chats.list', {})).toMatchObject({ ok: false, status: 504 })
  })

  test('no window → 503 immediately', async () => {
    const r = createRendererRequester({ send: () => false })
    expect(await r.dispatch('chats.list', {})).toMatchObject({ ok: false, status: 503 })
  })

  test('a reply with an unknown id is ignored', async () => {
    const r = createRendererRequester({ send: () => true, timeoutMs: 20 })
    const pending = r.dispatch('chats.list', {})
    r.resolve({ id: 'stranger', result: { ok: true, data: 1 } })
    expect(await pending).toMatchObject({ status: 504 })
  })
})

describe('control server over loopback', () => {
  let handle: ControlServerHandle | null = null
  let dir = ''

  afterEach(async () => {
    await handle?.stop()
    handle = null
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  async function boot(dispatch: ControlDispatch = async () => ({ ok: true, data: { hi: 1 } })) {
    dir = await mkdtemp(path.join(os.tmpdir(), 'voidcast-control-'))
    handle = await startControlServer({ userDataDir: dir, dispatch })
    return handle
  }

  test('publishes control.json and removes it on stop', async () => {
    const h = await boot()
    const info = JSON.parse(await readFile(path.join(dir, CONTROL_INFO_FILE), 'utf8'))
    expect(info).toMatchObject({
      port: h.port,
      token: h.token,
      baseUrl: `http://127.0.0.1:${h.port}`,
    })
    await h.stop()
    handle = null
    await expect(readFile(path.join(dir, CONTROL_INFO_FILE))).rejects.toThrow()
  })

  test('rejects a missing or wrong token', async () => {
    const h = await boot()
    expect((await request(h.port, { path: '/chats' })).status).toBe(401)
    expect(
      (await request(h.port, { path: '/chats', headers: { authorization: 'Bearer nope' } })).status,
    ).toBe(401)
  })

  test('accepts the bearer token and relays the reply', async () => {
    const h = await boot()
    const res = await request(h.port, {
      path: '/chats',
      headers: { authorization: `Bearer ${h.token}` },
    })
    expect(res).toEqual({ status: 200, body: { hi: 1 } })
  })

  test('rejects browser origins even with a valid token', async () => {
    const h = await boot()
    const res = await request(h.port, {
      path: '/chats',
      headers: { authorization: `Bearer ${h.token}`, origin: 'http://evil.example' },
    })
    expect(res.status).toBe(403)
  })

  test('rejects a rebound Host header', async () => {
    const h = await boot()
    const res = await request(h.port, {
      path: '/chats',
      headers: { authorization: `Bearer ${h.token}`, host: 'evil.example' },
    })
    expect(res.status).toBe(403)
  })

  test('maps renderer errors to their status and unknown routes to 404', async () => {
    const h = await boot(async () => ({ ok: false, status: 404, error: 'Unknown chat id.' }))
    const auth = { authorization: `Bearer ${h.token}` }
    expect(await request(h.port, { path: '/chats/x', headers: auth })).toEqual({
      status: 404,
      body: { error: 'Unknown chat id.' },
    })
    expect((await request(h.port, { path: '/nope', headers: auth })).status).toBe(404)
  })

  test('POST body reaches the dispatcher; bad or oversized bodies are 400', async () => {
    let seen: { method: string; params: Record<string, unknown> } | null = null
    const h = await boot(async (method, params) => {
      seen = { method, params }
      return { ok: true, data: { fine: true } }
    })
    const post = (payload: string) =>
      new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port: h.port,
            method: 'POST',
            path: '/chats',
            headers: { authorization: `Bearer ${h.token}`, 'content-type': 'application/json' },
          },
          (res) => {
            res.resume()
            res.on('end', () => resolve(res.statusCode ?? 0))
          },
        )
        req.on('error', reject)
        req.end(payload)
      })
    expect(await post(JSON.stringify({ text: 'hello' }))).toBe(200)
    expect(seen).toEqual({ method: 'chats.create', params: { text: 'hello' } })
    expect(await post('{nope')).toBe(400)
    expect(await post('[1]')).toBe(400)
    expect(await post(JSON.stringify({ text: 'x'.repeat(300 * 1024) }))).toBe(400)
  })

  test('a throwing dispatcher becomes a 500', async () => {
    const h = await boot(async () => {
      throw new Error('boom')
    })
    const res = await request(h.port, {
      path: '/chats',
      headers: { authorization: `Bearer ${h.token}` },
    })
    expect(res).toEqual({ status: 500, body: { error: 'boom' } })
  })
})

describe('waitForIdle', () => {
  const noSleep = async () => {}

  test('returns as soon as the chat is idle', async () => {
    let polls = 0
    const dispatch: ControlDispatch = async () => ({
      ok: true,
      data: { id: 'a', busy: ++polls < 3 },
    })
    const reply = await waitForIdle(dispatch, 'a', '30', noSleep)
    expect(reply).toEqual({ ok: true, data: { id: 'a', busy: false, timedOut: false } })
    expect(polls).toBe(3)
  })

  test('times out while still busy', async () => {
    const dispatch: ControlDispatch = async () => ({ ok: true, data: { id: 'a', busy: true } })
    const reply = await waitForIdle(dispatch, 'a', 0, noSleep)
    expect(reply).toMatchObject({ ok: true, data: { busy: true, timedOut: true } })
  })

  test('passes an unknown chat through', async () => {
    const dispatch: ControlDispatch = async () => ({
      ok: false,
      status: 404,
      error: 'Unknown chat id.',
    })
    expect(await waitForIdle(dispatch, 'x', '5', noSleep)).toMatchObject({
      ok: false,
      status: 404,
    })
  })
})
