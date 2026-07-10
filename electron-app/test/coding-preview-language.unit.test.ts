import { describe, expect, test } from 'vitest'
import { languageFromPreviewPath } from '@/lib/codingPreviewLanguage'
import { escapePreviewHtml, highlightPreviewLine } from '@/lib/codingSyntaxHighlight'

describe('languageFromPreviewPath', () => {
  test('maps common web extensions', () => {
    expect(languageFromPreviewPath('src/App.tsx')).toBe('typescript')
    expect(languageFromPreviewPath('src\\lib\\chat.ts')).toBe('typescript')
    expect(languageFromPreviewPath('index.html')).toBe('xml')
    expect(languageFromPreviewPath('styles/main.css')).toBe('css')
    expect(languageFromPreviewPath('package.json')).toBe('json')
  })

  test('handles special filenames', () => {
    expect(languageFromPreviewPath('Dockerfile')).toBe('dockerfile')
    expect(languageFromPreviewPath('Makefile')).toBe('bash')
  })

  test('returns null for unknown extensions', () => {
    expect(languageFromPreviewPath('archive.zip')).toBeNull()
    expect(languageFromPreviewPath(null)).toBeNull()
  })
})

describe('highlightPreviewLine', () => {
  test('escapes plain text when language is unknown', () => {
    expect(highlightPreviewLine('<tag>', null)).toBe('&lt;tag&gt;')
  })

  test('highlights typescript keywords', () => {
    const html = highlightPreviewLine('export const value = 1', 'typescript')
    expect(html).toContain('hljs-keyword')
    expect(html).toContain('export')
  })

  test('escapes html helper', () => {
    expect(escapePreviewHtml('a & b')).toBe('a &amp; b')
  })
})
