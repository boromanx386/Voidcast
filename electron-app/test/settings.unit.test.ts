import { describe, expect, test } from 'vitest'
import {
  normalizeSubAgent,
  normalizeSettingsCandidate,
  subAgentConfigForRole,
  withOpenRouterModel,
  withOpenRouterProviderOnly,
  withSubAgentOpenRouterProvider,
  type AppSettings,
  defaults,
} from '../src/lib/settings'

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...defaults, ...overrides }
}

function makeSubAgent(raw: any): AppSettings {
  return makeSettings({ subAgent: raw })
}

describe('normalizeSubAgent', () => {
  // --- missing / invalid input ---
  test('missing subAgent → returns defaults', () => {
    const s = normalizeSubAgent(makeSettings())
    expect(s.subAgent).toEqual(defaults.subAgent)
  })

  test('null subAgent → returns defaults', () => {
    const s = normalizeSubAgent(makeSubAgent(null as any))
    expect(s.subAgent).toEqual(defaults.subAgent)
  })

  test('undefined subAgent → returns defaults', () => {
    const s = normalizeSubAgent(makeSubAgent(undefined as any))
    expect(s.subAgent).toEqual(defaults.subAgent)
  })

  test('non-object subAgent (string) → returns defaults', () => {
    const s = normalizeSubAgent(makeSubAgent('nonsense' as any))
    expect(s.subAgent).toEqual(defaults.subAgent)
  })

  test('non-object subAgent (number) → returns defaults', () => {
    const s = normalizeSubAgent(makeSubAgent(42 as any))
    expect(s.subAgent).toEqual(defaults.subAgent)
  })

  // --- enabled ---
  test('enabled: true → true', () => {
    const s = normalizeSubAgent(makeSubAgent({ enabled: true }))
    expect(s.subAgent.enabled).toBe(true)
  })

  test('enabled: false → false', () => {
    const s = normalizeSubAgent(makeSubAgent({ enabled: false }))
    expect(s.subAgent.enabled).toBe(false)
  })

  test('enabled: truthy string → false (strict check)', () => {
    const s = normalizeSubAgent(makeSubAgent({ enabled: 'true' as any }))
    expect(s.subAgent.enabled).toBe(false)
  })

  test('enabled: 1 → false (strict check)', () => {
    const s = normalizeSubAgent(makeSubAgent({ enabled: 1 as any }))
    expect(s.subAgent.enabled).toBe(false)
  })

  // --- model ---
  test('model: valid string → kept', () => {
    const s = normalizeSubAgent(makeSubAgent({ model: 'gpt-4o-mini' }))
    expect(s.subAgent.model).toBe('gpt-4o-mini')
  })

  test('model: empty string → default', () => {
    const s = normalizeSubAgent(makeSubAgent({ model: '' }))
    expect(s.subAgent.model).toBe(defaults.subAgent.model)
  })

  test('model: whitespace only → default', () => {
    const s = normalizeSubAgent(makeSubAgent({ model: '   ' }))
    expect(s.subAgent.model).toBe(defaults.subAgent.model)
  })

  test('model: missing → default', () => {
    const s = normalizeSubAgent(makeSubAgent({ enabled: true }))
    expect(s.subAgent.model).toBe(defaults.subAgent.model)
  })

  // --- token budgets (internal defaults; not Options UI) ---
  test('outputTokens: always pins to built-in default', () => {
    const s = normalizeSubAgent(makeSubAgent({ outputTokens: 512 }))
    expect(s.subAgent.outputTokens).toBe(defaults.subAgent.outputTokens)
  })

  test('outputTokens: missing → default', () => {
    const s = normalizeSubAgent(makeSubAgent({ enabled: true }))
    expect(s.subAgent.outputTokens).toBe(defaults.subAgent.outputTokens)
  })

  test('outputTokens: ignores legacy maxTokensPerImage', () => {
    const s = normalizeSubAgent(makeSubAgent({ maxTokensPerImage: 500 } as any))
    expect(s.subAgent.outputTokens).toBe(defaults.subAgent.outputTokens)
  })

  test('contextTokens: always pins to built-in default (16K)', () => {
    const s = normalizeSubAgent(makeSubAgent({ contextTokens: 65536 }))
    expect(s.subAgent.contextTokens).toBe(defaults.subAgent.contextTokens)
    expect(s.subAgent.contextTokens).toBe(16384)
  })

  test('contextTokens: missing → default', () => {
    const s = normalizeSubAgent(makeSubAgent({ enabled: true }))
    expect(s.subAgent.contextTokens).toBe(defaults.subAgent.contextTokens)
  })

  // --- showAnalysisWindow ---
  test('showAnalysisWindow: true → true', () => {
    const s = normalizeSubAgent(makeSubAgent({ showAnalysisWindow: true }))
    expect(s.subAgent.showAnalysisWindow).toBe(true)
  })

  test('showAnalysisWindow: false → false', () => {
    const s = normalizeSubAgent(makeSubAgent({ showAnalysisWindow: false }))
    expect(s.subAgent.showAnalysisWindow).toBe(false)
  })

  test('showAnalysisWindow: missing → true (default)', () => {
    const s = normalizeSubAgent(makeSubAgent({ enabled: true }))
    expect(s.subAgent.showAnalysisWindow).toBe(true)
  })

  test('codingEnabled: true → true', () => {
    const s = normalizeSubAgent(makeSubAgent({ codingEnabled: true }))
    expect(s.subAgent.codingEnabled).toBe(true)
  })

  test('codingEnabled: missing → false', () => {
    const s = normalizeSubAgent(makeSubAgent({ enabled: true }))
    expect(s.subAgent.codingEnabled).toBe(false)
  })

  // --- combinations ---
  test('partial config: other fields get defaults', () => {
    const s = normalizeSubAgent(makeSubAgent({ enabled: true, model: 'claude' }))
    expect(s.subAgent.enabled).toBe(true)
    expect(s.subAgent.codingEnabled).toBe(false)
    expect(s.subAgent.model).toBe('claude')
    expect(s.subAgent.provider).toBe('openrouter')
    expect(s.subAgent.outputTokens).toBe(defaults.subAgent.outputTokens)
    expect(s.subAgent.contextTokens).toBe(defaults.subAgent.contextTokens)
    expect(s.subAgent.showAnalysisWindow).toBe(true)
  })

  test('full config: endpoint fields preserved; token budgets stay defaults', () => {
    const s = normalizeSubAgent(makeSubAgent({
      enabled: true,
      codingEnabled: true,
      model: 'gpt-4o',
      provider: 'openrouter',
      codingModel: 'deepseek-v4-flash',
      codingProvider: 'deepseek',
      outputTokens: 9999,
      contextTokens: 32768,
      showAnalysisWindow: false,
    }))
    expect(s.subAgent).toEqual({
      enabled: true,
      codingEnabled: true,
      model: 'gpt-4o',
      provider: 'openrouter',
      codingModel: 'deepseek-v4-flash',
      codingProvider: 'deepseek',
      openrouterProviderOnly: '',
      codingOpenrouterProviderOnly: '',
      outputTokens: defaults.subAgent.outputTokens,
      contextTokens: defaults.subAgent.contextTokens,
      showAnalysisWindow: false,
    })
  })

  test('codingModel migrates from vision model when missing', () => {
    const s = normalizeSubAgent(
      makeSubAgent({ enabled: true, model: 'llava:13b', provider: 'ollama' }),
    )
    expect(s.subAgent.codingModel).toBe('llava:13b')
    expect(s.subAgent.codingProvider).toBe('ollama')
  })

  test('codingModel can differ from vision model', () => {
    const s = normalizeSubAgent(
      makeSubAgent({
        enabled: true,
        codingEnabled: true,
        model: 'llava:13b',
        provider: 'ollama',
        codingModel: 'deepseek/deepseek-v4-flash',
        codingProvider: 'openrouter',
      }),
    )
    expect(s.subAgent.model).toBe('llava:13b')
    expect(s.subAgent.provider).toBe('ollama')
    expect(s.subAgent.codingModel).toBe('deepseek/deepseek-v4-flash')
    expect(s.subAgent.codingProvider).toBe('openrouter')
  })

  test('namespaced Ollama model keeps id and routes to ollama', () => {
    const s = normalizeSubAgent(
      makeSubAgent({ enabled: true, model: 'sorc/qwen3.5-claude-4.6-opus:9b' }),
    )
    expect(s.subAgent.model).toBe('sorc/qwen3.5-claude-4.6-opus:9b')
    expect(s.subAgent.provider).toBe('ollama')
  })

  test('explicit provider is preserved', () => {
    const s = normalizeSubAgent(
      makeSubAgent({ enabled: true, model: 'custom-vision', provider: 'ollama' }),
    )
    expect(s.subAgent.provider).toBe('ollama')
  })

  test('does not mutate surrounding settings', () => {
    const s = makeSettings({
      ollamaModel: 'custom-model',
      subAgent: { ...defaults.subAgent, enabled: true },
    })
    const out = normalizeSubAgent(s)
    expect(out.ollamaModel).toBe('custom-model')
  })
})

