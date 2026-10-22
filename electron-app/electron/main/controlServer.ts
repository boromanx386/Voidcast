/**
 * Local control API: lets an external agent (MCP shim, CLI, scripts) inspect and
 * stop chats of the running app.
 *
 * The agent loop lives in the renderer, so this server owns no chat state — it
 * authenticates a request, relays `{ method, params }` to the renderer and
 * returns the reply. Loopback only, bearer token, no browser origins.
 * `wait` is the one method answered here: it polls the renderer's chat status.
 */

import http from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AddressInfo } from 'node:net'

export type ControlReply =
  { ok: true; data: unknown } | { ok: false; status: number; error: string }

export type ControlDispatch = (
  method: string,
  params: Record<string, unknown>,
) => Promise<ControlReply>

/** Starting a turn may switch the view and wait for the run to go live. */
export const CONTROL_RENDERER_TIMEOUT_MS = 20_000
export const CONTROL_BODY_MAX_BYTES = 256 * 1024
export const CONTROL_WAIT_DEFAULT_S = 60
export const CONTROL_WAIT_MAX_S = 600
const CONTROL_WAIT_POLL_MS = 500
export const CONTROL_INFO_FILE = 'control.json'

/** `{ method, params }` → the renderer's reply, correlated by request id. */
export function createRendererRequester(opts: {
  send: (request: { id: string; method: string; params: Record<string, unknown> }) => boolean
  timeoutMs?: number
}): {
  dispatch: ControlDispatch
  resolve: (payload: { id: string; result: ControlReply }) => void
} {
  const pending = new Map<string, (reply: ControlReply) => void>()
  const timeoutMs = opts.timeoutMs ?? CONTROL_RENDERER_TIMEOUT_MS
  return {
    dispatch: (method, params) =>
      new Promise<ControlReply>((resolve) => {
        const id = randomUUID()
        const timer = setTimeout(() => {
          pending.delete(id)
          resolve({ ok: false, status: 504, error: 'The app did not answer in time.' })
        }, timeoutMs)
        pending.set(id, (reply) => {
          clearTimeout(timer)
          resolve(reply)
        })
        if (!opts.send({ id, method, params })) {
          clearTimeout(timer)
          pending.delete(id)
          resolve({ ok: false, status: 503, error: 'No app window is available.' })
        }
      }),
    resolve: (payload) => {
      const done = payload && typeof payload.id === 'string' ? pending.get(payload.id) : undefined
      if (!done) return
      pending.delete(payload.id)
      done(
        payload.result && typeof payload.result === 'object'
          ? payload.result
          : { ok: false, status: 500, error: 'Malformed renderer reply.' },
      )
    },
  }
}

type Route = { method: string; params: Record<string, unknown> }

/** Map an HTTP request to a control method; null = no such route. */
export function routeControlRequest(
  httpMethod: string,
  url: URL,
  body: Record<string, unknown> = {},
): Route | null {
  const parts = url.pathname.split('/').filter(Boolean)
  const query: Record<string, unknown> = {}
  for (const [k, v] of url.searchParams) query[k] = v

  if (parts[0] !== 'chats') return null
  if (parts.length === 1) {
    if (httpMethod === 'GET') return { method: 'chats.list', params: {} }
    if (httpMethod === 'POST') return { method: 'chats.create', params: body }
    return null
  }
  // The path id always wins over a same-named query/body field.
  const id = parts[1] ? decodeURIComponent(parts[1]) : ''
  if (!id) return null
  if (parts.length === 2 && httpMethod === 'GET') return { method: 'chats.get', params: { id } }
  if (parts.length === 3 && httpMethod === 'GET' && parts[2] === 'transcript') {
    return { method: 'chats.transcript', params: { ...query, id } }
  }
  if (parts.length === 3 && httpMethod === 'GET' && parts[2] === 'wait') {
    return { method: 'chats.wait', params: { ...query, id } }
  }
  if (parts.length === 3 && httpMethod === 'POST' && parts[2] === 'stop') {
    return { method: 'chats.stop', params: { id } }
  }
  if (parts.length === 3 && httpMethod === 'POST' && parts[2] === 'send') {
    return { method: 'chats.send', params: { ...body, id } }
  }
  return null
}

