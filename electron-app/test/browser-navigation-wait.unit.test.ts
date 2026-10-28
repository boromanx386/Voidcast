import { EventEmitter } from 'node:events'
import { describe, expect, test } from 'vitest'
import { settleNavigation, type NavigationEvents } from '../electron/main/browser/navigationWait'

const fakeWebContents = () => new EventEmitter() as EventEmitter & NavigationEvents

describe('settleNavigation', () => {
  test('waits for the load to stop instead of a fixed delay', async () => {
    const wc = fakeWebContents()
    let settled = false
    const done = settleNavigation(wc, () => undefined, 5000).then((r) => {
      settled = true
      return r
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(settled).toBe(false)
    wc.emit('did-stop-loading')
    await expect(done).resolves.toEqual({ timedOut: false })
    expect(wc.listenerCount('did-stop-loading')).toBe(0)
    expect(wc.listenerCount('did-navigate-in-page')).toBe(0)
  })

  test('listens before triggering, so a navigation that settles at once is not missed', async () => {
    const wc = fakeWebContents()
    await expect(settleNavigation(wc, () => wc.emit('did-stop-loading'), 5000)).resolves.toEqual({
      timedOut: false,
    })
  })

  test('a same-document step settles on the main frame only', async () => {
    const wc = fakeWebContents()
    const done = settleNavigation(wc, () => undefined, 200)
    wc.emit('did-navigate-in-page', {}, 'https://example.test/#frame', false)
    wc.emit('did-navigate-in-page', {}, 'https://example.test/#main', true)
    await expect(done).resolves.toEqual({ timedOut: false })
  })

  test('a slow page resolves on timeout instead of failing the step', async () => {
    const wc = fakeWebContents()
    await expect(settleNavigation(wc, () => undefined, 30)).resolves.toEqual({ timedOut: true })
    expect(wc.listenerCount('did-stop-loading')).toBe(0)
  })

  test('a failing trigger rejects and removes its listeners', async () => {
    const wc = fakeWebContents()
    await expect(
      settleNavigation(wc, () => Promise.reject(new Error('CDP timeout')), 5000),
    ).rejects.toThrow('CDP timeout')
    expect(wc.listenerCount('did-stop-loading')).toBe(0)
  })
})
