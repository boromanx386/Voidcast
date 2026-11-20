// Attach the per-run desktop credential to requests for the local tools server only.

type DesktopAuth = { token: string; port: number }

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  // A Request object.
  return input.url
}

export function toolsAuthHeader(url: URL, desktop: DesktopAuth | null): [string, string] | null {
  if (
    !desktop ||
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    Number(url.port || '80') !== desktop.port
  )
    return null
  return ['x-voidcast-desktop-token', desktop.token]
}

export function initToolsAuth(): void {
  if (typeof window === 'undefined') return
  const desktop = window.voidcast?.getToolsAuth() ?? null
  if (!desktop) return
  const originalFetch = window.fetch.bind(window)
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    let url: URL
    try {
      url = new URL(requestUrl(input), window.location.href)
    } catch {
      // Let fetch report the bad URL as a rejected promise, as it normally would.
      return originalFetch(input, init)
    }
    const auth = toolsAuthHeader(url, desktop)
    if (!auth) return originalFetch(input, init)
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    )
    headers.set(...auth)
    // Custom authentication headers can survive a cross-origin redirect.
    return originalFetch(input, { ...init, headers, redirect: 'error' })
  }) as typeof fetch
}
