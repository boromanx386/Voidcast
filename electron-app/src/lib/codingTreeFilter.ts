import type { CodingFileNode } from '@/types/coding'

/** Align with electron `shouldSkipCodingWalkDir` — hide heavy / generated dirs in the panel tree. */
export function shouldSkipCodingTreeDirName(name: string): boolean {
  if (name.startsWith('.')) {
    return (
      name === '.git' ||
      name === '.next' ||
      name === '.turbo' ||
      name === '.cache' ||
      name === '.venv'
    )
  }
  return (
    name === 'node_modules' ||
    name === 'dist' ||
    name === 'build' ||
    name === 'coverage' ||
    name === 'target' ||
    name === 'out' ||
    name === '__pycache__' ||
    name === 'venv' ||
    name === 'Pods' ||
    name === '.gradle' ||
    name === 'DerivedData'
  )
}

export function filterCodingTreeEntries(entries: CodingFileNode[]): CodingFileNode[] {
  return entries.filter((e) => e.type !== 'directory' || !shouldSkipCodingTreeDirName(e.name))
}
