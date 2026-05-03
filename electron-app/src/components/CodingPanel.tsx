import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileTree } from '@/components/coding/FileTree'
import { FilePreview } from '@/components/coding/FilePreview'
import { TerminalView } from '@/components/coding/TerminalView'
import { filterCodingTreeEntries } from '@/lib/codingTreeFilter'
import { expandTextToTerminalLines, MAX_TERMINAL_ROWS } from '@/lib/terminalChunks'
import type { AppSettings } from '@/lib/settings'
import {
  invokeExecuteCodingCommand,
  invokeListCodingDirectory,
  invokePickCodingDirectory,
  invokeReadCodingFile,
} from '@/lib/codingTools'
import type { CodingFileNode, TerminalLine } from '@/types/coding'

type Props = {
  settings: AppSettings
  onUpdateProjectPath: (path: string) => void
  externalTerminalLines?: TerminalLine[]
}

export function CodingPanel({ settings, onUpdateProjectPath, externalTerminalLines = [] }: Props) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [previewContent, setPreviewContent] = useState('')
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([])
  const [command, setCommand] = useState('')
  const [files, setFiles] = useState<CodingFileNode[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set())
  const [childrenByDir, setChildrenByDir] = useState<Record<string, CodingFileNode[]>>({})

  const expandedDirsRef = useRef(expandedDirs)
  expandedDirsRef.current = expandedDirs

  const projectPath = settings.coding.projectPath || settings.codingProjectPath

  const pushTerminal = useCallback((stream: TerminalLine['stream'], text: string) => {
    const idBase = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const rows = expandTextToTerminalLines(stream, text, idBase)
    if (rows.length === 0) return
    setTerminalLines((prev) => [...prev, ...rows].slice(-MAX_TERMINAL_ROWS))
  }, [])

  const refreshFiles = useCallback(async () => {
    if (!projectPath) return
    const listed = await invokeListCodingDirectory(projectPath)
    if (listed.ok) {
      setFiles(filterCodingTreeEntries(listed.entries))
      setChildrenByDir({})
      setExpandedDirs(new Set())
    } else pushTerminal('stderr', listed.error)
  }, [projectPath, pushTerminal])

  const toggleDirectory = useCallback(
    async (dirPath: string) => {
      if (!projectPath) return
      if (loadingDirs.has(dirPath)) return

      if (expandedDirsRef.current.has(dirPath)) {
        setExpandedDirs((prev) => {
          const next = new Set(prev)
          next.delete(dirPath)
          return next
        })
        return
      }

      if (!childrenByDir[dirPath]) {
        setLoadingDirs((p) => new Set(p).add(dirPath))
        try {
          const r = await invokeListCodingDirectory(projectPath, dirPath)
          if (!r.ok) {
            pushTerminal('stderr', r.error)
            return
          }
          setChildrenByDir((c) => ({ ...c, [dirPath]: filterCodingTreeEntries(r.entries) }))
        } finally {
          setLoadingDirs((p) => {
            const n = new Set(p)
            n.delete(dirPath)
            return n
          })
        }
      }

      setExpandedDirs((p) => new Set(p).add(dirPath))
    },
    [projectPath, childrenByDir, loadingDirs, pushTerminal],
  )

  useEffect(() => {
    void refreshFiles()
  }, [refreshFiles])

  useEffect(() => {
    if (externalTerminalLines.length === 0) return
    const batch = externalTerminalLines.flatMap((line) =>
      expandTextToTerminalLines(line.stream, line.text, line.id),
    )
    if (batch.length === 0) return
    setTerminalLines((prev) => [...prev, ...batch].slice(-MAX_TERMINAL_ROWS))
  }, [externalTerminalLines])

  const onPickFolder = useCallback(async () => {
    const r = await invokePickCodingDirectory()
    if (r.ok) {
      onUpdateProjectPath(r.path)
      pushTerminal('system', `Project set: ${r.path}`)
    }
  }, [onUpdateProjectPath, pushTerminal])

  const onOpenFile = useCallback(async (path: string) => {
    if (!projectPath) return
    setSelectedPath(path)
    const out = await invokeReadCodingFile(projectPath, path)
    setPreviewContent(out.text)
  }, [projectPath])

  const onRunCommand = useCallback(async () => {
    if (!projectPath || !command.trim()) return
    pushTerminal('system', `$ ${command}`)
    const out = await invokeExecuteCodingCommand(projectPath, command)
    pushTerminal(out.ok ? 'stdout' : 'stderr', out.text)
    setCommand('')
  }, [projectPath, command, pushTerminal])

  const visibleFileCount = useMemo(() => {
    let n = 0
    for (const e of files) {
      if (e.type === 'file') n += 1
    }
    for (const list of Object.values(childrenByDir)) {
      for (const e of list) {
        if (e.type === 'file') n += 1
      }
    }
    return n
  }, [files, childrenByDir])

  return (
    <aside className="flex h-full min-h-0 w-[26rem] min-w-[22rem] shrink-0 flex-col gap-3 overflow-hidden border-l border-void-muted/30 bg-void-dark/40 p-3">
      <div className="flex shrink-0 items-center justify-between">
        <div className="text-sm font-mono text-neon-cyan">CODING_PANEL</div>
        <button type="button" className="cyber-btn text-xs" onClick={() => void onPickFolder()}>
          PICK_FOLDER
        </button>
      </div>
      <div className="shrink-0 text-[11px] font-mono text-void-dim break-all">
        {projectPath || 'No project folder selected.'}{' '}
        {projectPath ? `(${visibleFileCount} files listed)` : ''}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <div className="min-h-0 shrink-0">
          <FileTree
            rootEntries={files}
            expandedDirs={expandedDirs}
            loadingDirs={loadingDirs}
            childrenByDir={childrenByDir}
            selectedPath={selectedPath}
            onToggleDirectory={toggleDirectory}
            onSelectFile={(path) => void onOpenFile(path)}
          />
        </div>
        <FilePreview filePath={selectedPath} content={previewContent} />
        <TerminalView lines={terminalLines} />
      </div>
      <div className="flex shrink-0 gap-2">
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void onRunCommand()
          }}
          placeholder="npm test"
          className="cyber-input flex-1 text-xs"
        />
        <button type="button" className="cyber-btn text-xs" onClick={() => void onRunCommand()}>
          RUN
        </button>
      </div>
    </aside>
  )
}
