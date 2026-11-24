import { afterEach, describe, expect, it } from 'vitest'
import {
  formatContextTokens,
  mergeModelLists,
  parseOpenCodeGoCatalog,
  parseOpenRouterCatalog,
} from '@/lib/liveModels'
import { openCodeGoApiStyle, setOpenCodeGoCatalogStyles } from '@/lib/cloudLlmPresets'

describe('parseOpenRouterCatalog', () => {
  it('keeps only text models that accept tools', () => {
    const models = parseOpenRouterCatalog({
      data: [
        {
          id: 'acme/agent-1',
          name: 'Acme: Agent 1',
          created: 200,
          context_length: 1_048_576,
          supported_parameters: ['tools', 'temperature'],
          architecture: { output_modalities: ['text'] },
        },
        { id: 'acme/no-tools', supported_parameters: ['temperature'] },
        {
          id: 'acme/image-only',
          supported_parameters: ['tools'],
          architecture: { output_modalities: ['image'] },
        },
      ],
    })
    expect(models).toEqual([
      {
        id: 'acme/agent-1',
        label: 'Acme: Agent 1 (1.05M ctx)',
        contextTokens: 1_048_576,
        created: 200,
      },
    ])
  })

  it('returns nothing for a malformed body', () => {
    expect(parseOpenRouterCatalog(null)).toEqual([])
    expect(parseOpenRouterCatalog({ data: 'x' })).toEqual([])
  })
})

describe('parseOpenCodeGoCatalog', () => {
  const body = {
    data: [
      {
        id: 'chatty',
        name: 'Chatty',
        type: 'chat',
        limit: { context: 262_144 },
        api: { 'chat-completions': {} },
        recommended_api: 'chat-completions',
      },
      { id: 'claude-x', type: 'chat', api: { messages: {} }, recommended_api: 'messages' },
      { id: 'grok-x', type: 'chat', api: { responses: {} }, recommended_api: 'responses' },
      { id: 'gem', type: 'chat', api: { 'generate-content': {} }, recommended_api: 'interactions' },
      { id: 'decide', type: 'decision', api: { systemone: {} } },
      { id: 'embed', type: 'embedding', api: { embeddings: {} } },
    ],
  }

  it('drops models the app cannot speak to and records the wire format', () => {
    const models = parseOpenCodeGoCatalog(body)
    expect(models.map((m) => [m.id, m.apiStyle])).toEqual([
      ['chatty', 'openai-chat'],
      ['claude-x', 'anthropic-messages'],
      ['grok-x', 'opencode-responses'],
    ])
    expect(models[0].label).toBe('Chatty (262K ctx)')
    expect(models[1].label).toBe('claude-x (Anthropic Messages)')
  })
})

describe('openCodeGoApiStyle with a live catalog', () => {
  afterEach(() => setOpenCodeGoCatalogStyles(new Map()))

  it('routes an unknown model by the catalog', () => {
    expect(openCodeGoApiStyle('brand-new-model')).toBe('openai-chat')
    setOpenCodeGoCatalogStyles(new Map([['brand-new-model', 'anthropic-messages']]))
    expect(openCodeGoApiStyle('brand-new-model')).toBe('anthropic-messages')
  })

  it('lets the catalog overrule a stale static entry', () => {
    expect(openCodeGoApiStyle('minimax-m3.1-flash')).toBe('anthropic-messages')
    setOpenCodeGoCatalogStyles(new Map([['minimax-m3.1-flash', 'openai-chat']]))
    expect(openCodeGoApiStyle('minimax-m3.1-flash')).toBe('openai-chat')
  })
})

describe('mergeModelLists', () => {
  it('keeps curated first and adds only new live models, newest first', () => {
    const { recommended, more } = mergeModelLists(
      [{ id: 'a', label: 'A curated' }],
      [
        { id: 'a', label: 'A live' },
        { id: 'old', label: 'Old', created: 1 },
        { id: 'new', label: 'New', created: 9 },
      ],
    )
    expect(recommended).toEqual([{ id: 'a', label: 'A curated' }])
    expect(more.map((m) => m.id)).toEqual(['new', 'old'])
  })
})

describe('formatContextTokens', () => {
  it('formats round and odd windows', () => {
    expect(formatContextTokens(1_000_000)).toBe('1M')
    expect(formatContextTokens(2_000_000)).toBe('2M')
    expect(formatContextTokens(1_048_576)).toBe('1.05M')
    expect(formatContextTokens(256_000)).toBe('256K')
    expect(formatContextTokens(undefined)).toBe('')
  })
})
