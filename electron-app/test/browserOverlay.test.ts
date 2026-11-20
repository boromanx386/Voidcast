import { describe, expect, it } from 'vitest'
import { rectsOverlap, sameRect } from '@/lib/browserOverlay'

const panel = { x: 100, y: 50, width: 400, height: 300 }

describe('rectsOverlap', () => {
  it('detects a popup reaching into the panel', () => {
    expect(rectsOverlap({ left: 450, top: 300, right: 700, bottom: 500 }, panel)).toBe(true)
  })

  it('ignores a popup that only touches the panel edge', () => {
    expect(rectsOverlap({ left: 500, top: 100, right: 600, bottom: 200 }, panel)).toBe(false)
    expect(rectsOverlap({ left: 120, top: 350, right: 300, bottom: 400 }, panel)).toBe(false)
  })

  it('ignores collapsed elements', () => {
    expect(rectsOverlap({ left: 200, top: 100, right: 200, bottom: 100 }, panel)).toBe(false)
  })

  it('never reports an empty panel as covered', () => {
    const box = { left: 0, top: 0, right: 1000, bottom: 1000 }
    expect(rectsOverlap(box, { x: 0, y: 0, width: 0, height: 0 })).toBe(false)
  })
})

describe('sameRect', () => {
  it('treats a missing previous rect as changed', () => {
    expect(sameRect(null, panel)).toBe(false)
    expect(sameRect({ ...panel }, panel)).toBe(true)
    expect(sameRect({ ...panel, x: 101 }, panel)).toBe(false)
  })
})
