import { describe, expect, it } from 'vitest'
import {
  applyCodingDone,
  applyCodingStart,
  applyVisionDone,
  applyVisionProgress,
  applyVisionStart,
  emptySubAgentPanelState,
  parseCodingStartLabel,
} from '@/lib/subAgentPanelState'

describe('parseCodingStartLabel', () => {
  it('parses worker rounds', () => {
    const p = parseCodingStartLabel('WORKER 1 · 3/50')
    expect(p.kind).toBe('workers')
    expect(p.workerId).toBe('worker-1')
    expect(p.progress).toBe('3/50')
  })

  it('parses explore rounds', () => {
    const p = parseCodingStartLabel('SUB_AGENT · EXPLORE (2/8)')
    expect(p.kind).toBe('explore')
    expect(p.progress).toBe('2/8')
  })

  it('parses workers batch kickoff', () => {
    const p = parseCodingStartLabel('WORKERS 1–2 · starting')
    expect(p.kind).toBe('workers')
    expect(p.title).toBe('WORKERS')
  })
})

describe('subAgentPanel reducers', () => {
  it('tracks vision progress', () => {
    let s = emptySubAgentPanelState()
    s = applyVisionStart(s, 3)
    expect(s.open).toBe(true)
    expect(s.busy).toBe(true)
    expect(s.kind).toBe('vision')
    s = applyVisionProgress(s, 2, 3)
    expect(s.progress).toBe('2/3')
    s = applyVisionDone(s, 'a: cats')
    expect(s.busy).toBe(false)
    expect(s.text).toContain('cats')
  })

  it('tracks parallel workers from labels', () => {
    let s = emptySubAgentPanelState()
    s = applyCodingStart(s, 'WORKERS 1–2 · starting')
    expect(s.workers).toHaveLength(2)
    s = applyCodingStart(s, 'WORKER 1 · 4/50')
    s = applyCodingStart(s, 'WORKER 2 · 1/50')
    expect(s.workers.find((w) => w.id === 'worker-1')?.progress).toBe('4/50')
    expect(s.workers.find((w) => w.id === 'worker-2')?.status).toBe('running')
    s = applyCodingDone(
      s,
      'WORKER 1:\nDone A\n\n---\nWORKER 2:\nDone B',
    )
    expect(s.busy).toBe(false)
    expect(s.workers.every((w) => w.status === 'done')).toBe(true)
  })

  it('flags explore partial completion and auto-collapses', () => {
    let s = applyCodingStart(emptySubAgentPanelState(), 'SUB_AGENT · EXPLORE (8/8)')
    expect(s.collapsed).toBe(false)
    s = applyCodingDone(s, 'Max rounds without done — synthesized digest.')
    expect(s.progress).toBe('partial')
    expect(s.collapsed).toBe(true)
  })
})
