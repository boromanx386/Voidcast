import { describe, expect, test } from 'vitest'
import {
  contextWindowAfterEdit,
  historyBeforeCurrentUserTurn,
  sliceUiHistoryForContext,
} from '../src/lib/chatMessages'
import { restoredHistoryNeedsCompression } from '../src/lib/contextUsage'
import type { UiMessage } from '../src/types/chat'

function turns(count: number): UiMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i),
    role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `m${i}`,
  }))
}

describe('contextWindowAfterEdit', () => {
  test('keeps the summary when the edit is after the compressed part', () => {
    expect(contextWindowAfterEdit('summary', 20, 30, 20)).toBeNull()
    expect(contextWindowAfterEdit('summary', 20, 30, 25)).toBeNull()
  })

  test('drops the summary when the edited message is inside it', () => {
    expect(contextWindowAfterEdit('summary', 20, 30, 19)).toEqual({ summary: '', throughIndex: 0 })
    expect(contextWindowAfterEdit('summary', 20, 30, 0)).toEqual({ summary: '', throughIndex: 0 })
  })

  test('legacy summary without an index covers every message', () => {
    expect(contextWindowAfterEdit('summary', undefined, 6, 5)).toEqual({
      summary: '',
      throughIndex: 0,
    })
  })

  test('does nothing without a summary', () => {
    expect(contextWindowAfterEdit(undefined, 20, 30, 3)).toBeNull()
    expect(contextWindowAfterEdit('  ', 20, 30, 3)).toBeNull()
  })

  test('later turns stay visible after an edit inside the summary', () => {
    const afterEdit = turns(6)
    const window = contextWindowAfterEdit('summary', 20, 30, 5)!
    const nextTurn = [...afterEdit, ...turns(2)]
    expect(sliceUiHistoryForContext(nextTurn, window.summary, window.throughIndex)).toBe(nextTurn)
    // What the old index did: the clamp hid every message until the chat outgrew it.
    expect(sliceUiHistoryForContext(nextTurn, 'summary', 20)).toEqual([])
  })
})

describe('historyBeforeCurrentUserTurn', () => {
  test('drops the trailing user message so it is not sent twice', () => {
    const history = turns(3)
    expect(historyBeforeCurrentUserTurn(history).map((m) => m.id)).toEqual(['0', '1'])
  })

  test('leaves a history that ends with an assistant message', () => {
    const history = turns(2)
    expect(historyBeforeCurrentUserTurn(history)).toBe(history)
  })

  test('handles an empty history', () => {
    expect(historyBeforeCurrentUserTurn([])).toEqual([])
  })
})

describe('restoredHistoryNeedsCompression', () => {
  const turn = (chars: number) => ({ role: 'user' as const, content: 'x'.repeat(chars) })

  test('true when the raw turns reach the compress ratio', () => {
    expect(restoredHistoryNeedsCompression(null, [], undefined, [turn(3_800)], 1_000)).toBe(true)
  })

  test('false when the raw turns fit', () => {
    expect(restoredHistoryNeedsCompression(null, [], undefined, [turn(800)], 1_000)).toBe(false)
  })

  test('counts the system and tool overhead from the previous usage', () => {
    const usage = {
      promptTokens: 800,
      outputTokens: 0,
      maxTokens: 1_000,
      ratio: 0.8,
      shouldWarn: true,
      shouldCompress: false,
    }
    // 800 prompt tokens, about 100 of them conversation: about 700 are fixed overhead.
    expect(restoredHistoryNeedsCompression(usage, [turn(392)], undefined, [turn(800)], 1_000)).toBe(
      true,
    )
  })

  test('false without a usable limit', () => {
    expect(restoredHistoryNeedsCompression(null, [], undefined, [turn(9_999)], undefined)).toBe(
      false,
    )
  })
})
