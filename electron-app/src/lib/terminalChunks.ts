import type { TerminalLine } from '@/types/coding'

/** Keeps layout/paint cheap: one DOM row per chunk at most this many chars. */
export const MAX_TERMINAL_LINE_CHARS = 4096

/** Total rows retained in state (including chunk-expanded tool output). */
export const MAX_TERMINAL_ROWS = 2000

/**
 * Cursor-to-column (`ESC[nG`) and erase-line (`ESC[2K`) are how spinners redraw a line;
 * treat them like `\r`. Every other non-SGR escape is dropped: the panel only renders colors.
 */
function normalizeEscapes(text: string): string {
  return (
    text
      .replace(/\x1b\[(?:\d*G|[012]?K)/g, '\r')
      // OSC (window title, hyperlinks): ESC ] … BEL or ESC \
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      // CSI sequences that are not SGR (`…m`)
      .replace(/\x1b\[[0-9;?]*[A-Za-ln-z]/g, '')
      .replace(/\x1b[()][A-Za-z0-9]/g, '')
  )
}

/**
 * Applies `\r` like a terminal would for redraw-style output: text after a carriage return
 * replaces the line. A trailing `\r` only arms the reset, so `50%\r` keeps showing `50%`
 * until the next frame arrives.
 */
function applyCarriageReturns(
  base: string,
  pendingCr: boolean,
  segment: string,
): { text: string; pendingCr: boolean } {
  const parts = segment.split('\r')
  let text = base
  let pending = pendingCr
  parts.forEach((part, i) => {
    if (i > 0) pending = true
    if (part === '') return
    text = pending ? part : text + part
    pending = false
  })
  return { text, pendingCr: pending }
}

export type TerminalChunk = {
  stream: TerminalLine['stream']
  text: string
  idPrefix: string
  runId?: string
  source?: TerminalLine['source']
}

/**
 * Appends one output chunk to the rows. A chunk that continues the open (newline-less) last row
 * of the same run and stream is merged into it, so a prompt and its answer, or a progress bar's
 * frames, stay on one row.
 */
export function appendTerminalChunk(
  prev: TerminalLine[],
  chunk: TerminalChunk,
  maxRows = MAX_TERMINAL_ROWS,
): TerminalLine[] {
  const raw = normalizeEscapes(String(chunk.text ?? '').replace(/\r\n/g, '\n'))
  if (raw.length === 0) return prev

  const ts = Date.now()
  const endsOpen = !raw.endsWith('\n')
  const segments = raw.split('\n')
  // Line-aligned stream chunks end in a newline; without this every chunk adds a blank row.
  if (!endsOpen) segments.pop()

  const out = prev.slice()
  const last = out[out.length - 1]
  const canMerge =
    last?.partial === true &&
    chunk.runId != null &&
    last.runId === chunk.runId &&
    last.stream === chunk.stream

  let seq = 0
  segments.forEach((segment, i) => {
    const isLast = i === segments.length - 1
    const merging = i === 0 && canMerge
    const resolved = merging
      ? applyCarriageReturns(last.text, last.pendingCr === true, segment)
      : applyCarriageReturns('', false, segment)
    const open = isLast && endsOpen
    const pieces = splitLong(resolved.text)
    pieces.forEach((piece, j) => {
      const lastPiece = j === pieces.length - 1
      const row: TerminalLine = {
        id: merging && j === 0 ? last.id : `${chunk.idPrefix}-${seq++}`,
        stream: chunk.stream,
        text: piece,
        ts,
        ...(chunk.runId ? { runId: chunk.runId } : {}),
        ...(chunk.source ? { source: chunk.source } : {}),
        ...(open && lastPiece ? { partial: true } : {}),
        ...(open && lastPiece && resolved.pendingCr ? { pendingCr: true } : {}),
      }
      if (merging && j === 0) out[out.length - 1] = row
      else out.push(row)
    })
  })

  return out.length > maxRows ? out.slice(-maxRows) : out
}

function splitLong(text: string): string[] {
  if (text.length <= MAX_TERMINAL_LINE_CHARS) return [text]
  const pieces: string[] = []
  let rest = text
  while (rest.length > MAX_TERMINAL_LINE_CHARS) {
    pieces.push(`${rest.slice(0, MAX_TERMINAL_LINE_CHARS)}…`)
    rest = rest.slice(MAX_TERMINAL_LINE_CHARS)
  }
  pieces.push(rest)
  return pieces
}

export function expandTextToTerminalLines(
  stream: TerminalLine['stream'],
  text: string,
  idPrefix: string,
): TerminalLine[] {
  return appendTerminalChunk([], { stream, text, idPrefix }, Infinity).map(
    ({ partial: _p, pendingCr: _c, ...row }) => row,
  )
}
