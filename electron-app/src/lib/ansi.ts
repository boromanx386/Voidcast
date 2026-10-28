/**
 * Minimal SGR (color/bold) parser for terminal rows. Rows are parsed one at a time, so a color
 * that spans lines restarts at default on the next row — fine for compiler and test output,
 * which re-emits codes per line.
 */

export type AnsiStyle = {
  /** CSS color: `rgb(var(--ansi-N))` for the 16 palette colors, `rgb(r g b)` otherwise. */
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  inverse?: boolean
}

export type AnsiSpan = { text: string; style: AnsiStyle }

const SGR_RE = /\x1b\[([0-9;]*)m/g

const palette = (n: number) => `rgb(var(--ansi-${n}))`

/** xterm 256-color index → CSS color. */
function color256(n: number): string | undefined {
  if (!Number.isInteger(n) || n < 0 || n > 255) return undefined
  if (n < 16) return palette(n)
  if (n >= 232) {
    const v = 8 + (n - 232) * 10
    return `rgb(${v} ${v} ${v})`
  }
  const i = n - 16
  const level = (c: number) => (c === 0 ? 0 : 55 + c * 40)
  return `rgb(${level(Math.floor(i / 36))} ${level(Math.floor(i / 6) % 6)} ${level(i % 6)})`
}

function applySgr(style: AnsiStyle, params: number[]): AnsiStyle {
  const next = { ...style }
  for (let i = 0; i < params.length; i++) {
    const p = params[i]
    if (p === 0) {
      for (const k of Object.keys(next)) delete next[k as keyof AnsiStyle]
    } else if (p === 1) next.bold = true
    else if (p === 2) next.dim = true
    else if (p === 3) next.italic = true
    else if (p === 4) next.underline = true
    else if (p === 7) next.inverse = true
    else if (p === 22) {
      delete next.bold
      delete next.dim
    } else if (p === 23) delete next.italic
    else if (p === 24) delete next.underline
    else if (p === 27) delete next.inverse
    else if (p >= 30 && p <= 37) next.fg = palette(p - 30)
    else if (p >= 90 && p <= 97) next.fg = palette(p - 90 + 8)
    else if (p === 39) delete next.fg
    else if (p >= 40 && p <= 47) next.bg = palette(p - 40)
    else if (p >= 100 && p <= 107) next.bg = palette(p - 100 + 8)
    else if (p === 49) delete next.bg
    else if (p === 38 || p === 48) {
      const key = p === 38 ? 'fg' : 'bg'
      if (params[i + 1] === 5) {
        const c = color256(params[i + 2])
        if (c) next[key] = c
        i += 2
      } else if (params[i + 1] === 2) {
        const [r, g, b] = params.slice(i + 2, i + 5)
        if ([r, g, b].every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) {
          next[key] = `rgb(${r} ${g} ${b})`
        }
        i += 4
      }
    }
  }
  return next
}

export function hasAnsi(text: string): boolean {
  return text.includes('\x1b')
}

export function parseAnsi(text: string): AnsiSpan[] {
  const spans: AnsiSpan[] = []
  let style: AnsiStyle = {}
  let last = 0
  SGR_RE.lastIndex = 0
  for (let m = SGR_RE.exec(text); m; m = SGR_RE.exec(text)) {
    if (m.index > last) spans.push({ text: text.slice(last, m.index), style })
    const params = m[1] === '' ? [0] : m[1].split(';').map((v) => (v === '' ? 0 : Number(v)))
    style = applySgr(style, params)
    last = m.index + m[0].length
  }
  if (last < text.length) spans.push({ text: text.slice(last), style })
  // A sequence cut at a chunk boundary would otherwise print as `[3`.
  return spans
    .map((s) => ({ ...s, text: s.text.replace(/\x1b\[?[0-9;]*$/, '').replace(/\x1b/g, '') }))
    .filter((s) => s.text.length > 0)
}
