type Props = {
  filePath: string | null
  content: string
}

export function FilePreview({ filePath, content }: Props) {
  return (
    <div className="rounded border border-void-muted/30 bg-void-black/30 p-2">
      <div className="mb-2 text-xs font-mono text-neon-green">PREVIEW {filePath ? `- ${filePath}` : ''}</div>
      <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs text-void-light">
        {content || 'Select file to preview...'}
      </pre>
    </div>
  )
}
