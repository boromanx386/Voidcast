import { describe, expect, test } from 'vitest'
import { allowPopup, popupToEvict } from '../electron/main/browser/popupGuard'

describe('allowPopup', () => {
  test('allows a burst up to the limit, then refuses inside the window', () => {
    const recent: number[] = []
    expect(allowPopup(recent, 1000, 3, 10_000)).toBe(true)
    expect(allowPopup(recent, 1100, 3, 10_000)).toBe(true)
    expect(allowPopup(recent, 1200, 3, 10_000)).toBe(true)
    expect(allowPopup(recent, 1300, 3, 10_000)).toBe(false)
    // Refused attempts are not recorded, so the window still closes on the first popup.
    expect(recent).toEqual([1000, 1100, 1200])
  })

  test('opens again once old attempts leave the window', () => {
    const recent: number[] = []
    for (const at of [0, 1, 2]) allowPopup(recent, at, 3, 10_000)
    // At 10_000 only the attempt at 0 has aged out (a full window old): one slot frees up.
    expect(allowPopup(recent, 10_000, 3, 10_000)).toBe(true)
    expect(recent).toEqual([1, 2, 10_000])
    expect(allowPopup(recent, 10_000, 3, 10_000)).toBe(false)
  })
})

describe('popupToEvict', () => {
  const page = (id: string, createdAt: number, popup: boolean) => ({ id, createdAt, popup })

  test('evicts the oldest popup that is not the current page', () => {
    const pages = [page('p1', 1, false), page('p2', 2, true), page('p3', 3, true)]
    expect(popupToEvict(pages, 'p3')).toBe('p2')
    expect(popupToEvict(pages, 'p2')).toBe('p3')
  })

  test('never evicts a page the user or the agent opened', () => {
    const pages = [page('p1', 1, false), page('p2', 2, false), page('p3', 3, true)]
    expect(popupToEvict(pages, 'p3')).toBeNull()
  })
})
