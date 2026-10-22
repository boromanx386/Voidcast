import { describe, expect, it } from 'vitest'
import {
  acquireWorkerFileLock,
  buildCodingWorkersReport,
  buildWorkerContextPacket,
  buildWorkerInjection,
  clampWorkerMaxRounds,
  CODING_WORKER_ALLOWED_TOOLS,
  CODING_WORKER_BLOCKER_MAX_CHARS,
  CODING_WORKER_TOOL_RESULT_MAX_CHARS,
  CODING_WORKER_VERIFY_MAX_CHARS,
  clipVerificationOutput,
  clipWorkerToolResult,
  CODING_WORKER_DEFAULT_ROUNDS,
  CODING_WORKER_DIGEST_MAX_CHARS,
  CODING_WORKER_MAX_ROUNDS,
  CODING_WORKER_MAX_TASKS,
  createWorkerFileLock,
  formatWorkerDigest,
  isPathInWorkerScope,
  newSiblingActivityText,
  normalizeWorkerPathKey,
  parseCodingWorkerTasks,
  pathFromWorkerToolArgs,
  releaseWorkerFileLocks,
  runWorkerTypeCheck,
  shellRedirectConflictsWithLock,
  shellRedirectTargets,
  synthesizeWorkerDigest,
  workerScopesOverlap,
  workerToolTarget,
  type WorkerBlackboard,
  type WorkerBlackboardEntry,
  type WorkerRunResult,
  type WorkerTypeCheckResult,
} from '../src/lib/codingWorkers'
import { createWorkerSteerQueue, pushWorkerSteer } from '../src/lib/workerSteer'
import { buildToolsList } from '../src/lib/toolDefinitions'
import type { ToolsEnabled } from '../src/lib/settings'

const baseTools: ToolsEnabled = {
  webSearch: false,
  youtube: false,
  weather: false,
  scrape: false,
  pdf: false,
  runwareImage: false,
  runwareMusic: false,
  tts: false,
  coding: true,
  enterPlan: true,
}

describe('parseCodingWorkerTasks', () => {
  it('rejects empty and over-max tasks', () => {
    expect(parseCodingWorkerTasks({}).ok).toBe(false)
    expect(parseCodingWorkerTasks({ tasks: [] }).ok).toBe(false)
    expect(
      parseCodingWorkerTasks({
        tasks: [{ goal: 'a' }, { goal: 'b' }, { goal: 'c' }],
      }).ok,
    ).toBe(false)
  })

  it('accepts 1–2 valid tasks', () => {
    const one = parseCodingWorkerTasks({
      tasks: [
        {
          goal: 'fix auth',
          path_prefix: 'src/auth',
          success_criteria: 'login succeeds and auth tests pass',
          focus_paths: ['src/auth/login.ts', 'src/auth/login.ts', ''],
        },
      ],
    })
    expect(one.ok).toBe(true)
    if (one.ok) {
      expect(one.tasks).toHaveLength(1)
      expect(one.tasks[0]!.pathPrefix).toBe('src/auth')
      expect(one.tasks[0]!.successCriteria).toContain('auth tests')
      expect(one.tasks[0]!.focusPaths).toEqual(['src/auth/login.ts'])
    }
    const two = parseCodingWorkerTasks({
      tasks: [
        { goal: 'a', path_prefix: 'src' },
        { goal: 'b', path_prefix: 'tests' },
      ],
    })
    expect(two.ok).toBe(true)
    if (two.ok) expect(two.tasks).toHaveLength(CODING_WORKER_MAX_TASKS)
  })

  it('rejects parallel tasks without disjoint scopes', () => {
    const missing = parseCodingWorkerTasks({ tasks: [{ goal: 'a' }, { goal: 'b' }] })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toMatch(/disjoint path_prefix/)

    const overlapping = parseCodingWorkerTasks({
      tasks: [
        { goal: 'a', path_prefix: 'src' },
        { goal: 'b', path_prefix: 'src/providers' },
      ],
    })
    expect(overlapping.ok).toBe(false)
    if (!overlapping.ok) expect(overlapping.error).toMatch(/scopes overlap/)
  })
})