describe('subAgentConfigForRole', () => {
  test('vision returns same config', () => {
    const sub = defaults.subAgent
    expect(subAgentConfigForRole(sub, 'vision')).toBe(sub)
  })

  test('coding projects codingModel onto model', () => {
    const sub = {
      ...defaults.subAgent,
      model: 'llava:13b',
      provider: 'ollama' as const,
      codingModel: 'deepseek-v4-flash',
      codingProvider: 'deepseek' as const,
      codingOpenrouterProviderOnly: '',
    }
    const coding = subAgentConfigForRole(sub, 'coding')
    expect(coding.model).toBe('deepseek-v4-flash')
    expect(coding.provider).toBe('deepseek')
    expect(coding.codingModel).toBe('deepseek-v4-flash')
  })

  test('coding projects OpenRouter provider lock', () => {
    const sub = {
      ...defaults.subAgent,
      model: 'openai/gpt-4o',
      provider: 'openrouter' as const,
      openrouterProviderOnly: 'openai',
      codingModel: 'anthropic/claude-sonnet-5',
      codingProvider: 'openrouter' as const,
      codingOpenrouterProviderOnly: 'anthropic',
    }
    const coding = subAgentConfigForRole(sub, 'coding')
    expect(coding.openrouterProviderOnly).toBe('anthropic')
  })
})

