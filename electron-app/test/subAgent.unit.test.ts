import { describe, it, expect } from 'vitest'
import { buildPrompt, detectSubAgentProvider } from '../src/lib/subAgent'

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
