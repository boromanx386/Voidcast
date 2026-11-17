import { describe, expect, it } from 'vitest'
import { formatTurnToolRecord, recordTurnToolUse } from '../src/lib/turnToolRecord'

const noRepo = {
  filesChanged: 0,
  commandsRun: 0,
  gitMutations: 0,
  hadRepoAction: false,
  hadAnyToolEvents: false,
}

describe('recordTurnToolUse', () => {
  it('counts calls and failures in first-call order', () => {
    let list = recordTurnToolUse([], 'read_file', 'ok')
    list = recordTurnToolUse(list, 'edit_code', 'Error: no match')
    list = recordTurnToolUse(list, 'read_file', 'ok')
    expect(list).toEqual([
      { name: 'read_file', calls: 2, failed: 0 },
      { name: 'edit_code', calls: 1, failed: 1 },
    ])
  })

  it('keeps what web-type calls read, skipping failures and repeats', () => {
    let list = recordTurnToolUse([], 'web_search', 'results', { query: 'electron  updater' })
    list = recordTurnToolUse(list, 'scrape_url', 'Error: 404', { url: 'https://a.test/x' })
    list = recordTurnToolUse(list, 'scrape_url', 'page', { url: 'https://a.test/y' })
    list = recordTurnToolUse(list, 'web_search', 'results', { query: 'electron updater' })
    list = recordTurnToolUse(list, 'read_file', 'ok', { path: 'src/a.ts' })
    expect(list).toEqual([
      { name: 'web_search', calls: 2, failed: 0, sources: ['electron updater'] },
      { name: 'scrape_url', calls: 2, failed: 1, sources: ['https://a.test/y'] },
      { name: 'read_file', calls: 1, failed: 0 },
    ])
  })

  it('caps sources per tool and their length', () => {
    let list: ReturnType<typeof recordTurnToolUse> = []
    for (let i = 0; i < 8; i++)
      list = recordTurnToolUse(list, 'web_search', 'r', { query: `q${i}` })
    list = recordTurnToolUse(list, 'scrape_url', 'r', { url: 'x'.repeat(300) })
    expect(list[0].sources).toHaveLength(5)
    expect(list[1].sources?.[0]).toHaveLength(120)
  })
})

describe('formatTurnToolRecord', () => {
  it('is empty for messages without a record', () => {
    expect(formatTurnToolRecord({})).toBe('')
  })

  it('marks a turn that called no tools', () => {
    expect(formatTurnToolRecord({ turnTools: [] })).toBe(
      '<tool_record>No tools were called in this turn.</tool_record>',
    )
  })

  it('lists tools with counts and failures', () => {
    expect(
      formatTurnToolRecord({
        turnTools: [
          { name: 'web_search', calls: 1, failed: 0 },
          { name: 'generate_image', calls: 2, failed: 1 },
        ],
      }),
    ).toBe('<tool_record>Tools called: web_search, generate_image ×2 (1 failed).</tool_record>')
  })

  it('names the sources next to the tool', () => {
    expect(
      formatTurnToolRecord({
        turnTools: [
          { name: 'web_search', calls: 2, failed: 0, sources: ['electron updater', 'appimage'] },
          { name: 'scrape_url', calls: 1, failed: 0, sources: ['https://a.test/y'] },
        ],
      }),
    ).toBe(
      '<tool_record>Tools called: web_search ×2 ["electron updater", "appimage"], scrape_url ["https://a.test/y"].</tool_record>',
    )
  })

  it('adds project changes for coding turns', () => {
    expect(
      formatTurnToolRecord({
        turnTools: [{ name: 'edit_code', calls: 2, failed: 0 }],
        codingTurnEvidence: {
          ...noRepo,
          filesChanged: 1,
          filePaths: ['src/a.ts'],
          commandsRun: 1,
          commandSummaries: ['npm test'],
          hadRepoAction: true,
          hadAnyToolEvents: true,
        },
      }),
    ).toBe(
      '<tool_record>Tools called: edit_code ×2. Project: files changed: src/a.ts; commands run: npm test.</tool_record>',
    )
  })

  it('does not call a web-only coding turn tool-free', () => {
    expect(
      formatTurnToolRecord({
        turnTools: [{ name: 'web_search', calls: 1, failed: 0 }],
        codingTurnEvidence: noRepo,
      }),
    ).toBe('<tool_record>Tools called: web_search. Nothing in the project changed.</tool_record>')
  })

  it('older coding messages only claim what the coding log knows', () => {
    expect(formatTurnToolRecord({ codingTurnEvidence: noRepo })).toBe(
      '<tool_record>No coding tools were called; nothing in the project changed.</tool_record>',
    )
  })
})
