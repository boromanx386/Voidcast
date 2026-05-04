import type { TerminalLine } from '@/types/coding'

/** Keeps layout/paint cheap: one DOM row per chunk at most this many chars. */
export const MAX_TERMINAL_LINE_CHARS = 4096

/** Total rows retained in state (including chunk-expanded tool output). */
export const MAX_TERMINAL_ROWS = 100

export function expandTextToTerminalLines(
  stream: TerminalLine['stream'],
  text: string,
  idPrefix: string,
): TerminalLine[] {
  const ts = Date.now()
  const raw = String(text ?? '')
  if (raw.length === 0) return []

  const segments = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const out: TerminalLine[] = []
  let seq = 0

  for (const segment of segments) {
    let rest = segment
    while (rest.length > 0) {
      const take = rest.slice(0, MAX_TERMINAL_LINE_CHARS)
      rest = rest.slice(MAX_TERMINAL_LINE_CHARS)
      const cont = rest.length > 0
      out.push({
        id: `${idPrefix}-${seq++}`,
        stream,
        text: cont ? `${take}…` : take,
        ts,
      })
    }
  }

  return out
}
