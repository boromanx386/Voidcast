import { describe, expect, test } from 'vitest'
import { isMcpOAuthEnabled } from '../electron/main/mcpOAuth'

describe('isMcpOAuthEnabled', () => {
  test('requires remote url', () => {
    expect(isMcpOAuthEnabled({ command: 'node' })).toBe(false)
    expect(isMcpOAuthEnabled(undefined)).toBe(false)
  })

  test('supports boolean and object oauth flags', () => {
    expect(isMcpOAuthEnabled({ url: 'http://localhost/mcp', oauth: true })).toBe(true)
    expect(isMcpOAuthEnabled({ url: 'http://localhost/mcp', oauth: { scope: 'x' } })).toBe(true)
    expect(isMcpOAuthEnabled({ url: 'http://localhost/mcp', oauth: { enabled: false } })).toBe(
      false,
    )
  })
})
