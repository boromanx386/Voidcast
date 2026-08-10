/**
 * Team-mode coding workers — parallel nested agents on the coding sub-agent model.
 * Invoked by main chat LLM via run_coding_workers (max 2 concurrent tasks).
 */

import type { MutableRefObject } from 'react'
import type { SubAgentConfig } from '@/lib/settings'
import { subAgentConfigForRole, SUB_AGENT_DEFAULT_OUTPUT_TOKENS } from '@/lib/settings'
import {
  callSubAgentChat,
  type SubAgentKeys,
  type SubAgentUiCallbacks,
} from '@/lib/subAgent'
import {
  CODING_EXPLORE_ALLOWED_TOOLS,
  parseCodingExploreAction,
} from '@/lib/codingSubAgent'
import {
  invalidateCodingFileCache,
  isCodingToolFailure,
  normalizeCodingContextMemo,
  pushRecentUnique,
  removeFileDigest,
  upsertCodingFileCache,
  upsertFileDigest,
  type CodingContextMemo,
  type CodingFileCache,
} from '@/lib/codingContextMemo'
import { digestReadFile } from '@/lib/codingSubAgent'
import { formatEditedFileMemoEntry } from '@/lib/codingEol'

export const CODING_WORKER_MAX_TASKS = 2
/** Default tool rounds before forced digest. */
export const CODING_WORKER_DEFAULT_ROUNDS = 100
export const CODING_WORKER_MAX_ROUNDS = 100
export const CODING_WORKER_READ_BUDGET = 64_000

/** Explore tools + mutation tools (no nested team/explore recursion). */
export const CODING_WORKER_ALLOWED_TOOLS = new Set([
  ...CODING_EXPLORE_ALLOWED_TOOLS,
  'write_file',
  'edit_code',
  'execute_command',
])

export const CODING_WORKER_MUTATION_TOOLS = new Set(['write_file', 'edit_code'])

export type CodingWorkerTask = {
  goal: string
  pathPrefix?: string
  maxRounds?: number
}

export type CodingWorkerFileLock = {
  /** pathKey → workerId that holds the write lock */
  locked: Map<string, string>
  /** workerId → set of pathKeys acquired (for release) */
  owned: Map<string, Set<string>>
}

export function createWorkerFileLock(): CodingWorkerFileLock {
  return { locked: new Map(), owned: new Map() }
}

export function normalizeWorkerPathKey(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase()
}

/**
 * true if relPath is inside path_prefix (when set). Empty prefix = whole project.
 * path_prefix may be a file or directory; directory match allows prefix/child.
 */
export function isPathInWorkerScope(relPath: string, pathPrefix?: string): boolean {
  const path = normalizeWorkerPathKey(relPath)
  if (!path) return false
  const raw = (pathPrefix || '').trim()
  if (!raw) return true
  const prefix = normalizeWorkerPathKey(raw)
  if (!prefix) return true
  return path === prefix || path.startsWith(`${prefix}/`)
}

export function pathFromWorkerToolArgs(
  tool: string,
  args: Record<string, unknown>,
): string | null {
  if (tool !== 'write_file' && tool !== 'edit_code') return null
  const p = typeof args.path === 'string' ? args.path.trim() : ''
  return p || null
}

/** Acquire write lock; returns error message or null if ok. */
export function acquireWorkerFileLock(
  batch: CodingWorkerFileLock,
  workerId: string,
  pathKey: string,
): string | null {
  const key = normalizeWorkerPathKey(pathKey)
  if (!key) return 'Error: empty path for write lock.'
  const owner = batch.locked.get(key)
  if (owner && owner !== workerId) {
    return `Error: path "${pathKey}" is locked by ${owner}. Choose a different file or wait.`
  }
  batch.locked.set(key, workerId)
  let set = batch.owned.get(workerId)
  if (!set) {
    set = new Set()
    batch.owned.set(workerId, set)
  }
  set.add(key)
  return null
}

export function releaseWorkerFileLocks(batch: CodingWorkerFileLock, workerId: string): void {
  const set = batch.owned.get(workerId)
  if (!set) return
  for (const key of set) {
    if (batch.locked.get(key) === workerId) batch.locked.delete(key)
  }
  batch.owned.delete(workerId)
}

