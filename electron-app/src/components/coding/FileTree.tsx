import type { CodingFileNode } from '@/types/coding'
import {
  dirHasGitChanges,
  gitLetterTextClass,
  normalizeGitPath,
  type GitStatusEntry,
} from '@/lib/gitStatusParse'

export type FileTreeProps = {
  rootEntries: CodingFileNode[]
  expandedDirs: ReadonlySet<string>
  loadingDirs: ReadonlySet<string>
  childrenByDir: Readonly<Record<string, CodingFileNode[]>>
  selectedPath: string | null
  /** Git status by normalized relative path — colors dirty files. */
  gitStatusByPath?: ReadonlyMap<string, GitStatusEntry>
  /** Optional branch label shown in the FILES header. */
  gitBranchLabel?: string | null
  /** When true, hide clean files; keep dirs that contain changes. */
  dirtyOnly?: boolean
  /** When true, no coding folder is selected — show a clear empty status. */
  noProject?: boolean
  onDirtyOnlyChange?: (next: boolean) => void
  onToggleDirectory: (dirPath: string) => void | Promise<void>
  onSelectFile: (path: string) => void
  onStageFile?: (path: string) => void
  onUnstageFile?: (path: string) => void
  onDiscardFile?: (path: string) => void
  /** Open a file in the OS default app (e.g. double-click an image or sound). */
  onOpenExternal?: (path: string) => void
}

function filterDirtyEntries(
  entries: CodingFileNode[],
  byPath: ReadonlyMap<string, GitStatusEntry> | undefined,
): CodingFileNode[] {
  if (!byPath || byPath.size === 0) return entries
  return entries.filter((node) => {
    if (node.type === 'directory') return dirHasGitChanges(node.path, byPath)
    return byPath.has(normalizeGitPath(node.path))
  })
}

