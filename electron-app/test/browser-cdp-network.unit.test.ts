import { describe, expect, test } from 'vitest'
import type { WebContents } from 'electron'
import { CdpSession } from '../electron/main/browser/cdp'

type Emit = (method: string, params: Record<string, unknown>) => void

/** A CdpSession over a fake webContents; `emit` plays the debugger's event stream. */
function attachedSession(
  sendCommand: (
    method: string,
    params: Record<string, unknown>,
  ) => Promise<unknown> = async () => ({}),
): { session: CdpSession; emit: Emit } {
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
      sendCommand,
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

  test('a page script error fails fast instead of reading as "selector missing"', async () => {
    const { session } = attachedSession(async (method) =>
      method === 'Runtime.evaluate'
        ? {
            result: { type: 'object', subtype: 'error' },
            exceptionDetails: {
              text: 'Uncaught',
              exception: {
                description:
                  "SyntaxError: Failed to execute 'querySelector' on 'Document': 'a[' is not a valid selector.\n    at <anonymous>:1:12",
              },
            },
          }
        : {},
    )
    await session.attach()
    const started = Date.now()
    await expect(session.waitFor({ selector: 'a[', timeoutMs: 5000 })).rejects.toThrow(
      "Page script failed: SyntaxError: Failed to execute 'querySelector' on 'Document': 'a[' is not a valid selector.",
    )
    expect(Date.now() - started).toBeLessThan(1000)
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

describe('CdpSession snapshot', () => {
  const axNode = (nodeId: string, role: string, name = '') => ({
    nodeId,
    role: { value: role },
    name: { value: name },
    backendDOMNodeId: Number(nodeId),
  })
  // Two actionable nodes buried in the generic/StaticText noise every real page has.
  const tree = {
    nodes: [
      axNode('1', 'RootWebArea', 'Example'),
      axNode('2', 'generic'),
      axNode('3', 'StaticText', 'hello'),
      axNode('4', 'button', 'Save'),
      { nodeId: '5', ignored: true },
    ],
  }
  const treeSession = () =>
    attachedSession(async (method) => (method === 'Accessibility.getFullAXTree' ? tree : {}))

  test('skipped noise nodes do not make a full snapshot look truncated', async () => {
    const { session } = treeSession()
    await session.attach()
    const text = await session.snapshot(400)
    expect(text).toContain('4 button name="Save"')
    expect(text).not.toContain('truncated')
  })

  test('a real cut counts only the nodes that would have been listed', async () => {
    const { session } = treeSession()
    await session.attach()
    const text = await session.snapshot(1)
    expect(text).toContain('(truncated to 1 of 2 nodes — raise max_nodes to see the rest)')
    expect(text).not.toContain('button')
  })
})
