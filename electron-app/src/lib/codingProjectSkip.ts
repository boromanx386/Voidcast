/** Heavy / generated directory names — shared by search, glob, and file tree. */
export const CODING_SKIP_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-electron',
  'build',
  'release',
  '.next',
  'coverage',
  'target',
  'out',
  '__pycache__',
  '.turbo',
  '.cache',
  '.venv',
  'venv',
  'Pods',
  '.gradle',
  'DerivedData',
  '.voidcast',
])

const CODING_SKIP_DOT_DIR_NAMES = new Set([
  '.git',
  '.next',
  '.turbo',
  '.cache',
  '.venv',
  '.voidcast',
])

/** Ripgrep `--glob` exclusions aligned with {@link CODING_SKIP_DIR_NAMES}. */
export const CODING_RIPGREP_EXCLUDE_GLOBS = [
  ...Array.from(CODING_SKIP_DIR_NAMES, (name) => `!**/${name}/**`),
] as const

/** Generated dependency locks — machine-written, huge, pure noise for source search. */
const CODING_LOCK_FILE_NAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'cargo.lock',
  'poetry.lock',
  'composer.lock',
  'pipfile.lock',
  'flake.lock',
])

export function shouldSkipCodingProjectDir(name: string): boolean {
  if (name.startsWith('.')) {
    return CODING_SKIP_DOT_DIR_NAMES.has(name)
  }
  return CODING_SKIP_DIR_NAMES.has(name)
}

function fileNameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const slash = normalized.lastIndexOf('/')
  return slash >= 0 ? normalized.slice(slash + 1) : normalized
}

/**
 * True for the few `.git` entries that change when a commit, checkout, branch switch
 * or stage happens. The project watcher otherwise skips `.git` (object writes are
 * pure noise), so without this an outside `git commit` never refreshed the panel.
 */
export function isCodingGitStatePath(filePath: string): boolean {
  const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts[0]?.toLowerCase() !== '.git') return false
  if (parts.length === 2) return parts[1] === 'HEAD' || parts[1] === 'index'
  return parts[1] === 'refs'
}

/**
 * True for bundled/minified artifacts and paths under generated folders.
 * Used to keep `search_files` signal focused on editable source.
 */
export function isCodingGeneratedArtifactPath(filePath: string): boolean {
  const pathLower = filePath.replace(/\\/g, '/').toLowerCase()
  const fileName = fileNameFromPath(pathLower)

  for (const part of pathLower.split('/')) {
    if (!part) continue
    if (CODING_SKIP_DIR_NAMES.has(part)) return true
    if (part.startsWith('.') && CODING_SKIP_DOT_DIR_NAMES.has(part)) return true
  }

  if (/\.(min|bundle)\.(js|jsx|mjs|cjs|css|scss)$/i.test(fileName)) return true
  if (/\.web-[a-z0-9_-]+\.(js|css)$/i.test(fileName)) return true
  // Vite/Rollup hashed bundles: index-GO3eqiis.js, assets/foo-bar12ab.css
  if (/^[a-z0-9_.-]+-[a-z0-9]{6,}\.(js|jsx|mjs|cjs|css|map)$/i.test(fileName)) return true
  if (CODING_LOCK_FILE_NAMES.has(fileName)) return true

  return false
}

export function filterCodingSearchMatches<T extends { path: string }>(matches: T[]): T[] {
  return matches.filter((match) => !isCodingGeneratedArtifactPath(match.path))
}
