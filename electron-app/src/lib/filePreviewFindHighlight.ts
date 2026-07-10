import { findAllMatchRanges } from '@/lib/filePreviewFindReplace'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** HTML for the find highlight layer behind the edit textarea. */
export function buildFindHighlightHtml(
  text: string,
  query: string,
  matchCase: boolean,
  activeIndex: number,
): string {
  if (!query) return escapeHtml(text)

  const ranges = findAllMatchRanges(text, query, matchCase)
  if (ranges.length === 0) return escapeHtml(text)

  let html = ''
  let pos = 0
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!
    html += escapeHtml(text.slice(pos, range.start))
    const active = i === activeIndex
    html += `<mark class="find-mark${active ? ' find-mark--active' : ''}">${escapeHtml(text.slice(range.start, range.end))}</mark>`
    pos = range.end
  }
  html += escapeHtml(text.slice(pos))
  return html
}
