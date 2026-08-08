import type { CodingFileNode } from '@/types/coding'
import { shouldSkipCodingProjectDir } from '@/lib/codingProjectSkip'

/** Heavy / generated dirs in the panel tree (shared skip list with search/glob). */
export function shouldSkipCodingTreeDirName(name: string): boolean {
  return shouldSkipCodingProjectDir(name)
}

/**
 * Keep every entry but flag heavy / generated dirs as `ignored` so the tree
 * renders them dimmed instead of hiding them.
 */
export function filterCodingTreeEntries(entries: CodingFileNode[]): CodingFileNode[] {
  return entries.map((e) =>
    e.type === 'directory' && shouldSkipCodingTreeDirName(e.name)
      ? { ...e, ignored: true }
      : e,
  )
}
