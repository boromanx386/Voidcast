import { describe, expect, test } from 'vitest'
import {
  addTrustedMcpProjectPath,
  buildMcpProjectServerPreviews,
  describeMcpServerConfig,
  isMcpProjectTrusted,
  normalizeMcpProjectPath,
  shouldAllowProjectMcpConfig,
} from '@/lib/mcpProjectTrust'

describe('mcpProjectTrust', () => {
  test('normalizeMcpProjectPath is case-insensitive and slash-normalized', () => {
    expect(normalizeMcpProjectPath('C:\\Projects\\App\\')).toBe('c:/projects/app')
    expect(normalizeMcpProjectPath('/tmp/foo/')).toBe('/tmp/foo')
  })

  test('isMcpProjectTrusted matches normalized roots', () => {
    const trusted = ['C:/Projects/App']
    expect(isMcpProjectTrusted('c:\\projects\\app', trusted)).toBe(true)
    expect(isMcpProjectTrusted('c:/projects/other', trusted)).toBe(false)
  })

  test('addTrustedMcpProjectPath dedupes and sorts', () => {
    expect(addTrustedMcpProjectPath(['b/path'], 'A/Path')).toEqual(['a/path', 'b/path'])
    expect(addTrustedMcpProjectPath(['a/path'], 'a/path')).toEqual(['a/path'])
  })

  test('shouldAllowProjectMcpConfig gates untrusted project files', () => {
    expect(shouldAllowProjectMcpConfig('', [], true)).toBe(true)
    expect(shouldAllowProjectMcpConfig('/proj', [], false)).toBe(true)
    expect(shouldAllowProjectMcpConfig('/proj', [], true)).toBe(false)
    expect(shouldAllowProjectMcpConfig('/proj', ['/proj'], true)).toBe(true)
  })

  test('describe and preview server configs', () => {
    expect(describeMcpServerConfig({ url: 'http://x' })).toBe('url: http://x')
    expect(describeMcpServerConfig({ command: 'npx', args: ['-y', 'pkg'], cwd: '/x' })).toContain(
      'npx -y pkg',
    )
    const previews = buildMcpProjectServerPreviews({
      z: { command: 'z' },
      a: { url: 'http://a' },
    })
    expect(previews.map((p) => p.id)).toEqual(['a', 'z'])
    expect(previews[0]?.transport).toBe('url')
    expect(previews[1]?.transport).toBe('stdio')
  })
})
