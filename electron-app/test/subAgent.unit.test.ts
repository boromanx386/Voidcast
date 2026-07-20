import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildPrompt, detectSubAgentProvider, describeImagesWithSubAgent } from '../src/lib/subAgent'
import { imageCatalogKey, visionCacheKey } from '../src/lib/imageVisionCache'

// ── buildPrompt ──────────────────────────────────────────────────────────

describe('buildPrompt', () => {
  it('returns only the default prompt when query is undefined', () => {
    const result = buildPrompt(undefined)
    expect(result).not.toContain('The user asked')
    expect(result).not.toContain('Tailor your description')
  })

  it('returns only the default prompt when query is empty string', () => {
    const result = buildPrompt('')
    expect(result).not.toContain('The user asked')
  })

  it('returns only the default prompt when query is whitespace', () => {
    const result = buildPrompt('   \t\n  ')
    expect(result).not.toContain('The user asked')
  })

  it('appends user query when provided', () => {
    const result = buildPrompt('describe the UI')
    expect(result).toContain('The user asked: "describe the UI"')
    expect(result).toContain('Tailor your description to answer the user\'s question.')
  })

  it('includes the default prompt before the user query', () => {
    const result = buildPrompt('what color is the button?')
    const idxUser = result.indexOf('The user asked')
    const idxDefault = result.indexOf('Describe this image concisely')
    expect(idxDefault).toBe(0)
    expect(idxUser).toBeGreaterThan(idxDefault)
  })

  it('handles query with double quotes inside', () => {
    const result = buildPrompt('is the "Submit" button visible?')
    expect(result).toContain('The user asked: "is the "Submit" button visible?"')
  })

  it('does NOT contain the old 3-5 sentences limit (regression)', () => {
    const result = buildPrompt('anything')
    expect(result).not.toMatch(/3\s*(to|-)\s*5\s*sentences/i)
    expect(result).not.toContain('Be brief')
  })

  it('does NOT add meta-commentary instruction', () => {
    const result = buildPrompt('test')
    expect(result).toContain('Do not add meta-commentary')
  })

  it('handles very long query', () => {
    const long = 'a'.repeat(500)
    const result = buildPrompt(long)
    expect(result).toContain(long)
    expect(result.length).toBeGreaterThan(500)
  })

  it('handles query with newlines', () => {
    const result = buildPrompt('line1\nline2\nline3')
    expect(result).toContain('line1\nline2\nline3')
  })

  it('handles unicode query (ćirilica)', () => {
    const result = buildPrompt('опиши овај екран')
    expect(result).toContain('опиши овај екран')
  })

  it('uses focus when provided by the main agent', () => {
    const result = buildPrompt('look at this', 'read the error text in the status bar')
    expect(result).toContain('The assistant needs from this image: "read the error text in the status bar"')
    expect(result).toContain('Original user message: "look at this"')
    expect(result).toContain('Tailor your description to what the assistant needs.')
  })

  it('focus without user query omits original user line', () => {
    const result = buildPrompt(undefined, 'button color')
    expect(result).toContain('The assistant needs from this image: "button color"')
    expect(result).not.toContain('Original user message')
  })
})

// ── detectSubAgentProvider ───────────────────────────────────────────────

