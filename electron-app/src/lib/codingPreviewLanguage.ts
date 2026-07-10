const EXTENSION_LANGUAGE: Record<string, string> = {
  bash: 'bash',
  cjs: 'javascript',
  css: 'css',
  cs: 'csharp',
  dockerfile: 'dockerfile',
  env: 'ini',
  go: 'go',
  gql: 'graphql',
  graphql: 'graphql',
  htm: 'xml',
  html: 'xml',
  ini: 'ini',
  java: 'java',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  jsonc: 'json',
  kt: 'kotlin',
  less: 'less',
  lua: 'lua',
  md: 'markdown',
  mdx: 'markdown',
  mjs: 'javascript',
  php: 'php',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  svg: 'xml',
  swift: 'swift',
  toml: 'ini',
  ts: 'typescript',
  tsx: 'typescript',
  vue: 'xml',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
}

function extFromPath(filePath: string): string {
  const base = filePath.replace(/\\/g, '/').split('/').pop() || ''
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** Map a coding-panel file path to a highlight.js language id, or null when unknown. */
export function languageFromPreviewPath(filePath: string | null | undefined): string | null {
  if (!filePath?.trim()) return null
  const normalized = filePath.replace(/\\/g, '/')
  const base = normalized.split('/').pop()?.toLowerCase() || ''
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile'
  if (base === 'makefile') return 'bash'
  const ext = extFromPath(filePath)
  return EXTENSION_LANGUAGE[ext] ?? null
}
