import fontkit from '@pdf-lib/fontkit'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

const require = createRequire(import.meta.url)

const MAX_CONTENT_CHARS = 400_000
const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN_L = 54
const MARGIN_R = 54
const MARGIN_T = 72
const MARGIN_B = 65

/** A4 content width */
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R

const COL_TITLE = rgb(0.1, 0.21, 0.36)
const COL_H2 = rgb(0.18, 0.22, 0.28)
const COL_H34 = rgb(0.29, 0.33, 0.4)
const COL_BODY = rgb(0.1, 0.1, 0.1)
const COL_MUTED = rgb(0.45, 0.51, 0.58)
const COL_RULE = rgb(0.63, 0.68, 0.75)
const COL_TABLE_HEAD_BG = rgb(0.89, 0.91, 0.94)
const COL_TABLE_GRID = rgb(0.8, 0.84, 0.88)

const SIZE_TITLE = 18
const SIZE_H2 = 13
const SIZE_H3 = 11
const SIZE_H4 = 10
const SIZE_BODY = 10
const SIZE_TABLE = 9
const SIZE_DATE = 9

const LEADING = (s: number) => s * 1.4
const PARA_AFTER = 8
const BLOCK_GAP = 6

type FontQuad = {
  latin: PDFFont
  cyr: PDFFont
  latinBold: PDFFont
  cyrBold: PDFFont
}

function segmentRuns(s: string): { kind: 'cyr' | 'lat'; text: string }[] {
  const runs: { kind: 'cyr' | 'lat'; text: string }[] = []
  for (const ch of s) {
    const cyr = /[\u0400-\u04FF\u0500-\u052F]/.test(ch)
    const kind: 'cyr' | 'lat' = cyr ? 'cyr' : 'lat'
    const last = runs[runs.length - 1]
    if (last && last.kind === kind) last.text += ch
    else runs.push({ kind, text: ch })
  }
  return runs
}

function pickFont(
  fonts: FontQuad,
  kind: 'cyr' | 'lat',
  bold: boolean,
): PDFFont {
  if (bold) {
    return kind === 'cyr' ? fonts.cyrBold : fonts.latinBold
  }
  return kind === 'cyr' ? fonts.cyr : fonts.latin
}

function measureLine(
  text: string,
  fonts: FontQuad,
  size: number,
  bold = false,
): number {
  let w = 0
  for (const seg of segmentRuns(text)) {
    const font = pickFont(fonts, seg.kind, bold)
    w += font.widthOfTextAtSize(seg.text, size)
  }
  return w
}

function drawLineMixed(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  size: number,
  fonts: FontQuad,
  color = COL_BODY,
  bold = false,
): void {
  let cx = x
  for (const seg of segmentRuns(text)) {
    const font = pickFont(fonts, seg.kind, bold)
    page.drawText(seg.text, {
      x: cx,
      y,
      size,
      font,
      color,
    })
    cx += font.widthOfTextAtSize(seg.text, size)
  }
}

function drawRichLine(
  page: PDFPage,
  parts: { text: string; bold: boolean }[],
  x: number,
  y: number,
  size: number,
  fonts: FontQuad,
  color = COL_BODY,
): void {
  let cx = x
  for (const p of parts) {
    for (const seg of segmentRuns(p.text)) {
      const font = pickFont(fonts, seg.kind, p.bold)
      page.drawText(seg.text, {
        x: cx,
        y,
        size,
        font,
        color,
      })
      cx += font.widthOfTextAtSize(seg.text, size)
    }
  }
}

function breakLongToken(
  token: string,
  maxWidth: number,
  fonts: FontQuad,
  size: number,
  bold: boolean,
): string[] {
  const out: string[] = []
  let chunk = ''
  for (const ch of token) {
    const trial = chunk + ch
    if (measureLine(trial, fonts, size, bold) <= maxWidth) {
      chunk = trial
    } else {
      if (chunk) out.push(chunk)
      chunk = ch
    }
  }
  if (chunk) out.push(chunk)
  return out
}

