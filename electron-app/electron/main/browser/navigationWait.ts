/**
 * Wait for a history step or reload to settle, kept free of Electron so it can be unit tested.
 *
 * back/forward/reload used to sleep a fixed 400ms and then read the URL: on anything slower
 * the agent got the OLD url back and its next snapshot landed mid-navigation. This waits for
 * the main frame to actually finish instead.
 */

/** The slice of `WebContents` this needs — an EventEmitter with Electron's event names. */
export type NavigationEvents = {
  on(event: 'did-stop-loading', listener: () => void): unknown
  on(
    event: 'did-navigate-in-page',
    listener: (event: unknown, url: string, isMainFrame: boolean) => void,
  ): unknown
  removeListener(event: 'did-stop-loading', listener: () => void): unknown
  removeListener(
    event: 'did-navigate-in-page',
    listener: (event: unknown, url: string, isMainFrame: boolean) => void,
  ): unknown
}

/**
 * Run `trigger`, then resolve once the navigation it started has settled: a full load ends
 * with `did-stop-loading` (success, error page or abort alike), a same-document step
 * (hash/pushState history) fires only `did-navigate-in-page`. Listeners go on BEFORE the
 * trigger so a fast navigation cannot slip past them.
 *
 * Never rejects on timeout: a page still loading after `timeoutMs` is a slow page, not a
 * failed step — the caller reports whatever URL it has by then. A trigger error rejects.
 */
export function settleNavigation(
  wc: NavigationEvents,
  trigger: () => Promise<unknown> | unknown,
  timeoutMs: number,
): Promise<{ timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    let done = false
    const cleanup = (): void => {
      clearTimeout(timer)
      wc.removeListener('did-stop-loading', onStop)
      wc.removeListener('did-navigate-in-page', onInPage)
    }
    const finish = (timedOut: boolean): void => {
      if (done) return
      done = true
      cleanup()
      resolve({ timedOut })
    }
    const onStop = (): void => finish(false)
    const onInPage = (_event: unknown, _url: string, isMainFrame: boolean): void => {
      if (isMainFrame) finish(false)
    }
    wc.on('did-stop-loading', onStop)
    wc.on('did-navigate-in-page', onInPage)
    const timer = setTimeout(() => finish(true), timeoutMs)
    Promise.resolve()
      .then(trigger)
      .catch((e: unknown) => {
        if (done) return
        done = true
        cleanup()
        reject(e instanceof Error ? e : new Error(String(e)))
      })
  })
}
