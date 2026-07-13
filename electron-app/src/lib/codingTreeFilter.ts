import type { CodingFileNode } from '@/types/coding'
import { shouldSkipCodingProjectDir } from '@/lib/codingProjectSkip'

/** Hide heavy / generated dirs in the panel tree (shared skip list with search/glob). */
export function shouldSkipCodingTreeDirName(name: string): boolean {
  return shouldSkipCodingProjectDir(name)
}

export function filterCodingTreeEntries(entries: CodingFileNode[]): CodingFileNode[] {
  return entries.filter((e) => e.type !== 'directory' || !shouldSkipCodingTreeDirName(e.name))
}
