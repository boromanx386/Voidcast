import type { CodingFileNode } from '@/types/coding'

export type FileTreeProps = {
  rootEntries: CodingFileNode[]
  expandedDirs: ReadonlySet<string>
  loadingDirs: ReadonlySet<string>
  childrenByDir: Readonly<Record<string, CodingFileNode[]>>
  selectedPath: string | null
  onToggleDirectory: (dirPath: string) => void | Promise<void>
  onSelectFile: (path: string) => void
}

function TreeRows({
  entries,
  depth,
  expandedDirs,
  loadingDirs,
  childrenByDir,
  onToggleDirectory,
  onSelectFile,
  selectedPath,
}: {
  entries: CodingFileNode[]
  depth: number
} & Omit<FileTreeProps, 'rootEntries'>) {
  const pad = 6 + depth * 10

  return (
    <>
      {entries.map((node) =>
        node.type === 'directory' ? (
          <div key={node.path}>
            <button
              type="button"
              title={node.path}
              style={{ paddingLeft: pad }}
              onClick={() => void onToggleDirectory(node.path)}
              className="w-full rounded py-1 text-left text-xs font-mono text-void-light hover:bg-void-mid/40"
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
                  selectedPath={selectedPath}
                />
              ))}
          </div>
        ) : (
          <button
            key={node.path}
            type="button"
            title={node.path}
            style={{ paddingLeft: pad }}
            onClick={() => onSelectFile(node.path)}
            className={`w-full rounded py-1 text-left text-xs font-mono break-all ${
              selectedPath === node.path ? 'bg-neon-cyan/15 text-neon-cyan' : 'text-void-light hover:bg-void-mid/40'
            }`}
          >
            <span className="inline-block w-4" aria-hidden />
            📄 {node.name}
          </button>
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
  onToggleDirectory,
  onSelectFile,
}: FileTreeProps) {
  return (
    <div className="rounded border border-void-muted/30 bg-void-black/30 p-2">
      <div className="mb-2 text-xs font-mono text-neon-cyan">FILES</div>
      <div className="max-h-52 overflow-auto space-y-0.5">
        {rootEntries.length === 0 && (
          <div className="text-xs text-void-dim">No files loaded.</div>
        )}
        {rootEntries.length > 0 && (
          <TreeRows
            entries={rootEntries}
            depth={0}
            expandedDirs={expandedDirs}
            loadingDirs={loadingDirs}
            childrenByDir={childrenByDir}
            onToggleDirectory={onToggleDirectory}
            onSelectFile={onSelectFile}
            selectedPath={selectedPath}
          />
        )}
      </div>
    </div>
  )
}
