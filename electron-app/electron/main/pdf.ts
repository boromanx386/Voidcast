import fontkit from '@pdf-lib/fontkit'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

const require = createRequire(import.meta.url)

const MAX_CONTENT_CHARS = 400_000
const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 50
const BODY_SIZE = 11
const TITLE_SIZE = 14
const LINE_HEIGHT = BODY_SIZE * 1.35
const TITLE_LINE_HEIGHT = TITLE_SIZE * 1.35
const PARA_GAP = 6

type FontPair = { latin: PDFFont; cyr: PDFFont }

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

function measureLine(
  text: string,
  fontLat: PDFFont,
  fontCyr: PDFFont,
  size: number,
): number {
  let w = 0
  for (const seg of segmentRuns(text)) {
    const font = seg.kind === 'cyr' ? fontCyr : fontLat
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
  fonts: FontPair,
  color = rgb(0.1, 0.1, 0.1),
): void {
  let cx = x
  for (const seg of segmentRuns(text)) {
    const font = seg.kind === 'cyr' ? fonts.cyr : fonts.latin
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

function breakLongToken(
  token: string,
  maxWidth: number,
  fonts: FontPair,
  size: number,
): string[] {
  const out: string[] = []
  let chunk = ''
  for (const ch of token) {
    const trial = chunk + ch
    if (measureLine(trial, fonts.latin, fonts.cyr, size) <= maxWidth) {
      chunk = trial
    } else {
      if (chunk) out.push(chunk)
      chunk = ch
    }
  }
  if (chunk) out.push(chunk)
  return out
}

function wrapParagraph(
  paragraph: string,
  maxWidth: number,
  fonts: FontPair,
  size: number,
): string[] {
  const words = paragraph.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const word of words) {
    const trial = cur ? `${cur} ${word}` : word
    if (measureLine(trial, fonts.latin, fonts.cyr, size) <= maxWidth) {
      cur = trial
    } else {
      if (cur) lines.push(cur)
      if (measureLine(word, fonts.latin, fonts.cyr, size) <= maxWidth) {
        cur = word
      } else {
        lines.push(...breakLongToken(word, maxWidth, fonts, size))
        cur = ''
      }
    }
  }
  if (cur) lines.push(cur)
  return lines
}

function safeDefaultFilename(title: string, suggested?: string): string {
  const base = (suggested || title || 'voidcast-document').trim().slice(0, 120)
  const cleaned = base.replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, '_') || 'voidcast-document'
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

async function buildPdfBytes(opts: {
  title: string
  body: string
}): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create()
  pdfDoc.registerFontkit(fontkit)
  const latinBytes = fs.readFileSync(
    require.resolve('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2'),
  )
  const cyrBytes = fs.readFileSync(
    require.resolve('@fontsource/noto-sans/files/noto-sans-cyrillic-400-normal.woff2'),
  )
  const [latin, cyr] = await Promise.all([
    pdfDoc.embedFont(latinBytes),
    pdfDoc.embedFont(cyrBytes),
  ])
  const fonts: FontPair = { latin, cyr }

  const maxW = PAGE_W - 2 * MARGIN
  const paragraphs = opts.body
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter(Boolean)

  let page = pdfDoc.addPage([PAGE_W, PAGE_H])
  /** Baseline Y for the next line (PDF coords: origin bottom-left). */
  let y = PAGE_H - MARGIN

  const titleText = opts.title.trim()
  if (titleText) {
    y -= TITLE_SIZE
    drawLineMixed(page, titleText, MARGIN, y, TITLE_SIZE, fonts)
    y -= TITLE_LINE_HEIGHT + PARA_GAP
  }

  for (const para of paragraphs) {
    const lines = wrapParagraph(para, maxW, fonts, BODY_SIZE)
    for (const line of lines) {
      if (y < MARGIN + LINE_HEIGHT) {
        page = pdfDoc.addPage([PAGE_W, PAGE_H])
        y = PAGE_H - MARGIN - BODY_SIZE
      } else {
        y -= LINE_HEIGHT
      }
      drawLineMixed(page, line, MARGIN, y, BODY_SIZE, fonts)
    }
    y -= PARA_GAP
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
