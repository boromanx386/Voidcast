export type SavePdfResult = { ok: boolean; text: string }

export async function invokeSavePdf(opts: {
  content: string
  title?: string
  filename?: string
  outputDir: string
}): Promise<string> {
  const vc = window.voidcast?.savePdf
  if (!vc) {
    throw new Error('Run Voidcast in Electron to save PDF files.')
  }
  const r: unknown = await vc(opts)
  if (typeof r === 'string') return r
  const obj = r as SavePdfResult | { text?: string; ok?: boolean }
  if (obj && typeof obj === 'object' && 'text' in obj && typeof obj.text === 'string') {
    return obj.text
  }
  return String(r)
}
