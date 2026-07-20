import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChunkThrottle } from '../src/lib/chunkThrottle'
import {
  appendCodingCommandEventToFeed,
  consumeLastExecuteCommandStreamed,
  formatCodingCommandExitLine,
  markLastExecuteCommandStreamed,
  resetCodingTerminalFeedState,
} from '../src/lib/codingCommandStream'
import type { TerminalLine } from '../src/types/coding'

afterEach(() => {
  consumeLastExecuteCommandStreamed()
  vi.useRealTimers()
})

describe('ChunkThrottle', () => {
  it('coalesces rapid chunks within the interval into one flush per stream', () => {
    vi.useFakeTimers()
    const flushed: { stream: string; text: string }[] = []
    const t = new ChunkThrottle((stream, text) => {
      flushed.push({ stream, text })
    }, 50)

    t.push('stdout', 'a')
    t.push('stdout', 'b')
    t.push('stderr', 'e')
    expect(flushed).toEqual([])

    vi.advanceTimersByTime(50)
    expect(flushed).toEqual([
      { stream: 'stdout', text: 'ab' },
      { stream: 'stderr', text: 'e' },
    ])
  })

  it('flush() sends pending immediately and clears the timer', () => {
    vi.useFakeTimers()
    const flushed: string[] = []
    const t = new ChunkThrottle((stream, text) => {
      if (stream === 'stdout') flushed.push(text)
    }, 50)
    t.push('stdout', 'hello')
    t.flush()
    expect(flushed).toEqual(['hello'])
    vi.advanceTimersByTime(50)
    expect(flushed).toEqual(['hello'])
  })
})

describe('mark/consumeLastExecuteCommandStreamed', () => {
  it('returns true once then clears (anti-duplicate for applyAgentToolResult)', () => {
    markLastExecuteCommandStreamed(true)
    expect(consumeLastExecuteCommandStreamed()).toBe(true)
    expect(consumeLastExecuteCommandStreamed()).toBe(false)
  })

  it('false mark means fallback dump path', () => {
    markLastExecuteCommandStreamed(false)
    expect(consumeLastExecuteCommandStreamed()).toBe(false)
  })
})

describe('formatCodingCommandExitLine', () => {
  it('formats exit, timeout, and stopped', () => {
    expect(formatCodingCommandExitLine({ code: 0 })).toBe('[exit 0]')
    expect(formatCodingCommandExitLine({ code: 1 })).toBe('[exit 1]')
    expect(formatCodingCommandExitLine({ timedOut: true, code: 124 })).toBe('[timed out]')
    expect(formatCodingCommandExitLine({ killed: true, code: 130 })).toBe('[stopped]')
  })
})

describe('appendCodingCommandEventToFeed', () => {
  it('appends text events and an exit line on done', () => {
    const seq = { n: 0 }
    const prev: TerminalLine[] = []
    const withCmd = appendCodingCommandEventToFeed(
      prev,
      { runId: 'r1', stream: 'system', text: '$ echo hi' },
      seq,
    )
    expect(withCmd).toHaveLength(1)
    expect(withCmd[0]!.text).toBe('$ echo hi')
    expect(withCmd[0]!.stream).toBe('system')

    const withOut = appendCodingCommandEventToFeed(
      withCmd,
      { runId: 'r1', stream: 'stdout', text: 'hi\n' },
      seq,
    )
    expect(withOut).toHaveLength(2)
    expect(withOut[1]!.text).toBe('hi\n')

    const afterDone = appendCodingCommandEventToFeed(
      withOut,
      { runId: 'r1', done: true, code: 0 },
      seq,
    )
    expect(afterDone.map((l) => l.text)).toEqual(['$ echo hi', 'hi\n', '[exit 0]'])
    expect(afterDone[2]!.stream).toBe('system')
  })

  it('appends [stopped] when done with killed', () => {
    const seq = { n: 0 }
    const after = appendCodingCommandEventToFeed(
      [],
      { runId: 'rk', done: true, killed: true, code: 130 },
      seq,
    )
    expect(after).toHaveLength(1)
    expect(after[0]!.text).toBe('[stopped]')
  })

  it('does not re-append a full body after stream chunks (feed already has output)', () => {
    const seq = { n: 0 }
    let feed = appendCodingCommandEventToFeed(
      [],
      { runId: 'r2', stream: 'system', text: '$ npm test' },
      seq,
    )
    feed = appendCodingCommandEventToFeed(
      feed,
      { runId: 'r2', stream: 'stdout', text: 'ok\n' },
      seq,
    )
    // Simulate applyAgentToolResult skipping dump when streamed was consumed:
    markLastExecuteCommandStreamed(true)
    const streamed = consumeLastExecuteCommandStreamed()
    expect(streamed).toBe(true)
    // Feed unchanged — no duplicate final dump
    expect(feed.map((l) => l.text)).toEqual(['$ npm test', 'ok\n'])
  })
})

describe('resetCodingTerminalFeedState', () => {
  it('returns empty feed and zeroes the stream sequence counter', () => {
    const seq = { n: 0 }
    let feed = appendCodingCommandEventToFeed(
      [],
      { runId: 'r3', stream: 'stdout', text: 'noise\n' },
      seq,
    )
    expect(feed).toHaveLength(1)
    expect(seq.n).toBeGreaterThan(0)

    feed = resetCodingTerminalFeedState(seq)
    expect(feed).toEqual([])
    expect(seq.n).toBe(0)

    feed = appendCodingCommandEventToFeed(
      feed,
      { runId: 'r4', stream: 'stdout', text: 'fresh\n' },
      seq,
    )
    expect(feed).toHaveLength(1)
    expect(feed[0]!.id).toBe('stream-r4-1')
  })
})
