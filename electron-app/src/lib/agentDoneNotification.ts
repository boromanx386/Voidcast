/**
 * OS toast shown when an assistant reply finishes while the Voidcast window is
 * minimized or hidden in the tray. The main process decides whether to actually
 * show it (it owns the window state); this module only prepares the text.
 */

/** Max characters of reply text put into the toast body. */
const MAX_BODY_CHARS = 160

/**
 * One-line preview of a finished reply for the toast body: first non-empty line,
 * light markdown noise stripped, clamped to a readable length.
 */
export function agentDoneNotificationBody(replyText: string): string {
  const firstLine =
    replyText
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  const plain = firstLine
    .replace(/^[#>*\-\s]+/, '')
    .replace(/`+/g, '')
    .replace(/\*\*|__|~~/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim()
  if (!plain) return 'Reply ready.'
  return plain.length > MAX_BODY_CHARS
    ? `${plain.slice(0, MAX_BODY_CHARS - 1).trimEnd()}…`
    : plain
}

/**
 * Ask the main process to show the "reply finished" notification. Best-effort:
 * no-ops when the window is in the foreground (main returns false then).
 */
export function notifyAgentDone(replyText: string): void {
  try {
    const api = window.voidcast
    if (!api?.notifyAgentDone) return
    void api
      .notifyAgentDone({ title: 'Voidcast', body: agentDoneNotificationBody(replyText) })
      .catch(() => {
        /* notification is best-effort */
      })
  } catch {
    /* ignore */
  }
}
