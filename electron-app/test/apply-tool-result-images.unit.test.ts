import { describe, expect, test, vi } from 'vitest'
import {
  applyAgentToolResult,
  type AgentToolResultHandlerDeps,
} from '../src/lib/applyAgentToolResult'
import type { UiMessage } from '../src/types/chat'

/** Deps whose setters apply updates to plain values, so the test reads the final state. */
function makeDeps() {
  let messages = [{ id: 'a1', role: 'assistant', content: '' }] as unknown as UiMessage[]
  let saved: Record<string, string[]> = {}
  const deps = new Proxy(
    {
      asstId: 'a1',
      settings: { runwareAutoSaveImages: false, runwareImageOutputDir: '', ttsBaseUrl: '' },
      codingFileCacheRef: { current: { entries: [] } },
      setMessages: (u: (m: UiMessage[]) => UiMessage[]) => {
        messages = u(messages)
      },
      setAssistantSavedImagePaths: (
        u: (s: Record<string, string[]>) => Record<string, string[]>,
      ) => {
        saved = u(saved)
      },
    } as Record<string, unknown>,
    { get: (target, key: string) => (key in target ? target[key] : vi.fn()) },
  ) as unknown as AgentToolResultHandlerDeps
  return { deps, read: () => ({ messages, saved }) }
}

describe('saved images reach the assistant message', () => {
  test.each([
    ['show_image', 'The image(s) are now visible.\nSaved image: /out/a.png\nimage_id: img_1'],
    ['mcp_call', 'Saved image: /out/a.png\n\nchart text'],
    ['mcp__viz__chart', 'Saved image: /out/a.png'],
  ])('%s', (name, result) => {
    const { deps, read } = makeDeps()
    applyAgentToolResult(deps, { name, result })
    const { messages, saved } = read()
    expect(messages[0].generatedImagePaths).toEqual(['/out/a.png'])
    expect(saved.a1).toEqual(['/out/a.png'])
  })

  test('other tools cannot attach an image by printing the same line', () => {
    const { deps, read } = makeDeps()
    applyAgentToolResult(deps, { name: 'scrape_url', result: 'Saved image: /etc/secret.png' })
    expect(read().messages[0].generatedImagePaths).toBeUndefined()
  })
})