/** Split on **…** — even chunks are normal, odd are bold */
function splitBoldParts(s: string): { text: string; bold: boolean }[] {
  const parts = s.split(/\*\*/)
  return parts.map((t, i) => ({ text: t, bold: i % 2 === 1 }))
}

function wordsFromBoldParts(
  parts: { text: string; bold: boolean }[],
): { text: string; bold: boolean }[] {
  const words: { text: string; bold: boolean }[] = []
  for (const p of parts) {
    if (!p.text) continue
    const bits = p.text.split(/(\s+)/)
    for (const b of bits) {
      if (!b) continue
      words.push({ text: b, bold: p.bold })
    }
  }
  return words
}

function wrapRichParagraph(
  para: string,
  maxWidth: number,
  fonts: FontQuad,
  size: number,
): { text: string; bold: boolean }[][] {
  const words = wordsFromBoldParts(splitBoldParts(para))
  const lines: { text: string; bold: boolean }[][] = []
  let cur: { text: string; bold: boolean }[] = []
  let curW = 0

  const flush = () => {
    if (cur.length) {
      lines.push(cur)
      cur = []
      curW = 0
    }
  }

  for (const w of words) {
    const isSpace = /^\s+$/.test(w.text)
    const pieceW = measureLine(w.text, fonts, size, w.bold)
    const trialW = curW + pieceW

    if (!isSpace && trialW > maxWidth && cur.length) {
      flush()
    }

    if (!isSpace && pieceW > maxWidth) {
      for (const piece of breakLongToken(w.text, maxWidth, fonts, size, w.bold)) {
        const pw = measureLine(piece, fonts, size, w.bold)
        if (curW + pw > maxWidth && cur.length) flush()
        cur.push({ text: piece, bold: w.bold })
        curW += pw
      }
      continue
    }

    cur.push(w)
    curW += pieceW
    if (isSpace && curW > maxWidth) {
      flush()
    }
  }
  flush()
  return lines
}

type ParsedListItem =
  | { kind: 'bullet'; body: string }
  | { kind: 'ordered'; n: string; body: string }

/** Merge continuation lines into the previous item; supports `-`, `•`, `* `, `1.` … */
function parseMarkdownListLines(rawLines: string[]): ParsedListItem[] | null {
  const items: ParsedListItem[] = []
  for (const raw of rawLines) {
    const line = raw.trimEnd()
    const t = line.trim()
    if (!t) continue

    let m: RegExpExecArray | null
    if ((m = /^[-•]\s+(.*)$/.exec(t))) {
      items.push({ kind: 'bullet', body: m[1] ?? '' })
    } else if (
      !t.startsWith('**') &&
      /^\*\s+/.test(t) &&
      (m = /^\*\s+(.*)$/.exec(t))
    ) {
      items.push({ kind: 'bullet', body: m[1] ?? '' })
    } else if ((m = /^(\d{1,3})\.\s+(.*)$/.exec(t))) {
      items.push({ kind: 'ordered', n: m[1], body: m[2] ?? '' })
    } else if (items.length > 0) {
      const prev = items[items.length - 1]
      prev.body += (prev.body ? ' ' : '') + t
    }
  }
  return items.length ? items : null
}

function isMarkdownListFirstLine(line: string): boolean {
  const t = line.trim()
  if (/^[-•]\s+/.test(t)) return true
  if (/^\d{1,3}\.\s+/.test(t)) return true
  if (/^\*\s+/.test(t) && !t.startsWith('**')) return true
  return false
}

function wrapPlainParagraph(
  paragraph: string,
  maxWidth: number,
  fonts: FontQuad,
  size: number,
  bold = false,
): string[] {
  const words = paragraph.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const word of words) {
    const trial = cur ? `${cur} ${word}` : word
    if (measureLine(trial, fonts, size, bold) <= maxWidth) {
      cur = trial
    } else {
      if (cur) lines.push(cur)
      if (measureLine(word, fonts, size, bold) <= maxWidth) {
        cur = word
      } else {
        lines.push(...breakLongToken(word, maxWidth, fonts, size, bold))
        cur = ''
      }
    }
  }
  if (cur) lines.push(cur)
  return lines
}

