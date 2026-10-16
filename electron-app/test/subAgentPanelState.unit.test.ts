import { describe, expect, it } from 'vitest'
import {
  applyCodingDone,
  applyCodingEvent,
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

  it('keeps parsing enriched worker labels with tool targets', () => {
    const p = parseCodingStartLabel('WORKER 1 · 3/50 · edit_code src/lib/x.ts')
    expect(p.kind).toBe('workers')
    expect(p.workerId).toBe('worker-1')
    expect(p.progress).toBe('3/50 · edit_code src/lib/x.ts')
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
    s = applyCodingDone(s, 'WORKER 1:\nDone A\n\n---\nWORKER 2:\nDone B')
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

describe('applyCodingEvent', () => {
  it('logs the line, updates the worker slot, and never flips busy', () => {
    let s = applyCodingStart(emptySubAgentPanelState(), 'WORKERS 1–2 · starting')
    s = applyCodingStart(s, 'WORKER 1 · 4/50')
    expect(s.busy).toBe(true)
    s = applyCodingEvent(s, {
      workerId: 'worker-1',
      text: 'WORKER 1 wrote src/a.ts',
      level: 'ok',
    })
    expect(s.busy).toBe(true)
    expect(s.text).toBe('WORKER 1 wrote src/a.ts')
    expect(s.events.at(-1)?.text).toBe('WORKER 1 wrote src/a.ts')
    expect(s.events.at(-1)?.level).toBe('ok')
    expect(s.events.at(-1)?.workerId).toBe('worker-1')
    expect(s.workers.find((w) => w.id === 'worker-1')?.lastLine).toBe('WORKER 1 wrote src/a.ts')
  })

  it('ignores blank text and still logs batch-level events', () => {
    const base = applyCodingStart(emptySubAgentPanelState(), 'WORKERS 1–2 · starting')
    expect(applyCodingEvent(base, { text: '   ' })).toBe(base)
    const s = applyCodingEvent(base, { text: 'batched note' })
    expect(s.events.at(-1)?.text).toBe('batched note')
    expect(s.events.at(-1)?.level).toBe('info')
    expect(s.events.at(-1)?.workerId).toBeUndefined()
  })

  it('marks only the named worker done while the batch stays busy', () => {
    let s = applyCodingStart(emptySubAgentPanelState(), 'WORKERS 1–2 · starting in parallel')
    s = applyCodingStart(s, 'WORKER 1 · 4/50')
    s = applyCodingEvent(s, {
      workerId: 'worker-1',
      text: 'WORKER 1 done — fixed the store',
      level: 'ok',
      status: 'done',
    })
    expect(s.busy).toBe(true)
    expect(s.collapsed).toBe(false)
    expect(s.workers.find((w) => w.id === 'worker-1')?.status).toBe('done')
    expect(s.workers.find((w) => w.id === 'worker-1')?.progress).toBe('done')
    expect(s.workers.find((w) => w.id === 'worker-2')?.status).toBe('running')
  })
})

describe('applyCodingDone with worker slots', () => {
  it('keeps a clean worker done when its sibling failed', () => {
    let s = applyCodingStart(emptySubAgentPanelState(), 'WORKERS 1–2 · starting in parallel')
    s = applyCodingDone(
      s,
      'Coding workers finished (2):\n---\nWORKER 1:\nAll good.\n---\nWORKER 2:\nError: aborted',
    )
    expect(s.busy).toBe(false)
    expect(s.collapsed).toBe(true)
    expect(s.workers.find((w) => w.id === 'worker-1')?.status).toBe('done')
    expect(s.workers.find((w) => w.id === 'worker-2')?.status).toBe('error')
    expect(s.progress).toBe('error')
    expect(s.events.at(-1)?.text).toMatch(/errors/i)
    expect(s.events.at(-1)?.level).toBe('err')
  })

  it('reports plain done when both workers were clean', () => {
    let s = applyCodingStart(emptySubAgentPanelState(), 'WORKERS 1–2 · starting in parallel')
    s = applyCodingDone(s, 'WORKER 1:\nDone A\n---\nWORKER 2:\nDone B')
    expect(s.progress).toBe('done')
    expect(s.workers.every((w) => w.status === 'done')).toBe(true)
    expect(s.events.at(-1)?.level).toBe('ok')
  })
})
