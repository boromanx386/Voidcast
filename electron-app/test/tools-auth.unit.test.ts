import { describe, expect, it } from 'vitest'
import { toolsAuthHeader } from '../src/lib/lanAuth'

describe('tools request credentials', () => {
  const desktop = { token: 'desktop-test', port: 8765 }
  const phoneOrigin = 'http://192.0.2.7:8765'

  it('sends the desktop credential only to the local tools listener', () => {
    for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
      expect(
        toolsAuthHeader(new URL(`http://${host}:8765/tools/pdf`), desktop, 'null', ''),
      ).toEqual(['x-voidcast-desktop-token', desktop.token])
    }
    for (const url of ['http://localhost:11434/', phoneOrigin, 'https://example.com:8765/']) {
      expect(toolsAuthHeader(new URL(url), desktop, 'null', '')).toBeNull()
    }
  })

  it('sends the paired phone credential only to its own origin', () => {
    expect(
      toolsAuthHeader(new URL('/tools/search', phoneOrigin), null, phoneOrigin, 'phone'),
    ).toEqual(['x-voidcast-access-token', 'phone'])
    expect(
      toolsAuthHeader(new URL('http://127.0.0.1:8765/'), null, phoneOrigin, 'phone'),
    ).toBeNull()
  })
})
