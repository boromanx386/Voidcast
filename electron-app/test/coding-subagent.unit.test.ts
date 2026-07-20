import { describe, expect, it } from 'vitest'
import {
  CODING_COMPRESS_THRESHOLD,
  CODING_COMPRESS_TOOLS,
  clampExploreMaxRounds,
  hardTruncateCodingResult,
  isCodingExploreAllowedTool,
  parseCodingExploreAction,
  shouldCompressCodingResult,
} from '../src/lib/codingSubAgent'
import { buildOllamaToolsList } from '../src/lib/toolDefinitions'

describe('shouldCompressCodingResult', () => {
  it('returns false when coding sub-agent disabled', () => {
    const raw = 'x'.repeat(CODING_COMPRESS_THRESHOLD + 10)
    expect(shouldCompressCodingResult('execute_command', raw, false)).toBe(false)
  })

  it('returns false below threshold', () => {
    const raw = 'x'.repeat(CODING_COMPRESS_THRESHOLD - 1)
    expect(shouldCompressCodingResult('execute_command', raw, true)).toBe(false)
  })

  it('returns true at/above threshold for allowlisted tools', () => {
    const raw = 'x'.repeat(CODING_COMPRESS_THRESHOLD)
    for (const name of CODING_COMPRESS_TOOLS) {
      expect(shouldCompressCodingResult(name, raw, true)).toBe(true)
    }
  })

  it('returns false for non-allowlisted tools even when large', () => {
    const raw = 'x'.repeat(CODING_COMPRESS_THRESHOLD + 100)
    expect(shouldCompressCodingResult('edit_code', raw, true)).toBe(false)
    expect(shouldCompressCodingResult('write_file', raw, true)).toBe(false)
    expect(shouldCompressCodingResult('web_search', raw, true)).toBe(false)
  })
})

describe('hardTruncateCodingResult', () => {
  it('passthrough when short', () => {
    expect(hardTruncateCodingResult('hello', 100)).toBe('hello')
  })

  it('truncates with marker when long', () => {
    const raw = 'a'.repeat(100)
    const out = hardTruncateCodingResult(raw, 40)
    expect(out.startsWith('a'.repeat(40))).toBe(true)
    expect(out).toContain('[truncated')
  })
})

describe('coding explore allowlist / parse', () => {
  it('allows only read-only coding tools', () => {
    expect(isCodingExploreAllowedTool('search_files')).toBe(true)
    expect(isCodingExploreAllowedTool('read_file')).toBe(true)
    expect(isCodingExploreAllowedTool('check_types')).toBe(true)
    expect(isCodingExploreAllowedTool('write_file')).toBe(false)
    expect(isCodingExploreAllowedTool('edit_code')).toBe(false)
    expect(isCodingExploreAllowedTool('execute_command')).toBe(false)
    expect(isCodingExploreAllowedTool('coding_explore')).toBe(false)
  })

  it('clamps max rounds', () => {
    expect(clampExploreMaxRounds(undefined)).toBe(8)
    expect(clampExploreMaxRounds(3)).toBe(3)
    expect(clampExploreMaxRounds(99)).toBe(12)
    expect(clampExploreMaxRounds(0)).toBe(1)
  })

  it('parses tool JSON', () => {
    const a = parseCodingExploreAction(
      '{"tool":"search_files","args":{"query":"foo","path_prefix":"src"}}',
    )
    expect(a.kind).toBe('tool')
    if (a.kind === 'tool') {
      expect(a.call.tool).toBe('search_files')
      expect(a.call.args.query).toBe('foo')
    }
  })

  it('prefers tool over digest when both present', () => {
    const a = parseCodingExploreAction(
      '{"tool":"read_file","args":{"path":"a.ts"},"digest":"should ignore"}',
    )
    expect(a.kind).toBe('tool')
    if (a.kind === 'tool') expect(a.call.tool).toBe('read_file')
  })

  it('parses done digest', () => {
    const a = parseCodingExploreAction('{"done":true,"digest":"Found X in src/a.ts"}')
    expect(a.kind).toBe('done')
    if (a.kind === 'done') expect(a.digest).toContain('Found X')
  })

  it('rejects write tool names via allowlist even if parsed', () => {
    const a = parseCodingExploreAction('{"tool":"write_file","args":{"path":"x"}}')
    expect(a.kind).toBe('tool')
    if (a.kind === 'tool') {
      expect(isCodingExploreAllowedTool(a.call.tool)).toBe(false)
    }
  })
})

describe('buildOllamaToolsList coding_explore', () => {
  const codingEnabled = {
    webSearch: false,
    youtube: false,
    reddit: false,
    weather: false,
    scrape: false,
    pdf: false,
    runwareImage: false,
    runwareMusic: false,
    coding: true,
    enterPlan: false,
  }

  it('omits coding_explore when subAgentCodingEnabled is false', () => {
    const tools = buildOllamaToolsList(codingEnabled as never, false, {
      subAgentCodingEnabled: false,
    })
    expect(tools.some((t) => t.function.name === 'coding_explore')).toBe(false)
  })

  it('includes coding_explore when subAgentCodingEnabled is true', () => {
    const tools = buildOllamaToolsList(codingEnabled as never, false, {
      subAgentCodingEnabled: true,
    })
    const explore = tools.find((t) => t.function.name === 'coding_explore')
    expect(explore).toBeTruthy()
    expect(explore?.function.parameters.required).toContain('goal')
  })

  it('keeps coding_explore in plan mode', () => {
    const tools = buildOllamaToolsList(codingEnabled as never, false, {
      agentMode: 'plan',
      subAgentCodingEnabled: true,
    })
    expect(tools.some((t) => t.function.name === 'coding_explore')).toBe(true)
    expect(tools.some((t) => t.function.name === 'execute_command')).toBe(false)
    expect(tools.some((t) => t.function.name === 'write_file')).toBe(false)
  })
})
