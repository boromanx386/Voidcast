import { describe, expect, it } from 'vitest'
import { buildFindHighlightHtml } from '@/lib/filePreviewFindHighlight'

describe('buildFindHighlightHtml', () => {
  it('escapes html and wraps matches', () => {
    const html = buildFindHighlightHtml('<foo> bar foo', 'foo', false, 1)
    expect(html).toContain('&lt;')
    expect(html).toContain('<mark class="find-mark">foo</mark>')
    expect(html).toContain('<mark class="find-mark find-mark--active">foo</mark>')
  })

  it('returns plain escaped text when query is empty', () => {
    expect(buildFindHighlightHtml('a & b', '', false, -1)).toBe('a &amp; b')
  })
})
