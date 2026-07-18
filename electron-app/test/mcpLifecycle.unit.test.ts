import { describe, expect, test } from 'vitest'
import { planMcpServerReconciliation } from '../electron/main/mcpManager'

describe('planMcpServerReconciliation', () => {
  test('closes servers removed from config', () => {
    const plan = planMcpServerReconciliation({
      configServerIds: ['a'],
      connectedServerIds: ['a', 'b'],
      connectedHealthyIds: ['a', 'b'],
    })
    expect(plan.toClose).toEqual(['b'])
    expect(plan.toStart).toEqual([])
  })

  test('starts missing or unhealthy desired servers', () => {
    const plan = planMcpServerReconciliation({
      configServerIds: ['a', 'b', 'c'],
      connectedServerIds: ['a'],
      connectedHealthyIds: ['a'],
    })
    expect(plan.toClose).toEqual([])
    expect(plan.toStart).toEqual(['b', 'c'])
  })

  test('restarts servers that are connected but not healthy', () => {
    const plan = planMcpServerReconciliation({
      configServerIds: ['a', 'b'],
      connectedServerIds: ['a', 'b'],
      connectedHealthyIds: ['a'],
    })
    expect(plan.toClose).toEqual([])
    expect(plan.toStart).toEqual(['b'])
  })

  test('respects enabled map — disabled servers are not desired', () => {
    const plan = planMcpServerReconciliation({
      configServerIds: ['a', 'b'],
      enabledMap: { b: false },
      connectedServerIds: ['a', 'b'],
      connectedHealthyIds: ['a', 'b'],
    })
    expect(plan.toClose).toEqual(['b'])
    expect(plan.toStart).toEqual([])
  })
})
