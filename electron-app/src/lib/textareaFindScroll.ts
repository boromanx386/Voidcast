import type { TextRange } from '@/lib/filePreviewFindReplace'

function copyTextareaMetrics(el: HTMLTextAreaElement, mirror: HTMLDivElement): void {
  const cs = window.getComputedStyle(el)
  mirror.style.whiteSpace = 'pre'
  mirror.style.overflowWrap = 'normal'
  mirror.style.wordWrap = 'normal'
  mirror.style.font = cs.font
  mirror.style.letterSpacing = cs.letterSpacing
  mirror.style.lineHeight = cs.lineHeight
  mirror.style.padding = cs.padding
  mirror.style.border = cs.border
  mirror.style.boxSizing = cs.boxSizing
  mirror.style.width = `${el.clientWidth}px`
}

/** Scroll a textarea so the given range is visible (mirror-based for accuracy). */
export function scrollTextareaMatchIntoView(el: HTMLTextAreaElement, range: TextRange): void {
  const text = el.value
  const before = text.slice(0, range.start)
  const marker = text.slice(range.start, Math.max(range.end, range.start + 1))

  const mirror = document.createElement('div')
  mirror.setAttribute('aria-hidden', 'true')
  mirror.style.position = 'fixed'
  mirror.style.top = '-10000px'
  mirror.style.left = '-10000px'
  mirror.style.visibility = 'hidden'
  mirror.style.pointerEvents = 'none'
  copyTextareaMetrics(el, mirror)

  mirror.append(document.createTextNode(before))
  const span = document.createElement('span')
  span.textContent = marker || ' '
  mirror.appendChild(span)

  document.body.appendChild(mirror)
  const markerTop = span.offsetTop
  const markerLeft = span.offsetLeft
  document.body.removeChild(mirror)

  const marginY = el.clientHeight * 0.35
  const marginX = el.clientWidth * 0.35
  el.scrollTop = Math.max(0, Math.min(markerTop - marginY, el.scrollHeight - el.clientHeight))
  el.scrollLeft = Math.max(0, Math.min(markerLeft - marginX, el.scrollWidth - el.clientWidth))
}

export function revealTextareaMatch(el: HTMLTextAreaElement, range: TextRange): void {
  el.setSelectionRange(range.start, range.end)
  scrollTextareaMatchIntoView(el, range)
}

export function focusTextareaMatch(el: HTMLTextAreaElement, range: TextRange): void {
  el.focus({ preventScroll: true })
  revealTextareaMatch(el, range)
}
