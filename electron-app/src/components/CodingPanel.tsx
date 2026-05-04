import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileTree } from '@/components/coding/FileTree'
import { FilePreview } from '@/components/coding/FilePreview'
import { TerminalView } from '@/components/coding/TerminalView'
import { filterCodingTreeEntries } from '@/lib/codingTreeFilter'
import { expandTextToTerminalLines, MAX_TERMINAL_ROWS } from '@/lib/terminalChunks'
import type { AppSettings, CodingSettings } from '@/lib/settings'

type CodingUiVisibilityPatch = Partial<
  Pick<CodingSettings, 'showFileTree' | 'showFilePreview' | 'showTerminal'>
>
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
  onCodingUiChange: (patch: CodingUiVisibilityPatch) => void
  /** Increments when agent mutates the project on disk; refreshes file tree while panel is open. */
  fileTreeRevision?: number
  /** Agent `execute_command` lines only (mirrors shell); manual RUN output is appended locally. */
  agentShellFeed?: TerminalLine[]
}

export function CodingPanel({
  settings,
  onUpdateProjectPath,
  onCodingUiChange,
  fileTreeRevision = 0,
  agentShellFeed = [],
}: Props) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [previewContent, setPreviewContent] = useState('')
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([])
  const [command, setCommand] = useState('')
  /** Oldest → newest; used for ↑ / ↓ in command input (bash-style). */
  const [commandHistory, setCommandHistory] = useState<string[]>([])
  /** `null` = new line; `0` = most recent history entry; larger = older. */
  const [historyFromEnd, setHistoryFromEnd] = useState<number | null>(null)
  const commandHistoryDraftRef = useRef('')
  const [files, setFiles] = useState<CodingFileNode[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set())
  const [childrenByDir, setChildrenByDir] = useState<Record<string, CodingFileNode[]>>({})

  const expandedDirsRef = useRef(expandedDirs)
  expandedDirsRef.current = expandedDirs

  const seenAgentShellIdsRef = useRef<Set<string>>(new Set())

  const projectPath = settings.coding.projectPath || settings.codingProjectPath
  const { showFileTree, showFilePreview, showTerminal } = settings.coding

  const toggleSection = useCallback(
    (key: 'showFileTree' | 'showFilePreview' | 'showTerminal') => {
      const cur = settings.coding[key]
      if (cur) {
        const othersOn = (['showFileTree', 'showFilePreview', 'showTerminal'] as const)
          .filter((k) => k !== key)
          .some((k) => settings.coding[k])
        if (!othersOn) return
      }
      onCodingUiChange({ [key]: !cur })
    },
    [onCodingUiChange, settings.coding],
  )

  useEffect(() => {
    seenAgentShellIdsRef.current.clear()
  }, [projectPath])

  useEffect(() => {
    setCommandHistory([])
    setHistoryFromEnd(null)
    commandHistoryDraftRef.current = ''
  }, [projectPath])

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

  /** Re-list root and any expanded folders; keeps expand state, drops cache for collapsed dirs. */
  const refreshFileTreeInPlace = useCallback(async () => {
    if (!projectPath) return
    const root = await invokeListCodingDirectory(projectPath)
    if (!root.ok) {
      pushTerminal('stderr', root.error)
      return
    }
    setFiles(filterCodingTreeEntries(root.entries))

    const expanded = [...expandedDirsRef.current]
    if (expanded.length === 0) {
      setChildrenByDir({})
      return
    }
    const pairs = await Promise.all(
      expanded.map(async (dirPath) => {
        const r = await invokeListCodingDirectory(projectPath, dirPath)
        return [dirPath, r.ok ? filterCodingTreeEntries(r.entries) : null] as const
      }),
    )
    setChildrenByDir(() => {
      const next: Record<string, CodingFileNode[]> = {}
      for (const [dirPath, list] of pairs) {
        if (list) next[dirPath] = list
      }
      return next
    })
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
    if (fileTreeRevision === 0) return
    void refreshFileTreeInPlace()
  }, [fileTreeRevision, refreshFileTreeInPlace])

  useEffect(() => {
    const feed = agentShellFeed
    const stillInFeed = new Set(feed.map((l) => l.id))
    for (const id of [...seenAgentShellIdsRef.current]) {
      if (!stillInFeed.has(id)) seenAgentShellIdsRef.current.delete(id)
    }
    if (feed.length === 0) return
    const batch: TerminalLine[] = []
    for (const line of feed) {
      if (seenAgentShellIdsRef.current.has(line.id)) continue
      seenAgentShellIdsRef.current.add(line.id)
      batch.push(...expandTextToTerminalLines(line.stream, line.text, line.id))
    }
    if (batch.length === 0) return
    setTerminalLines((prev) => [...prev, ...batch].slice(-MAX_TERMINAL_ROWS))
  }, [agentShellFeed])

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
    const trimmed = command.trim()
    if (!projectPath || !trimmed) return
    pushTerminal('system', `$ ${trimmed}`)
    const out = await invokeExecuteCodingCommand(projectPath, trimmed)
    pushTerminal(out.ok ? 'stdout' : 'stderr', out.text)
    setCommandHistory((prev) => {
      if (prev.length > 0 && prev[prev.length - 1] === trimmed) return prev
      return [...prev, trimmed].slice(-100)
    })
    setHistoryFromEnd(null)
    commandHistoryDraftRef.current = ''
    setCommand('')
    void refreshFileTreeInPlace()
  }, [projectPath, command, pushTerminal, refreshFileTreeInPlace])

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
      <div className="flex shrink-0 flex-wrap gap-1.5" role="toolbar" aria-label="Coding panel sections">
        {(['showFileTree', 'showFilePreview', 'showTerminal'] as const).map((key) => {
          const on = settings.coding[key]
          const label = key === 'showFileTree' ? 'FILES' : key === 'showFilePreview' ? 'PREVIEW' : 'TERM'
          const title =
            key === 'showFileTree'
              ? 'Toggle file tree'
              : key === 'showFilePreview'
                ? 'Toggle file preview'
                : 'Toggle terminal output'
          return (
            <button
              key={key}
              type="button"
              title={title}
              aria-pressed={on}
              aria-label={`${label}: ${on ? 'on' : 'off'}`}
              onClick={() => toggleSection(key)}
              className={`rounded border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide transition-colors ${
                on
                  ? 'border-neon-cyan/50 bg-neon-cyan/10 text-neon-cyan'
                  : 'border-void-muted/50 text-void-dim/70 hover:border-void-dim hover:text-void-text'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        {showFileTree && (
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
        )}
        {showFilePreview && <FilePreview filePath={selectedPath} content={previewContent} />}
        {showTerminal && (
          <TerminalView lines={terminalLines} onClear={() => setTerminalLines([])} />
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              void onRunCommand()
              return
            }
            if (e.key === 'ArrowUp') {
              if (commandHistory.length === 0) return
              e.preventDefault()
              if (historyFromEnd === null) {
                commandHistoryDraftRef.current = command
                setHistoryFromEnd(0)
                setCommand(commandHistory[commandHistory.length - 1])
                return
              }
              const next = historyFromEnd + 1
              if (next >= commandHistory.length) return
              setHistoryFromEnd(next)
              setCommand(commandHistory[commandHistory.length - 1 - next])
              return
            }
            if (e.key === 'ArrowDown') {
              if (historyFromEnd === null) return
              e.preventDefault()
              if (historyFromEnd === 0) {
                setCommand(commandHistoryDraftRef.current)
                setHistoryFromEnd(null)
                return
              }
              const next = historyFromEnd - 1
              setHistoryFromEnd(next)
              setCommand(commandHistory[commandHistory.length - 1 - next])
            }
          }}
          placeholder="npm test"
          title="Enter: run · ↑ / ↓: command history"
          className="cyber-input flex-1 text-xs"
        />
        <button type="button" className="cyber-btn text-xs" onClick={() => void onRunCommand()}>
          RUN
        </button>
      </div>
    </aside>
  )
}
