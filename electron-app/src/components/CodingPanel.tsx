import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileTree } from '@/components/coding/FileTree'
import { FilePreview } from '@/components/coding/FilePreview'
import { TerminalView } from '@/components/coding/TerminalView'
import type { AppSettings } from '@/lib/settings'
import {
  invokeExecuteCodingCommand,
  invokeListCodingDirectory,
  invokePickCodingDirectory,
  invokeReadCodingFile,
} from '@/lib/codingTools'
import type { TerminalLine } from '@/types/coding'

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
  const [files, setFiles] = useState<Array<{ name: string; path: string; type: 'file' | 'directory'; size?: number }>>([])

  const projectPath = settings.coding.projectPath || settings.codingProjectPath

  const pushTerminal = useCallback((stream: TerminalLine['stream'], text: string) => {
    setTerminalLines((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, stream, text, ts: Date.now() }].slice(-300))
  }, [])

  const refreshFiles = useCallback(async () => {
    if (!projectPath) return
    const entries = await invokeListCodingDirectory(projectPath)
    setFiles(entries)
  }, [projectPath])

  useEffect(() => {
    void refreshFiles()
  }, [refreshFiles])

  useEffect(() => {
    if (externalTerminalLines.length === 0) return
    setTerminalLines((prev) => [...prev, ...externalTerminalLines].slice(-300))
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

  const fileCount = useMemo(() => files.filter((f) => f.type === 'file').length, [files])

  return (
    <aside className="w-[26rem] min-w-[22rem] border-l border-void-muted/30 bg-void-dark/40 p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-mono text-neon-cyan">CODING_PANEL</div>
        <button type="button" className="cyber-btn text-xs" onClick={() => void onPickFolder()}>
          PICK_FOLDER
        </button>
      </div>
      <div className="text-[11px] font-mono text-void-dim break-all">
        {projectPath || 'No project folder selected.'} {projectPath ? `(${fileCount} files)` : ''}
      </div>
      <FileTree files={files} selectedPath={selectedPath} onSelect={(path) => void onOpenFile(path)} />
      <FilePreview filePath={selectedPath} content={previewContent} />
      <TerminalView lines={terminalLines} />
      <div className="flex gap-2">
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