function TreeRows({
  entries,
  depth,
  expandedDirs,
  loadingDirs,
  childrenByDir,
  onToggleDirectory,
  onSelectFile,
  onStageFile,
  onUnstageFile,
  onDiscardFile,
  onOpenExternal,
  selectedPath,
  gitStatusByPath,
  dirtyOnly,
}: {
  entries: CodingFileNode[]
  depth: number
} & Omit<FileTreeProps, 'rootEntries' | 'gitBranchLabel' | 'onDirtyOnlyChange'>) {
  const pad = 6 + depth * 10
  const byPath = gitStatusByPath
  const visible = dirtyOnly ? filterDirtyEntries(entries, byPath) : entries

  return (
    <>
      {visible.map((node) =>
        node.type === 'directory' ? (
          <div key={node.path}>
            <button
              type="button"
              title={node.path}
              style={{ paddingLeft: pad }}
              onClick={() => void onToggleDirectory(node.path)}
              className={`w-full rounded py-1 text-left text-xs font-mono hover:bg-void-mid/40 ${
                node.ignored
                  ? 'text-void-dim/70 opacity-70'
                  : byPath && dirHasGitChanges(node.path, byPath)
                    ? 'coding-dir-dirty'
                    : 'text-void-light'
              }`}
            >
              <span className="inline-block w-4 tabular-nums text-void-dim">
                {loadingDirs.has(node.path) ? '…' : expandedDirs.has(node.path) ? '▾' : '▸'}
              </span>
              <span className="opacity-90">{expandedDirs.has(node.path) ? '📂' : '📁'}</span>{' '}
              <span className="break-all">{node.name}</span>
            </button>
            {expandedDirs.has(node.path) &&
              (loadingDirs.has(node.path) && childrenByDir[node.path] === undefined ? (
                <div
                  className="py-1 text-xs font-mono text-void-dim"
                  style={{ paddingLeft: pad + 14 }}
                >
                  Loading…
                </div>
              ) : (childrenByDir[node.path]?.length ?? 0) === 0 ? (
                <div
                  className="py-0.5 text-[11px] font-mono text-void-dim/80"
                  style={{ paddingLeft: pad + 14 }}
                >
                  (empty)
                </div>
              ) : (
                <TreeRows
                  entries={childrenByDir[node.path] ?? []}
                  depth={depth + 1}
                  expandedDirs={expandedDirs}
                  loadingDirs={loadingDirs}
                  childrenByDir={childrenByDir}
                  onToggleDirectory={onToggleDirectory}
                  onSelectFile={onSelectFile}
                  onStageFile={onStageFile}
                  onUnstageFile={onUnstageFile}
                  onDiscardFile={onDiscardFile}
                  onOpenExternal={onOpenExternal}
                  selectedPath={selectedPath}
                  gitStatusByPath={gitStatusByPath}
                  dirtyOnly={dirtyOnly}
                />
              ))}
          </div>
        ) : (
          (() => {
            const status = byPath?.get(normalizeGitPath(node.path))
            const letter = status?.letter
            const colorClass = letter ? gitLetterTextClass(letter) : ''
            const selected = selectedPath === node.path
            const canStage = Boolean(status && (status.unstaged || status.untracked) && onStageFile)
            const canUnstage = Boolean(status?.staged && onUnstageFile)
            const canDiscard = Boolean(
              status && status.unstaged && !status.untracked && onDiscardFile,
            )
            return (
              <div
                key={node.path}
                className={`group flex w-full items-stretch gap-0.5 rounded ${
                  selected ? 'coding-accent-bg' : 'hover:bg-void-mid/40'
                }`}
              >
                <button
                  type="button"
                  title={status ? `${node.path} (${letter})` : node.path}
                  style={{ paddingLeft: pad }}
                  onClick={() => onSelectFile(node.path)}
                  onDoubleClick={() => onOpenExternal?.(node.path)}
                  className={`min-w-0 flex-1 py-1 text-left text-xs font-mono break-all ${
                    selected
                      ? 'coding-accent-text'
                      : node.ignored
                        ? 'text-void-dim/70 opacity-70'
                        : letter
                          ? colorClass
                          : 'text-void-light'
                  }`}
                >
                  <span
                    className={`inline-block w-4 tabular-nums ${letter ? colorClass : 'text-transparent'}`}
                    aria-hidden={!letter}
                  >
                    {letter || '·'}
                  </span>
                  📄 {node.name}
                </button>
                {(canStage || canUnstage || canDiscard) && (
                  <div className="flex shrink-0 items-center gap-0.5 pr-0.5 opacity-70 group-hover:opacity-100">
                    {canStage ? (
                      <button
                        type="button"
                        title="Stage"
                        aria-label={`Stage ${node.name}`}
                        className="coding-btn--tree coding-btn--stage"
                        onClick={(e) => {
                          e.stopPropagation()
                          onStageFile?.(node.path)
                        }}
                      >
                        +
                      </button>
                    ) : null}
                    {canUnstage ? (
                      <button
                        type="button"
                        title="Unstage"
                        aria-label={`Unstage ${node.name}`}
                        className="coding-btn--tree coding-btn--unstage"
                        onClick={(e) => {
                          e.stopPropagation()
                          onUnstageFile?.(node.path)
                        }}
                      >
                        −
                      </button>
                    ) : null}
                    {canDiscard ? (
                      <button
                        type="button"
                        title="Discard unstaged changes"
                        aria-label={`Discard ${node.name}`}
                        className="coding-btn--tree coding-btn--discard"
                        onClick={(e) => {
                          e.stopPropagation()
                          onDiscardFile?.(node.path)
                        }}
                      >
                        ↶
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            )
          })()
        ),
      )}
    </>
  )
}

export function FileTree({
  rootEntries,
  expandedDirs,
  loadingDirs,
  childrenByDir,
  selectedPath,
  gitStatusByPath,
  gitBranchLabel,
  dirtyOnly = false,
  noProject = false,
  onDirtyOnlyChange,
  onToggleDirectory,
  onSelectFile,
  onStageFile,
  onUnstageFile,
  onDiscardFile,
  onOpenExternal,
}: FileTreeProps) {
  const dirtyCount = gitStatusByPath?.size ?? 0
  const visibleRoot =
    dirtyOnly && gitStatusByPath ? filterDirtyEntries(rootEntries, gitStatusByPath) : rootEntries

  return (
    <div className="flex h-full min-h-0 flex-col rounded border border-void-muted/30 bg-void-black/30 p-2">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="coding-accent-text text-xs font-mono">FILES</div>
          {gitBranchLabel ? (
            <div
              className="min-w-0 truncate text-[10px] font-mono text-void-dim"
              title={gitBranchLabel}
            >
              {gitBranchLabel}
            </div>
          ) : null}
        </div>
        {onDirtyOnlyChange && dirtyCount > 0 ? (
          <button
            type="button"
            title={dirtyOnly ? 'Show all files' : 'Show only changed files'}
            aria-pressed={dirtyOnly}
            onClick={() => onDirtyOnlyChange(!dirtyOnly)}
            className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide transition-colors ${
              dirtyOnly
                ? 'coding-dirty-toggle--on'
                : 'border-void-muted/50 text-void-dim hover:border-void-dim hover:text-void-text'
            }`}
          >
            {dirtyOnly ? `DIRTY ${dirtyCount}` : `ALL · ${dirtyCount}`}
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto space-y-0.5">
        {noProject ? (
          <div className="flex h-full items-start justify-center px-1 pt-5 text-center">
            <div className="font-semibold text-[11px] uppercase tracking-wide text-void-dim">
              No folder selected
            </div>
          </div>
        ) : (
          <>
            {rootEntries.length === 0 && (
              <div className="text-xs text-void-dim">No files loaded.</div>
            )}
            {rootEntries.length > 0 && visibleRoot.length === 0 && dirtyOnly && (
              <div className="text-xs text-void-dim">No changed files in tree.</div>
            )}
            {visibleRoot.length > 0 && (
              <TreeRows
                entries={rootEntries}
                depth={0}
                expandedDirs={expandedDirs}
                loadingDirs={loadingDirs}
                childrenByDir={childrenByDir}
                onToggleDirectory={onToggleDirectory}
                onSelectFile={onSelectFile}
                onStageFile={onStageFile}
                onUnstageFile={onUnstageFile}
                onDiscardFile={onDiscardFile}
                onOpenExternal={onOpenExternal}
                selectedPath={selectedPath}
                gitStatusByPath={gitStatusByPath}
                dirtyOnly={dirtyOnly}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
