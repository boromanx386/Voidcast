import { describe, expect, test } from 'vitest'
import {
  GENERAL_SESSION_GROUP_KEY,
  groupSessionsByProject,
  projectPathDisplayLabel,
  projectPathGroupKey,
  sessionBoundProjectPath,
} from '@/lib/sessionProjectGroups'

describe('sessionProjectGroups', () => {
  test('sessionBoundProjectPath prefers codingProjectPath then memo', () => {
    expect(sessionBoundProjectPath(undefined)).toBe('')
    expect(sessionBoundProjectPath({ id: '1', updatedAt: 1 })).toBe('')
    expect(
      sessionBoundProjectPath({
        id: '1',
        updatedAt: 1,
        codingProjectPath: 'Q:\\coding\\vst',
      }),
    ).toBe('Q:\\coding\\vst')
    expect(
      sessionBoundProjectPath({
        id: '1',
        updatedAt: 1,
        codingContextMemo: { projectPath: 'Q:\\coding\\other' },
      }),
    ).toBe('Q:\\coding\\other')
  })

  test('projectPathGroupKey normalizes slash/case and maps empty to General', () => {
    expect(projectPathGroupKey('')).toBe(GENERAL_SESSION_GROUP_KEY)
    expect(projectPathGroupKey('C:\\Projects\\App\\')).toBe('c:/projects/app')
    expect(projectPathGroupKey('C:/Projects/App')).toBe('c:/projects/app')
  })

  test('projectPathDisplayLabel uses basename', () => {
    expect(projectPathDisplayLabel('')).toBe('General')
    expect(projectPathDisplayLabel('Q:\\coding\\vst')).toBe('vst')
    expect(projectPathDisplayLabel('/tmp/foo/')).toBe('foo')
  })

  test('groupSessionsByProject puts General first and sorts by activity', () => {
    const sessions = [
      { id: 'a', updatedAt: 10, codingProjectPath: 'Q:\\coding\\old' },
      { id: 'b', updatedAt: 30, codingProjectPath: '' },
      { id: 'c', updatedAt: 40, codingProjectPath: 'Q:\\coding\\vst' },
      { id: 'd', updatedAt: 20, codingProjectPath: 'Q:\\coding\\vst\\' },
      { id: 'e', updatedAt: 5 },
    ]
    const groups = groupSessionsByProject(sessions)
    expect(groups.map((g) => g.key)).toEqual([
      GENERAL_SESSION_GROUP_KEY,
      'q:/coding/vst',
      'q:/coding/old',
    ])
    expect(groups[0]!.sessions.map((s) => s.id)).toEqual(['b', 'e'])
    expect(groups[1]!.sessions.map((s) => s.id)).toEqual(['c', 'd'])
    expect(groups[1]!.label).toBe('vst')
  })
})