function normalizeForPdf(text: string): string {
  const replacements: Record<string, string> = {
    '\u00A0': ' ',
    '\u200B': '',
    '\u200C': '',
    '\u200D': '',
    '\uFEFF': '',
    '\u2018': "'",
    '\u2019': "'",
    '\u201C': '"',
    '\u201D': '"',
    '\u2026': '...',
    '\u2022': '•',
  }
  let t = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (const [a, b] of Object.entries(replacements)) {
    t = t.replaceAll(a, b)
  }
  for (const c of '\u2500\u2501\u2502\u2503\u2550\u2551\u2014\u2015') {
    t = t.replaceAll(c, '-')
  }
  t = t.replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
  t = t.replace(/[\u2600-\u27BF]/g, '')
  return t
}

function isAsciiRule(line: string): boolean {
  const s = line.trim()
  if (s.length < 8) return false
  const compact = s.replace(/\s/g, '')
  return compact.length > 0 && /^[=\-_]+$/.test(compact)
}

function parseMdTable(para: string): string[][] | null {
  const lines = para.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length < 1 || !lines[0].includes('|')) return null
  const rows: string[][] = []
  for (const line of lines) {
    if (!line.includes('|')) return null
    let raw = line.split('|').map((c) => c.trim())
    if (raw.length >= 2 && raw[0] === '' && raw[raw.length - 1] === '') {
      raw = raw.slice(1, -1)
    }
    if (!raw.length) continue
    if (raw.every((c) => /^[-:\s]+$/)) continue
    rows.push(raw.map((c) => c || ' '))
  }
  if (!rows.length) return null
  const maxCols = Math.max(...rows.map((r) => r.length))
  for (const r of rows) {
    while (r.length < maxCols) r.push(' ')
  }
  return rows
}

type RenderCtx = {
  pdfDoc: PDFDocument
  page: PDFPage
  y: number
  fonts: FontQuad
}

function ensureSpace(ctx: RenderCtx, need: number): void {
  if (ctx.y - need >= MARGIN_B) return
  ctx.page = ctx.pdfDoc.addPage([PAGE_W, PAGE_H])
  ctx.y = PAGE_H - MARGIN_T
}

function drawHr(ctx: RenderCtx): void {
  ensureSpace(ctx, 14)
  ctx.y -= 4
  const yLine = ctx.y
  ctx.page.drawLine({
    start: { x: MARGIN_L, y: yLine },
    end: { x: PAGE_W - MARGIN_R, y: yLine },
    thickness: 1,
    color: COL_RULE,
    opacity: 0.9,
  })
  ctx.y = yLine - 10
}

function drawParagraphRich(
  ctx: RenderCtx,
  para: string,
  size: number,
  color = COL_BODY,
  lineGap = 0,
  layout?: { x: number; width: number },
): void {
  const textX = layout?.x ?? MARGIN_L
  const maxW = layout?.width ?? CONTENT_W
  const lines = wrapRichParagraph(para, maxW, ctx.fonts, size)
  const lh = LEADING(size)
  for (const lineParts of lines) {
    ensureSpace(ctx, lh + 2)
    ctx.y -= lh
    drawRichLine(ctx.page, lineParts, textX, ctx.y, size, ctx.fonts, color)
  }
  ctx.y -= lineGap
}

