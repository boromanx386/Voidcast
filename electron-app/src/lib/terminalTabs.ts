import type { TerminalLine } from '@/types/coding'
import { appendTerminalChunk, MAX_TERMINAL_ROWS } from '@/lib/terminalChunks'

/** One background process (dev server, watcher, …) with its own terminal tab. */
export type ProcessTab = {
  runId: string
  /** The command, without the `$ ` prompt. */
  command: string
  running: boolean
  /** `[exit 0]`, `[stopped]`, … once the process is gone. */
  exitText?: string
  lines: TerminalLine[]
}

export type TerminalBuffers = {
  agent: TerminalLine[]
  shell: TerminalLine[]
  procs: ProcessTab[]
}

/** Finished tabs beyond this are dropped, oldest first; running ones are never dropped. */
export const MAX_PROCESS_TABS = 8

export const emptyTerminalBuffers = (): TerminalBuffers => ({ agent: [], shell: [], procs: [] })

export const processTabId = (runId: string) => `proc:${runId}`

/** Tab label: the command's first words, short enough for the tab strip. */
export function processTabLabel(command: string, max = 22): string {
  const one = command.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one || 'process'
}

const PROMPT_RE = /^\$ (.*?)(?: {2}\(background\))?$/

function commandFromRows(rows: TerminalLine[], runId: string): string | undefined {
  for (const row of rows) {
    if (row.runId !== runId || row.stream !== 'system') continue
    const m = row.text.match(PROMPT_RE)
    if (m) return m[1]
  }
  return undefined
}

function appendRow(rows: TerminalLine[], line: TerminalLine): TerminalLine[] {
  return appendTerminalChunk(rows, {
    stream: line.stream,
    text: line.text,
    idPrefix: line.id,
    runId: line.runId,
    source: line.source,
  })
}

function pruneProcs(procs: ProcessTab[]): ProcessTab[] {
  let extra = procs.length - MAX_PROCESS_TABS
  if (extra <= 0) return procs
  return procs.filter((p) => {
    if (extra > 0 && !p.running) {
      extra--
      return false
    }
    return true
  })
}

/**
 * Routes feed lines to their tab: RUN commands to SHELL, background processes to a tab of
 * their own, everything else to AGENT. A foreground run that the main process hands back to
 * the agent turns background mid-stream; its earlier rows move out of AGENT with it, and AGENT
 * keeps a one-line pointer.
 */
export function routeFeedLines(buf: TerminalBuffers, lines: TerminalLine[]): TerminalBuffers {
  let { agent, shell, procs } = buf
  for (const line of lines) {
    if (line.source === 'manual') {
      shell = appendRow(shell, line)
      continue
    }
    if (!line.background || !line.runId) {
      agent = appendRow(agent, line)
      continue
    }
    const runId = line.runId
    let idx = procs.findIndex((p) => p.runId === runId)
    if (idx < 0) {
      const moved = agent.filter((r) => r.runId === runId)
      const command =
        commandFromRows(moved, runId) ?? commandFromRows([line], runId) ?? runId.slice(0, 8)
      if (moved.length > 0) {
        agent = [
          ...agent.filter((r) => r.runId !== runId),
          {
            id: `moved-${runId}`,
            stream: 'system' as const,
            text: `→ still running in its own tab: ${processTabLabel(command)}`,
            ts: line.ts,
            runId,
          },
        ].slice(-MAX_TERMINAL_ROWS)
      }
      procs = [...procs, { runId, command, running: true, lines: moved }]
      idx = procs.length - 1
    }
    const tab = procs[idx]
    const next: ProcessTab = {
      ...tab,
      lines: appendRow(tab.lines, line),
      ...(line.done ? { running: false, exitText: line.text } : {}),
    }
    procs = procs.map((p, i) => (i === idx ? next : p))
  }
  return { agent, shell, procs: pruneProcs(procs) }
}

export function appendShellRows(buf: TerminalBuffers, rows: TerminalLine[]): TerminalBuffers {
  return { ...buf, shell: [...buf.shell, ...rows].slice(-MAX_TERMINAL_ROWS) }
}

export function clearTerminalTab(buf: TerminalBuffers, tabId: string): TerminalBuffers {
  if (tabId === 'agent') return { ...buf, agent: [] }
  if (tabId === 'shell') return { ...buf, shell: [] }
  return {
    ...buf,
    procs: buf.procs.map((p) => (processTabId(p.runId) === tabId ? { ...p, lines: [] } : p)),
  }
}

export function closeProcessTab(buf: TerminalBuffers, runId: string): TerminalBuffers {
  return { ...buf, procs: buf.procs.filter((p) => p.runId !== runId) }
}

export function linesForTab(buf: TerminalBuffers, tabId: string): TerminalLine[] {
  if (tabId === 'agent') return buf.agent
  if (tabId === 'shell') return buf.shell
  return buf.procs.find((p) => processTabId(p.runId) === tabId)?.lines ?? []
}
