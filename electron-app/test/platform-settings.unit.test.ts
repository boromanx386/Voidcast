import { describe, expect, it } from 'vitest'

// Mirror of settings.ts helper — keep in sync if moved to a shared module later.
function isViteDevServerUrl(url: string): boolean {
  const raw = url.trim()
  if (!raw) return false
  try {
    const u = new URL(raw.includes('://') ? raw : `http://${raw}`)
    const h = u.hostname.toLowerCase()
    if (h !== 'localhost' && h !== '127.0.0.1') return false
    const port = u.port || (u.protocol === 'https:' ? '443' : '80')
    return port === '5173' || port === '7777' || port === '4173'
  } catch {
    return /localhost:5173|127\.0\.0\.1:5173|localhost:7777|127\.0\.0\.1:7777|localhost:4173|127\.0\.0\.1:4173/.test(
      raw,
    )
  }
}

describe('isViteDevServerUrl', () => {
  it('detects vite dev and preview ports', () => {
    expect(isViteDevServerUrl('http://localhost:5173')).toBe(true)
    expect(isViteDevServerUrl('http://localhost:5173/api/deepseek')).toBe(true)
    expect(isViteDevServerUrl('http://127.0.0.1:8765')).toBe(false)
    expect(isViteDevServerUrl('https://api.deepseek.com')).toBe(false)
  })
})