describe('worker context packet', () => {
  it('carries the active request, plan findings, and memo digests compactly', () => {
    const packet = buildWorkerContextPacket({
      userText: 'Remove the legacy provider and keep the remaining providers working.',
      activePlan: {
        title: 'Remove legacy provider',
        summary: 'Delete registration and update tests.',
        status: 'approved',
        steps: [
          { id: '1', text: 'Remove provider registration' },
          { id: '2', text: 'Update provider tests', done: true },
        ],
        research: {
          keyFiles: ['src/providers.ts'],
          findings: 'Provider is registered in one central map.',
          searches: ['legacyProvider'],
        },
      },
      memo: {
        projectPath: 'Q:/coding/vst',
        lastDirectory: 'src',
        recentFiles: ['src/providers.ts'],
        recentSearches: ['legacyProvider'],
        recentCommands: [],
        recentGitOps: [],
        recentFailures: [],
        lastTurnSummary: 'Plan research completed.',
        recentFileDigests: [{ path: 'src/providers.ts', digest: 'central provider map' }],
      },
    })
    expect(packet).toContain('Main user request: Remove the legacy provider')
    expect(packet).toContain('Active build plan: Remove legacy provider')
    expect(packet).toContain('Plan key files: src/providers.ts')
    expect(packet).toContain('src/providers.ts: central provider map')
  })
})

describe('path scope + locks', () => {
  it('normalizes and scopes paths', () => {
    expect(normalizeWorkerPathKey('Src\\Auth\\x.ts')).toBe('src/auth/x.ts')
    expect(isPathInWorkerScope('src/auth/x.ts', 'src/auth')).toBe(true)
    expect(isPathInWorkerScope('src/other/y.ts', 'src/auth')).toBe(false)
    expect(isPathInWorkerScope('src/auth/x.ts', '')).toBe(true)
    expect(workerScopesOverlap('src/auth', 'src/auth/login.ts')).toBe(true)
    expect(workerScopesOverlap('src/auth', 'src/providers')).toBe(false)
    expect(workerScopesOverlap('src/auth', undefined)).toBe(true)
  })

  it('blocks path traversal and absolute paths outside the worker scope', () => {
    // `..` that climbs out of the scope must not match the prefix.
    expect(isPathInWorkerScope('src/../package.json', 'src')).toBe(false)
    expect(isPathInWorkerScope('src/auth/../../package.json', 'src/auth')).toBe(false)
    expect(isPathInWorkerScope('../outside.ts', '')).toBe(false)
    expect(isPathInWorkerScope('../src/auth/x.ts', 'src/auth')).toBe(false)
    // Absolute POSIX and Windows drive paths are never in scope.
    expect(isPathInWorkerScope('/etc/passwd', 'src')).toBe(false)
    expect(isPathInWorkerScope('C:\\Users\\x.ts', '')).toBe(false)
    expect(isPathInWorkerScope('C:/Users/x.ts', 'src')).toBe(false)
    // `..` that stays inside the scope is still allowed.
    expect(isPathInWorkerScope('src/auth/sub/../x.ts', 'src/auth')).toBe(true)
    expect(normalizeWorkerPathKey('src/auth/sub/../x.ts')).toBe('src/auth/x.ts')
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
    expect(d).toContain('Ended without a structured final summary')
  })

  it('reports round budget when the worker wrote nothing', () => {
    const d = synthesizeWorkerDigest({
      goal: 'Fix auth',
      pathPrefix: 'src/auth',
      notes: [],
      toolTrail: ['search_files'],
      mutatedPaths: [],
      stopReason: 'Stopped at round budget.',
    })
    expect(d).toContain('round budget')
    expect(d).toContain('Stopped at round budget.')
  })
})