/** Marker + hanging indent for wrapped body (same baseline on first line). */
function drawListItemRich(
  ctx: RenderCtx,
  markerDisplay: string,
  body: string,
  markerBold = false,
): void {
  const size = SIZE_BODY
  const lh = LEADING(size)
  const markerWithSpace = markerDisplay.endsWith(' ')
    ? markerDisplay
    : `${markerDisplay} `
  const prefixW = measureLine(markerWithSpace, ctx.fonts, size, markerBold)
  const textStartX = MARGIN_L + prefixW
  const maxW = PAGE_W - MARGIN_R - textStartX
  const lines = wrapRichParagraph(body.trim(), maxW, ctx.fonts, size)

  for (let i = 0; i < lines.length; i++) {
    ensureSpace(ctx, lh + 2)
    ctx.y -= lh
    if (i === 0) {
      drawLineMixed(
        ctx.page,
        markerWithSpace,
        MARGIN_L,
        ctx.y,
        size,
        ctx.fonts,
        COL_BODY,
        markerBold,
      )
      drawRichLine(
        ctx.page,
        lines[i],
        textStartX,
        ctx.y,
        size,
        ctx.fonts,
        COL_BODY,
      )
    } else {
      drawRichLine(
        ctx.page,
        lines[i],
        MARGIN_L + prefixW,
        ctx.y,
        size,
        ctx.fonts,
        COL_BODY,
      )
    }
  }
  ctx.y -= 4
}

/** Keeps single `\\n` inside a block as separate paragraphs; `\\n\\n` still splits blocks earlier. */
function drawBodyBlockRich(ctx: RenderCtx, block: string): void {
  const trimmed = block.trim()
  if (!trimmed) return
  const segments = trimmed
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (segments.length <= 1) {
    drawParagraphRich(ctx, trimmed, SIZE_BODY, COL_BODY, PARA_AFTER)
    return
  }
  for (let i = 0; i < segments.length; i++) {
    drawParagraphRich(
      ctx,
      segments[i],
      SIZE_BODY,
      COL_BODY,
      i < segments.length - 1 ? 8 : PARA_AFTER,
    )
  }
}

function drawParagraphPlain(
  ctx: RenderCtx,
  para: string,
  size: number,
  color = COL_BODY,
  bold = false,
  lineGap = 0,
): void {
  const lines = wrapPlainParagraph(para, CONTENT_W, ctx.fonts, size, bold)
  const lh = LEADING(size)
  for (const line of lines) {
    ensureSpace(ctx, lh + 2)
    ctx.y -= lh
    drawLineMixed(ctx.page, line, MARGIN_L, ctx.y, size, ctx.fonts, color, bold)
  }
  ctx.y -= lineGap
}

function classifyAndRenderBlock(ctx: RenderCtx, rawBlock: string): void {
  let block = rawBlock.trim()
  if (!block) return

  if (isAsciiRule(block)) {
    drawHr(ctx)
    return
  }

  const lines = block.split('\n').map((l) => l.trim())
  if (
    lines.length >= 3 &&
    isAsciiRule(lines[0] ?? '') &&
    isAsciiRule(lines[2] ?? '') &&
    lines[1]
  ) {
    drawHr(ctx)
    drawParagraphPlain(ctx, lines[1], SIZE_H3, COL_H2, true, 4)
    drawHr(ctx)
    const rest = lines.slice(3).join('\n').trim()
    if (rest) classifyAndRenderBlock(ctx, rest)
    return
  }

  if (/^-{2,}$/.test(block)) {
    ctx.y -= 12
    return
  }

  if (block.startsWith('---')) {
    const rest = block.replace(/^---+/, '').trim()
    ctx.y -= 12
    if (rest) classifyAndRenderBlock(ctx, rest)
    return
  }

  const firstLine = lines[0] ?? ''
  const restBlock = lines.slice(1).join('\n').trim()

  const heading = (
    prefix: string,
    size: number,
    color: ReturnType<typeof rgb>,
  ): boolean => {
    if (!firstLine.startsWith(prefix)) return false
    const title = firstLine.slice(prefix.length).trim()
    ensureSpace(ctx, size + 8)
    ctx.y -= size + 4
    drawParagraphPlain(ctx, title, size, color, true, 6)
    if (restBlock) classifyAndRenderBlock(ctx, restBlock)
    return true
  }

  if (heading('# ', SIZE_TITLE, COL_TITLE)) return
  if (heading('#### ', SIZE_H4, COL_H34)) return
  if (heading('### ', SIZE_H3, COL_H2)) return
  if (heading('## ', SIZE_H2, COL_H2)) return

  if (isMarkdownListFirstLine(firstLine)) {
    const parsed = parseMarkdownListLines(lines.filter((l) => l.trim().length))
    if (parsed?.length) {
      for (const item of parsed) {
        if (item.kind === 'bullet') {
          drawListItemRich(ctx, '•', item.body, false)
        } else {
          drawListItemRich(ctx, `${item.n}.`, item.body, false)
        }
      }
      ctx.y -= PARA_AFTER
      return
    }
  }

  const table = parseMdTable(block)
  if (table && table.length) {
    drawTable(ctx, table)
    ctx.y -= BLOCK_GAP
    return
  }

  drawBodyBlockRich(ctx, block)
}

