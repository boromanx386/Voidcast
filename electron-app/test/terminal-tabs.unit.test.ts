import { describe, expect, it } from 'vitest'
import {
  closeProcessTab,
  emptyTerminalBuffers,
  linesForTab,
  MAX_PROCESS_TABS,
  processTabId,
  processTabLabel,
  routeFeedLines,
} from '../src/lib/terminalTabs'
import type { TerminalLine } from '../src/types/coding'

let n = 0
const line = (over: Partial<TerminalLine> & Pick<TerminalLine, 'text'>): TerminalLine => ({
  id: `l${n++}`,
  stream: 'stdout',
  ts: 0,
  ...over,
})

describe('routeFeedLines', () => {
  it('sends RUN output to SHELL and foreground agent output to AGENT', () => {
    const buf = routeFeedLines(emptyTerminalBuffers(), [
      line({ text: '$ ls', stream: 'system', runId: 'a' }),
      line({ text: 'x\n', runId: 'a' }),
      line({ text: '$ npm test', stream: 'system', runId: 'm', source: 'manual' }),
    ])
    expect(buf.agent.map((r) => r.text)).toEqual(['$ ls', 'x'])
    expect(buf.shell.map((r) => r.text)).toEqual(['$ npm test'])
    expect(buf.procs).toEqual([])
  })

  it('gives an explicit background run its own tab, named after the command', () => {
    const buf = routeFeedLines(emptyTerminalBuffers(), [
      line({ text: '$ npm run dev  (background)', stream: 'system', runId: 'b', background: true }),
      line({ text: 'ready\n', runId: 'b', background: true }),
    ])
    expect(buf.agent).toEqual([])
    expect(buf.procs).toHaveLength(1)
    expect(buf.procs[0]).toMatchObject({ runId: 'b', command: 'npm run dev', running: true })
    expect(linesForTab(buf, processTabId('b')).map((r) => r.text)).toEqual([
      '$ npm run dev  (background)',
      'ready',
    ])
  })

  it('moves a promoted foreground run out of AGENT and leaves a pointer', () => {
    let buf = routeFeedLines(emptyTerminalBuffers(), [
      line({ text: '$ vite', stream: 'system', runId: 'p' }),
      line({ text: 'Local: http://localhost:5173\n', runId: 'p' }),
    ])
    buf = routeFeedLines(buf, [
      line({
        text: '[still running — returned to agent; tracked as background]',
        stream: 'system',
        runId: 'p',
        background: true,
      }),
    ])
    expect(buf.agent.map((r) => r.text)).toEqual(['→ still running in its own tab: vite'])
    expect(buf.procs[0].command).toBe('vite')
    expect(buf.procs[0].lines.map((r) => r.text)).toEqual([
      '$ vite',
      'Local: http://localhost:5173',
      '[still running — returned to agent; tracked as background]',
    ])
  })

  it('marks the tab finished on the exit line', () => {
    const buf = routeFeedLines(emptyTerminalBuffers(), [
      line({ text: '$ w  (background)', stream: 'system', runId: 'w', background: true }),
      line({ text: '[exit 1]', stream: 'system', runId: 'w', background: true, done: true }),
    ])
    expect(buf.procs[0]).toMatchObject({ running: false, exitText: '[exit 1]' })
    expect(closeProcessTab(buf, 'w').procs).toEqual([])
  })

  it('drops the oldest finished tabs past the cap, never running ones', () => {
    const lines: TerminalLine[] = []
    for (let i = 0; i < MAX_PROCESS_TABS + 2; i++) {
      const runId = `r${i}`
      lines.push(
        line({ text: `$ job ${i}  (background)`, stream: 'system', runId, background: true }),
      )
      if (i < 2) {
        lines.push(
          line({ text: '[exit 0]', stream: 'system', runId, background: true, done: true }),
        )
      }
    }
    const buf = routeFeedLines(emptyTerminalBuffers(), lines)
    expect(buf.procs).toHaveLength(MAX_PROCESS_TABS)
    expect(buf.procs.map((p) => p.runId)).not.toContain('r0')
    expect(buf.procs.map((p) => p.runId)).not.toContain('r1')
  })
})

describe('processTabLabel', () => {
  it('shortens long commands', () => {
    expect(processTabLabel('npm run dev')).toBe('npm run dev')
    expect(processTabLabel('npx vitest --watch --reporter=verbose src', 12)).toBe('npx vitest …')
  })
})
