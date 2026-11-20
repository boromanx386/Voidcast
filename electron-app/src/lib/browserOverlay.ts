/**
 * The Voidcast browser page is a native view drawn above every DOM element, so no z-index
 * can put a popup over it. The WEB panel watches for DOM overlays that overlap its rect and
 * swaps the live view for a still frame while one is open.
 *
 * An overlay is anything matching OVERLAY_SELECTOR. New popups and modals get picked up by
 * giving them a dialog/menu/listbox role (which they should have anyway) or, for purely
 * visual overlays, `data-covers-browser`.
 */

export type Rect = { x: number; y: number; width: number; height: number }

export const OVERLAY_SELECTOR =
  '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[aria-modal="true"],[data-covers-browser]'

type Box = { left: number; top: number; right: number; bottom: number }

export function rectsOverlap(a: Box, b: Rect): boolean {
  if (a.right - a.left <= 0 || a.bottom - a.top <= 0) return false
  if (b.width <= 0 || b.height <= 0) return false
  return a.left < b.x + b.width && a.right > b.x && a.top < b.y + b.height && a.bottom > b.y
}

/** True when an overlay outside `host` overlaps `rect` (viewport coordinates). */
export function overlayCovers(doc: Document, host: Element, rect: Rect): boolean {
  for (const el of doc.querySelectorAll(OVERLAY_SELECTOR)) {
    // The panel's own controls never count, or the page would freeze on itself.
    if (host.contains(el) || el.contains(host)) continue
    if (rectsOverlap(el.getBoundingClientRect(), rect)) return true
  }
  return false
}

/**
 * The host's padding box. The view used to be sized to the border box, so it painted over
 * the panel's border and its rounded corners.
 */
export function hostContentRect(el: HTMLElement): Rect {
  const box = el.getBoundingClientRect()
  return {
    x: Math.round(box.left + el.clientLeft),
    y: Math.round(box.top + el.clientTop),
    width: Math.round(el.clientWidth),
    height: Math.round(el.clientHeight),
  }
}

export function sameRect(a: Rect | null, b: Rect): boolean {
  return a !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}
