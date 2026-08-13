import { useEffect, useMemo, useState } from 'react'
import { FilePreviewEdit } from '@/components/coding/FilePreviewEdit'
import { ChatMarkdown } from '@/components/ChatMarkdown'
import { languageFromPreviewPath } from '@/lib/codingPreviewLanguage'
import { highlightPreviewLine } from '@/lib/codingSyntaxHighlight'

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
  /** Inline file edit (file mode only). */
  editing?: boolean
  editDraft?: string
  editBusy?: boolean
  editSessionKey?: number
  canEdit?: boolean
  onStartEdit?: () => void
  onEditDraftChange?: (next: string) => void
  onSaveEdit?: () => void
  onCancelEdit?: () => void
}

function normalizePreviewLines(content: string): string[] {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

function DiffLines({ content }: { content: string }) {
  const lines = normalizePreviewLines(content)
  return (
    <>
      {lines.map((line, i) => {
        let rowClass = 'text-void-light'
        if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')) {
          rowClass = 'text-void-dim'
        } else if (line.startsWith('@@')) {
          rowClass = 'coding-diff-line--hunk'
        } else if (line.startsWith('+')) {
          rowClass = 'coding-diff-line--add'
        } else if (line.startsWith('-')) {
          rowClass = 'coding-diff-line--del'
        }
        return (
          <div key={i} className={`flex w-max min-w-full gap-2 px-1 ${rowClass}`}>
            <span className="w-8 shrink-0 select-none text-right tabular-nums text-void-dim/60">
              {i + 1}
            </span>
            <span className="whitespace-pre">
              {line.length === 0 ? '\u00a0' : line}
            </span>
          </div>
        )
      })}
    </>
  )
}

function FileLines({ content, filePath }: { content: string; filePath: string | null }) {
  const language = useMemo(() => languageFromPreviewPath(filePath), [filePath])
  const lines = useMemo(() => normalizePreviewLines(content), [content])
  const highlighted = useMemo(
    () => lines.map((line) => highlightPreviewLine(line, language)),
    [lines, language],
  )

  return (
    <div className="file-preview-code w-max min-w-full">
      {lines.map((line, i) => (
        <div key={i} className="flex w-max min-w-full gap-2 px-1 text-void-light">
          <span className="w-8 shrink-0 select-none text-right tabular-nums text-void-dim/60">
            {i + 1}
          </span>
          {language ? (
            <code
              className="hljs whitespace-pre bg-transparent p-0 font-mono text-inherit"
              dangerouslySetInnerHTML={{ __html: highlighted[i] }}
            />
          ) : (
            <span className="whitespace-pre">
              {line.length === 0 ? '\u00a0' : line}
            </span>
          )}
        </div>
      ))}
    </div>
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
  editing = false,
  editDraft = '',
  editBusy = false,
  editSessionKey = 0,
  canEdit = false,
  onStartEdit,
  onEditDraftChange,
  onSaveEdit,
  onCancelEdit,
}: Props) {
  const [showMdSource, setShowMdSource] = useState(false)
  const isMarkdown = mode === 'file' && !editing && languageFromPreviewPath(filePath) === 'markdown'
  const showMdPreview = isMarkdown && !showMdSource

  useEffect(() => {
    setShowMdSource(false)
  }, [filePath, mode, editing])

  const label = editing
    ? `EDIT${filePath ? ` - ${filePath}` : ''}`
    : mode === 'diff'
      ? `DIFF${diffStaged ? ' (staged)' : ''}${filePath ? ` - ${filePath}` : ''}`
      : mode === 'image'
        ? `IMAGE${filePath ? ` - ${filePath}` : ''}`
        : `PREVIEW${filePath ? ` - ${filePath}` : ''}`

  const labelClass = editing ? 'coding-label--edit' : 'coding-label--preview'
  const showGitActions = !editing && (canStage || canUnstage || canDiscard)
  const showEditAction = !editing && canEdit && onStartEdit
  const showEditActions = editing && onSaveEdit && onCancelEdit && onEditDraftChange
  const showMdToggle = isMarkdown

  return (
    <div className="flex h-full min-h-0 flex-col rounded border border-void-muted/30 bg-void-black/30 p-2">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <div className={`min-w-0 truncate text-xs font-mono ${labelClass}`} title={label}>
          {label}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {showMdToggle ? (
            <button
              type="button"
              title={showMdSource ? 'Show Markdown preview' : 'Show raw source'}
              className="coding-btn coding-btn--md-toggle"
              onClick={() => setShowMdSource((v) => !v)}
            >
              {showMdSource ? 'MD' : 'Source'}
            </button>
          ) : null}
          {showEditAction ? (
            <button
              type="button"
              title="Edit file"
              className="coding-btn coding-btn--edit"
              onClick={onStartEdit}
            >
              ✎
            </button>
          ) : null}
          {showEditActions ? (
            <>
              <button
                type="button"
                title="Save (Ctrl+S)"
                className="coding-btn coding-btn--save"
                disabled={editBusy}
                onClick={onSaveEdit}
              >
                Save
              </button>
              <button
                type="button"
                title="Cancel (Esc)"
                className="rounded border border-void-muted/50 px-1.5 py-0.5 text-[10px] font-mono text-void-dim hover:bg-void-mid/40 hover:text-void-light disabled:opacity-40"
                disabled={editBusy}
                onClick={onCancelEdit}
              >
                Cancel
              </button>
            </>
          ) : null}
          {showGitActions ? (
            <>
              {canStage && onStage ? (
                <button
                  type="button"
                  title="Stage file"
                  className="coding-btn coding-btn--stage"
                  onClick={onStage}
                >
                  +
                </button>
              ) : null}
              {canUnstage && onUnstage ? (
                <button
                  type="button"
                  title="Unstage file"
                  className="coding-btn coding-btn--unstage"
                  onClick={onUnstage}
                >
                  −
                </button>
              ) : null}
              {canDiscard && onDiscard ? (
                <button
                  type="button"
                  title="Discard unstaged changes (git restore)"
                  className="coding-btn coding-btn--discard"
                  onClick={onDiscard}
                >
                  ↶
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      <div
        className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
          mode === 'image' && !editing
            ? ''
            : showMdPreview
              ? 'text-sm'
              : 'font-mono text-xs'
        }`}
      >
        {editing && onEditDraftChange && onSaveEdit && onCancelEdit ? (
          <FilePreviewEdit
            key={editSessionKey}
            draft={editDraft}
            busy={editBusy}
            onDraftChange={onEditDraftChange}
            onSave={onSaveEdit}
            onCancel={onCancelEdit}
          />
        ) : mode === 'image' ? (
          <div className="min-h-0 flex-1 overflow-auto">
            {imageSrc ? (
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
            )}
          </div>
        ) : !content ? (
          <div className="overflow-auto px-1 text-void-dim">
            {mode === 'diff' ? 'Select a change to preview diff…' : 'Select file to preview...'}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            {mode === 'diff' ? (
              <DiffLines content={content} />
            ) : showMdPreview ? (
              <div className="file-preview-markdown px-2 py-2">
                <ChatMarkdown content={content} />
              </div>
            ) : (
              <FileLines content={content} filePath={filePath} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
