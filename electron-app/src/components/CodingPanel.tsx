import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileTree } from '@/components/coding/FileTree'
import { FolderIcon } from '@/components/icons/FolderIcon'
import { FilePreview } from '@/components/coding/FilePreview'
import { TerminalView } from '@/components/coding/TerminalView'
import { filterCodingTreeEntries } from '@/lib/codingTreeFilter'
import {
  buildGitStatusByPath,
  formatGitBranchBadge,
  normalizeGitPath,
  parseGitStatusText,
  type GitStatusEntry,
} from '@/lib/gitStatusParse'
import { expandTextToTerminalLines, MAX_TERMINAL_ROWS } from '@/lib/terminalChunks'
import type { AppSettings, CodingSettings } from '@/lib/settings'
import {
  invokeCodingGit,
  invokeExecuteCodingCommand,
  invokeListCodingDirectory,
  invokePickCodingDirectory,
  invokeReadCodingFile,
} from '@/lib/codingTools'
import type { CodingFileNode, TerminalLine } from '@/types/coding'

type CodingUiVisibilityPatch = Partial<
  Pick<CodingSettings, 'showFileTree' | 'showFilePreview' | 'showTerminal' | 'panelWidthPx'>
>

type Props = {
  settings: AppSettings
  onUpdateProjectPath: (path: string) => void
  onCodingUiChange: (patch: CodingUiVisibilityPatch) => void
  /** Controlled panel width from chat ↔ panel splitter. */
  widthPx?: number
  /** Increments when agent mutates the project on disk; refreshes file tree while panel is open. */
  fileTreeRevision?: number
  /** Increments when agent mutates disk or runs git tools; refreshes git colors. */
  gitRevision?: number
  /** Agent `execute_command` lines only (mirrors shell); manual RUN output is appended locally. */
  agentShellFeed?: TerminalLine[]
}

type PreviewMode = 'file' | 'diff'

const SECTION_KEYS = ['showFileTree', 'showFilePreview', 'showTerminal'] as const

