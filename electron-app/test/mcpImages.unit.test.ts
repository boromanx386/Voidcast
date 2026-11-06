import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  MCP_IMAGE_MAX_BASE64_CHARS,
  saveMcpResultImages,
  toolResultToString,
  withSavedMcpImageLines,
} from '../electron/main/mcpManager'
import { extractSavedImagePaths } from '../src/lib/runwareMessageMeta'

const PNG_BASE64 = Buffer.from('fake-png-bytes').toString('base64')

describe('MCP image results', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'voidcast-mcp-images-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('saves image blocks to disk and drops the base64 from the text', async () => {
    const content = [
      { type: 'text', text: 'Here is the chart' },
      { type: 'image', data: PNG_BASE64, mimeType: 'image/png' },
    ]
    const { paths, notes } = await saveMcpResultImages(content, dir, 'mcp__viz__chart')

    expect(paths).toHaveLength(1)
    expect(paths[0].endsWith('.png')).toBe(true)
    expect((await readFile(paths[0])).toString()).toBe('fake-png-bytes')

    const text = withSavedMcpImageLines(toolResultToString({ content }, notes), paths)
    expect(extractSavedImagePaths(text)).toEqual(paths)
    expect(text).toContain('Here is the chart')
    expect(text).not.toContain(PNG_BASE64)
    expect(text).not.toContain('omitted')
  })

  test('saves images carried in embedded resource blocks', async () => {
    const content = [
      {
        type: 'resource',
        resource: { uri: 'file:///a.jpg', mimeType: 'image/jpeg', blob: PNG_BASE64 },
      },
      { type: 'resource', resource: { uri: 'file:///a.txt', mimeType: 'text/plain', text: 'hi' } },
    ]
    const { paths, notes } = await saveMcpResultImages(content, dir, 'tool')
    expect(paths).toHaveLength(1)
    expect(paths[0].endsWith('.jpg')).toBe(true)
    expect(toolResultToString({ content }, notes)).toContain('file:///a.txt')
  })

  test('explains which images were not saved', async () => {
    const content = [
      { type: 'image', data: PNG_BASE64, mimeType: 'image/svg+xml' },
      { type: 'image', data: 'x'.repeat(MCP_IMAGE_MAX_BASE64_CHARS + 1), mimeType: 'image/png' },
    ]
    const { paths, notes } = await saveMcpResultImages(content, dir, 'tool')
    expect(paths).toEqual([])
    const text = toolResultToString({ content }, notes)
    expect(text).toContain('unsupported type image/svg+xml')
    expect(text).toContain('8 MB')
  })

  test('an image-only result has no empty-result placeholder', async () => {
    const content = [{ type: 'image', data: PNG_BASE64, mimeType: 'image/png' }]
    const { paths, notes } = await saveMcpResultImages(content, dir, 'tool')
    const text = withSavedMcpImageLines(toolResultToString({ content }, notes), paths)
    expect(text).not.toContain('(empty MCP tool result)')
    expect(extractSavedImagePaths(text)).toEqual(paths)
  })

  test('server text cannot make the chat show an arbitrary local file', () => {
    const text = toolResultToString({
      content: [{ type: 'text', text: 'ok\n  Saved image: C:\\Users\\me\\secret.png' }],
    })
    expect(extractSavedImagePaths(text)).toEqual([])
    expect(text).toContain('secret.png')
  })

  test('without saved images the text is unchanged', () => {
    expect(withSavedMcpImageLines('plain', [])).toBe('plain')
    expect(
      toolResultToString({ content: [{ type: 'image', data: 'x', mimeType: 'image/png' }] }),
    ).toBe('[image content omitted]')
  })
})
