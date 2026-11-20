// Attach local credentials only to their intended tools server.

const TOKEN_STORAGE_KEY = 'voidcast_lan_token'
const AUTH_HEADER = 'x-voidcast-access-token'

let accessToken = ''

export function getLanAccessToken(): string {
  return accessToken
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  // A Request object.
  return input.url
}

function bootstrapTokenFromUrl(): void {
  const url = new URL(window.location.href)
  const t = url.searchParams.get('t')
  if (t && t.trim()) {
    accessToken = t.trim()
    try {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, accessToken)
    } catch {
      /* storage may be unavailable (private mode) — keep in-memory only */
    }
    // Strip the token from the address bar so it doesn't linger in history/logs.
    url.searchParams.delete('t')
    try {
      window.history.replaceState(window.history.state, '', url.toString())
    } catch {
      /* ignore */
    }
  } else {
    // Restore from session so a refresh keeps working (survives reload, cleared on close).
    try {
      accessToken = window.sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? ''
    } catch {
      accessToken = ''
    }
  }
}

type DesktopAuth = { token: string; port: number }

export function toolsAuthHeader(
  url: URL,
  desktop: DesktopAuth | null,
  pageOrigin: string,
  phoneToken: string,
): [string, string] | null {
  if (desktop) {
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      Number(url.port || '80') !== desktop.port
    )
      return null
    return ['x-voidcast-desktop-token', desktop.token]
  }
  return phoneToken && url.origin === pageOrigin ? [AUTH_HEADER, phoneToken] : null
}

export function initLanAccess(): void {
  if (typeof window === 'undefined') return
  const desktop = window.voidcast?.getToolsAuth() ?? null
  if (!desktop) bootstrapTokenFromUrl()
  if (!desktop && !accessToken) return
  const originalFetch = window.fetch.bind(window)
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(requestUrl(input), window.location.href)
    const auth = toolsAuthHeader(url, desktop, window.location.origin, accessToken)
    if (!auth) return originalFetch(input, init)
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    )
    headers.set(...auth)
    // Custom authentication headers can survive a cross-origin redirect.
    return originalFetch(input, { ...init, headers, redirect: 'error' })
  }) as typeof fetch
}