export function parseCodingWorkerTasks(
  args: Record<string, unknown>,
): { ok: true; tasks: CodingWorkerTask[] } | { ok: false; error: string } {
  const raw = args.tasks
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'Error: run_coding_workers requires a tasks array (1–2 items).' }
  }
  if (raw.length === 0) {
    return { ok: false, error: 'Error: run_coding_workers needs at least one task.' }
  }
  if (raw.length > CODING_WORKER_MAX_TASKS) {
    return {
      ok: false,
      error: `Error: run_coding_workers allows at most ${CODING_WORKER_MAX_TASKS} parallel tasks.`,
    }
  }
  const tasks: CodingWorkerTask[] = []
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i]
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: `Error: tasks[${i}] must be an object with goal.` }
    }
    const o = item as Record<string, unknown>
    const goal = typeof o.goal === 'string' ? o.goal.trim() : ''
    if (!goal) return { ok: false, error: `Error: tasks[${i}].goal is required.` }
    const pathPrefix =
      typeof o.path_prefix === 'string' && o.path_prefix.trim()
        ? o.path_prefix.trim()
        : undefined
    const maxRounds =
      typeof o.max_rounds === 'number' && Number.isFinite(o.max_rounds)
        ? o.max_rounds
        : undefined
    tasks.push({ goal, pathPrefix, maxRounds })
  }
  return { ok: true, tasks }
}

export function clampWorkerMaxRounds(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return CODING_WORKER_DEFAULT_ROUNDS
  return Math.max(1, Math.min(CODING_WORKER_MAX_ROUNDS, Math.round(raw)))
}

/** Build a usable digest when the model never emits {"done":true}. */
export function synthesizeWorkerDigest(opts: {
  goal: string
  pathPrefix?: string
  notes: string[]
  toolTrail: string[]
  mutatedPaths: string[]
}): string {
  const lines: string[] = [`Goal: ${opts.goal.slice(0, 400)}`]
  if (opts.pathPrefix) lines.push(`Scope: ${opts.pathPrefix}`)
  if (opts.mutatedPaths.length) {
    lines.push(`Files written/edited: ${[...new Set(opts.mutatedPaths)].join(', ')}`)
  } else {
    lines.push('Files written/edited: (none completed before round budget).')
  }
  if (opts.toolTrail.length) {
    lines.push(`Tools used: ${opts.toolTrail.slice(-12).join(' → ')}`)
  }
  if (opts.notes.length) lines.push(`Notes: ${opts.notes.join(' ')}`)
  lines.push(
    'Stopped at round budget without a structured done digest — main agent should verify with git_diff / read_file.',
  )
  return lines.join('\n').slice(0, 2500)
}

/**
 * A successful write_file/edit_code performed by a worker. Collected per-worker
 * and applied SERIALLY to the parent memo after Promise.all settles, so two
 * parallel workers cannot race on the shared codingContextMemoRef / file cache.
 */
export type WorkerMutation = {
  tool: 'write_file' | 'edit_code'
  path: string
  args: Record<string, unknown>
  result: string
}

export type WorkerRunResult = {
  digest: string
  mutations: WorkerMutation[]
}

/**
 * Apply a batch of worker mutations to the parent coding memo + file cache.
 * Pure (no I/O): reads/writes the refs the caller passes. Idempotent for the
 * same path (LRU front). Mirrors the write_file/edit_code branches of
 * applyAgentToolResult but stripped of UI side effects (terminal, reveal, etc.).
 */
export function applyWorkerMutationsToMemo(opts: {
  memoRef: MutableRefObject<CodingContextMemo>
  fileCacheRef: MutableRefObject<CodingFileCache>
  mutations: WorkerMutation[]
  codingProjectPath: string
}): void {
  if (opts.mutations.length === 0) return
  let memo = opts.memoRef.current
  let fileCache = opts.fileCacheRef.current
  for (const m of opts.mutations) {
    if (isCodingToolFailure(m.tool, m.result)) continue
    const filePath = m.path
    if (!filePath) continue

    if (m.tool === 'write_file') {
      const content = typeof m.args.content === 'string' ? m.args.content : ''
      if (content) {
        fileCache = upsertCodingFileCache(fileCache, filePath, content)
        memo = {
          ...memo,
          recentFileDigests: upsertFileDigest(
            memo.recentFileDigests ?? [],
            filePath,
            digestReadFile(content),
          ),
        }
      }
      memo = {
        ...memo,
        recentFiles: pushRecentUnique(memo.recentFiles, `${filePath} (written)`),
      }
    } else {
      // edit_code: worker does not know the final file content, so invalidate
      // the cache + digest for this path — next read_file will be full (not
      // soft-denied) and re-populate both.
      fileCache = invalidateCodingFileCache(fileCache, filePath)
      memo = {
        ...memo,
        recentFileDigests: removeFileDigest(memo.recentFileDigests ?? [], filePath),
        recentFiles: pushRecentUnique(
          memo.recentFiles,
          formatEditedFileMemoEntry(filePath, m.result),
        ),
      }
    }
  }
  memo = normalizeCodingContextMemo(memo, opts.codingProjectPath)
  opts.memoRef.current = memo
  opts.fileCacheRef.current = fileCache
}