describe('detectSubAgentProvider', () => {
  it('detects Ollama models with colon (e.g. llava:13b)', () => {
    expect(detectSubAgentProvider('llava:13b')).toBe('ollama')
  })

  it('detects Ollama models with colon and tag (e.g. qwen2.5:7b)', () => {
    expect(detectSubAgentProvider('qwen2.5:7b')).toBe('ollama')
  })

  it('detects Ollama models with colon (e.g. mistral:latest)', () => {
    expect(detectSubAgentProvider('mistral:latest')).toBe('ollama')
  })

  it('returns ollama for empty string (safety fallback)', () => {
    expect(detectSubAgentProvider('')).toBe('ollama')
  })

  it('detects OpenRouter models with slash (e.g. openai/gpt-4o-mini)', () => {
    expect(detectSubAgentProvider('openai/gpt-4o-mini')).toBe('openrouter')
  })

  it('detects OpenRouter models with slash (e.g. anthropic/claude-sonnet)', () => {
    expect(detectSubAgentProvider('anthropic/claude-sonnet')).toBe('openrouter')
  })

  it('detects OpenRouter for plain model names without colon (e.g. gpt-4)', () => {
    expect(detectSubAgentProvider('gpt-4')).toBe('openrouter')
  })

  it('detects OpenRouter for plain model names (e.g. claude-3-opus)', () => {
    expect(detectSubAgentProvider('claude-3-opus')).toBe('openrouter')
  })

  it('colon with OpenRouter route variant = openrouter (e.g. openai/gpt-4:free)', () => {
    expect(detectSubAgentProvider('openai/gpt-4:free')).toBe('openrouter')
  })

  it('namespaced Ollama model with slash+colon = ollama (e.g. sorc/qwen…:9b)', () => {
    expect(detectSubAgentProvider('sorc/qwen3.5-claude-4.6-opus:9b')).toBe('ollama')
  })

  it('handles model with dots and numbers (e.g. llama3.2-vision:latest)', () => {
    expect(detectSubAgentProvider('llama3.2-vision:latest')).toBe('ollama')
  })

  it('explicit provider overrides heuristic', () => {
    expect(detectSubAgentProvider('openai/gpt-4o', 'ollama')).toBe('ollama')
    expect(detectSubAgentProvider('llava:13b', 'openrouter')).toBe('openrouter')
  })
})

// ── describeImagesWithSubAgent (vision cache) ────────────────────────────

describe('describeImagesWithSubAgent vision cache', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const keys = {
    ollamaBaseUrl: 'http://localhost:11434',
    openrouterBaseUrl: 'https://openrouter.ai/api/v1',
    openrouterApiKey: '',
    deepseekBaseUrl: 'https://api.deepseek.com',
    deepseekApiKey: '',
  }

  const config = {
    enabled: true,
    memoryEnabled: false,
    codingEnabled: false,
    model: 'llava:13b',
    provider: 'ollama' as const,
  }

  it('returns cached descriptions without calling fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const img = { base64: 'dGVzdA==', mime: 'image/png', path: 'a.png', index: 1 }
    const cache = { [imageCatalogKey(img)]: 'cached blue button' }

    const results = await describeImagesWithSubAgent(
      [img],
      config,
      keys,
      undefined,
      undefined,
      undefined,
      cache,
    )

    expect(results).toEqual([
      { index: 1, path: 'a.png', description: 'cached blue button' },
    ])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('calls fetch only for uncached images in a mixed batch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: 'fresh desc' } }),
    } as Response)

    const cached = { base64: 'Y2E=', mime: 'image/png', path: 'cached.png', index: 1 }
    const fresh = { base64: 'ZmI=', mime: 'image/png', path: 'fresh.png', index: 2 }
    const cache = { [imageCatalogKey(cached)]: 'from cache' }

    const results = await describeImagesWithSubAgent(
      [cached, fresh],
      config,
      keys,
      undefined,
      undefined,
      undefined,
      cache,
    )

    expect(results[0]?.description).toBe('from cache')
    expect(results[1]?.description).toBe('fresh desc')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('does not reuse cache when focus differs', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: 'focused desc' } }),
    } as Response)

    const img = { base64: 'Y2E=', mime: 'image/png', path: 'cached.png', index: 1 }
    const cache = { [visionCacheKey(img, 'error text')]: 'old focused desc' }

    const results = await describeImagesWithSubAgent(
      [img],
      config,
      keys,
      undefined,
      undefined,
      undefined,
      cache,
      'button color',
    )

    expect(results[0]?.description).toBe('focused desc')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
