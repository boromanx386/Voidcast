import { describe, expect, test } from 'vitest'
import {
  buildAssistantImageVisionHint,
  buildHistoricalImageRecallHint,
  buildImageCatalogHint,
  buildQueuedFilePathHint,
  buildQueuedImagePathHint,
  buildRuntimeTimeHint,
  buildSteerCourseCorrectionText,
  deriveSessionTitle,
  sanitizeForTts,
  shouldUseVisionForText,
  toConversationTurns,
} from '../src/lib/chatHints'
import { buildToolsCodingHint } from '../src/lib/chatMessages'
import type { PendingChatImage } from '../src/lib/chatImageCatalog'

describe('deriveSessionTitle', () => {
  test('returns UNTITLED_SESSION when no user messages', () => {
    expect(deriveSessionTitle([])).toBe('UNTITLED_SESSION')
  })

  test('uses first user content', () => {
    expect(
      deriveSessionTitle([{ id: '1', role: 'user', content: 'Hello world' }]),
    ).toBe('Hello world')
  })

  test('truncates long titles', () => {
    const long = 'a'.repeat(80)
    const title = deriveSessionTitle([{ id: '1', role: 'user', content: long }])
    expect(title.length).toBe(61)
    expect(title.endsWith('…')).toBe(true)
  })

  test('falls back to [image] for image-only user message', () => {
    expect(
      deriveSessionTitle([{ id: '1', role: 'user', content: '', images: ['abc'] }]),
    ).toBe('[image]')
  })
})

describe('sanitizeForTts', () => {
  test('strips code blocks and URLs', () => {
    const input = 'Hello ```code here``` visit https://example.com ok'
    expect(sanitizeForTts(input)).toBe('Hello visit ok')
  })

  test('strips image_url lines', () => {
    expect(sanitizeForTts('Done\nimage_url: https://cdn.example.com/x.png')).toBe('Done')
  })
})

describe('buildRuntimeTimeHint', () => {
  test('includes ISO timestamp', () => {
    const fixed = new Date('2026-06-12T12:00:00.000Z')
    const hint = buildRuntimeTimeHint(fixed)
    expect(hint).toContain('2026-06-12T12:00:00.000Z')
    expect(hint).toContain('Runtime clock context:')
  })
})

describe('shouldUseVisionForText', () => {
  test('matches analyze/describe triggers', () => {
    expect(shouldUseVisionForText('please analyze this')).toBe(true)
    expect(shouldUseVisionForText('what is in the photo')).toBe(true)
    expect(shouldUseVisionForText('hello there')).toBe(false)
  })
})

describe('buildImageCatalogHint', () => {
  test('returns empty for empty catalog', () => {
    expect(buildImageCatalogHint([])).toBe('')
  })

  test('lists catalog indexes with pending lead', () => {
    const catalog: PendingChatImage[] = [
      { base64: 'abc', mime: 'image/png', path: '/tmp/a.png', kind: 'pending' },
    ]
    const hint = buildImageCatalogHint(catalog, 1)
    expect(hint).toContain('Session image catalog')
    expect(hint).toContain('Index 1')
    expect(hint).toContain('/tmp/a.png')
    expect(hint).toContain('THIS message are index 1')
  })

  test('without pending attach, tells model catalog images are not newly attached', () => {
    const catalog: PendingChatImage[] = [
      { base64: 'abc', mime: 'image/png', path: '/tmp/old.png', kind: 'attachment' },
    ]
    const hint = buildImageCatalogHint(catalog, 0)
    expect(hint).toContain('No image is attached to THIS message')
    expect(hint).toContain('Do not describe or treat catalog images as newly attached')
    expect(hint).toContain('/tmp/old.png')
  })
})

describe('buildQueuedImagePathHint', () => {
  test('returns empty when no queued images', () => {
    expect(buildQueuedImagePathHint([])).toBe('')
  })

  test('lists attached paths', () => {
    const hint = buildQueuedImagePathHint([
      { base64: 'x', mime: 'image/png', path: 'C:\\img.png' },
    ])
    expect(hint).toContain('C:\\img.png')
  })
})