function drawTable(ctx: RenderCtx, rows: string[][]): void {
  const ncols = rows[0]?.length ?? 0
  if (!ncols) return
  const weights = Array.from({ length: ncols }, (_, i) =>
    i === ncols - 1 ? 2 : 1,
  )
  const tw = weights.reduce((a, b) => a + b, 0)
  const colWidths = weights.map((w) =>
    Math.max(50, (CONTENT_W * w) / tw),
  )

  const cellStyle = SIZE_TABLE
  const pad = 4
  const lh = LEADING(cellStyle)

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri]
    const isHeader = ri === 0
    const cellLines: string[][] = row.map((cell, ci) =>
      wrapPlainParagraph(
        cell.replace(/\|/g, ' '),
        Math.max(20, (colWidths[ci] ?? 0) - pad * 2),
        ctx.fonts,
        cellStyle,
        false,
      ),
    )
    const rowHeight =
      Math.max(...cellLines.map((cl) => cl.length), 1) * lh + pad * 2

    ensureSpace(ctx, rowHeight + 2)

    let x = MARGIN_L
    for (let ci = 0; ci < ncols; ci++) {
      const cw = colWidths[ci] ?? 0
      const lines = cellLines[ci] ?? ['']
      if (isHeader) {
        ctx.page.drawRectangle({
          x,
          y: ctx.y - rowHeight + pad,
          width: cw,
          height: rowHeight,
          color: COL_TABLE_HEAD_BG,
        })
      }
      ctx.page.drawRectangle({
        x,
        y: ctx.y - rowHeight,
        width: cw,
        height: rowHeight,
        borderColor: COL_TABLE_GRID,
        borderWidth: 0.5,
      })
      let ly = ctx.y - pad - cellStyle
      for (const line of lines) {
        drawLineMixed(
          ctx.page,
          line,
          x + pad,
          ly,
          cellStyle,
          ctx.fonts,
          isHeader ? COL_TITLE : COL_BODY,
          isHeader,
        )
        ly -= lh
      }
      x += cw
    }
    ctx.y -= rowHeight
  }
}

