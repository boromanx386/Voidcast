import { describe, expect, it } from 'vitest'
import {
  acquireWorkerFileLock,
  clampWorkerMaxRounds,
  CODING_WORKER_DEFAULT_ROUNDS,
  CODING_WORKER_MAX_ROUNDS,
  CODING_WORKER_MAX_TASKS,
  createWorkerFileLock,
  isPathInWorkerScope,
  normalizeWorkerPathKey,
  parseCodingWorkerTasks,
  pathFromWorkerToolArgs,
  releaseWorkerFileLocks,
  shellRedirectConflictsWithLock,
  shellRedirectTargets,
  synthesizeWorkerDigest,
} from '../src/lib/codingWorkers'
import { buildToolsList } from '../src/lib/toolDefinitions'
import type { ToolsEnabled } from '../src/lib/settings'

const baseTools: ToolsEnabled = {
  webSearch: false,
  youtube: false,
  reddit: false,
  weather: false,
  scrape: false,
  pdf: false,
  runwareImage: false,
  runwareMusic: false,
  coding: true,
  enterPlan: true,
}

describe('parseCodingWorkerTasks', () => {
  it('rejects empty and over-max tasks', () => {
    expect(parseCodingWorkerTasks({}).ok).toBe(false)
    expect(parseCodingWorkerTasks({ tasks: [] }).ok).toBe(false)
    expect(
      parseCodingWorkerTasks({
        tasks: [
          { goal: 'a' },
          { goal: 'b' },
          { goal: 'c' },
        ],
      }).ok,
    ).toBe(false)
  })

  it('accepts 1–2 valid tasks', () => {
    const one = parseCodingWorkerTasks({ tasks: [{ goal: 'fix auth', path_prefix: 'src/auth' }] })
    expect(one.ok).toBe(true)
    if (one.ok) {
      expect(one.tasks).toHaveLength(1)
      expect(one.tasks[0]!.pathPrefix).toBe('src/auth')
    }
    const two = parseCodingWorkerTasks({
      tasks: [{ goal: 'a' }, { goal: 'b', path_prefix: 'tests' }],
    })
    expect(two.ok).toBe(true)
    if (two.ok) expect(two.tasks).toHaveLength(CODING_WORKER_MAX_TASKS)
  })
})

describe('path scope + locks', () => {
  it('normalizes and scopes paths', () => {
    expect(normalizeWorkerPathKey('Src\\Auth\\x.ts')).toBe('src/auth/x.ts')
    expect(isPathInWorkerScope('src/auth/x.ts', 'src/auth')).toBe(true)
    expect(isPathInWorkerScope('src/other/y.ts', 'src/auth')).toBe(false)
    expect(isPathInWorkerScope('src/auth/x.ts', '')).toBe(true)
  })

  it('extracts path from mutation tools', () => {
    expect(pathFromWorkerToolArgs('write_file', { path: 'a.ts' })).toBe('a.ts')
    expect(pathFromWorkerToolArgs('edit_code', { path: 'b.ts' })).toBe('b.ts')
    expect(pathFromWorkerToolArgs('read_file', { path: 'c.ts' })).toBeNull()
  })

  it('serializes write locks across workers', () => {
    const batch = createWorkerFileLock()
    expect(acquireWorkerFileLock(batch, 'worker-1', 'src/a.ts')).toBeNull()
    expect(acquireWorkerFileLock(batch, 'worker-2', 'src/a.ts')).toMatch(/locked/)
    expect(acquireWorkerFileLock(batch, 'worker-1', 'src/a.ts')).toBeNull()
    releaseWorkerFileLocks(batch, 'worker-1')
    expect(acquireWorkerFileLock(batch, 'worker-2', 'src/a.ts')).toBeNull()
  })
})

