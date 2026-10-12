import { describe, expect, test } from 'vitest'
import {
  emptyCodingContextMemo,
  patchSessionCodingPath,
  sessionCodingProjectPath,
} from '../src/lib/codingContextMemo'
import { mergeExternalSettings } from '../src/lib/externalSettingsSync'
import { defaults } from '../src/lib/settings'

type Row = {
  id: string
  updatedAt: number
  codingProjectPath?: string
  codingContextMemo?: ReturnType<typeof emptyCodingContextMemo>
}

function row(id: string, projectPath: string): Row {
  return {
    id,
    updatedAt: 1,
    codingProjectPath: projectPath || undefined,
    codingContextMemo: emptyCodingContextMemo(projectPath),
  }
}

describe('per-chat coding folder', () => {
  test('session path wins over its memo and a General chat stays General', () => {
    expect(sessionCodingProjectPath(undefined)).toBe('')
    expect(sessionCodingProjectPath({ codingProjectPath: 'Q:\\chatA' })).toBe('Q:\\chatA')
    expect(sessionCodingProjectPath({ codingContextMemo: { projectPath: 'Q:\\memo' } })).toBe(
      'Q:\\memo',
    )
    // Empty session path + empty memo = General: no app-default fallback leaks in.
    expect(
      sessionCodingProjectPath({ codingProjectPath: '', codingContextMemo: { projectPath: '' } }),
    ).toBe('')
  })

  test('rebinding one chat leaves every other chat untouched', () => {
    const sessions = [row('a', 'Q:\\chatA'), row('b', 'Q:\\chatB')]
    const next = patchSessionCodingPath(sessions, 'b', 'Q:\\other')

    expect(sessionCodingProjectPath(next[1])).toBe('Q:\\other')
    expect(next[1].codingContextMemo?.projectPath).toBe('Q:\\other')
    expect(next[0]).toBe(sessions[0])
    expect(sessionCodingProjectPath(next[0])).toBe('Q:\\chatA')
  })

  test('binding an empty folder returns the chat to General', () => {
    const sessions = [row('a', 'Q:\\chatA')]
    const next = patchSessionCodingPath(sessions, 'a', '   ')

    expect(next[0].codingProjectPath).toBeUndefined()
    expect(sessionCodingProjectPath(next[0])).toBe('')
  })

  test('rebinding an unknown chat is a no-op', () => {
    const sessions = [row('a', 'Q:\\chatA')]
    expect(patchSessionCodingPath(sessions, 'missing', 'Q:\\x')).toBe(sessions)
  })

  test('external settings sync never resurrects stale coding state', () => {
    const live = { ...defaults, coding: { ...defaults.coding, terminalHeightPx: 222 } }
    const onDisk = {
      ...defaults,
      uiTheme: 'matrix' as const,
      coding: { ...defaults.coding, terminalHeightPx: 111 },
    }

    const merged = mergeExternalSettings(live, onDisk)

    // Adopted: the field an agent tool may write straight to disk.
    expect(merged.uiTheme).toBe('matrix')
    // Kept: every coding field, including the panel layout an open chat is using.
    expect(merged.coding.terminalHeightPx).toBe(222)
    // And an in-sync poll must not re-render the app at all.
    expect(mergeExternalSettings(live, live)).toBe(live)
  })
})
