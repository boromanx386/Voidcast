import { describe, expect, it } from 'vitest'
import {
  CODING_CLEAR_MIN_CHARS,
  CODING_TRIM_HEAD_CHARS,
  CODING_TRIM_TAIL_CHARS,
  CODING_TRIM_THRESHOLD,
  CODING_TRIM_TOOLS,
  clampExploreMaxRounds,
  clearedCodingToolResultPlaceholder,
  isClearableCodingToolResult,
  isCodingExploreAllowedTool,
  parseCodingExploreAction,
  shouldTrimCodingResult,
  trimNoisyCodingResult,
} from '../src/lib/codingSubAgent'
import { buildOllamaToolsList } from '../src/lib/toolDefinitions'

describe('shouldTrimCodingResult', () => {
  it('returns false when coding context management disabled', () => {
    const raw = 'x'.repeat(CODING_TRIM_THRESHOLD + 10)
    expect(shouldTrimCodingResult('execute_command', raw, false)).toBe(false)
  })

  it('returns false at/below threshold', () => {
    const raw = 'x'.repeat(CODING_TRIM_THRESHOLD)
    expect(shouldTrimCodingResult('execute_command', raw, true)).toBe(false)
  })

  it('returns true above threshold for noisy tools', () => {
    const raw = 'x'.repeat(CODING_TRIM_THRESHOLD + 1)
    for (const name of CODING_TRIM_TOOLS) {
      expect(shouldTrimCodingResult(name, raw, true)).toBe(true)
    }
  })

  it('returns false for tools whose raw output the main agent needs', () => {
    const raw = 'x'.repeat(CODING_TRIM_THRESHOLD + 100)
    expect(shouldTrimCodingResult('edit_code', raw, true)).toBe(false)
    expect(shouldTrimCodingResult('write_file', raw, true)).toBe(false)
    expect(shouldTrimCodingResult('web_search', raw, true)).toBe(false)
    expect(shouldTrimCodingResult('read_file', raw, true)).toBe(false)
    expect(shouldTrimCodingResult('list_directory', raw, true)).toBe(false)
    expect(shouldTrimCodingResult('git_diff', raw, true)).toBe(false)
    expect(shouldTrimCodingResult('git_show', raw, true)).toBe(false)
  })
})

describe('trimNoisyCodingResult', () => {
  it('passthrough when at/below threshold', () => {
    const raw = 'a'.repeat(CODING_TRIM_THRESHOLD)
    expect(trimNoisyCodingResult(raw)).toBe(raw)
  })

  it('keeps head and tail with omitted marker', () => {
    const raw = `HEAD${'m'.repeat(CODING_TRIM_THRESHOLD * 2)}TAIL`
    const out = trimNoisyCodingResult(raw)
    expect(out.startsWith(raw.slice(0, CODING_TRIM_HEAD_CHARS))).toBe(true)
    expect(out.endsWith(raw.slice(-CODING_TRIM_TAIL_CHARS))).toBe(true)
    expect(out).toContain('chars omitted')
    expect(out.length).toBeLessThan(raw.length)
  })

  it('preserves errors at the end of command output', () => {
    const raw = `${'log line\n'.repeat(2000)}ERROR: build failed at src/x.ts:12`
    const out = trimNoisyCodingResult(raw)
    expect(out).toContain('ERROR: build failed at src/x.ts:12')
  })
})

describe('old tool result clearing helpers', () => {
  it('marks re-fetchable coding tools as clearable', () => {
    expect(isClearableCodingToolResult('read_file')).toBe(true)
    expect(isClearableCodingToolResult('search_files')).toBe(true)
    expect(isClearableCodingToolResult('execute_command')).toBe(true)
    expect(isClearableCodingToolResult('git_diff')).toBe(true)
  })

  it('never clears mutations, digests, or non-coding tools', () => {
    expect(isClearableCodingToolResult('edit_code')).toBe(false)
    expect(isClearableCodingToolResult('write_file')).toBe(false)
    expect(isClearableCodingToolResult('coding_explore')).toBe(false)
    expect(isClearableCodingToolResult('web_search')).toBe(false)
  })

  it('placeholder names the tool and size and stays small', () => {
    const p = clearedCodingToolResultPlaceholder('read_file', 12_345)
    expect(p).toContain('read_file')
    expect(p).toContain('12')
    expect(p.length).toBeLessThan(CODING_CLEAR_MIN_CHARS)
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
