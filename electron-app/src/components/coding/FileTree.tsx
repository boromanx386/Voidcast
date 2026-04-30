import type { CodingFileNode } from '@/types/coding'

type Props = {
  files: CodingFileNode[]
  selectedPath: string | null
  onSelect: (path: string) => void
}

export function FileTree({ files, selectedPath, onSelect }: Props) {
  return (
    <div className="rounded border border-void-muted/30 bg-void-black/30 p-2">
      <div className="mb-2 text-xs font-mono text-neon-cyan">FILES</div>
      <div className="max-h-52 overflow-auto space-y-1">
        {files.length === 0 && <div className="text-xs text-void-dim">No files loaded.</div>}
        {files.map((f) => (
          <button
            key={f.path}
            type="button"
            onClick={() => f.type === 'file' && onSelect(f.path)}
            className={`w-full text-left rounded px-2 py-1 text-xs font-mono ${
              selectedPath === f.path ? 'bg-neon-cyan/15 text-neon-cyan' : 'text-void-light hover:bg-void-mid/40'
            } ${f.type === 'directory' ? 'opacity-80 cursor-default' : ''}`}
            disabled={f.type === 'directory'}
          >
            {f.type === 'directory' ? '📁' : '📄'} {f.path}
          </button>
        ))}
      </div>
    </div>
  )
}
