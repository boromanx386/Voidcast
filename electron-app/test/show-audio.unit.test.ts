import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  handleShowAudio,
  mediaHandlersRegistry,
  MAX_SHOW_AUDIO_BYTES,
  resolveLocalAudioPath,
} from '../src/lib/toolHandlers/mediaHandlers'
import {
  applyAgentToolResult,
  type AgentToolResultHandlerDeps,
} from '../src/lib/applyAgentToolResult'
import { buildToolsList } from '../src/lib/toolDefinitions'
import { toolPhaseForAgentTool } from '../src/lib/agentToolPhase'
import type { ExecCtx } from '../src/lib/toolExecTypes'
import type { UiMessage } from '../src/types/chat'

type SavePayload = { bytes: ArrayBuffer; mime?: string; filename?: string }

function stubDesktop(files: Record<string, string>) {
  const saves: SavePayload[] = []
  const reads: { path: string; maxBytes?: number }[] = []
  const voidcast = {
    readAudioFile: vi.fn(async (payload: { path: string; maxBytes?: number }) => {
      reads.push(payload)
      const { path } = payload
      return path in files
        ? {
            ok: true,
            file: { base64: files[path], mime: 'audio/wav', name: path.split('/').pop(), path },
          }
        : { ok: false, error: 'ENOENT' }
    }),
    saveAudioBytes: vi.fn(async (payload: SavePayload) => {
      saves.push(payload)
      const saved = `/out/${payload.filename || 'voidcast-tts'}.wav`
      return { ok: true, text: `Saved audio: ${saved}`, path: saved }
    }),
  }
  vi.stubGlobal('window', { voidcast })
  return { saves, reads }
}

const makeCtx = (over: Partial<ExecCtx> = {}) => ({ ...over }) as unknown as ExecCtx

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('show_audio', () => {
  test('copies the file and returns the copy as audio_path', async () => {
    const { saves, reads } = stubDesktop({ '/tmp/clip.wav': 'QUJD' })
    const res = await handleShowAudio({ paths: '/tmp/clip.wav' }, makeCtx())

    expect(reads[0].maxBytes).toBe(MAX_SHOW_AUDIO_BYTES)
    expect(saves[0].filename).toBe('clip')
    expect(saves[0].mime).toBe('audio/wav')
    expect(new TextDecoder().decode(saves[0].bytes)).toBe('ABC')
    expect(res).toContain('audio_path: /out/clip.wav')
  })

  test('resolves relative paths against the project', async () => {
    stubDesktop({ '/repo/sfx/hit.wav': 'QUJD' })
    const res = await handleShowAudio(
      { paths: 'sfx/hit.wav' },
      makeCtx({ codingProjectPath: '/repo' }),
    )
    expect(res).toContain('audio_path: /out/hit.wav')
  })

  test('reports partial failures next to what worked', async () => {
    stubDesktop({ '/tmp/ok.wav': 'QUJD' })
    const res = await handleShowAudio(
      { paths: '/tmp/ok.wav, /tmp/gone.mp3, /tmp/notes.txt' },
      makeCtx(),
    )
    expect(res).toContain('audio_path: /out/ok.wav')
    expect(res).toContain('Could not read audio: /tmp/gone.mp3. ENOENT.')
    expect(res).toContain('Not a usable audio path: /tmp/notes.txt')
  })

  test('returns errors the model can act on', async () => {
    stubDesktop({})
    expect(await handleShowAudio({}, makeCtx())).toMatch(/^Error: missing audio paths/)
    expect(await handleShowAudio({ paths: 'rel/a.mp3' }, makeCtx())).toMatch(
      /^Error: show_audio could not show any audio/,
    )
  })

  test('is desktop only', async () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome' })
    expect(await handleShowAudio({ paths: '/a.mp3' }, makeCtx())).toMatch(
      /only available in the desktop app/,
    )
  })

  test('is offered and registered in every agent mode', () => {
    const none = { coding: false, runwareImage: false } as never
    for (const opts of [undefined, { agentMode: 'plan' as const }]) {
      const names = buildToolsList(none, false, opts).map((t) => t.function.name)
      expect(names).toContain('show_audio')
    }
    expect(mediaHandlersRegistry.show_audio).toBe(handleShowAudio)
    expect(toolPhaseForAgentTool('show_audio')).toBe('audio')
  })

  test('the result puts a player on the assistant message', () => {
    let messages = [{ id: 'a1', role: 'assistant', content: '' }] as unknown as UiMessage[]
    const deps = new Proxy(
      {
        asstId: 'a1',
        settings: { runwareAutoSaveMusic: false, runwareMusicOutputDir: '' },
        codingFileCacheRef: { current: { entries: [] } },
        setMessages: (u: (m: UiMessage[]) => UiMessage[]) => {
          messages = u(messages)
        },
      } as Record<string, unknown>,
      { get: (target, key: string) => (key in target ? target[key] : vi.fn()) },
    ) as unknown as AgentToolResultHandlerDeps
    applyAgentToolResult(deps, {
      name: 'show_audio',
      result: 'The audio is now playable in the chat.\naudio_path: /out/clip.wav',
    })
    expect(messages[0].generatedAudioPaths).toEqual(['/out/clip.wav'])
  })
})

describe('resolveLocalAudioPath', () => {
  test('takes absolute paths anywhere, relative ones only inside the project', () => {
    expect(resolveLocalAudioPath('', 'C:\\temp\\a.mp3')).toBe('C:\\temp\\a.mp3')
    expect(resolveLocalAudioPath('', '/tmp/a.FLAC')).toBe('/tmp/a.FLAC')
    expect(resolveLocalAudioPath('/repo', 'sfx/a.ogg')).toBe('/repo/sfx/a.ogg')
    expect(resolveLocalAudioPath('', 'sfx/a.ogg')).toBeNull()
    expect(resolveLocalAudioPath('/repo', '../a.mp3')).toBeNull()
    expect(resolveLocalAudioPath('/repo', '/tmp/a.png')).toBeNull()
    expect(resolveLocalAudioPath('/repo', '/tmp/noext')).toBeNull()
  })
})
