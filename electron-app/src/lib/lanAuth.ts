// LAN access token bootstrap + global fetch interceptor (web/LAN build only).
//
// The desktop embeds the shared access token in the phone's connection URL as
// ?t=<token> (see LanWebAccessPanel). This module reads it once, strips it from
// the address bar (so it doesn't linger in history/server logs), and injects the
// `x-voidcast-access-token` header into every same-origin request. On the Electron
// desktop build there is no ?t= and the token stays empty, so nothing is sent —
// the desktop talks to the server over loopback, which is always allowed.

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

function shouldAttach(input: RequestInfo | URL): boolean {
  if (!accessToken) return false
  let url: URL
  try {
    url = new URL(requestUrl(input), window.location.href)
  } catch {
    return false
  }
  // Only attach to same-origin requests (the LAN server), not external APIs.
  return url.origin === window.location.origin
}

export function initLanAccess(): void {
  if (typeof window === 'undefined') return
  bootstrapTokenFromUrl()
  if (!accessToken) return
  const originalFetch = window.fetch.bind(window)
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (shouldAttach(input)) {
      const headers = new Headers(init?.headers)
      if (!headers.has(AUTH_HEADER)) {
        headers.set(AUTH_HEADER, accessToken)
      }
      init = { ...(init ?? {}), headers }
    }
    return originalFetch(input, init)
  }) as typeof fetch
}
