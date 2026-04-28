const TEXT_FILE_EXTENSIONS = new Set([
  'txt',
  'md',
  'csv',
  'json',
  'js',
  'ts',
  'py',
  'java',
  'cs',
  'html',
  'css',
])

const SUPPORTED_FILE_EXTENSIONS = new Set([
  ...TEXT_FILE_EXTENSIONS,
  'pdf',
  'docx',
])

export const MAX_CHAT_FILE_SNAPSHOT_BYTES = 400 * 1024

export function extFromName(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx < 0) return ''
  return name.slice(idx + 1).trim().toLowerCase()
}

export function isSupportedChatFileName(name: string): boolean {
  const ext = extFromName(name)
  return SUPPORTED_FILE_EXTENSIONS.has(ext)
}

export function isTextSnapshotExtension(ext: string): boolean {
  return TEXT_FILE_EXTENSIONS.has(ext.toLowerCase())
}

export function chatFileAcceptList(): string {
  return '.txt,.md,.pdf,.docx,.csv,.json,.js,.ts,.py,.java,.cs,.html,.css'
}
