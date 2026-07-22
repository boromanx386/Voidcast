import { describe, expect, test } from 'vitest'
import {
  normalizeSubAgent,
  normalizeSettingsCandidate,
  withOpenRouterModel,
  withOpenRouterProviderOnly,
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

  test('memoryEnabled: true → true', () => {
    const s = normalizeSubAgent(makeSubAgent({ memoryEnabled: true }))
    expect(s.subAgent.memoryEnabled).toBe(true)
  })

  test('memoryEnabled migrates from legacy enabled when unset', () => {
    const s = normalizeSubAgent(makeSubAgent({ enabled: true }))
    expect(s.subAgent.memoryEnabled).toBe(true)
  })

  test('memoryEnabled: false stays off when legacy enabled was false', () => {
    const s = normalizeSubAgent(makeSubAgent({ enabled: false }))
    expect(s.subAgent.memoryEnabled).toBe(false)
  })

  test('memoryEnabled explicit false overrides legacy enabled', () => {
    const s = normalizeSubAgent(makeSubAgent({ enabled: true, memoryEnabled: false }))
    expect(s.subAgent.memoryEnabled).toBe(false)
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

  // --- outputTokens ---
  test('outputTokens: valid value → kept', () => {
    const s = normalizeSubAgent(makeSubAgent({ outputTokens: 512 }))
    expect(s.subAgent.outputTokens).toBe(512)
  })

  test('outputTokens: below minimum → clamped to 50', () => {
    const s = normalizeSubAgent(makeSubAgent({ outputTokens: 10 }))
    expect(s.subAgent.outputTokens).toBe(50)
  })

  test('outputTokens: above maximum → clamped to 4096', () => {
    const s = normalizeSubAgent(makeSubAgent({ outputTokens: 99999 }))
    expect(s.subAgent.outputTokens).toBe(4096)
  })

  test('outputTokens: at minimum boundary (50) → 50', () => {
    const s = normalizeSubAgent(makeSubAgent({ outputTokens: 50 }))
    expect(s.subAgent.outputTokens).toBe(50)
  })

  test('outputTokens: at maximum boundary (4096) → 4096', () => {
    const s = normalizeSubAgent(makeSubAgent({ outputTokens: 4096 }))
    expect(s.subAgent.outputTokens).toBe(4096)
  })

  test('outputTokens: float → rounded', () => {
    const s = normalizeSubAgent(makeSubAgent({ outputTokens: 512.7 }))
    expect(s.subAgent.outputTokens).toBe(513)
  })

  test('outputTokens: missing → default', () => {
    const s = normalizeSubAgent(makeSubAgent({ enabled: true }))
    expect(s.subAgent.outputTokens).toBe(defaults.subAgent.outputTokens)
  })

  test('outputTokens: NaN → default', () => {
    const s = normalizeSubAgent(makeSubAgent({ outputTokens: NaN }))
    expect(s.subAgent.outputTokens).toBe(defaults.subAgent.outputTokens)
  })

  test('outputTokens: Infinity → default', () => {
    const s = normalizeSubAgent(makeSubAgent({ outputTokens: Infinity }))
    expect(s.subAgent.outputTokens).toBe(defaults.subAgent.outputTokens)
  })

  // --- migration: old maxTokensPerImage → outputTokens ---
  test('migrates old maxTokensPerImage to outputTokens', () => {
    const s = normalizeSubAgent(makeSubAgent({ maxTokensPerImage: 500 } as any))
    expect(s.subAgent.outputTokens).toBe(500)
  })

  test('migrates maxTokensPerImage with clamping', () => {
    const s = normalizeSubAgent(makeSubAgent({ maxTokensPerImage: 5 } as any))
    expect(s.subAgent.outputTokens).toBe(50)
  })

  test('outputTokens wins over maxTokensPerImage when both present', () => {
    const s = normalizeSubAgent(makeSubAgent({
      outputTokens: 2048,
      maxTokensPerImage: 500,
    } as any))
    expect(s.subAgent.outputTokens).toBe(2048)
  })

  // --- contextTokens ---
  test('contextTokens: valid value → kept', () => {
    const s = normalizeSubAgent(makeSubAgent({ contextTokens: 16384 }))
    expect(s.subAgent.contextTokens).toBe(16384)
  })

  test('contextTokens: below minimum → clamped to 512', () => {
    const s = normalizeSubAgent(makeSubAgent({ contextTokens: 100 }))
    expect(s.subAgent.contextTokens).toBe(512)
  })

  test('contextTokens: above maximum → clamped to 131072', () => {
    const s = normalizeSubAgent(makeSubAgent({ contextTokens: 999999 }))
    expect(s.subAgent.contextTokens).toBe(131072)
  })

  test('contextTokens: at minimum (512) → 512', () => {
    const s = normalizeSubAgent(makeSubAgent({ contextTokens: 512 }))
    expect(s.subAgent.contextTokens).toBe(512)
  })

  test('contextTokens: at maximum (131072) → 131072', () => {
    const s = normalizeSubAgent(makeSubAgent({ contextTokens: 131072 }))
    expect(s.subAgent.contextTokens).toBe(131072)
  })

  test('contextTokens: missing → default', () => {
    const s = normalizeSubAgent(makeSubAgent({ enabled: true }))
    expect(s.subAgent.contextTokens).toBe(defaults.subAgent.contextTokens)
  })

  test('contextTokens: NaN → default', () => {
    const s = normalizeSubAgent(makeSubAgent({ contextTokens: NaN }))
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
    expect(s.subAgent.memoryEnabled).toBe(true)
    expect(s.subAgent.codingEnabled).toBe(false)
    expect(s.subAgent.model).toBe('claude')
    expect(s.subAgent.provider).toBe('openrouter')
    expect(s.subAgent.outputTokens).toBe(defaults.subAgent.outputTokens)
    expect(s.subAgent.contextTokens).toBe(defaults.subAgent.contextTokens)
    expect(s.subAgent.showAnalysisWindow).toBe(true)
  })

  test('full config: all fields preserved (in range)', () => {
    const s = normalizeSubAgent(makeSubAgent({
      enabled: true,
      memoryEnabled: false,
      codingEnabled: true,
      model: 'gpt-4o',
      provider: 'openrouter',
      outputTokens: 2048,
      contextTokens: 32768,
      showAnalysisWindow: false,
    }))
    expect(s.subAgent).toEqual({
      enabled: true,
      memoryEnabled: false,
      codingEnabled: true,
      model: 'gpt-4o',
      provider: 'openrouter',
      outputTokens: 2048,
      contextTokens: 32768,
      showAnalysisWindow: false,
    })
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
    const s = makeSettings({ llmModel: 'custom-model', subAgent: { enabled: true } })
    const out = normalizeSubAgent(s)
    expect(out.llmModel).toBe('custom-model')
  })
})

describe('openrouter provider by model', () => {
  test('migrates legacy openrouterProviderOnly into the per-model map', () => {
    const s = normalizeSettingsCandidate({
      openrouterModel: 'anthropic/claude-sonnet-4.6',
      openrouterProviderOnly: 'anthropic',
    })
    expect(s.openrouterProviderByModel['anthropic/claude-sonnet-4.6']).toBe('anthropic')
    expect(s.openrouterProviderOnly).toBe('anthropic')
  })

  test('active provider follows the selected model map entry', () => {
    const s = normalizeSettingsCandidate({
      openrouterModel: 'openai/gpt-4o-mini',
      openrouterProviderOnly: 'stale',
      openrouterProviderByModel: {
        'openai/gpt-4o-mini': 'openai',
        'anthropic/claude-sonnet-4.6': 'anthropic',
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
        'anthropic/claude-sonnet-4.6': 'anthropic',
      },
    })
    expect(withOpenRouterModel(base, 'anthropic/claude-sonnet-4.6')).toEqual({
      openrouterModel: 'anthropic/claude-sonnet-4.6',
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