function workerSystemPrompt(pathPrefix: string | undefined, recentFiles: string[]): string {
  const tools = [...CODING_WORKER_ALLOWED_TOOLS].join(', ')
  const prefixLine = pathPrefix
    ? `Hard scope: write_file/edit_code paths MUST stay under path_prefix "${pathPrefix}". Prefer that folder for search/glob/list too.`
    : 'Stay inside the coding project root. Coordinate with your sibling worker via disjoint files when possible.'
  const recent =
    recentFiles.length > 0
      ? `Recently touched files: ${recentFiles.slice(0, 8).join(', ')}.`
      : 'No recent files listed.'
  return `You are a coding worker sub-agent. Complete YOUR assigned goal only (do not reassign work).
Allowed tools only: ${tools}.
You MAY write_file, edit_code, and execute_command. Do NOT call run_coding_workers or coding_explore.

Each turn reply with ONE JSON object only (no prose outside JSON):
- Tool call: {"tool":"<name>","args":{...}}
- Finished: {"done":true,"digest":"<what you changed: paths, summary, how to verify>"}

Efficiency (critical — you have a limited number of rounds):
1. Map quickly (1–2 search/glob/find_symbols), then edit.
2. Prefer edit_code; avoid long explore loops.
3. After a successful write/edit that satisfies the goal, IMMEDIATELY respond with {"done":true,"digest":"..."} — do not keep searching.
4. If blocked, still finish with done=true and digest describing the blocker.

${prefixLine}
${recent}
Keep digests under 2500 characters.`
}

type WorkerRunOpts = {
  workerId: string
  workerLabel: string
  goal: string
  pathPrefix?: string
  maxRounds?: number
  recentFiles?: string[]
  config: SubAgentConfig
  keys: SubAgentKeys
  signal?: AbortSignal
  ui?: SubAgentUiCallbacks
  fileLocks: CodingWorkerFileLock
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>
}