describe('worker round budget helpers', () => {
  it('defaults and clamps max rounds', () => {
    expect(clampWorkerMaxRounds(undefined)).toBe(CODING_WORKER_DEFAULT_ROUNDS)
    expect(CODING_WORKER_DEFAULT_ROUNDS).toBe(100)
    expect(CODING_WORKER_MAX_ROUNDS).toBe(100)
    expect(clampWorkerMaxRounds(150)).toBe(CODING_WORKER_MAX_ROUNDS)
    expect(clampWorkerMaxRounds(1)).toBe(1)
  })

  it('synthesizes digest from trail when model never dones', () => {
    const d = synthesizeWorkerDigest({
      goal: 'Fix auth',
      pathPrefix: 'src/auth',
      notes: [],
      toolTrail: ['search_files', 'edit_code'],
      mutatedPaths: ['src/auth/login.ts'],
    })
    expect(d).toContain('src/auth/login.ts')
    expect(d).toContain('search_files')
    expect(d).toContain('round budget')
  })
})

describe('applyWorkerMutationsToMemo', () => {
  // Lazy import to avoid pulling react types at module load in the test setup.
  async function load() {
    return await import('../src/lib/codingWorkers')
  }

  it('records write_file into recentFiles, fileCache, and recentFileDigests', async () => {
    const { applyWorkerMutationsToMemo } = await load()
    const { emptyCodingContextMemo, emptyCodingFileCache } = await import(
      '../src/lib/codingContextMemo'
    )
    const memo = { current: emptyCodingContextMemo('proj') }
    const fileCache = { current: emptyCodingFileCache() }
    applyWorkerMutationsToMemo({
      memoRef: memo,
      fileCacheRef: fileCache,
      codingProjectPath: 'proj',
      mutations: [
        {
          tool: 'write_file',
          path: 'src/a.ts',
          args: { path: 'src/a.ts', content: 'export const x = 1\n' },
          result: 'Saved src/a.ts',
        },
      ],
    })
    expect(memo.current.recentFiles).toContain('src/a.ts (written)')
    expect(fileCache.current.entries.find((e) => e.path === 'src/a.ts')).toBeTruthy()
    expect(memo.current.recentFileDigests.find((d) => d.path === 'src/a.ts')).toBeTruthy()
  })

  it('invalidates cache + digest for edit_code (worker does not know final content)', async () => {
    const { applyWorkerMutationsToMemo } = await load()
    const {
      emptyCodingContextMemo,
      emptyCodingFileCache,
      upsertCodingFileCache,
      upsertFileDigest,
    } = await import('../src/lib/codingContextMemo')
    const fileCache = { current: upsertCodingFileCache(emptyCodingFileCache(), 'src/b.ts', 'old') }
    const memo = {
      current: {
        ...emptyCodingContextMemo('proj'),
        recentFileDigests: upsertFileDigest([], 'src/b.ts', 'old digest'),
      },
    }
    applyWorkerMutationsToMemo({
      memoRef: memo,
      fileCacheRef: fileCache,
      codingProjectPath: 'proj',
      mutations: [
        {
          tool: 'edit_code',
          path: 'src/b.ts',
          args: { path: 'src/b.ts', find_text: 'old', replace_text: 'new' },
          result: 'Edited src/b.ts',
        },
      ],
    })
    expect(fileCache.current.entries.find((e) => e.path === 'src/b.ts')).toBeFalsy()
    expect(memo.current.recentFileDigests.find((d) => d.path === 'src/b.ts')).toBeFalsy()
    expect(memo.current.recentFiles.some((f) => f.startsWith('src/b.ts'))).toBe(true)
  })

  it('skips failed mutations (result starts with Error:)', async () => {
    const { applyWorkerMutationsToMemo } = await load()
    const { emptyCodingContextMemo, emptyCodingFileCache } = await import(
      '../src/lib/codingContextMemo'
    )
    const memo = { current: emptyCodingContextMemo('proj') }
    const fileCache = { current: emptyCodingFileCache() }
    applyWorkerMutationsToMemo({
      memoRef: memo,
      fileCacheRef: fileCache,
      codingProjectPath: 'proj',
      mutations: [
        {
          tool: 'write_file',
          path: 'src/c.ts',
          args: { path: 'src/c.ts', content: 'x' },
          result: 'Error: write failed',
        },
      ],
    })
    expect(memo.current.recentFiles.length).toBe(0)
    expect(fileCache.current.entries.length).toBe(0)
  })

  it('applies multiple mutations serially without losing entries (no race)', async () => {
    const { applyWorkerMutationsToMemo } = await load()
    const { emptyCodingContextMemo, emptyCodingFileCache } = await import(
      '../src/lib/codingContextMemo'
    )
    const memo = { current: emptyCodingContextMemo('proj') }
    const fileCache = { current: emptyCodingFileCache() }
    applyWorkerMutationsToMemo({
      memoRef: memo,
      fileCacheRef: fileCache,
      codingProjectPath: 'proj',
      mutations: [
        {
          tool: 'write_file',
          path: 'src/a.ts',
          args: { path: 'src/a.ts', content: 'a' },
          result: 'Saved src/a.ts',
        },
        {
          tool: 'write_file',
          path: 'src/b.ts',
          args: { path: 'src/b.ts', content: 'b' },
          result: 'Saved src/b.ts',
        },
      ],
    })
    expect(memo.current.recentFiles).toContain('src/a.ts (written)')
    expect(memo.current.recentFiles).toContain('src/b.ts (written)')
    expect(fileCache.current.entries.length).toBe(2)
  })
})

