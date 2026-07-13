import { filterCodingSearchMatches } from './codingProjectSkip'

export type CodingSearchRawMatch = {
  path: string
  line: number
  text: string
}

export type ScoredSearchMatch = CodingSearchRawMatch & {
  score: number
}

export type CodingSearchBlockLine = {
  line: number
  text: string
  isMatch: boolean
}

export type CodingSearchBlock = {
  path: string
  startLine: number
  endLine: number
  lines: CodingSearchBlockLine[]
}

export type CodingSearchProcessedResult = {
  query: string
  totalRawMatches: number
  totalFiles: number
  truncatedCollection: boolean
  fileMatchCounts: Record<string, number>
  blocks: CodingSearchBlock[]
}

/** Collect up to this many raw lexical matches before ranking. */
export const CODING_SEARCH_INTERNAL_MAX = 2000
/** Max match lines to keep per file after ranking. */
export const CODING_SEARCH_MAX_PER_FILE = 5
/** Max contextual blocks returned to the model. */
export const CODING_SEARCH_MAX_BLOCKS = 60
/** Lines of context before/after each match (rg -C style). */
export const CODING_SEARCH_CONTEXT_LINES = 2
/** How many top files to list in the summary header. */
export const CODING_SEARCH_TOP_FILES = 12
export const CODING_SEARCH_LINE_TEXT_MAX = 240

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase()
}

function queryTokens(query: string): string[] {
  return normalizeQuery(query)
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 1)
}

function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const slash = normalized.lastIndexOf('/')
  return slash >= 0 ? normalized.slice(slash + 1) : normalized
}

function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

function recentFileBoost(path: string, recentFiles: string[]): number {
  const normalized = path.replace(/\\/g, '/').toLowerCase()
  for (const recent of recentFiles) {
    const r = recent.replace(/\\/g, '/').toLowerCase().split(' (')[0] ?? ''
    if (!r) continue
    if (normalized === r || normalized.endsWith(`/${r}`) || r.endsWith(normalized)) return 12
  }
  return 0
}

export function scoreSearchMatch(
  path: string,
  line: number,
  text: string,
  query: string,
  recentFiles: string[] = [],
): number {
  const q = normalizeQuery(query)
  if (!q) return 0

  const pathLower = path.replace(/\\/g, '/').toLowerCase()
  const fileName = fileNameFromPath(pathLower)
  const baseName = stripExtension(fileName)
  const textLower = text.toLowerCase()
  const compactQuery = q.replace(/\s+/g, '')

  let score = 0

  if (baseName === compactQuery || baseName === q.replace(/\s+/g, '_')) score += 80
  else if (fileName.includes(compactQuery)) score += 45
  else if (pathLower.includes(q)) score += 28

  for (const token of queryTokens(q)) {
    if (baseName.includes(token)) score += 18
    else if (pathLower.includes(token)) score += 6
    if (textLower.includes(token)) score += 4
  }

  if (textLower.includes(q)) score += 8
  if (textLower.trim() === q) score += 6

  if (/^(export\s+)?(async\s+)?function\s+/i.test(text)) score += 10
  if (/^(export\s+)?(const|let|var|class|interface|type|enum)\s+/i.test(text)) score += 8
  if (/^\s*(public|private|protected)\s+/i.test(text)) score += 4

  if (line <= 40 && /^\s*import\s/.test(text)) score -= 6
  if (/\.(test|spec|stories)\./i.test(pathLower)) score -= 3

  score += recentFileBoost(path, recentFiles)

  // Slight preference for earlier definition lines over deep call sites in huge files.
  if (line > 0 && line <= 400) score += 2

  return score
}

export function countMatchesByFile(matches: CodingSearchRawMatch[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const match of matches) {
    counts.set(match.path, (counts.get(match.path) ?? 0) + 1)
  }
  return counts
}