async function runOneCodingWorker(opts: WorkerRunOpts): Promise<WorkerRunResult> {
  const goal = opts.goal.trim()
  if (!goal) return { digest: `${opts.workerLabel}: Error: missing goal.`, mutations: [] }

  const codingConfig = subAgentConfigForRole(opts.config, 'coding')
  const maxRounds = clampWorkerMaxRounds(opts.maxRounds)
  const pathPrefix = (opts.pathPrefix || '').trim() || undefined
  const recentFiles = opts.recentFiles ?? []
  let readBudget = CODING_WORKER_READ_BUDGET
  const notes: string[] = []
  const toolTrail: string[] = []
  const mutatedPaths: string[] = []
  const mutations: WorkerMutation[] = []
  let mutationSuccesses = 0

  opts.ui?.onCodingStart?.(`${opts.workerLabel} · 0/${maxRounds}`)

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: workerSystemPrompt(pathPrefix, recentFiles) },
    {
      role: 'user',
      content: `Goal: ${goal}${pathPrefix ? `\nPath prefix (required scope for writes): ${pathPrefix}` : ''}\n\nStart work. Reply with JSON only.`,
    },
  ]

  const finishWith = (body: string): WorkerRunResult => {
    const digest = `${opts.workerLabel}:\n${body}`
    opts.ui?.onCodingDone?.(digest)
    return { digest, mutations }
  }

  try {
    for (let round = 0; round < maxRounds; round++) {
      if (opts.signal?.aborted) {
        return finishWith(
          synthesizeWorkerDigest({
            goal,
            pathPrefix,
            notes: [...notes, 'Aborted.'],
            toolTrail,
            mutatedPaths,
          }),
        )
      }
      opts.ui?.onCodingStart?.(`${opts.workerLabel} · ${round + 1}/${maxRounds}`)

      const roundsLeft = maxRounds - round
      if (roundsLeft <= 2 && mutationSuccesses > 0) {
        messages.push({
          role: 'user',
          content:
            `${roundsLeft} round(s) left. Prefer {"done":true,"digest":"..."} now if the goal is mostly met. ` +
            `Do not start new broad searches.`,
        })
      } else if (roundsLeft === 1) {
        messages.push({
          role: 'user',
          content:
            'LAST round. You MUST reply with {"done":true,"digest":"..."} summarizing work or blockers. No more tools.',
        })
      }

      const reply = await callSubAgentChat({
        messages,
        config: codingConfig,
        keys: opts.keys,
        signal: opts.signal,
        maxTokens: Math.min(
          opts.config.outputTokens ?? SUB_AGENT_DEFAULT_OUTPUT_TOKENS,
          SUB_AGENT_DEFAULT_OUTPUT_TOKENS,
        ),
      })
      messages.push({ role: 'assistant', content: reply })

      const action = parseCodingExploreAction(reply)
      if (action.kind === 'done') {
        return finishWith(action.digest)
      }
      if (action.kind === 'invalid') {
        messages.push({
          role: 'user',
          content:
            'Invalid reply. Respond with either {"tool":"...","args":{...}} or {"done":true,"digest":"..."}.',
        })
        continue
      }

      // Last round: refuse tools, force structured finish.
      if (roundsLeft <= 1) {
        messages.push({
          role: 'user',
          content: 'No more tools. Reply ONLY {"done":true,"digest":"..."}.',
        })
        const forced = await callSubAgentChat({
          messages,
          config: codingConfig,
          keys: opts.keys,
          signal: opts.signal,
          maxTokens: Math.min(
            opts.config.outputTokens ?? SUB_AGENT_DEFAULT_OUTPUT_TOKENS,
            SUB_AGENT_DEFAULT_OUTPUT_TOKENS,
          ),
        })
        const forcedAction = parseCodingExploreAction(forced)
        if (forcedAction.kind === 'done') return finishWith(forcedAction.digest)
        if (forced.trim().length > 40) return finishWith(forced.trim())
        return finishWith(
          synthesizeWorkerDigest({ goal, pathPrefix, notes, toolTrail, mutatedPaths }),
        )
      }

      const { tool, args } = action.call
      if (!CODING_WORKER_ALLOWED_TOOLS.has(tool)) {
        messages.push({
          role: 'user',
          content: `Error: tool "${tool}" is not allowed for coding workers. Allowed: ${[...CODING_WORKER_ALLOWED_TOOLS].join(', ')}.`,
        })
        continue
      }

      if (tool === 'read_file' && readBudget <= 0) {
        notes.push('Read budget exhausted.')
        messages.push({
          role: 'user',
          content:
            'Error: nested read_file character budget exhausted. Finish with {"done":true,"digest":"..."}.',
        })
        continue
      }

      const execArgs = { ...args }
      if (
        pathPrefix &&
        (tool === 'search_files' || tool === 'glob_files' || tool === 'list_directory') &&
        typeof execArgs.path_prefix !== 'string' &&
        (tool === 'list_directory' ? typeof execArgs.path !== 'string' : true)
      ) {
        if (tool === 'list_directory' && !execArgs.path) {
          execArgs.path = pathPrefix
        } else if (tool !== 'list_directory' && !execArgs.path_prefix) {
          execArgs.path_prefix = pathPrefix
        }
      }

      if (CODING_WORKER_MUTATION_TOOLS.has(tool)) {
        const rel = pathFromWorkerToolArgs(tool, execArgs)
        if (!rel) {
          messages.push({
            role: 'user',
            content: `Error: ${tool} requires a path argument.`,
          })
          continue
        }
        if (!isPathInWorkerScope(rel, pathPrefix)) {
          messages.push({
            role: 'user',
            content: `Error: path "${rel}" is outside path_prefix "${pathPrefix}". Stay in scope.`,
          })
          continue
        }
        const lockErr = acquireWorkerFileLock(opts.fileLocks, opts.workerId, rel)
        if (lockErr) {
          messages.push({ role: 'user', content: lockErr })
          continue
        }
      }

      let result = await opts.executeTool(tool, execArgs)
      toolTrail.push(tool)

      const looksOk = !/^\s*error\s*:/i.test(result)
      if (CODING_WORKER_MUTATION_TOOLS.has(tool) && looksOk) {
        const rel = pathFromWorkerToolArgs(tool, execArgs)
        if (rel) {
          mutatedPaths.push(rel)
          mutations.push({
            tool: tool as 'write_file' | 'edit_code',
            path: rel,
            args: execArgs,
            result,
          })
        }
        mutationSuccesses += 1
      }

      if (tool === 'read_file') {
        if (result.length > readBudget) {
          result = `${result.slice(0, readBudget)}\n…[truncated for worker budget]`
          readBudget = 0
        } else {
          readBudget -= result.length
        }
      }

      const MAX_TOOL_CHARS = 12_000
      if (result.length > MAX_TOOL_CHARS) {
        result = `${result.slice(0, MAX_TOOL_CHARS)}\n…[truncated for worker context]`
      }

      const afterMutationNudge =
        CODING_WORKER_MUTATION_TOOLS.has(tool) && looksOk
          ? '\n\nIf the goal is satisfied by this edit, reply next with {"done":true,"digest":"..."} instead of more tools.'
          : ''

      messages.push({
        role: 'user',
        content: `Tool ${tool} result:\n${result}${afterMutationNudge}`,
      })
    }

    // Forced final digest after budget (same idea as coding_explore).
    messages.push({
      role: 'user',
      content:
        'Max rounds reached. STOP calling tools. Reply ONLY with {"done":true,"digest":"..."} ' +
        'listing files changed and verification tips. If nothing was written, say so and what blocked you.',
    })
    try {
      const finalReply = await callSubAgentChat({
        messages,
        config: codingConfig,
        keys: opts.keys,
        signal: opts.signal,
        maxTokens: Math.min(
          opts.config.outputTokens ?? SUB_AGENT_DEFAULT_OUTPUT_TOKENS,
          SUB_AGENT_DEFAULT_OUTPUT_TOKENS,
        ),
      })
      const action = parseCodingExploreAction(finalReply)
      if (action.kind === 'done') return finishWith(action.digest)
      if (finalReply.trim().length > 40) return finishWith(finalReply.trim())
    } catch {
      // fall through to synthesized digest
    }

    return finishWith(
      synthesizeWorkerDigest({ goal, pathPrefix, notes, toolTrail, mutatedPaths }),
    )
  } finally {
    releaseWorkerFileLocks(opts.fileLocks, opts.workerId)
  }
}

