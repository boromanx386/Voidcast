import * as cheerio from 'cheerio'
import dns from 'node:dns/promises'
import net from 'node:net'

const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 10
const FETCH_TIMEOUT_MS = 20_000

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (
    parts.length !== 4 ||
    parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)
  ) {
    return true
  }
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

function isPrivateIPv6(ip: string): boolean {
  const x = ip.toLowerCase()
  if (x === '::1') return true
  if (x.startsWith('fe80:')) return true
  if (x.startsWith('fec0:')) return true
  if (x.startsWith('fc') || x.startsWith('fd')) return true
  if (x.startsWith('ff')) return true
  if (x.startsWith('::ffff:')) {
    const tail = x.slice(7)
    const last = tail.split(':').pop() ?? ''
    if (net.isIPv4(last)) return isPrivateIPv4(last)
  }
  return false
}

async function assertHostIsPublic(hostname: string): Promise<void> {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost')) {
    throw new Error('Local host is not allowed')
  }
  if (net.isIPv4(h)) {
    if (isPrivateIPv4(h)) throw new Error('Private IPv4 addresses are not allowed')
    return
  }
  if (net.isIPv6(h)) {
    if (isPrivateIPv6(h)) throw new Error('Private IPv6 addresses are not allowed')
    return
  }
  const results = await dns.lookup(h, { all: true })
  if (!results.length) throw new Error('Could not resolve host')
  for (const r of results) {
    if (r.family === 4) {
      if (isPrivateIPv4(r.address)) {
        throw new Error('Host resolves to a private IPv4 address')
      }
    } else if (r.family === 6) {
      if (isPrivateIPv6(r.address)) {
        throw new Error('Host resolves to a private IPv6 address')
      }
    }
  }
}

async function assertUrlSafeForFetch(u: URL): Promise<void> {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed')
  }
  if (u.username || u.password) throw new Error('URL credentials are not allowed')
  const host = u.hostname
  if (!host) throw new Error('Invalid host')
  await assertHostIsPublic(host)
}

async function readBodyLimited(res: Response, maxBytes: number): Promise<Buffer> {
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')
  const chunks: Buffer[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error(`Page is larger than ${maxBytes} bytes`)
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

function htmlToPlainText(html: string): string {
  const $ = cheerio.load(html)
  $('script, style, noscript, svg, iframe, object, embed').remove()
  const text = $('body').length ? $('body').text() : $.root().text()
  return text.replace(/\s+/g, ' ').trim()
}

function looksLikeHtml(s: string): boolean {
  const t = s.slice(0, 512).toLowerCase()
  return (
    t.includes('<html') ||
    t.includes('<!doctype') ||
    t.includes('<head') ||
    t.includes('<body')
  )
}

function bufferToUtf8(buf: Buffer): string {
  return buf.toString('utf8')
}

function extractTextFromBuffer(buf: Buffer, contentType: string): string {
  const ct = contentType.toLowerCase()
  const raw = bufferToUtf8(buf)

  if (ct.includes('text/html') || ct.includes('application/xhtml')) {
    return htmlToPlainText(raw)
  }
  if (ct.includes('text/plain') || (ct.includes('text/') && !ct.includes('html'))) {
    return raw.replace(/\s+/g, ' ').trim()
  }
  if (ct.includes('application/json') || ct.includes('/xml')) {
    return raw.replace(/\s+/g, ' ').trim()
  }
  if (!ct.trim() || looksLikeHtml(raw)) {
    return htmlToPlainText(raw)
  }
  throw new Error(
    `Unsupported content type (${contentType || 'unknown'}); only text and HTML are supported`,
  )
}

function clampMaxChars(n: unknown): number {
  const d = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : 40_000
  return Math.min(120_000, Math.max(2_000, d))
}

/**
 * Fetch a public http(s) URL, strip HTML to plain text, truncate for the LLM.
 * Validates each redirect hop for SSRF (no LAN/metadata targets).
 */
export async function scrapePublicUrlToText(
  urlStr: string,
  maxCharsArg: unknown,
): Promise<{ ok: boolean; text: string }> {
  const maxChars = clampMaxChars(maxCharsArg)
  const trimmed = String(urlStr ?? '').trim()
  if (!trimmed) return { ok: false, text: 'Empty URL' }

  let current = trimmed
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)

  try {
    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
      let u: URL
      try {
        u = new URL(current)
      } catch {
        return { ok: false, text: 'Invalid URL' }
      }
      await assertUrlSafeForFetch(u)

      const res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: ac.signal,
        headers: {
          'User-Agent': 'Voidcast/1.0 (scrape_url tool)',
          Accept:
            'text/html,application/xhtml+xml,text/plain,application/json;q=0.8,*/*;q=0.5',
        },
      })

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        if (!loc) return { ok: false, text: 'Redirect without Location header' }
        current = new URL(loc, current).href
        continue
      }

      if (!res.ok) {
        return { ok: false, text: `HTTP ${res.status}` }
      }

      const ct = res.headers.get('content-type') ?? ''
      const buf = await readBodyLimited(res, MAX_BODY_BYTES)
      let text: string
      try {
        text = extractTextFromBuffer(buf, ct)
      } catch (e) {
        return {
          ok: false,
          text: e instanceof Error ? e.message : String(e),
        }
      }
      if (text.length > maxChars) {
        text = `${text.slice(0, maxChars)}\n\n[Truncated to ${maxChars} characters]`
      }
      return { ok: true, text }
    }
    return { ok: false, text: 'Too many redirects' }
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      return { ok: false, text: 'Request timed out' }
    }
    return {
      ok: false,
      text: e instanceof Error ? e.message : String(e),
    }
  } finally {
    clearTimeout(t)
  }
}