function safeDefaultFilename(title: string, suggested?: string): string {
  const base = (suggested || title || 'voidcast-document').trim().slice(0, 120)
  const cleaned =
    base.replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, '_') ||
    'voidcast-document'
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`
}

function uniqueFilePath(dir: string, fileName: string): string {
  let fp = path.join(dir, fileName)
  if (!fs.existsSync(fp)) return fp
  const ext = path.extname(fileName)
  const stem = fileName.slice(0, -ext.length) || 'document'
  for (let i = 2; i < 1000; i++) {
    fp = path.join(dir, `${stem}-${i}${ext}`)
    if (!fs.existsSync(fp)) return fp
  }
  return path.join(dir, `${stem}-${Date.now()}${ext}`)
}

function resolveFontPath(rel: string): string | null {
  try {
    const p = require.resolve(`@fontsource/noto-sans/files/${rel}`)
    if (fs.existsSync(p)) return p
  } catch {
    /* missing weight */
  }
  return null
}

async function embedFonts(pdfDoc: PDFDocument): Promise<FontQuad> {
  pdfDoc.registerFontkit(fontkit)

  const latin400 =
    resolveFontPath('noto-sans-latin-400-normal.woff2') ??
    require.resolve('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2')
  const cyr400 =
    resolveFontPath('noto-sans-cyrillic-400-normal.woff2') ??
    require.resolve('@fontsource/noto-sans/files/noto-sans-cyrillic-400-normal.woff2')
  const latin700 = resolveFontPath('noto-sans-latin-700-normal.woff2')
  const cyr700 = resolveFontPath('noto-sans-cyrillic-700-normal.woff2')

  const l400 = fs.readFileSync(latin400)
  const c400 = fs.readFileSync(cyr400)
  const l700 = latin700 ? fs.readFileSync(latin700) : l400
  const c700 = cyr700 ? fs.readFileSync(cyr700) : c400

  const [latin, cyr, latinBold, cyrBold] = await Promise.all([
    pdfDoc.embedFont(l400),
    pdfDoc.embedFont(c400),
    pdfDoc.embedFont(l700),
    pdfDoc.embedFont(c700),
  ])
  return { latin, cyr, latinBold, cyrBold }
}

async function buildPdfBytes(opts: {
  title: string
  body: string
}): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create()
  const fonts = await embedFonts(pdfDoc)

  const raw = normalizeForPdf(opts.body)
  const blocks = raw.split(/\n\n+/).map((b) => b.trim()).filter(Boolean)

  const page = pdfDoc.addPage([PAGE_W, PAGE_H])
  const ctx: RenderCtx = {
    pdfDoc,
    page,
    y: PAGE_H - MARGIN_T,
    fonts,
  }

  const titleText = opts.title.trim()
  if (titleText) {
    ensureSpace(ctx, SIZE_TITLE + 24)
    ctx.y -= SIZE_TITLE
    drawLineMixed(ctx.page, titleText, MARGIN_L, ctx.y, SIZE_TITLE, fonts, COL_TITLE, true)
    ctx.y -= LEADING(SIZE_TITLE)

    const dateStr = new Date().toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
    ctx.y -= 2
    drawLineMixed(
      ctx.page,
      dateStr,
      MARGIN_L,
      ctx.y,
      SIZE_DATE,
      fonts,
      COL_MUTED,
      false,
    )
    ctx.y -= LEADING(SIZE_DATE) + 16
  }

  for (const block of blocks) {
    classifyAndRenderBlock(ctx, block)
  }

  return pdfDoc.save()
}

/**
 * Write PDF into `outputDir` (no dialog). Creates the directory if needed.
 */
export async function savePdfToFolder(payload: {
  content?: string
  title?: string
  filename?: string
  outputDir?: string
}): Promise<{ ok: boolean; text: string }> {
  const raw = String(payload?.content ?? '')
  if (!raw.trim()) {
    return { ok: false, text: 'Empty content' }
  }
  if (raw.length > MAX_CONTENT_CHARS) {
    return {
      ok: false,
      text: `Content too long (max ${MAX_CONTENT_CHARS} characters)`,
    }
  }

  const outRaw = String(payload?.outputDir ?? '').trim()
  if (!outRaw) {
    return {
      ok: false,
      text:
        'No PDF folder configured. Set it in Options → Tools → Save as PDF (folder path).',
    }
  }

  const dir = path.resolve(outRaw)
  try {
    await fs.promises.mkdir(dir, { recursive: true })
  } catch (e) {
    return {
      ok: false,
      text: e instanceof Error ? e.message : String(e),
    }
  }

  const title = String(payload?.title ?? 'Document').trim() || 'Document'
  const baseName = safeDefaultFilename(title, payload?.filename)
  const filePath = uniqueFilePath(dir, baseName)

  let pdfBytes: Uint8Array
  try {
    pdfBytes = await buildPdfBytes({ title, body: raw })
  } catch (e) {
    return {
      ok: false,
      text: e instanceof Error ? e.message : String(e),
    }
  }

  try {
    await fs.promises.writeFile(filePath, pdfBytes)
  } catch (e) {
    return {
      ok: false,
      text: e instanceof Error ? e.message : String(e),
    }
  }

  return {
    ok: true,
    text: `PDF saved:\n${filePath}`,
  }
}