export type RunCodingWorkersOpts = {
  tasks: CodingWorkerTask[]
  recentFiles?: string[]
  config: SubAgentConfig
  keys: SubAgentKeys
  signal?: AbortSignal
  ui?: SubAgentUiCallbacks
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>
  /**
   * Parent turn memo ref. When provided, worker write/edit mutations are
   * applied SERIALLY after Promise.all settles (no race with sibling workers)
   * so subsequent turns see accurate recentFiles / recentFileDigests / file
   * cache for worker edits. Without this, worker edits are invisible to the
   * parent memo and the next read_file can be soft-denied due to stale digest.
   */
  codingContextMemoRef?: MutableRefObject<CodingContextMemo>
  codingFileCacheRef?: MutableRefObject<CodingFileCache>
  codingProjectPath?: string
}

/**
 * Run 1–2 coding workers in parallel; returns a combined report for the main agent.
 */
export async function runCodingWorkers(opts: RunCodingWorkersOpts): Promise<string> {
  const tasks = opts.tasks.slice(0, CODING_WORKER_MAX_TASKS)
  if (tasks.length === 0) return 'Error: no tasks to run.'

  const fileLocks = createWorkerFileLock()
  const n = tasks.length
  opts.ui?.onCodingStart?.(
    n === 1 ? 'WORKER 1 · starting' : `WORKERS 1–${n} · starting in parallel`,
  )

  const settled: WorkerRunResult[] = await Promise.all(
    tasks.map((task, i) => {
      const workerId = `worker-${i + 1}`
      const workerLabel = `WORKER ${i + 1}`
      return runOneCodingWorker({
        workerId,
        workerLabel,
        goal: task.goal,
        pathPrefix: task.pathPrefix,
        maxRounds: task.maxRounds,
        recentFiles: opts.recentFiles,
        config: opts.config,
        keys: opts.keys,
        signal: opts.signal,
        ui: opts.ui,
        fileLocks,
        executeTool: opts.executeTool,
      }).catch((e): WorkerRunResult => {
        const msg = e instanceof Error ? e.message : String(e)
        return { digest: `${workerLabel}: Error: ${msg}`, mutations: [] }
      })
    }),
  )

  // Apply all worker mutations to the parent memo SERIALLY (after Promise.all)
  // so parallel workers cannot race on the shared codingContextMemoRef / file
  // cache. Without this, two workers editing in parallel could lost-update
  // the memo (last write wins) and leave recentFileDigests inconsistent.
  if (opts.codingContextMemoRef && opts.codingFileCacheRef) {
    const allMutations = settled.flatMap((s) => s.mutations)
    if (allMutations.length > 0) {
      applyWorkerMutationsToMemo({
        memoRef: opts.codingContextMemoRef,
        fileCacheRef: opts.codingFileCacheRef,
        mutations: allMutations,
        codingProjectPath: (opts.codingProjectPath || '').trim(),
      })
    }
  }

  const report = [
    `Coding workers finished (${settled.length}):`,
    ...settled.map((s) => `---\n${s.digest}`),
  ].join('\n')
  opts.ui?.onCodingDone?.(report.length > 4000 ? `${report.slice(0, 4000)}…` : report)
  return report
}
