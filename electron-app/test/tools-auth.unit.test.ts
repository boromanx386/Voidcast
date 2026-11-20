import { describe, expect, it } from 'vitest'
import { toolsAuthHeader } from '../src/lib/toolsAuth'

describe('tools request credentials', () => {
  const desktop = { token: 'desktop-test', port: 8765 }

  it('sends the desktop credential only to the local tools listener', () => {
    for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
      expect(toolsAuthHeader(new URL(`http://${host}:8765/tools/pdf`), desktop)).toEqual([
        'x-voidcast-desktop-token',
        desktop.token,
      ])
    }
    for (const url of [
      'http://localhost:11434/',
      'http://192.0.2.7:8765/',
      'https://example.com:8765/',
      'https://127.0.0.1:8765/',
    ]) {
      expect(toolsAuthHeader(new URL(url), desktop)).toBeNull()
    }
  })

  it('sends nothing without a desktop credential', () => {
    expect(toolsAuthHeader(new URL('http://127.0.0.1:8765/tools/search'), null)).toBeNull()
  })
})
