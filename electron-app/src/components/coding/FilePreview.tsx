type Props = {
  filePath: string | null
  content: string
  mode?: 'file' | 'diff' | 'image'
  /** Data URL when mode is image. */
  imageSrc?: string | null
  /** When mode is diff, whether this is staged (cached) diff. */
  diffStaged?: boolean
  /** Optional actions shown in the preview header. */
  onStage?: () => void
  onUnstage?: () => void
  onDiscard?: () => void
  canStage?: boolean
  canUnstage?: boolean
  canDiscard?: boolean
}

function DiffLines({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  return (
    <>
      {lines.map((line, i) => {
        let rowClass = 'text-void-light'
        let bgClass = ''
        if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')) {
          rowClass = 'text-void-dim'
        } else if (line.startsWith('@@')) {
          rowClass = 'text-neon-cyan/90'
          bgClass = 'bg-neon-cyan/5'
        } else if (line.startsWith('+')) {
          rowClass = 'text-neon-green'
          bgClass = 'bg-neon-green/10'
        } else if (line.startsWith('-')) {
          rowClass = 'text-neon-red'
          bgClass = 'bg-neon-red/10'
        }
        return (
          <div key={i} className={`flex gap-2 px-1 ${bgClass} ${rowClass}`}>
            <span className="w-8 shrink-0 select-none text-right tabular-nums text-void-dim/60">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
              {line.length === 0 ? '\u00a0' : line}
            </span>
          </div>
        )
      })}
    </>
  )
}

function FileLines({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  return (
    <>
      {lines.map((line, i) => (
        <div key={i} className="flex gap-2 px-1 text-void-light">
          <span className="w-8 shrink-0 select-none text-right tabular-nums text-void-dim/60">
            {i + 1}
          </span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
            {line.length === 0 ? '\u00a0' : line}
          </span>
        </div>
      ))}
    </>
  )
}

export function FilePreview({
  filePath,
  content,
  mode = 'file',
  imageSrc = null,
  diffStaged = false,
  onStage,
  onUnstage,
  onDiscard,
  canStage = false,
  canUnstage = false,
  canDiscard = false,
}: Props) {
  const label =
    mode === 'diff'
      ? `DIFF${diffStaged ? ' (staged)' : ''}${filePath ? ` - ${filePath}` : ''}`
      : mode === 'image'
        ? `IMAGE${filePath ? ` - ${filePath}` : ''}`
        : `PREVIEW${filePath ? ` - ${filePath}` : ''}`

  const showActions = canStage || canUnstage || canDiscard

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded border border-void-muted/30 bg-void-black/30 p-2">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <div className="min-w-0 truncate text-xs font-mono text-neon-green" title={label}>
          {label}
        </div>
        {showActions ? (
          <div className="flex shrink-0 items-center gap-1">
            {canStage && onStage ? (
              <button
                type="button"
                title="Stage file"
                className="rounded border border-neon-green/40 px-1.5 py-0.5 text-[10px] font-mono text-neon-green hover:bg-neon-green/10"
                onClick={onStage}
              >
                +
              </button>
            ) : null}
            {canUnstage && onUnstage ? (
              <button
                type="button"
                title="Unstage file"
                className="rounded border border-neon-yellow/40 px-1.5 py-0.5 text-[10px] font-mono text-neon-yellow hover:bg-neon-yellow/10"
                onClick={onUnstage}
              >
                −
              </button>
            ) : null}
            {canDiscard && onDiscard ? (
              <button
                type="button"
                title="Discard unstaged changes (git restore)"
                className="rounded border border-neon-red/40 px-1.5 py-0.5 text-[10px] font-mono text-neon-red/90 hover:bg-neon-red/10"
                onClick={onDiscard}
              >
                ↶
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div
        className={`min-h-0 flex-1 overflow-auto ${mode === 'image' ? '' : 'font-mono text-xs'}`}
      >
        {mode === 'image' ? (
          imageSrc ? (
            <div className="flex min-h-[120px] items-center justify-center p-2">
              <img
                src={imageSrc}
                alt={filePath || 'Image preview'}
                className="max-h-full max-w-full object-contain"
                draggable={false}
              />
            </div>
          ) : (
            <div className="px-1 text-xs text-void-dim">
              {content || 'Loading image…'}
            </div>
          )
        ) : !content ? (
          <div className="px-1 text-void-dim">
            {mode === 'diff' ? 'Select a change to preview diff…' : 'Select file to preview...'}
          </div>
        ) : mode === 'diff' ? (
          <DiffLines content={content} />
        ) : (
          <FileLines content={content} />
        )}
      </div>
    </div>
  )
}