export function CodingPanel({
  settings,
  onUpdateProjectPath,
  onCodingUiChange,
  widthPx,
  fileTreeRevision = 0,
  gitRevision = 0,
  agentShellFeed = [],
}: Props) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [previewContent, setPreviewContent] = useState('')
  const [previewMode, setPreviewMode] = useState<PreviewMode>('file')
  const [previewDiffStaged, setPreviewDiffStaged] = useState(false)
  /** Local bump so panel RUN also reloads git colors. */
  const [localGitBump, setLocalGitBump] = useState(0)
  const [gitStatusByPath, setGitStatusByPath] = useState<Map<string, GitStatusEntry>>(
    () => new Map(),
  )
  const [gitBranchLabel, setGitBranchLabel] = useState<string | null>(null)
  const [dirtyOnly, setDirtyOnly] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [commitBusy, setCommitBusy] = useState(false)
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
  const gitStatusByPathRef = useRef(gitStatusByPath)
  gitStatusByPathRef.current = gitStatusByPath

  const projectPath = settings.coding.projectPath || settings.codingProjectPath
  const { showFileTree, showFilePreview, showTerminal } = settings.coding

  const toggleSection = useCallback(
    (key: (typeof SECTION_KEYS)[number]) => {
      const cur = settings.coding[key]
      if (cur) {
        const othersOn = SECTION_KEYS.filter((k) => k !== key).some((k) => settings.coding[k])
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
    setSelectedPath(null)
    setPreviewContent('')
    setPreviewMode('file')
    setPreviewDiffStaged(false)
    setGitStatusByPath(new Map())
    setGitBranchLabel(null)
    setDirtyOnly(false)
    setCommitMessage('')
  }, [projectPath])

  const pushTerminal = useCallback((stream: TerminalLine['stream'], text: string) => {
    const idBase = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const rows = expandTextToTerminalLines(stream, text, idBase)
    if (rows.length === 0) return
    setTerminalLines((prev) => [...prev, ...rows].slice(-MAX_TERMINAL_ROWS))
  }, [])

  const refreshGitStatus = useCallback(async () => {
    if (!projectPath) {
      setGitStatusByPath(new Map())
      setGitBranchLabel(null)
      return
    }
    const out = await invokeCodingGit(projectPath, { mode: 'status' })
    if (!out.ok) {
      setGitStatusByPath(new Map())
      setGitBranchLabel(null)
      return
    }
    const parsed = parseGitStatusText(out.text)
    setGitStatusByPath(buildGitStatusByPath(parsed))
    setGitBranchLabel(parsed.branch ? formatGitBranchBadge(parsed.branch) : null)
  }, [projectPath])

  useEffect(() => {
    void refreshGitStatus()
  }, [refreshGitStatus, gitRevision, localGitBump])

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

  const onOpenFile = useCallback(
    async (path: string) => {
      if (!projectPath) return
      setSelectedPath(path)

      const status = gitStatusByPathRef.current.get(normalizeGitPath(path))
      if (status && !status.untracked) {
        const preferStaged = status.staged && !status.unstaged
        setPreviewMode('diff')
        setPreviewDiffStaged(preferStaged)
        const out = await invokeCodingGit(projectPath, {
          mode: 'diff',
          path,
          staged: preferStaged,
        })
        setPreviewContent(out.ok ? out.text : out.text || 'Diff failed.')
        return
      }

      setPreviewMode('file')
      setPreviewDiffStaged(false)
      const out = await invokeReadCodingFile(projectPath, path)
      setPreviewContent(out.text)
    },
    [projectPath],
  )

  const onStageFile = useCallback(
    async (path: string) => {
      if (!projectPath) return
      const out = await invokeCodingGit(projectPath, { mode: 'stage', path })
      if (!out.ok) {
        pushTerminal('stderr', out.text || `Stage failed: ${path}`)
        return
      }
      pushTerminal('system', `staged ${path}`)
      setLocalGitBump((n) => n + 1)
    },
    [projectPath, pushTerminal],
  )

  const onUnstageFile = useCallback(
    async (path: string) => {
      if (!projectPath) return
      const out = await invokeCodingGit(projectPath, { mode: 'unstage', path })
      if (!out.ok) {
        pushTerminal('stderr', out.text || `Unstage failed: ${path}`)
        return
      }
      pushTerminal('system', `unstaged ${path}`)
      setLocalGitBump((n) => n + 1)
    },
    [projectPath, pushTerminal],
  )

  const onDiscardFile = useCallback(
    async (path: string) => {
      if (!projectPath) return
      const ok = window.confirm(
        `Discard unstaged changes in:\n${path}\n\nThis cannot be undone (git restore).`,
      )
      if (!ok) return
      const out = await invokeCodingGit(projectPath, { mode: 'discard', path })
      if (!out.ok) {
        pushTerminal('stderr', out.text || `Discard failed: ${path}`)
        return
      }
      pushTerminal('system', `discarded ${path}`)
      setLocalGitBump((n) => n + 1)
      if (selectedPath === path) {
        setPreviewMode('file')
        setPreviewDiffStaged(false)
        const read = await invokeReadCodingFile(projectPath, path)
        setPreviewContent(read.text)
      }
    },
    [projectPath, pushTerminal, selectedPath],
  )

  const stagedCount = useMemo(() => {
    let n = 0
    for (const e of gitStatusByPath.values()) {
      if (e.staged) n += 1
    }
    return n
  }, [gitStatusByPath])

  const dirtyCount = gitStatusByPath.size

  const selectedGit = selectedPath
    ? gitStatusByPath.get(normalizeGitPath(selectedPath))
    : undefined

  const onCommit = useCallback(
    async (all: boolean) => {
      if (!projectPath || commitBusy) return
      const msg = commitMessage.trim()
      if (!msg) {
        pushTerminal('stderr', 'Commit message is empty.')
        return
      }
      if (all) {
        if (dirtyCount === 0) {
          pushTerminal('stderr', 'Nothing to commit.')
          return
        }
      } else if (stagedCount === 0) {
        pushTerminal('stderr', 'Nothing staged — use Commit All, or stage files first.')
        return
      }
      setCommitBusy(true)
      try {
        const out = await invokeCodingGit(projectPath, {
          mode: 'commit',
          message: msg,
          all,
        })
        if (!out.ok) {
          pushTerminal('stderr', out.text || 'Commit failed.')
          return
        }
        pushTerminal('stdout', out.text)
        setCommitMessage('')
        setLocalGitBump((n) => n + 1)
      } finally {
        setCommitBusy(false)
      }
    },
    [projectPath, commitBusy, commitMessage, stagedCount, dirtyCount, pushTerminal],
  )

  const onDiscardAll = useCallback(async () => {
    if (!projectPath || dirtyCount === 0) return
    const ok = window.confirm(
      `Discard ALL local changes in this project?\n\n` +
        `• Restores tracked files to HEAD\n` +
        `• Deletes untracked files\n\n` +
        `This cannot be undone.`,
    )
    if (!ok) return
    const out = await invokeCodingGit(projectPath, { mode: 'discardAll' })
    if (!out.ok) {
      pushTerminal('stderr', out.text || 'Discard all failed.')
      return
    }
    pushTerminal('system', out.text || 'Discarded all changes.')
    setLocalGitBump((n) => n + 1)
    setSelectedPath(null)
    setPreviewContent('')
    setPreviewMode('file')
    setPreviewDiffStaged(false)
    void refreshFileTreeInPlace()
  }, [projectPath, dirtyCount, pushTerminal, refreshFileTreeInPlace])

  const onDirtyOnlyChange = useCallback(
    (next: boolean) => {
      setDirtyOnly(next)
      if (!next || !projectPath) return
      // Expand dirs that contain changes so nested dirty files are reachable.
      const byPath = gitStatusByPathRef.current
      if (byPath.size === 0) return
      const dirs = new Set<string>()
      for (const filePath of byPath.keys()) {
        const parts = filePath.split('/')
        let acc = ''
        for (let i = 0; i < parts.length - 1; i++) {
          acc = acc ? `${acc}/${parts[i]}` : parts[i]!
          dirs.add(acc)
        }
      }
      if (dirs.size === 0) return
      void (async () => {
        const pairs = await Promise.all(
          [...dirs].map(async (dirPath) => {
            const r = await invokeListCodingDirectory(projectPath, dirPath)
            return [dirPath, r.ok ? filterCodingTreeEntries(r.entries) : null] as const
          }),
        )
        setChildrenByDir((c) => {
          const nextMap = { ...c }
          for (const [dirPath, list] of pairs) {
            if (list) nextMap[dirPath] = list
          }
          return nextMap
        })
        setExpandedDirs((p) => {
          const nextSet = new Set(p)
          for (const dirPath of dirs) nextSet.add(dirPath)
          return nextSet
        })
      })()
    },
    [projectPath],
  )

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
    setLocalGitBump((n) => n + 1)
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
    <aside
      className="flex h-full min-h-0 shrink-0 flex-col gap-3 overflow-hidden border-l border-void-muted/30 bg-void-dark/40 p-3"
      style={{ width: widthPx ?? settings.coding.panelWidthPx }}
    >
      <div className="flex shrink-0 items-center justify-between">
        <div className="text-sm font-mono text-neon-cyan">CODING_PANEL</div>
        <button type="button" className="cyber-btn text-xs" onClick={() => void onPickFolder()}>
          <FolderIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="shrink-0 text-[11px] font-mono text-void-dim break-all">
        {projectPath || 'No project folder selected.'}{' '}
        {projectPath ? `(${visibleFileCount} files listed)` : ''}
      </div>
      <div className="flex shrink-0 flex-wrap gap-1.5" role="toolbar" aria-label="Coding panel sections">
        {SECTION_KEYS.map((key) => {
          const on = settings.coding[key]
          const label =
            key === 'showFileTree' ? 'FILES' : key === 'showFilePreview' ? 'PREVIEW' : 'TERM'
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
              gitStatusByPath={gitStatusByPath}
              gitBranchLabel={gitBranchLabel}
              dirtyOnly={dirtyOnly}
              onDirtyOnlyChange={onDirtyOnlyChange}
              onToggleDirectory={toggleDirectory}
              onSelectFile={(path) => void onOpenFile(path)}
              onStageFile={(path) => void onStageFile(path)}
              onUnstageFile={(path) => void onUnstageFile(path)}
              onDiscardFile={(path) => void onDiscardFile(path)}
            />
          </div>
        )}
        {showFilePreview && (
          <FilePreview
            filePath={selectedPath}
            content={previewContent}
            mode={previewMode}
            diffStaged={previewDiffStaged}
            canStage={Boolean(
              selectedGit && (selectedGit.unstaged || selectedGit.untracked),
            )}
            canUnstage={Boolean(selectedGit?.staged)}
            canDiscard={Boolean(
              selectedGit && selectedGit.unstaged && !selectedGit.untracked,
            )}
            onStage={
              selectedPath ? () => void onStageFile(selectedPath) : undefined
            }
            onUnstage={
              selectedPath ? () => void onUnstageFile(selectedPath) : undefined
            }
            onDiscard={
              selectedPath ? () => void onDiscardFile(selectedPath) : undefined
            }
          />
        )}
        {dirtyCount > 0 && (
          <div className="flex shrink-0 flex-col gap-1.5">
            <div className="flex gap-2">
              <input
                type="text"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    // Prefer staged-only commit when something is staged; else commit all
                    void onCommit(stagedCount > 0 ? false : true)
                  }
                }}
                placeholder={
                  stagedCount > 0
                    ? `Message (${stagedCount} staged · ${dirtyCount} dirty)`
                    : `Message · commit all (${dirtyCount})`
                }
                title="Commit message"
                disabled={commitBusy}
                className="cyber-input flex-1 text-xs"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className="cyber-btn text-[10px] disabled:opacity-40"
                disabled={commitBusy || !commitMessage.trim() || stagedCount === 0}
                title="Commit only staged files"
                onClick={() => void onCommit(false)}
              >
                COMMIT
              </button>
              <button
                type="button"
                className="cyber-btn text-[10px] disabled:opacity-40"
                disabled={commitBusy || !commitMessage.trim() || dirtyCount === 0}
                title="Stage all changes and commit (like VS Code Commit All)"
                onClick={() => void onCommit(true)}
              >
                COMMIT ALL
              </button>
              <button
                type="button"
                className="rounded border border-neon-red/40 px-2 py-1 text-[10px] font-mono uppercase tracking-wide text-neon-red/90 hover:bg-neon-red/10 disabled:opacity-40"
                disabled={commitBusy || dirtyCount === 0}
                title="Discard all local changes (restore + clean)"
                onClick={() => void onDiscardAll()}
              >
                DISCARD ALL
              </button>
            </div>
          </div>
        )}
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
