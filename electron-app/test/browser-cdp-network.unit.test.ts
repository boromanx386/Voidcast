import { describe, expect, test } from 'vitest'
import type { WebContents } from 'electron'
import { CdpSession } from '../electron/main/browser/cdp'

type Emit = (method: string, params: Record<string, unknown>) => void

/** A CdpSession over a fake webContents; `emit` plays the debugger's event stream. */
function attachedSession(): { session: CdpSession; emit: Emit } {
  let listener: ((event: unknown, method: string, params: Record<string, unknown>) => void) | null =
    null
  const wc = {
    getURL: () => 'https://example.test/',
    getTitle: () => 'Example',
    debugger: {
      attach: () => undefined,
      isAttached: () => true,
      on: (_name: string, fn: typeof listener) => {
        listener = fn
      },
      removeListener: () => undefined,
      detach: () => undefined,
      sendCommand: async () => ({}),
    },
  } as unknown as WebContents
  const session = new CdpSession(wc)
  return {
    session,
    emit: (method, params) => listener?.(undefined, method, params),
  }
}

describe('CdpSession network tracking', () => {
  test('a redirect chain counts as one request, so networkIdle settles', async () => {
    const { session, emit } = attachedSession()
    await session.attach()
    emit('Network.requestWillBeSent', {
      requestId: 'r1',
      request: { method: 'GET', url: 'http://example.test/' },
    })
    emit('Network.requestWillBeSent', {
      requestId: 'r1',
      request: { method: 'GET', url: 'https://example.test/' },
      redirectResponse: { status: 301 },
    })
    emit('Network.responseReceived', {
      requestId: 'r1',
      response: { status: 200, url: 'https://example.test/' },
    })

    await expect(session.waitFor({ networkIdle: true, timeoutMs: 300 })).resolves.toMatch(
      /network idle/,
    )
    expect(session.networkRequestText()).toBe(
      [
        'GET 301 http://example.test/ -> https://example.test/',
        'GET 200 https://example.test/',
      ].join('\n'),
    )
  })

  test('an unanswered request still blocks networkIdle', async () => {
    const { session, emit } = attachedSession()
    await session.attach()
    emit('Network.requestWillBeSent', {
      requestId: 'r2',
      request: { method: 'GET', url: 'https://example.test/slow' },
    })
    await expect(session.waitFor({ networkIdle: true, timeoutMs: 300 })).rejects.toThrow(
      /Still missing: network idle/,
    )
  })
})