describe('applyWorkerMutationsToMemo', () => {
  // Lazy import to avoid pulling react types at module load in the test setup.
  async function load() {
    return await import('../src/lib/codingWorkers')
  }

  it('records write_file into recentFiles, fileCache, and recentFileDigests', async () => {
    const { applyWorkerMutationsToMemo } = await load()
    const { emptyCodingContextMemo, emptyCodingFileCache } =
      await import('../src/lib/codingContextMemo')
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
    const { emptyCodingContextMemo, emptyCodingFileCache } =
      await import('../src/lib/codingContextMemo')
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
    const { emptyCodingContextMemo, emptyCodingFileCache } =
      await import('../src/lib/codingContextMemo')
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

describe('worker allowed tools', () => {
  it('lets a worker stop the processes it started', () => {
    expect(CODING_WORKER_ALLOWED_TOOLS.has('stop_process')).toBe(true)
    expect(CODING_WORKER_ALLOWED_TOOLS.has('execute_command')).toBe(true)
    expect(CODING_WORKER_ALLOWED_TOOLS.has('list_processes')).toBe(true)
  })
})

describe('newSiblingActivityText', () => {
  const entries: WorkerBlackboardEntry[] = [
    { worker: 'WORKER 1', path: 'src/a.ts' },
    { worker: 'WORKER 2', path: 'src/b.ts' },
  ]

  it('shows only sibling changes and advances the cursor', () => {
    const first = newSiblingActivityText(entries, 0, 'WORKER 1')
    expect(first.text).toContain('WORKER 2 changed src/b.ts')
    expect(first.text).not.toContain('WORKER 1 changed')
    expect(first.nextCount).toBe(2)
  })

  it('returns nothing when there is no new sibling activity', () => {
    const none = newSiblingActivityText(entries, 2, 'WORKER 1')
    expect(none.text).toBe('')
    expect(none.nextCount).toBe(2)
    const onlyOwn = newSiblingActivityText([{ worker: 'WORKER 1', path: 'x.ts' }], 0, 'WORKER 1')
    expect(onlyOwn.text).toBe('')
    expect(onlyOwn.nextCount).toBe(1)
  })
})

describe('buildWorkerInjection', () => {
  const blackboard: WorkerBlackboard = {
    entries: [
      { worker: 'WORKER 1', path: 'src/a.ts' },
      { worker: 'WORKER 2', path: 'src/b.ts' },
    ],
  }

  it('combines sibling activity with drained steers and reports them once', () => {
    const queue = createWorkerSteerQueue()
    pushWorkerSteer(queue, 'prefer the existing helper')
    const drained: Array<[string, string]> = []
    const first = buildWorkerInjection({
      blackboard,
      blackboardSeen: 0,
      workerLabel: 'WORKER 1',
      steerQueue: queue,
      onSteerDrained: (label, correction) => drained.push([label, correction]),
    })
    expect(first.text).toContain('WORKER 2 changed src/b.ts')
    expect(first.text).toContain('prefer the existing helper')
    expect(first.text).toContain('[Steer — user course correction while you work]')
    expect(first.nextCount).toBe(2)
    expect(first.nextSteerCount).toBe(1)
    expect(drained).toEqual([['WORKER 1', 'prefer the existing helper']])

    const second = buildWorkerInjection({
      blackboard,
      blackboardSeen: first.nextCount,
      workerLabel: 'WORKER 1',
      steerQueue: queue,
      steerSeen: first.nextSteerCount,
    })
    expect(second.text).toBe('')
    expect(second.nextCount).toBe(2)
    expect(second.nextSteerCount).toBe(1)
  })

  it('delivers a steer to every worker, not just the first to ask', () => {
    const queue = createWorkerSteerQueue()
    pushWorkerSteer(queue, 'stop touching the config')
    const w1 = buildWorkerInjection({
      blackboardSeen: 0,
      workerLabel: 'WORKER 1',
      steerQueue: queue,
      steerSeen: 0,
    })
    const w2 = buildWorkerInjection({
      blackboardSeen: 0,
      workerLabel: 'WORKER 2',
      steerQueue: queue,
      steerSeen: 0,
    })
    expect(w1.text).toContain('stop touching the config')
    expect(w2.text).toContain('stop touching the config')
  })

  it('a batch started later does not replay older steers', () => {
    const queue = createWorkerSteerQueue()
    pushWorkerSteer(queue, 'old advice')
    const late = buildWorkerInjection({
      blackboardSeen: 0,
      workerLabel: 'WORKER 1',
      steerQueue: queue,
      steerSeen: queue.entries.length,
    })
    expect(late.text).toBe('')
  })

  it('returns an empty injection when nothing new is available', () => {
    const none = buildWorkerInjection({ blackboardSeen: 0, workerLabel: 'WORKER 1' })
    expect(none).toEqual({ text: '', nextCount: 0, nextSteerCount: 0 })
  })
})

describe('workerToolTarget', () => {
  it('labels a tool call with its file, query, or command', () => {
    expect(workerToolTarget('edit_code', { path: 'src/lib/x.ts' })).toBe('src/lib/x.ts')
    expect(workerToolTarget('search_files', { query: 'runCodingWorkers' })).toBe('runCodingWorkers')
    expect(workerToolTarget('execute_command', { command: 'npm\n  test' })).toBe('npm test')
    expect(workerToolTarget('list_processes', {})).toBe('')
  })

  it('truncates long targets to keep the status line compact', () => {
    const long = 'a'.repeat(200)
    const target = workerToolTarget('read_file', { path: long })
    expect(target.length).toBeLessThanOrEqual(80)
    expect(target.endsWith('…')).toBe(true)
  })
})

describe('runWorkerTypeCheck', () => {
  type Call = { name: string; args: Record<string, unknown> }

  function makeExec(report: (prefix: string | undefined) => string): {
    exec: (name: string, args: Record<string, unknown>) => Promise<string>
    calls: Call[]
  } {
    const calls: Call[] = []
    const exec = async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      if (name !== 'check_types') return 'ok'
      return report(args.path_prefix as string | undefined)
    }
    return { exec, calls }
  }

  it('checks each package once and reports clean', async () => {
    const { exec, calls } = makeExec((prefix) =>
      prefix === 'electron-app'
        ? 'No TypeScript errors found (electron-app).'
        : 'Error: No tsconfig.json in pkg. Set path_prefix to the package folder.',
    )
    const res = await runWorkerTypeCheck(['electron-app/src/lib/x.ts'], exec)
    expect(res.verified).toContain('check_types: clean (electron-app)')
    expect(res.failures).toEqual([])
    const final = calls.at(-1)
    expect(final?.args.path_prefix).toBe('electron-app')
    expect(final?.args.paths).toEqual(['src/lib/x.ts'])
  })

  it('reports errors as failures', async () => {
    const { exec } = makeExec((prefix) =>
      prefix === 'electron-app'
        ? 'TypeScript (electron-app): 2 errors.\n\nsrc/a.ts:1:1 — TS1: bad'
        : 'Error: No tsconfig.json in pkg.',
    )
    const res = await runWorkerTypeCheck(['electron-app/src/a.ts'], exec)
    expect(res.verified).toEqual([])
    expect(res.failures).toContain('check_types: 2 error(s) in electron-app')
  })

  it('marks paths with no check target as skipped', async () => {
    const { exec } = makeExec(() => 'Error: No check target in repo.')
    const res = await runWorkerTypeCheck(['src/a.ts'], exec)
    expect(res.verified).toEqual([])
    expect(res.failures).toEqual([])
    expect(res.skipped?.[0]).toMatch(/check_types skipped for src\/a\.ts/)
  })

  it('does nothing when no files were written', async () => {
    const { exec, calls } = makeExec(() => 'No TypeScript errors found (root).')
    const res = await runWorkerTypeCheck([], exec)
    expect(res).toEqual({ verified: [], failures: [] })
    expect(calls).toHaveLength(0)
  })
})

describe('worker report shaping', () => {
  const verificationOf = (verified: string[], failures: string[]): WorkerTypeCheckResult => ({
    verified,
    failures,
  })

  it('caps model prose and keeps typecheck verdicts while dropping raw diagnostics', () => {
    const digest = formatWorkerDigest({
      workerLabel: 'WORKER 1',
      body: 'A'.repeat(CODING_WORKER_DIGEST_MAX_CHARS + 900),
      verification: verificationOf(['check_types: clean (electron-app)'], []),
    })
    expect(digest.startsWith('WORKER 1:')).toBe(true)
    expect(digest.endsWith('…\nVerification: check_types: clean (electron-app)')).toBe(true)
    expect(digest.length).toBeLessThan(CODING_WORKER_DIGEST_MAX_CHARS + 200)
  })

  it('leaves a short digest untouched and omits the verification line when silent', () => {
    const digest = formatWorkerDigest({
      workerLabel: 'WORKER 2',
      body: 'Changed: a.ts\nVerified: tests pass\nBlocked: none',
      verification: verificationOf([], []),
    })
    expect(digest).toBe('WORKER 2:\nChanged: a.ts\nVerified: tests pass\nBlocked: none')
    expect(digest).not.toContain('…')
  })

  it('builds a compact report: file list, single-line JSON, clipped blockers', () => {
    const run: WorkerRunResult = {
      digest: 'WORKER 1:\nChanged: src/a.ts',
      mutations: [{ tool: 'write_file', path: 'src/a.ts', args: {}, result: 'Wrote src/a.ts' }],
      structured: {
        worker: 'WORKER 1',
        goal: 'g',
        changed: ['src/a.ts'],
        verified: ['check_types: clean (electron-app)'],
        failed: [],
        blockers: [`read_file: ${'e'.repeat(400)}`],
      },
    }
    const report = buildCodingWorkersReport([run])
    expect(report).toContain('Files touched by workers (1): src/a.ts')
    expect(report).toContain('---\nWORKER 1:\nChanged: src/a.ts')
    expect(report).toContain('```json\n[{')
    const fenced = report.match(/```json\n([\s\S]*?)\n```/)?.[1] ?? ''
    expect(fenced).not.toContain('\n')
    const parsed = JSON.parse(fenced) as Array<{ blockers: string[] }>
    expect(parsed[0]!.blockers[0]!.length).toBe(CODING_WORKER_BLOCKER_MAX_CHARS + 1)
    expect(parsed[0]!.blockers[0]!.endsWith('…')).toBe(true)
  })

  it('reports no structured block when the workers produced none', () => {
    const report = buildCodingWorkersReport([{ digest: 'WORKER 1:\nError: boom', mutations: [] }])
    expect(report).toContain('Files touched by workers: none.')
    expect(report).not.toContain('```json')
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

  it('exposes worker success criteria and focus paths in the task schema', () => {
    const workerTool = buildToolsList(baseTools, false, {
      agentMode: 'team',
      subAgentCodingEnabled: true,
    }).find((t) => t.function.name === 'run_coding_workers')
    const properties = (workerTool?.function.parameters as { properties?: Record<string, unknown> })
      ?.properties
    const taskSchema = (
      properties?.tasks as {
        items?: { properties?: Record<string, unknown>; required?: string[] }
      }
    )?.items
    const taskProperties = taskSchema?.properties
    expect(taskProperties).toHaveProperty('success_criteria')
    expect(taskProperties).toHaveProperty('focus_paths')
    expect(taskSchema?.required).toContain('success_criteria')
  })
})

describe('clipWorkerToolResult', () => {
  const max = CODING_WORKER_TOOL_RESULT_MAX_CHARS

  it('leaves short results alone', () => {
    expect(clipWorkerToolResult('execute_command', 'ok')).toBe('ok')
  })

  it('keeps the head of a file', () => {
    const file = `START${'x'.repeat(max * 2)}END`
    const out = clipWorkerToolResult('read_file', file)
    expect(out.startsWith('START')).toBe(true)
    expect(out).not.toContain('END')
    expect(out).toContain('truncated for worker context')
  })

  it('keeps the tail of command output, where errors and exit status live', () => {
    const output = `HEAD${'x'.repeat(max * 3)}error TS2322: boom
exit status 2`
    const out = clipWorkerToolResult('execute_command', output)
    expect(out.startsWith('HEAD')).toBe(true)
    expect(out).toContain('exit status 2')
    expect(out).toContain('chars omitted')
    expect(out.length).toBeLessThan(max + 80)
  })
})

describe('clipVerificationOutput', () => {
  it('caps raw verification output and says how to get the rest', () => {
    const out = clipVerificationOutput('d'.repeat(CODING_WORKER_VERIFY_MAX_CHARS + 500))
    expect(out.length).toBeLessThan(CODING_WORKER_VERIFY_MAX_CHARS + 120)
    expect(out).toContain('500 more chars')
    expect(clipVerificationOutput('short')).toBe('short')
  })
})
