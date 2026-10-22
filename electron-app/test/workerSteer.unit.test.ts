import { describe, expect, it } from 'vitest'
import {
  createWorkerSteerQueue,
  formatWorkerSteerMessage,
  pushWorkerSteer,
  readWorkerSteer,
  WORKER_STEER_MAX_CHARS,
  WORKER_STEER_MAX_ENTRIES,
} from '@/lib/workerSteer'

describe('workerSteer queue', () => {
  it('pushes trimmed messages and reads them in order', () => {
    const queue = createWorkerSteerQueue()
    expect(pushWorkerSteer(queue, '  use the v2 endpoint  ')).toBe('queued')
    expect(pushWorkerSteer(queue, 'skip the migration')).toBe('queued')
    expect(readWorkerSteer(queue, 0)).toEqual({
      messages: ['use the v2 endpoint', 'skip the migration'],
      nextCursor: 2,
    })
  })

  it('each reader keeps its own cursor, so no reader starves another', () => {
    const queue = createWorkerSteerQueue()
    pushWorkerSteer(queue, 'first')
    const a = readWorkerSteer(queue, 0)
    const b = readWorkerSteer(queue, 0)
    expect(a.messages).toEqual(['first'])
    expect(b.messages).toEqual(['first'])
    pushWorkerSteer(queue, 'second')
    expect(readWorkerSteer(queue, a.nextCursor).messages).toEqual(['second'])
    expect(readWorkerSteer(queue, queue.entries.length).messages).toEqual([])
  })

  it('reports why a push was refused', () => {
    const queue = createWorkerSteerQueue()
    expect(pushWorkerSteer(queue, '   ')).toBe('empty')
    expect(pushWorkerSteer(queue, 'first')).toBe('queued')
    expect(pushWorkerSteer(queue, 'first')).toBe('duplicate')
    for (let i = 1; i < WORKER_STEER_MAX_ENTRIES; i++) {
      expect(pushWorkerSteer(queue, `msg ${i}`)).toBe('queued')
    }
    expect(queue.entries).toHaveLength(WORKER_STEER_MAX_ENTRIES)
    expect(pushWorkerSteer(queue, 'overflow')).toBe('full')
    // A duplicate is still reported as a duplicate once the log is full.
    expect(pushWorkerSteer(queue, 'first')).toBe('duplicate')
  })

  it('caps message length', () => {
    const queue = createWorkerSteerQueue()
    expect(pushWorkerSteer(queue, 'x'.repeat(WORKER_STEER_MAX_CHARS + 100))).toBe('queued')
    expect(queue.entries[0]!.length).toBe(WORKER_STEER_MAX_CHARS)
  })
})

describe('formatWorkerSteerMessage', () => {
  it('wraps the message with the steer header and no-restart note', () => {
    const text = formatWorkerSteerMessage('  prefer the existing helper  ')
    expect(text).toContain('[Steer — user course correction while you work]')
    expect(text).toContain('prefer the existing helper')
    expect(text).toMatch(/do not restart/i)
  })
})