/** Poll `chats.get` until the chat is idle or the deadline passes. */
export async function waitForIdle(
  dispatch: ControlDispatch,
  id: string,
  timeoutRaw: unknown,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<ControlReply> {
  const asNumber = Number(timeoutRaw)
  const seconds =
    timeoutRaw !== undefined && Number.isFinite(asNumber)
      ? Math.max(0, Math.min(CONTROL_WAIT_MAX_S, asNumber))
      : CONTROL_WAIT_DEFAULT_S
  const deadline = Date.now() + seconds * 1000
  for (;;) {
    const reply = await dispatch('chats.get', { id })
    if (!reply.ok) return reply
    const status = reply.data as { busy?: boolean }
    const timedOut = Date.now() >= deadline
    if (!status.busy || timedOut) {
      return { ok: true, data: { ...(reply.data as object), timedOut: Boolean(status.busy) } }
    }
    await sleep(CONTROL_WAIT_POLL_MS)
  }
}

/** Read a small JSON object body; null = too large or not a JSON object. */
function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > CONTROL_BODY_MAX_BYTES) tooLarge = true
      else chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) return resolve(null)
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) return resolve({})
      try {
        const parsed: unknown = JSON.parse(raw)
        resolve(
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null,
        )
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

function tokenMatches(header: string | undefined, token: string): boolean {
  const given = (header ?? '').replace(/^Bearer\s+/i, '').trim()
  const a = Buffer.from(given)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

export function createControlServer(opts: {
  token: string
  dispatch: ControlDispatch
}): http.Server {
  return http.createServer((req, res) => {
    const host = (req.headers.host ?? '').toLowerCase()
    const port = (req.socket.localPort ?? 0).toString()
    // DNS-rebinding guard: only the literal loopback names are accepted as Host.
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      writeJson(res, 403, { error: 'Forbidden host.' })
      return
    }
    // Browsers always send Origin on cross-site requests; this API is not for them.
    if (req.headers.origin) {
      writeJson(res, 403, { error: 'Browser origins are not allowed.' })
      return
    }
    const auth = req.headers.authorization ?? (req.headers['x-voidcast-control-token'] as string)
    if (!tokenMatches(typeof auth === 'string' ? auth : undefined, opts.token)) {
      writeJson(res, 401, { error: 'Missing or invalid token.' })
      return
    }

    void (async () => {
      try {
        const httpMethod = req.method ?? 'GET'
        const body = httpMethod === 'POST' ? await readJsonBody(req) : (req.resume(), {})
        if (body === null) {
          writeJson(res, 400, { error: 'Body must be a JSON object under 256 KB.' })
          return
        }
        let route: Route | null = null
        try {
          route = routeControlRequest(httpMethod, new URL(req.url ?? '/', 'http://127.0.0.1'), body)
        } catch {
          route = null
        }
        if (!route) {
          writeJson(res, 404, { error: 'Not found.' })
          return
        }
        const reply =
          route.method === 'chats.wait'
            ? await waitForIdle(opts.dispatch, String(route.params.id), route.params.timeout)
            : await opts.dispatch(route.method, route.params)
        if (reply.ok) writeJson(res, 200, reply.data)
        else writeJson(res, reply.status, { error: reply.error })
      } catch (error: unknown) {
        writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    })()
  })
}

export type ControlServerHandle = {
  port: number
  token: string
  stop: () => Promise<void>
}

/**
 * Start listening on a random loopback port and publish `{ port, token, pid }`
 * to `<userData>/control.json` so a local client can find it. The token is
 * fresh on every start, so disabling and re-enabling revokes old clients.
 */
export async function startControlServer(opts: {
  userDataDir: string
  dispatch: ControlDispatch
}): Promise<ControlServerHandle> {
  const token = randomBytes(24).toString('hex')
  const server = createControlServer({ token, dispatch: opts.dispatch })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (server.address() as AddressInfo).port
  const infoPath = path.join(opts.userDataDir, CONTROL_INFO_FILE)
  await mkdir(opts.userDataDir, { recursive: true })
  await writeFile(
    infoPath,
    JSON.stringify({ baseUrl: `http://127.0.0.1:${port}`, port, token, pid: process.pid }),
    { mode: 0o600 },
  )
  return {
    port,
    token,
    stop: async () => {
      await new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      })
      await rm(infoPath, { force: true })
    },
  }
}
