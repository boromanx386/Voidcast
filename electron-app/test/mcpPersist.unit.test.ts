import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  getMcpResultsDir,
  MCP_RESULT_INLINE_MAX_CHARS,
  persistIfLargeMcpResult,
  readPersistedMcpResult,
} from '../electron/main/mcpManager'

describe('MCP large result persist (Claude/Cursor style)', () => {
  const created: string[] = []

  afterEach(async () => {
    await Promise.all(
      created.splice(0).map(async (p) => {
        try {
          await rm(p, { force: true })
        } catch {
          /* ignore */
        }
      }),
    )
  })

  test('small results stay inline unchanged', async () => {
    const small = JSON.stringify({ ok: true, n: 1 })
    const out = await persistIfLargeMcpResult(small, 'mcp__t__x')
    expect(out).toBe(small)
    expect(out).not.toContain('<persisted-output>')
  })

  test('large results are saved fully and return path + preview', async () => {
    const models = Array.from({ length: 80 }, (_, i) => ({
      id: `m-${i}`,
      name: `Model ${i}`,
      blurb: 'y'.repeat(800),
    }))
    const raw = JSON.stringify(models)
    expect(raw.length).toBeGreaterThan(MCP_RESULT_INLINE_MAX_CHARS)

    const out = await persistIfLargeMcpResult(raw, 'mcp__wangp__list_models')
    expect(out).toContain('<persisted-output>')
    expect(out).toContain(getMcpResultsDir())
    expect(out).toContain('mcp_read_result')
    expect(out.length).toBeLessThan(raw.length)

    const pathMatch = out.match(/Full output saved to:\n([^\n]+)/)
    expect(pathMatch?.[1]).toBeTruthy()
    const savedPath = pathMatch![1]!.trim()
    created.push(savedPath)

    const onDisk = await readFile(savedPath, 'utf8')
    expect(onDisk).toBe(raw)

    const page = await readPersistedMcpResult({
      path: savedPath,
      itemOffset: 0,
      itemLimit: 3,
      query: 'Model 1',
    })
    const parsed = JSON.parse(page) as { items: unknown[]; _meta: { total: number } }
    expect(parsed.items.length).toBeLessThanOrEqual(3)
    expect(parsed._meta.total).toBeGreaterThan(0)
  })

  test('mcp_read_result rejects paths outside mcp-results', async () => {
    const outside = path.join(os.tmpdir(), `voidcast-mcp-outside-${Date.now()}.txt`)
    await writeFile(outside, 'secret', 'utf8')
    created.push(outside)
    const out = await readPersistedMcpResult({ path: outside })
    expect(out).toMatch(/^Error:/)
    expect(out).toContain('mcp-results')
  })

  test('ensure results dir exists for assertion helper', async () => {
    await mkdir(getMcpResultsDir(), { recursive: true })
    expect(getMcpResultsDir()).toContain('.voidcast')
  })
})