describe('withSubAgentOpenRouterProvider', () => {
  test('stores provider in shared per-model map and subAgent field', () => {
    const s = makeSettings({
      subAgent: {
        ...defaults.subAgent,
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-5',
      },
    })
    const patch = withSubAgentOpenRouterProvider(s, 'vision', 'anthropic')
    expect(patch.subAgent.openrouterProviderOnly).toBe('anthropic')
    expect(patch.openrouterProviderByModel['anthropic/claude-sonnet-5']).toBe('anthropic')
  })
})

describe('openrouter provider by model', () => {
  test('migrates legacy openrouterProviderOnly into the per-model map', () => {
    const s = normalizeSettingsCandidate({
      openrouterModel: 'anthropic/claude-sonnet-5',
      openrouterProviderOnly: 'anthropic',
    })
    expect(s.openrouterProviderByModel['anthropic/claude-sonnet-5']).toBe('anthropic')
    expect(s.openrouterProviderOnly).toBe('anthropic')
  })

  test('active provider follows the selected model map entry', () => {
    const s = normalizeSettingsCandidate({
      openrouterModel: 'openai/gpt-4o-mini',
      openrouterProviderOnly: 'stale',
      openrouterProviderByModel: {
        'openai/gpt-4o-mini': 'openai',
        'anthropic/claude-sonnet-5': 'anthropic',
      },
    })
    expect(s.openrouterProviderOnly).toBe('openai')
  })

  test('withOpenRouterModel restores remembered provider', () => {
    const base = makeSettings({
      openrouterModel: 'openai/gpt-4o-mini',
      openrouterProviderOnly: 'openai',
      openrouterProviderByModel: {
        'openai/gpt-4o-mini': 'openai',
        'anthropic/claude-sonnet-5': 'anthropic',
      },
    })
    expect(withOpenRouterModel(base, 'anthropic/claude-sonnet-5')).toEqual({
      openrouterModel: 'anthropic/claude-sonnet-5',
      openrouterProviderOnly: 'anthropic',
    })
    expect(withOpenRouterModel(base, 'google/gemini-flash')).toEqual({
      openrouterModel: 'google/gemini-flash',
      openrouterProviderOnly: '',
    })
  })

  test('withOpenRouterProviderOnly writes and clears per-model entries', () => {
    const base = makeSettings({
      openrouterModel: 'openai/gpt-4o-mini',
      openrouterProviderOnly: '',
      openrouterProviderByModel: {},
    })
    const set = withOpenRouterProviderOnly(base, ' openai ')
    expect(set).toEqual({
      openrouterProviderOnly: 'openai',
      openrouterProviderByModel: { 'openai/gpt-4o-mini': 'openai' },
    })
    const cleared = withOpenRouterProviderOnly(
      { ...base, ...set },
      '  ',
    )
    expect(cleared.openrouterProviderOnly).toBe('')
    expect(cleared.openrouterProviderByModel).toEqual({})
  })
})