export function rankSearchMatches(
  matches: CodingSearchRawMatch[],
  query: string,
  options?: {
    recentFiles?: string[]
    maxPerFile?: number
    maxBlocks?: number
  },
): ScoredSearchMatch[] {
  const maxPerFile = options?.maxPerFile ?? CODING_SEARCH_MAX_PER_FILE
  const maxBlocks = options?.maxBlocks ?? CODING_SEARCH_MAX_BLOCKS
  const recentFiles = options?.recentFiles ?? []

  const filtered = filterCodingSearchMatches(matches)

  const scored = filtered.map((match) => ({
    ...match,
    score: scoreSearchMatch(match.path, match.line, match.text, query, recentFiles),
  }))

  scored.sort(
    (a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line,
  )

  const perFileCount = new Map<string, number>()
  const selected: ScoredSearchMatch[] = []
  for (const match of scored) {
    const count = perFileCount.get(match.path) ?? 0
    if (count >= maxPerFile) continue
    perFileCount.set(match.path, count + 1)
    selected.push(match)
    if (selected.length >= maxBlocks) break
  }

  return selected
}

export type MatchRange = {
  start: number
  end: number
  matchLines: Set<number>
}

export function mergeMatchRanges(
  matches: ScoredSearchMatch[],
  contextLines: number,
): Map<string, MatchRange[]> {
  const byFile = new Map<string, ScoredSearchMatch[]>()
  for (const match of matches) {
    const list = byFile.get(match.path) ?? []
    list.push(match)
    byFile.set(match.path, list)
  }

  const result = new Map<string, MatchRange[]>()

  for (const [filePath, fileMatches] of byFile) {
    const sorted = [...fileMatches].sort((a, b) => a.line - b.line)
    const ranges: MatchRange[] = []

    for (const match of sorted) {
      const start = Math.max(1, match.line - contextLines)
      const end = match.line + contextLines
      const last = ranges[ranges.length - 1]
      if (last && start <= last.end + 1) {
        last.end = Math.max(last.end, end)
        last.matchLines.add(match.line)
      } else {
        ranges.push({ start, end, matchLines: new Set([match.line]) })
      }
    }

    result.set(filePath, ranges)
  }

  return result
}

export function topFilesByMatchCount(
  fileMatchCounts: Map<string, number> | Record<string, number>,
  limit = CODING_SEARCH_TOP_FILES,
): Array<{ path: string; matchCount: number }> {
  const entries =
    fileMatchCounts instanceof Map
      ? Array.from(fileMatchCounts.entries())
      : Object.entries(fileMatchCounts)
  return entries
    .map(([path, matchCount]) => ({ path, matchCount }))
    .sort((a, b) => b.matchCount - a.matchCount || a.path.localeCompare(b.path))
    .slice(0, limit)
}

export function formatSearchResults(result: CodingSearchProcessedResult): string {
  const { query, blocks, totalRawMatches, totalFiles, truncatedCollection, fileMatchCounts } =
    result

  if (totalRawMatches === 0) return 'No matches.'

  const topFiles = topFilesByMatchCount(fileMatchCounts)
  const shownFiles = new Set(blocks.map((b) => b.path))
  const lines: string[] = [
    `Search "${query}": ${totalRawMatches} raw match${totalRawMatches === 1 ? '' : 'es'} in ${totalFiles} file${totalFiles === 1 ? '' : 's'}${truncatedCollection ? ' (collection capped)' : ''}.`,
    `Showing ${blocks.length} contextual block${blocks.length === 1 ? '' : 's'} across ${shownFiles.size} file${shownFiles.size === 1 ? '' : 's'} (ranked by relevance).`,
    '',
    'Top files by match count:',
    ...topFiles.map((f) => `  ${f.path} — ${f.matchCount}`),
    '',
    'Matches:',
  ]

  for (const block of blocks) {
    lines.push(`--- ${block.path}:${block.startLine}-${block.endLine} ---`)
    for (const row of block.lines) {
      const marker = row.isMatch ? '>>>' : '   '
      const lineNo = String(row.line).padStart(5, ' ')
      lines.push(`${marker}${lineNo}| ${row.text}`)
    }
    lines.push('')
  }

  lines.push('Use read_file on paths above for full file contents.')
  return lines.join('\n').trimEnd()
}
