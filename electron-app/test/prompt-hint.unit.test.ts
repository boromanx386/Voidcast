import { describe, expect, test } from 'vitest'
import {
  HINT_CONTEXT_MAX_CHARS,
  buildHintTranscript,
  buildHintUserMessage,
  generatePromptHint,
  sanitizePromptHint,
} from '../src/lib/promptHint'
import type { UiMessage } from '../src/types/chat'

function msg(
  role: 'user' | 'assistant',
  content: string,
  extra: Partial<UiMessage> = {},
): UiMessage {
  return { id: `${role}-${content.slice(0, 8)}`, role, content, ...extra }
}

describe('buildHintTranscript', () => {
  test('keeps user turns and every agent reply between them, in order', () => {
    const out = buildHintTranscript([
      msg('user', 'first ask'),
      msg('assistant', 'draft A'),
      msg('assistant', 'final A'),
      msg('user', 'second ask'),
      msg('assistant', 'final B'),
    ])
    expect(out).toBe(
      [
        'User: first ask',
        'Assistant: draft A',
        'Assistant: final A',
        'User: second ask',
        'Assistant: final B',
      ].join('\n\n'),
    )
  })

  test('drops messages with no text and no attachment', () => {
    const out = buildHintTranscript([msg('user', 'ask'), msg('assistant', '   ')])
    expect(out).toBe('User: ask')
  })

  test('represents an attachment-only message instead of dropping it', () => {
    const out = buildHintTranscript([msg('user', '', { images: ['b64'] })])
    expect(out).toBe('User: [1 attachment]')
  })

  test('drops the oldest whole turns when the budget is exceeded', () => {
    const filler = 'x'.repeat(200)
    const out = buildHintTranscript(
      [msg('user', `old ${filler}`), msg('assistant', `answer ${filler}`), msg('user', 'new ask')],
      // Room for the last turn only, so both older turns must go — whole turns, never halves.
      100,
    )
    expect(out).toBe('User: new ask')
  })

  test('keeps the final turn even when it alone exceeds the budget', () => {
    const out = buildHintTranscript([msg('user', 'y'.repeat(HINT_CONTEXT_MAX_CHARS + 50))])
    expect(out.startsWith('User: yyy')).toBe(true)
  })

  test('empty conversation gives an empty transcript', () => {
    expect(buildHintTranscript([])).toBe('')
  })
})

describe('buildHintUserMessage', () => {
  test('puts the conversation before the draft', () => {
    const out = buildHintUserMessage('User: ask', 'do the thing')
    expect(out).toBe('Conversation so far:\nUser: ask\n\nDraft to rewrite:\ndo the thing')
  })

  test('draft alone when the conversation is empty', () => {
    expect(buildHintUserMessage('', 'do the thing')).toBe('Draft to rewrite:\ndo the thing')
  })
})

describe('sanitizePromptHint', () => {
  test('unwraps a fenced answer', () => {
    expect(sanitizePromptHint('```text\nFix the OAuth redirect\n```', 'fix oauth')).toBe(
      'Fix the OAuth redirect',
    )
  })

  test('drops a label prefix', () => {
    expect(sanitizePromptHint('Improved prompt: Fix the OAuth redirect', 'fix oauth')).toBe(
      'Fix the OAuth redirect',
    )
  })

  test('keeps multi-line prompt structure', () => {
    const out = sanitizePromptHint('- step one\n- step two', 'step one')
    expect(out).toBe('- step one\n- step two')
  })

  test('null when the model changed nothing', () => {
    expect(sanitizePromptHint('fix oauth', 'fix oauth')).toBeNull()
  })

  test('null for empty output', () => {
    expect(sanitizePromptHint('   ', 'fix oauth')).toBeNull()
    expect(sanitizePromptHint('```\n```', 'fix oauth')).toBeNull()
  })
})

describe('generatePromptHint gates', () => {
  const config = { enabled: false, codingEnabled: false, model: 'deepseek-v4.1-flash' }
  const keys = { opencodeSessionId: 'rt-1' }

  test('null without a draft (no request made)', async () => {
    expect(await generatePromptHint({ messages: [], draft: '  ', config, keys })).toBeNull()
  })

  test('null without a configured model (no request made)', async () => {
    const out = await generatePromptHint({
      messages: [],
      draft: 'fix it',
      config: { ...config, model: '' },
      keys,
    })
    expect(out).toBeNull()
  })
})
