/**
 * Split long text into shorter segments for TTS — shorter wait for first
 * audio while the next chunk is generated during playback.
 */
const DEFAULT_MAX = 380

export function splitIntoTtsChunks(
  text: string,
  maxChars: number = DEFAULT_MAX,
): string[] {
  const t = text.trim()
  if (!t) return []
  if (t.length <= maxChars) return [t]

  const chunks: string[] = []
  const sentences = t.split(/(?<=[.!?…])\s+|\n+/).filter(Boolean)

  let buf = ''
  const flush = () => {
    const s = buf.trim()
    if (s) chunks.push(s)
    buf = ''
  }

  const pushHardSplit = (long: string) => {
    for (let i = 0; i < long.length; i += maxChars) {
      const part = long.slice(i, i + maxChars).trim()
      if (part) chunks.push(part)
    }
  }

  for (const seg of sentences) {
    if (seg.length > maxChars) {
      flush()
      pushHardSplit(seg)
      continue
    }
    const next = buf ? `${buf} ${seg}` : seg
    if (next.length <= maxChars) {
      buf = next
    } else {
      flush()
      buf = seg
    }
  }
  flush()

  return chunks.length ? chunks : [t.slice(0, maxChars)]
}