describe('buildHistoricalImageRecallHint', () => {
  test('returns empty for non-user or no images', () => {
    expect(buildHistoricalImageRecallHint({ id: '1', role: 'assistant', content: '' }, [])).toBe('')
  })

  test('maps attachment to catalog index', () => {
    const b64 = 'dGVzdA=='
    const catalog: PendingChatImage[] = [{ base64: b64, mime: 'image/png', path: '/p.png' }]
    const hint = buildHistoricalImageRecallHint(
      { id: '1', role: 'user', content: 'see this', images: [b64], imagePaths: ['/p.png'] },
      catalog,
    )
    expect(hint).toContain('Index 1')
    expect(hint).toContain('/p.png')
  })
})

describe('buildAssistantImageVisionHint', () => {
  test('includes vision analysis for generated paths', () => {
    const path = 'C:\\out\\gen.png'
    const hint = buildAssistantImageVisionHint(
      { id: '1', role: 'assistant', content: 'done', generatedImagePaths: [path] },
      { [`path:${path.toLowerCase()}`]: 'a red circle' },
    )
    expect(hint).toContain('Vision analysis: a red circle')
  })
})

describe('buildQueuedFilePathHint', () => {
  test('includes file snapshot content', () => {
    const hint = buildQueuedFilePathHint([
      {
        id: 'f1',
        name: 'doc.txt',
        path: '/doc.txt',
        mime: 'text/plain',
        size: 10,
        ext: 'txt',
        content: 'hello file',
      },
    ])
    expect(hint).toContain('doc.txt')
    expect(hint).toContain('hello file')
  })
})

describe('toConversationTurns', () => {
  test('filters empty turns and substitutes attachment placeholders', () => {
    const turns = toConversationTurns([
      { id: '1', role: 'user', content: '', images: ['x'] },
      { id: '2', role: 'assistant', content: '  ' },
      { id: '3', role: 'assistant', content: 'reply' },
    ])
    expect(turns).toEqual([
      { role: 'user', content: '[user attached image]' },
      { role: 'assistant', content: 'reply' },
    ])
  })
})

describe('buildToolsCodingHint', () => {
  test('requires tool calls and includes project path', () => {
    const hint = buildToolsCodingHint('Q:/coding/vst')
    expect(hint).toContain('MUST call')
    expect(hint).toContain('Q:/coding/vst')
    expect(hint).toContain('edit_code')
    expect(hint).toContain('execute_command')
  })

  test('team mode forbids plan escalate and prefers workers', () => {
    const hint = buildToolsCodingHint('Q:/coding/vst', {
      codingSubAgentEnabled: true,
      teamMode: true,
    })
    expect(hint).toContain('run_coding_workers')
    expect(hint).toContain('orchestrator protocol')
    expect(hint).toContain('TEAM MODE')
    expect(hint).toContain('DEFAULT for non-trivial coding')
  })

  test('agent mode exposes workers as optional', () => {
    const hint = buildToolsCodingHint('Q:/coding/vst', {
      codingSubAgentEnabled: true,
      teamMode: false,
    })
    expect(hint).toContain('run_coding_workers')
    expect(hint).toContain('optional')
    expect(hint).toContain('AGENT MODE workers')
    expect(hint).not.toContain('PRIMARY for multi-file')
  })
})

describe('buildSteerCourseCorrectionText', () => {
  test('wraps user text with hard redirect framing', () => {
    const out = buildSteerCourseCorrectionText('  do the other file  ')
    expect(out).toContain('[Steer — mid-turn course correction]')
    expect(out).toContain('hard redirect')
    expect(out).toContain('do the other file')
  })

  test('still returns header when body is empty', () => {
    const out = buildSteerCourseCorrectionText('   ')
    expect(out).toContain('[Steer — mid-turn course correction]')
    expect(out).not.toMatch(/\n\n$/)
  })
})
