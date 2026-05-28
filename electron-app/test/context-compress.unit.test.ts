import { describe, expect, test } from 'vitest'
import {
  resolveContextCompressedThroughIndex,
  sliceUiHistoryForContext,
} from '../src/lib/chatMessages'

describe('resolveContextCompressedThroughIndex', () => {
  test('returns 0 when no summary', () => {
    expect(resolveContextCompressedThroughIndex(undefined, 5, 10)).toBe(0)
  })

  test('legacy summary without index covers all messages', () => {
    expect(resolveContextCompressedThroughIndex('summary', undefined, 4)).toBe(4)
    expect(resolveContextCompressedThroughIndex('summary', 0, 4)).toBe(4)
  })

  test('clamps stored index to message count', () => {
    expect(resolveContextCompressedThroughIndex('summary', 99, 3)).toBe(3)
  })
})

describe('sliceUiHistoryForContext', () => {
  test('returns full history when no summary', () => {
    const msgs = [{ role: 'user' as const, id: '1', content: 'a' }]
    expect(sliceUiHistoryForContext(msgs, undefined, 5)).toBe(msgs)
  })

  test('drops messages before compress index when summary exists', () => {
    const msgs = [
      { role: 'user' as const, id: '1', content: 'a' },
      { role: 'assistant' as const, id: '2', content: 'b' },
      { role: 'user' as const, id: '3', content: 'c' },
    ]
    expect(sliceUiHistoryForContext(msgs, 'compressed memory', 2)).toEqual([
      { role: 'user', id: '3', content: 'c' },
    ])
  })

  test('legacy summary without index omits all prior messages', () => {
    const msgs = [
      { role: 'user' as const, id: '1', content: 'a' },
      { role: 'assistant' as const, id: '2', content: 'b' },
    ]
    expect(sliceUiHistoryForContext(msgs, 'summary', undefined)).toEqual([])
  })
})
