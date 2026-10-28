/**
 * Popup policy for the Voidcast browser, kept free of Electron so it can be unit tested.
 *
 * A page may open popups (OAuth and "open in new tab" flows rely on it), but an untrusted
 * page calling window.open in a loop used to cycle through the page cap and close every
 * tab the user or the agent had opened. Two rules stop that: a burst limit per project,
 * and eviction that only ever removes earlier popups.
 */

/** Popups one project may open inside `POPUP_WINDOW_MS` before further ones are refused. */
export const POPUP_BURST = 3
export const POPUP_WINDOW_MS = 10_000

/**
 * Record a popup attempt at `now` and say whether it may open. `recent` is the project's
 * own list of attempt times and is pruned and appended in place; refused attempts are not
 * recorded, so a storm cannot keep the window shut forever.
 */
export function allowPopup(
  recent: number[],
  now: number,
  limit = POPUP_BURST,
  windowMs = POPUP_WINDOW_MS,
): boolean {
  const cutoff = now - windowMs
  let keep = 0
  for (const at of recent) if (at > cutoff) recent[keep++] = at
  recent.length = keep
  if (recent.length >= limit) return false
  recent.push(now)
  return true
}

/**
 * Which page to close to make room for a popup at the cap: the oldest popup that is not
 * the current page. Pages the user or the agent opened are never evicted — null means
 * the popup has to be refused instead.
 */
export function popupToEvict(
  pages: readonly { id: string; createdAt: number; popup: boolean }[],
  activeId: string | null,
): string | null {
  let oldest: { id: string; createdAt: number } | null = null
  for (const page of pages) {
    if (!page.popup || page.id === activeId) continue
    if (!oldest || page.createdAt < oldest.createdAt) oldest = page
  }
  return oldest?.id ?? null
}
