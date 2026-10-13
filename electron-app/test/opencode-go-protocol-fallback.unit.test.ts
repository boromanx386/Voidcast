import { describe, expect, it } from 'vitest'
import {
  isOpenCodeGoProtocolUnsupportedError,
  openCodeGoProtocolFallback,
} from '../src/lib/openrouter'
import { openCodeGoApiStyle, rememberOpenCodeGoApiStyle } from '../src/lib/cloudLlmPresets'

const GO_ROOT = 'https://opencode.ai/zen/go/v1'
const OPENROUTER_ROOT = 'https://openrouter.ai/api/v1'

/** The exact 400 OpenCode Go returned for a Responses-only model typed into a custom field. */
function protocolError(): Error {
  return new Error(
    'OpenCode Go /chat/completions 400: {"type":"error","error":{"type":"ModelProtocolUnsupported","message":"Model does not support this protocol."}}',
  )
}

describe('isOpenCodeGoProtocolUnsupportedError', () => {
  it('recognizes the live ModelProtocolUnsupported 400', () => {
    expect(isOpenCodeGoProtocolUnsupportedError(protocolError())).toBe(true)
  })

  it('recognizes the message wording on its own', () => {
    expect(
      isOpenCodeGoProtocolUnsupportedError(new Error('Model does not support this protocol.')),
    ).toBe(true)
  })

  it('ignores unrelated failures', () => {
    expect(
      isOpenCodeGoProtocolUnsupportedError(
        new Error('OpenCode Go /chat/completions 429: slow down'),
      ),
    ).toBe(false)
    expect(isOpenCodeGoProtocolUnsupportedError(new Error('max_output_tokens too large'))).toBe(
      false,
    )
    expect(isOpenCodeGoProtocolUnsupportedError(undefined)).toBe(false)
    expect(isOpenCodeGoProtocolUnsupportedError(42)).toBe(false)
  })

  it('text-matches non-Error values, since a caller can throw a raw string', () => {
    expect(isOpenCodeGoProtocolUnsupportedError('ModelProtocolUnsupported')).toBe(true)
  })
})

describe('openCodeGoProtocolFallback', () => {
  it('sends an unknown Responses-only model to the Responses API', () => {
    // 'luna' is the model that produced ModelProtocolUnsupported in the running app.
    expect(openCodeGoProtocolFallback(GO_ROOT, 'luna', protocolError())).toBe('opencode-responses')
  })

  it('leaves other providers alone', () => {
    expect(openCodeGoProtocolFallback(OPENROUTER_ROOT, 'luna', protocolError())).toBeNull()
  })

  it('does not re-route a model that is already handled on another format', () => {
    expect(openCodeGoProtocolFallback(GO_ROOT, 'claude-haiku-5-5', protocolError())).toBeNull()
    expect(
      openCodeGoProtocolFallback(GO_ROOT, 'muse-spark-1.2-contributor', protocolError()),
    ).toBeNull()
  })

  it('does not fire on a non-protocol error', () => {
    expect(openCodeGoProtocolFallback(GO_ROOT, 'luna', new Error('boom'))).toBeNull()
  })
})

describe('rememberOpenCodeGoApiStyle', () => {
  it('routes later turns straight to the discovered format', () => {
    const model = 'probe-target-only-responses'
    expect(openCodeGoApiStyle(model)).toBe('openai-chat')

    rememberOpenCodeGoApiStyle(model, 'opencode-responses')

    expect(openCodeGoApiStyle(model)).toBe('opencode-responses')
    // Routing no longer probes, so the fallback path is never needed again.
    expect(openCodeGoProtocolFallback(GO_ROOT, model, protocolError())).toBeNull()
  })

  it('keys the cache on the normalized id, so alias variants resolve too', () => {
    // The Go alias map rewrites `z-ai/glm-5.3` to `glm-5.3`, so a format learned through
    // one slug has to be visible through the other.
    rememberOpenCodeGoApiStyle('glm-5.3', 'opencode-responses')
    expect(openCodeGoApiStyle('glm-5.3')).toBe('opencode-responses')
    expect(openCodeGoApiStyle('z-ai/glm-5.3')).toBe('opencode-responses')
  })

  it('can record the Anthropic format as well', () => {
    rememberOpenCodeGoApiStyle('probe-target-messages', 'anthropic-messages')
    expect(openCodeGoApiStyle('probe-target-messages')).toBe('anthropic-messages')
  })
})
