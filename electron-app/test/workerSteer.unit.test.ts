import { describe, expect, it } from 'vitest'
import {
  createWorkerSteerQueue,
  drainWorkerSteer,
  formatWorkerSteerMessage,
  pushWorkerSteer,
  WORKER_STEER_MAX_CHARS,
  WORKER_STEER_MAX_PENDING,
} from '@/lib/workerSteer'

describe('workerSteer queue', () => {
  it('pushes trimmed messages and drains them in order', () => {
    const queue = createWorkerSteerQueue()
    expect(pushWorkerSteer(queue, '  use the v2 endpoint  ')).toBe(true)
    expect(pushWorkerSteer(queue, 'skip the migration')).toBe(true)
    expect(queue.pending).toEqual(['use the v2 endpoint', 'skip the migration'])
    expect(drainWorkerSteer(queue)).toEqual(['use the v2 endpoint', 'skip the migration'])
    expect(queue.pending).toEqual([])
  })

  it('rejects empty, duplicate, and over-cap pushes', () => {
    const queue = createWorkerSteerQueue()
    expect(pushWorkerSteer(queue, '   ')).toBe(false)
    expect(pushWorkerSteer(queue, 'first')).toBe(true)
    expect(pushWorkerSteer(queue, 'first')).toBe(false)
    for (let i = 1; i < WORKER_STEER_MAX_PENDING; i++) {
      expect(pushWorkerSteer(queue, `msg ${i}`)).toBe(true)
    }
    expect(queue.pending).toHaveLength(WORKER_STEER_MAX_PENDING)
    expect(pushWorkerSteer(queue, 'overflow')).toBe(false)
  })

  it('caps message length', () => {
    const queue = createWorkerSteerQueue()
    expect(pushWorkerSteer(queue, 'x'.repeat(WORKER_STEER_MAX_CHARS + 100))).toBe(true)
    expect(queue.pending[0]!.length).toBe(WORKER_STEER_MAX_CHARS)
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
