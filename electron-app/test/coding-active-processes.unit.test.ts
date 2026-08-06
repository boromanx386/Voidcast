import { describe, expect, it } from 'vitest'
import {
  applyOutputToActiveProcess,
  appendProcessOutputBuffer,
  buildActiveProcessesHint,
  canControlCodingProcess,
  filterProcessesForAgent,
  mergeActiveProcessOutputLines,
  removeActiveProcess,
  sliceProcessOutputBuffer,
  upsertActiveProcess,
  type ActiveCodingProcess,
} from '../src/lib/codingActiveProcesses'

function proc(partial: Partial<ActiveCodingProcess> & Pick<ActiveCodingProcess, 'runId' | 'command'>): ActiveCodingProcess {
  return {
    pid: 1000,
    kind: 'foreground',
    startedAt: 1_000_000,
    lastLines: [],
    ...partial,
  }
}

describe('mergeActiveProcessOutputLines', () => {
  it('appends complete lines and merges partial chunks', () => {
    let lines = mergeActiveProcessOutputLines([], 'hello')
    expect(lines).toEqual(['hello'])
    lines = mergeActiveProcessOutputLines(lines, ' world\n')
    expect(lines).toEqual(['hello world', ''])
    lines = mergeActiveProcessOutputLines(lines, 'next\nline\n')
    expect(lines).toEqual(['hello world', 'next', 'line', ''])
  })

  it('keeps only the last max lines (+ incomplete slot)', () => {
    const lines = mergeActiveProcessOutputLines(['a', 'b', 'c', ''], 'd\ne\n', 3)
    expect(lines).toEqual(['c', 'd', 'e', ''])
  })
})

describe('upsert / remove / applyOutput', () => {
  it('upserts by runId and removes', () => {
    const a = proc({ runId: 'r1', command: 'npm run dev', pid: 1 })
    const b = proc({ runId: 'r2', command: 'pytest', kind: 'background', pid: 2 })
    let list = upsertActiveProcess([], a)
    list = upsertActiveProcess(list, b)
    expect(list).toHaveLength(2)
    list = upsertActiveProcess(list, { ...a, lastLines: ['ready'] })
    expect(list.find((p) => p.runId === 'r1')?.lastLines).toEqual(['ready'])
    expect(list).toHaveLength(2)
    list = removeActiveProcess(list, 'r1')
    expect(list.map((p) => p.runId)).toEqual(['r2'])
  })

  it('applyOutputToActiveProcess updates matching run only', () => {
    const list = [
      proc({ runId: 'r1', command: 'a' }),
      proc({ runId: 'r2', command: 'b' }),
    ]
    const next = applyOutputToActiveProcess(list, 'r2', 'Listening on :5173\n')
    expect(next[0]!.lastLines).toEqual([])
    expect(next[1]!.lastLines).toEqual(['Listening on :5173', ''])
  })

  it('preserves streamed lines when start upsert arrives late', () => {
    let list = applyOutputToActiveProcess([], 'r9', 'boot\n')
    expect(list[0]!.command).toBe('(running)')
    list = upsertActiveProcess(
      list,
      proc({ runId: 'r9', command: 'npm run dev', pid: 42, lastLines: [] }),
    )
    expect(list).toHaveLength(1)
    expect(list[0]!.command).toBe('npm run dev')
    expect(list[0]!.pid).toBe(42)
    expect(list[0]!.lastLines).toEqual(['boot', ''])
  })
})

describe('filter / ownership', () => {
  it('filters to same owner or same project', () => {
    const list = [
      proc({ runId: 'a', command: 'a', ownerId: 's1', projectPath: 'C:/foo' }),
      proc({ runId: 'b', command: 'b', ownerId: 's2', projectPath: 'C:/bar' }),
      proc({ runId: 'c', command: 'c', ownerId: 's3', projectPath: 'C:\\foo' }),
      proc({ runId: 'd', command: 'd' }),
    ]
    const filtered = filterProcessesForAgent(list, { ownerId: 's1', projectPath: 'C:/foo' })
    expect(filtered.map((p) => p.runId).sort()).toEqual(['a', 'c', 'd'])
  })

  it('canControl allows same project or owner, denies other folder', () => {
    const other = proc({ runId: 'x', command: 'x', ownerId: 's2', projectPath: 'D:/x' })
    expect(
      canControlCodingProcess(other, { ownerId: 's1', projectPath: 'C:/foo' }),
    ).toBe(false)
    expect(
      canControlCodingProcess(other, { ownerId: 's2', projectPath: 'C:/foo' }),
    ).toBe(true)
    expect(
      canControlCodingProcess(
        proc({ runId: 'y', command: 'y', ownerId: 's9', projectPath: 'C:/foo' }),
        { ownerId: 's1', projectPath: 'C:/foo' },
      ),
    ).toBe(true)
  })
})

describe('buildActiveProcessesHint', () => {
  it('returns empty string when no processes', () => {
    expect(buildActiveProcessesHint([])).toBe('')
  })

  it('formats fg/bg with duration and last snippet', () => {
    const hint = buildActiveProcessesHint(
      [
        proc({
          runId: 'r1',
          command: 'npm run dev',
          kind: 'foreground',
          pid: 1234,
          startedAt: 1_000_000,
          lastLines: ['', '  Local: http://localhost:5173/'],
        }),
        proc({
          runId: 'r2',
          command: 'python -m http.server',
          kind: 'background',
          pid: 5678,
          startedAt: 1_009_000,
          lastLines: [],
        }),
      ],
      1_012_000,
    )
    expect(hint).toContain('Active coding processes:')
    expect(hint).toContain('[fg] runId=r1 npm run dev → pid 1234, running 12s')
    expect(hint).toContain('Local: http://localhost:5173/')
    expect(hint).toContain('[bg] runId=r2 python -m http.server → pid 5678, running 3s')
    expect(hint).toContain('(no output yet)')
    expect(hint).toContain('stop_process')
  })

  it('caps listed processes and notes overflow', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      proc({ runId: `r${i}`, command: `cmd-${i}`, startedAt: 0 }),
    )
    const hint = buildActiveProcessesHint(many, 0)
    expect(hint.split('\n').filter((l) => l.startsWith('- [')).length).toBe(4)
    expect(hint).toContain('…and 2 more')
  })
})

describe('process output ring buffer', () => {
  it('appends and drops from the front when over max', () => {
    let state = { buffer: '', startOffset: 0 }
    state = appendProcessOutputBuffer(state, 'abcdefghij', 6)
    expect(state.buffer).toBe('efghij')
    expect(state.startOffset).toBe(4)
  })

  it('slices by absolute offset', () => {
    const state = { buffer: 'hello world', startOffset: 10 }
    const mid = sliceProcessOutputBuffer(state, 15)
    expect(mid.text).toBe(' world')
    expect(mid.nextOffset).toBe(21)
    expect(mid.truncatedFromStart).toBe(false)

    const early = sliceProcessOutputBuffer(state, 0)
    expect(early.text).toBe('hello world')
    expect(early.truncatedFromStart).toBe(true)
  })
})