describe('shell redirect lock guard', () => {
  it('detects redirect targets and conflicts with another worker lock', () => {
    const batch = createWorkerFileLock()
    expect(shellRedirectTargets('npm test > out.log')).toEqual(['out.log'])
    acquireWorkerFileLock(batch, 'worker-1', 'src/a.ts')
    const err = shellRedirectConflictsWithLock('echo x > src/a.ts', batch, 'worker-2')
    expect(err).toMatch(/conflicts with worker-1/)
    expect(shellRedirectConflictsWithLock('echo x > src/a.ts', batch, 'worker-1')).toBeNull()
  })
})

describe('buildToolsList team mode', () => {
  it('registers run_coding_workers in agent and team when coding sub is on (not plan)', () => {
    const team = buildToolsList(baseTools, false, {
      agentMode: 'team',
      subAgentCodingEnabled: true,
    }).map((t) => t.function.name)
    expect(team).toContain('run_coding_workers')
    expect(team).toContain('coding_explore')
    expect(team).not.toContain('enter_plan_mode')

    const agent = buildToolsList(baseTools, false, {
      agentMode: 'agent',
      subAgentCodingEnabled: true,
    }).map((t) => t.function.name)
    expect(agent).toContain('run_coding_workers')
    expect(agent).toContain('coding_explore')
    expect(agent).toContain('enter_plan_mode')

    const agentNoSub = buildToolsList(baseTools, false, {
      agentMode: 'agent',
      subAgentCodingEnabled: false,
    }).map((t) => t.function.name)
    expect(agentNoSub).not.toContain('run_coding_workers')
    expect(agentNoSub).not.toContain('coding_explore')

    const plan = buildToolsList(baseTools, false, {
      agentMode: 'plan',
      subAgentCodingEnabled: true,
    }).map((t) => t.function.name)
    expect(plan).not.toContain('run_coding_workers')
    expect(plan).not.toContain('write_file')
    expect(plan).not.toContain('enter_plan_mode')

    const ask = buildToolsList(baseTools, false, {
      agentMode: 'ask',
      subAgentCodingEnabled: true,
    }).map((t) => t.function.name)
    expect(ask).toContain('read_file')
    expect(ask).toContain('coding_explore')
    expect(ask).toContain('list_reminders')
    expect(ask).not.toContain('run_coding_workers')
    expect(ask).not.toContain('write_file')
    expect(ask).not.toContain('execute_command')
    expect(ask).not.toContain('enter_plan_mode')
    expect(ask).not.toContain('update_settings')
    expect(ask).not.toContain('update_plan_progress')
    expect(ask).not.toContain('generate_image')
  })
})
