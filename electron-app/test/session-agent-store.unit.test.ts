import { describe, expect, it, beforeEach } from 'vitest'
import { sessionAgentStore } from '../src/lib/sessionAgentStore'

describe('sessionAgentStore coding project concurrency', () => {
  const chatA = 'session-a'
  const chatB = 'session-b'
  const projA = 'Q:/repos/project-a'
  const projB = 'Q:/repos/project-b'

  beforeEach(() => {
    sessionAgentStore.discard(chatA)
    sessionAgentStore.discard(chatB)
  })

  it('blocks a different project while another chat is busy', () => {
    sessionAgentStore.beginRun(chatA, { codingProjectPath: projA })
    expect(sessionAgentStore.codingProjectConflict(chatB, projB)).toMatch(/different project/)
    expect(sessionAgentStore.codingProjectConflict(chatB, projA)).toBeNull()
    sessionAgentStore.stop(chatA)
  })

  it('allows the same project on two chats (no hard conflict)', () => {
    sessionAgentStore.beginRun(chatA, { codingProjectPath: projA })
    expect(sessionAgentStore.codingProjectConflict(chatB, projA)).toBeNull()
    sessionAgentStore.stop(chatA)
  })

  it('returns same-project advisory when a peer is busy on the same path', () => {
    sessionAgentStore.beginRun(chatA, { codingProjectPath: projA })
    const advisory = sessionAgentStore.codingSameProjectBusyAdvisory(chatB, projA)
    expect(advisory).toMatch(/Another chat is also using this coding project/)
    expect(advisory).toMatch(/within one batch, not across chats/)
    sessionAgentStore.stop(chatA)
  })

  it('stop keeps path for grace and advisory still fires briefly', () => {
    sessionAgentStore.beginRun(chatA, { codingProjectPath: projA })
    sessionAgentStore.stop(chatA)
    const slot = sessionAgentStore.get(chatA)!
    expect(slot.busy).toBe(false)
    expect(slot.codingProjectPath).toBe(projA)
    expect(slot.codingStopGraceUntil).toBeGreaterThan(Date.now())
    expect(sessionAgentStore.codingSameProjectBusyAdvisory(chatB, projA)).toBeTruthy()
    sessionAgentStore.update(chatA, { codingStopGraceUntil: Date.now() - 1 })
    expect(sessionAgentStore.codingSameProjectBusyAdvisory(chatB, projA)).toBeNull()
  })

  it('endRun clears project path and grace', () => {
    const { runId } = sessionAgentStore.beginRun(chatA, { codingProjectPath: projA })
    sessionAgentStore.endRun(chatA, runId)
    const slot = sessionAgentStore.get(chatA)!
    expect(slot.codingProjectPath).toBeUndefined()
    expect(slot.codingStopGraceUntil).toBeUndefined()
  })
})
