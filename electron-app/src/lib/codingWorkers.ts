/**
 * Team-mode coding workers — parallel nested agents on the coding sub-agent model.
 * Invoked by main chat LLM via run_coding_workers (max 2 concurrent tasks).
 */

import type { MutableRefObject } from 'react'
import type { SubAgentConfig } from '@/lib/settings'
import { subAgentConfigForRole, SUB_AGENT_DEFAULT_OUTPUT_TOKENS } from '@/lib/settings'
import { detectSubAgentProvider } from '@/lib/cloudLlmPresets'
import type { PlanArtifact } from '@/types/chat'
import { type SubAgentKeys, type SubAgentUiCallbacks } from '@/lib/subAgent'
import { CODING_EXPLORE_ALLOWED_TOOLS } from '@/lib/codingSubAgent'
import { runSharedToolLoop } from '@/lib/agentToolLoop'
import { buildToolsList, type AgentToolDefinition } from '@/lib/toolDefinitions'
import {
  callNativeSubAgentToolRound,
  type NativeSubAgentMessage,
  type NativeSubAgentToolCall,
} from '@/lib/subAgentToolLoop'
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
import {
  drainWorkerSteer,
  formatWorkerSteerMessage,
  type WorkerSteerQueue,
} from '@/lib/workerSteer'

export const CODING_WORKER_MAX_TASKS = 2
/** Default tool rounds before forced digest. */
export const CODING_WORKER_DEFAULT_ROUNDS = 100
export const CODING_WORKER_MAX_ROUNDS = 100
/**
 * Total characters a single worker may pull through read_file across its whole
 * run. Workers are often told to "read the packet in full first", so this must
 * comfortably cover the instruction/spec files plus the target source. Once it
 * is spent, read_file soft-stops with explicit guidance (see executeWorkerTool)
 * instead of hard-failing and letting the model spin on retries until the round
 * budget runs out with nothing written.
 */
export const CODING_WORKER_READ_BUDGET = 160_000

/**
 * Per-worker prose digest cap for the batch report returned to the main agent.
 * Worker summaries are model-written and unbounded, and every round after the
 * batch re-sends the report — so detail beyond this is re-fetched on demand
 * (`git_diff` / `read_file`) instead of riding in main's context.
 */
export const CODING_WORKER_DIGEST_MAX_CHARS = 1_500
/** Blocker notes are raw tool-error snippets — clip them before they enter the report. */
export const CODING_WORKER_BLOCKER_MAX_CHARS = 160

/**
 * Explore tools + mutation tools (no nested team/explore recursion).
 * `stop_process` is included so a worker that starts a long-running command
 * (dev server, watcher) can clean it up itself instead of leaking a process.
 */
export const CODING_WORKER_ALLOWED_TOOLS = new Set([
  ...CODING_EXPLORE_ALLOWED_TOOLS,
  'write_file',
  'edit_code',
  'execute_command',
  'stop_process',
])

export const CODING_WORKER_MUTATION_TOOLS = new Set(['write_file', 'edit_code'])

export type CodingWorkerTask = {
  goal: string
  pathPrefix?: string
  successCriteria?: string
  focusPaths?: string[]
  maxRounds?: number
}

/** Read-only context packet copied from the parent turn into each worker prompt. */
export type CodingWorkerContext = {
  userText?: string
  memo?: CodingContextMemo
  activePlan?: PlanArtifact
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

/**
 * Normalize a relative path for scope/lock comparisons.
 * Resolves `.` and `..` segments. A `..` that would climb above the project
 * root is kept as a leading `..` so it can never match a scope prefix.
 */
export function normalizeWorkerPathKey(path: string): string {
  const out: string[] = []
  for (const seg of path.trim().replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
      else out.push('..')
      continue
    }
    out.push(seg)
  }
  return out.join('/').toLowerCase()
}

/** True if the raw path is absolute (POSIX `/…` or Windows drive `C:…`) or escapes the root via `..`. */
function isEscapingWorkerPath(relPath: string): boolean {
  const raw = relPath.trim().replace(/\\/g, '/')
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) return true
  const key = normalizeWorkerPathKey(raw)
  return key === '..' || key.startsWith('../')
}

/**
 * true if relPath is inside path_prefix (when set). Empty prefix = whole project.
 * path_prefix may be a file or directory; directory match allows prefix/child.
 */
export function isPathInWorkerScope(relPath: string, pathPrefix?: string): boolean {
  if (isEscapingWorkerPath(relPath)) return false
  const path = normalizeWorkerPathKey(relPath)
  if (!path) return false
  const raw = (pathPrefix || '').trim()
  if (!raw) return true
  const prefix = normalizeWorkerPathKey(raw)
  if (!prefix) return true
  return path === prefix || path.startsWith(`${prefix}/`)
}

/** Conservative overlap check for two worker write scopes. */
export function workerScopesOverlap(left?: string, right?: string): boolean {
  const a = normalizeWorkerPathKey(left || '')
  const b = normalizeWorkerPathKey(right || '')
  // An unscoped parallel worker can touch anything, so it overlaps by default.
  if (!a || !b) return true
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

export function pathFromWorkerToolArgs(tool: string, args: Record<string, unknown>): string | null {
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

/** Shell redirect targets from execute_command (best-effort; does not parse all shells). */
export function shellRedirectTargets(command: string): string[] {
  const targets: string[] = []
  const re = /(?:^|[\s;&|])(?:\d*>>?)\s*([^\s&|;'"`]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(command)) !== null) {
    const raw = (m[1] || '').trim()
    if (!raw) continue
    if (raw === '/dev/null' || raw === 'nul') continue
    targets.push(raw)
  }
  return targets
}

/** True when a shell redirect would write to a path locked by another worker. */
export function shellRedirectConflictsWithLock(
  command: string,
  fileLocks: CodingWorkerFileLock,
  workerId: string,
): string | null {
  for (const target of shellRedirectTargets(command)) {
    const key = normalizeWorkerPathKey(target)
    if (!key) continue
    const owner = fileLocks.locked.get(key)
    if (owner && owner !== workerId) {
      return `Error: shell redirect to "${target}" conflicts with ${owner}'s file lock.`
    }
  }
  return null
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
      typeof o.path_prefix === 'string' && o.path_prefix.trim() ? o.path_prefix.trim() : undefined
    const successCriteria =
      typeof o.success_criteria === 'string' && o.success_criteria.trim()
        ? o.success_criteria.trim()
        : undefined
    const focusPaths = Array.isArray(o.focus_paths)
      ? [
          ...new Set(
            o.focus_paths
              .filter((p): p is string => typeof p === 'string')
              .map((p) => p.trim())
              .filter(Boolean),
          ),
        ].slice(0, 8)
      : undefined
    const maxRounds =
      typeof o.max_rounds === 'number' && Number.isFinite(o.max_rounds) ? o.max_rounds : undefined
    tasks.push({ goal, pathPrefix, successCriteria, focusPaths, maxRounds })
  }
  const dispatchError = validateCodingWorkerDispatch(tasks)
  if (dispatchError) return { ok: false, error: dispatchError }
  return { ok: true, tasks }
}

export function validateCodingWorkerDispatch(tasks: CodingWorkerTask[]): string | null {
  if (tasks.length <= 1) return null
  const unscoped = tasks.findIndex((task) => !task.pathPrefix)
  if (unscoped >= 0) {
    return (
      `Error: parallel worker task ${unscoped + 1} needs a disjoint path_prefix. ` +
      'Use one worker for shared-scope work, or give every parallel task a separate folder/file scope.'
    )
  }
  if (workerScopesOverlap(tasks[0]?.pathPrefix, tasks[1]?.pathPrefix)) {
    return (
      `Error: worker path_prefix scopes overlap ("${tasks[0]?.pathPrefix}" and "${tasks[1]?.pathPrefix}"). ` +
      'Split the work into disjoint scopes or use one worker.'
    )
  }
  return null
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
  /** Why the worker stopped without a structured final summary. */
  stopReason?: string
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
    opts.stopReason ??
      'Ended without a structured final summary — main agent should verify with git_diff / read_file.',
  )
  return lines.join('\n').slice(0, 2500)
}

/**
 * Per-worker digest as the main agent sees it: model prose capped and the
 * typecheck reduced to its verdict lines. Raw `check_types` output is not
 * included — main runs its own post-worker check when it wants diagnostics.
 */
export function formatWorkerDigest(opts: {
  workerLabel: string
  /** Prose summary (final model message or synthesized fallback). */
  body: string
  verification: WorkerTypeCheckResult
}): string {
  const verdicts = [...opts.verification.verified, ...opts.verification.failures]
  const prose = clipWorkerText(opts.body, CODING_WORKER_DIGEST_MAX_CHARS)
  const verificationLine = verdicts.length > 0 ? `\nVerification: ${verdicts.join('; ')}` : ''
  return `${opts.workerLabel}:\n${prose}${verificationLine}`
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
  /** Machine-readable summary for the orchestrator (deterministic, not model prose). */
  structured?: WorkerStructuredReport
}

/** One sibling action broadcast on the in-process worker blackboard. */
export type WorkerBlackboardEntry = {
  worker: string
  path: string
}

/**
 * In-process blackboard shared by all workers of one batch. Workers only
 * broadcast successful file mutations; each worker reads the entries posted by
 * its siblings before its next round, so an interface change in one scope is
 * visible to the others without a nested team of messages.
 */
export type WorkerBlackboard = {
  entries: WorkerBlackboardEntry[]
}

/**
 * Deterministic per-worker report consumed by the main agent after the batch:
 * what changed, what verification said, and what is still broken.
 */
export type WorkerStructuredReport = {
  worker: string
  goal: string
  scope?: string
  changed: string[]
  verified: string[]
  failed: string[]
  blockers: string[]
}

/**
 * Result of the single end-of-run typecheck over everything a worker wrote.
 * Only the one-line verdicts travel: the raw terminal dump is re-fetchable via
 * check_types, and carrying it into the report was the dominant cause of main's
 * context inflation after a worker batch.
 */
export type WorkerTypeCheckResult = {
  verified: string[]
  failures: string[]
}

type WorkerToolExec = (name: string, args: Record<string, unknown>) => Promise<string>

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
      // An empty string is a valid write (truncate), so only a missing content arg is skipped.
      if (typeof m.args.content === 'string') {
        const content = m.args.content
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

function clipWorkerText(value: string | undefined, maxChars: number): string {
  const text = (value || '').trim()
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}…`
}

/**
 * Keep the worker's inherited context compact and evidence-oriented. This is
 * intentionally a packet of pointers/digests, not a dump of whole files.
 */
export function buildWorkerContextPacket(context?: CodingWorkerContext): string {
  if (!context) return ''
  const lines: string[] = ['[Inherited context from the main coding agent]']
  const userText = clipWorkerText(context.userText, 1200)
  if (userText) lines.push(`Main user request: ${userText}`)

  const plan = context.activePlan
  if (plan) {
    lines.push(`Active build plan: ${clipWorkerText(plan.title, 240)} (${plan.status})`)
    if (plan.summary?.trim()) lines.push(`Plan summary: ${clipWorkerText(plan.summary, 900)}`)
    const unfinished = plan.steps.filter((step) => !step.done).slice(0, 6)
    if (unfinished.length > 0) {
      lines.push('Unfinished plan steps:')
      for (const step of unfinished) lines.push(`- ${step.text}`)
    }
    const research = plan.research
    if (research) {
      if (research.keyFiles.length > 0) {
        lines.push(`Plan key files: ${research.keyFiles.slice(0, 8).join(', ')}`)
      }
      if (research.searches?.length) {
        lines.push(`Plan searches already performed: ${research.searches.slice(0, 6).join(' | ')}`)
      }
      if (research.findings.trim()) {
        lines.push(`Plan findings: ${clipWorkerText(research.findings, 1400)}`)
      }
    }
  }

  const memo = context.memo
  if (memo) {
    if (memo.lastTurnSummary.trim()) {
      lines.push(`Previous coding turn: ${clipWorkerText(memo.lastTurnSummary, 1200)}`)
    }
    if (memo.recentFileDigests.length > 0) {
      lines.push('Known file digests (prefer targeted reads over whole-file rescans):')
      for (const digest of memo.recentFileDigests.slice(0, 8)) {
        lines.push(`- ${digest.path}: ${clipWorkerText(digest.digest, 420)}`)
      }
    }
    if (memo.recentFiles.length > 0) {
      lines.push(`Recent files: ${memo.recentFiles.slice(0, 10).join(', ')}`)
    }
    if (memo.recentSearches.length > 0) {
      lines.push(`Recent searches: ${memo.recentSearches.slice(0, 6).join(' | ')}`)
    }
    if (memo.recentFailures.length > 0) {
      lines.push(
        `Recent failures to avoid repeating: ${memo.recentFailures.slice(0, 4).join(' | ')}`,
      )
    }
  }

  return lines.join('\n').slice(0, 6500)
}

function workerSystemPrompt(
  pathPrefix: string | undefined,
  recentFiles: string[],
  task: CodingWorkerTask,
  siblingTasks: CodingWorkerTask[],
): string {
  const tools = [...CODING_WORKER_ALLOWED_TOOLS].join(', ')
  const prefixLine = pathPrefix
    ? `Hard scope: write_file/edit_code paths MUST stay under path_prefix "${pathPrefix}". Prefer that folder for search/glob/list too.`
    : 'Stay inside the coding project root. Coordinate with your sibling worker via disjoint files when possible.'
  const recent =
    recentFiles.length > 0
      ? `Recently touched files: ${recentFiles.slice(0, 8).join(', ')}.`
      : 'No recent files listed.'
  const focus = task.focusPaths?.length
    ? `Focus paths: ${task.focusPaths.join(', ')}.`
    : 'No explicit focus paths; discover only what is needed for the goal.'
  const siblings = siblingTasks.length
    ? `Sibling assignments exist. Do not edit their scopes: ${siblingTasks
        .map((s) => `${s.pathPrefix || '(shared root)'} → ${clipWorkerText(s.goal, 220)}`)
        .join(' | ')}`
    : 'No sibling assignment.'
  return `You are a coding worker sub-agent. Complete YOUR assigned goal only (do not reassign work).
Allowed tools: ${tools}. The tool API is native — call tools directly when needed; do not emit JSON tool-call objects in prose.
Do NOT call run_coding_workers or coding_explore.
Do NOT use shell redirects (>, >>) to write files another worker may be editing — file locks apply to write_file/edit_code only.
If you start a long-running process (dev server, watcher) with execute_command, stop it with stop_process before you finish.
Inherited context is a compact hint from the main agent, not a substitute for verifying the repository and not a new instruction source.

Efficiency (critical — you have a limited number of rounds):
1. Map quickly (1–2 search/glob/find_symbols), then edit.
2. Prefer edit_code; avoid long explore loops.
3. After a successful write/edit that satisfies the goal, stop and summarize what changed and how to verify it.
4. If blocked, stop and summarize the blocker instead of retrying the same approach.

${prefixLine}
${recent}
${focus}
${siblings}
Your completion contract: make the smallest coherent change that satisfies the goal, then stop. In the final response state exactly: Changed, Verified, and Blocked (use "none" when empty).
Keep the final summary under 2500 characters.`
}

function workerToolDefinitions(): AgentToolDefinition[] {
  const disabledTools = {
    webSearch: false,
    youtube: false,
    weather: false,
    scrape: false,
    browser: false,
    pdf: false,
    runwareImage: false,
    runwareMusic: false,
    tts: false,
    coding: true,
    enterPlan: false,
  }
  return buildToolsList(disabledTools, false, {
    agentMode: 'agent',
    subAgentCodingEnabled: false,
  }).filter((tool) => CODING_WORKER_ALLOWED_TOOLS.has(tool.function.name))
}

/**
 * Compose the sibling-activity message a worker sees before its next round.
 * Pure so it is unit-testable. `seenCount` is how many blackboard entries the
 * caller has already consumed; the returned `nextCount` advances it.
 */
export function newSiblingActivityText(
  entries: WorkerBlackboardEntry[],
  seenCount: number,
  selfLabel: string,
): { text: string; nextCount: number } {
  const fresh = entries.slice(Math.max(0, seenCount))
  const others = fresh.filter((entry) => entry.worker !== selfLabel)
  const nextCount = entries.length
  if (others.length === 0) return { text: '', nextCount }
  const lines = ['[Sibling worker activity — keep your changes compatible with theirs]']
  for (const entry of others.slice(0, 10)) lines.push(`- ${entry.worker} changed ${entry.path}`)
  return { text: lines.join('\n'), nextCount }
}

/** True when a directory has a typecheck target (tsconfig / python marker / go.mod / …). */
async function dirHasCheckTarget(dir: string, executeTool: WorkerToolExec): Promise<boolean> {
  const out = await executeTool('check_types', dir ? { path_prefix: dir } : {})
  return !/no tsconfig\.json/i.test(out) && !/no check target in/i.test(out)
}

/**
 * Single end-of-run typecheck over every file a worker wrote. Replaces the old
 * per-mutation check (which ran a full `tsc` after each edit). Groups the paths
 * by their package folder so each package is checked once, and caches the
 * folder probes so an unscoped monorepo path is not re-probed per file.
 */
export async function runWorkerTypeCheck(
  mutatedPaths: string[],
  executeTool: WorkerToolExec,
): Promise<WorkerTypeCheckResult> {
  const unique = [...new Set(mutatedPaths.map((p) => p.replace(/\\/g, '/').trim()).filter(Boolean))]
  const verified: string[] = []
  const failures: string[] = []
  if (unique.length === 0) return { verified, failures }

  const probeCache = new Map<string, boolean>()
  const hasTarget = async (dir: string): Promise<boolean> => {
    const cached = probeCache.get(dir)
    if (cached !== undefined) return cached
    const ok = await dirHasCheckTarget(dir, executeTool)
    probeCache.set(dir, ok)
    return ok
  }

  // package dir ('') means the project root itself has the check target.
  const byPackage = new Map<string, string[]>()
  const unscoped: string[] = []
  for (const rel of unique) {
    const segs = rel.split('/').filter(Boolean)
    let pkg: string | null = null
    for (let i = segs.length - 1; i >= 1; i--) {
      const dir = segs.slice(0, i).join('/')
      if (await hasTarget(dir)) {
        pkg = dir
        break
      }
    }
    if (pkg === null && (await hasTarget(''))) pkg = ''
    if (pkg === null) {
      unscoped.push(rel)
      continue
    }
    const list = byPackage.get(pkg) ?? []
    list.push(pkg ? rel.slice(pkg.length + 1) : rel)
    byPackage.set(pkg, list)
  }

  for (const [pkg, paths] of byPackage) {
    const args: Record<string, unknown> = { paths }
    if (pkg) args.path_prefix = pkg
    const out = await executeTool('check_types', args)
    const label = pkg || '(project root)'
    const errMatch = out.match(/: (\d+) error/)
    if (/no \w+ errors found/i.test(out)) verified.push(`check_types: clean (${label})`)
    else if (errMatch) failures.push(`check_types: ${errMatch[1]} error(s) in ${label}`)
    else failures.push(`check_types failed in ${label}`)
  }
  if (unscoped.length > 0) {
    failures.push(
      `check_types skipped for ${unscoped.join(', ')}: no tsconfig.json in any parent folder`,
    )
  }
  return { verified, failures }
}

type WorkerRunOpts = {
  workerId: string
  workerLabel: string
  task: CodingWorkerTask
  siblingTasks: CodingWorkerTask[]
  contextPacket: string
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
  /** Shared sink owned by the parent, so mutations survive if the worker throws. */
  mutationSink: WorkerMutation[]
  /** Shared sibling-activity board for this batch (optional). */
  blackboard?: WorkerBlackboard
  /** User course corrections queued mid-run (optional). Drained each round. */
  steerQueue?: WorkerSteerQueue
}

/** Short tool target for the live status line (path / query / pattern). */
export function workerToolTarget(name: string, args?: Record<string, unknown>): string {
  const raw = args?.path ?? args?.query ?? args?.pattern ?? args?.command
  const text = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : ''
  if (!text) return ''
  return text.length > 80 ? `${text.slice(0, 79)}…` : text
}

/**
 * Build the per-round injected user message: new sibling activity plus any user
 * steers queued since the previous round (steers are drained exactly once).
 */
export function buildWorkerInjection(params: {
  blackboard?: WorkerBlackboard
  blackboardSeen: number
  workerLabel: string
  steerQueue?: WorkerSteerQueue
  onSteerDrained?: (workerLabel: string, correction: string) => void
}): { text: string; nextCount: number } {
  const parts: string[] = []
  let nextCount = params.blackboardSeen
  if (params.blackboard) {
    const next = newSiblingActivityText(
      params.blackboard.entries,
      params.blackboardSeen,
      params.workerLabel,
    )
    nextCount = next.nextCount
    if (next.text) parts.push(next.text)
  }
  if (params.steerQueue) {
    for (const correction of drainWorkerSteer(params.steerQueue)) {
      parts.push(formatWorkerSteerMessage(correction))
      params.onSteerDrained?.(params.workerLabel, correction)
    }
  }
  return { text: parts.join('\n\n'), nextCount }
}

async function runOneCodingWorker(opts: WorkerRunOpts): Promise<WorkerRunResult> {
  const goal = opts.goal.trim()
  if (!goal) return { digest: `${opts.workerLabel}: Error: missing goal.`, mutations: [] }

  const codingConfig = subAgentConfigForRole(opts.config, 'coding')
  const maxRounds = clampWorkerMaxRounds(opts.maxRounds)
  const pathPrefix = (opts.pathPrefix || '').trim() || undefined
  const recentFiles = opts.recentFiles ?? []
  let readBudget = CODING_WORKER_READ_BUDGET
  let readBudgetNoteLogged = false
  const codingProvider = detectSubAgentProvider(codingConfig.model, codingConfig.provider)
  const notes: string[] = []
  const toolTrail: string[] = []
  const mutatedPaths: string[] = []
  const mutations: WorkerMutation[] = opts.mutationSink
  let blackboardSeen = 0
  const emitEvent = (text: string, level: 'info' | 'ok' | 'warn' | 'err') => {
    opts.ui?.onCodingEvent?.({ workerId: opts.workerId, text, level })
  }

  opts.ui?.onCodingStart?.(`${opts.workerLabel} · 0/${maxRounds}`)

  const messages: NativeSubAgentMessage[] = [
    {
      role: 'system',
      content: workerSystemPrompt(pathPrefix, recentFiles, opts.task, opts.siblingTasks),
    },
    {
      role: 'user',
      content: [
        `Goal: ${goal}`,
        pathPrefix ? `Path prefix (required scope for writes): ${pathPrefix}` : '',
        opts.task.successCriteria
          ? `Success criteria: ${opts.task.successCriteria}`
          : 'Success criteria: satisfy the goal and verify the smallest relevant surface.',
        opts.contextPacket,
        'Start work using the available coding tools. Do not wait for another agent to restate the context.',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ]
  const tools = workerToolDefinitions()
  const maxTokens = Math.min(
    opts.config.outputTokens ?? SUB_AGENT_DEFAULT_OUTPUT_TOKENS,
    SUB_AGENT_DEFAULT_OUTPUT_TOKENS,
  )

  const finishWith = (body: string, verification: WorkerTypeCheckResult): WorkerRunResult => {
    const wroteNothing = mutatedPaths.length === 0
    let stopReason = 'Ended without a structured final summary'
    if (readBudget === 0) {
      stopReason += ' — worker read budget was exhausted before it could finish'
    } else if (wroteNothing) {
      stopReason += ' — no files were written or edited'
    }
    stopReason += '; main agent should verify with git_diff / read_file.'
    const digestBody =
      body.trim() ||
      synthesizeWorkerDigest({ goal, pathPrefix, notes, toolTrail, mutatedPaths, stopReason })
    const digest = formatWorkerDigest({
      workerLabel: opts.workerLabel,
      body: digestBody,
      verification,
    })
    const structured: WorkerStructuredReport = {
      worker: opts.workerLabel,
      goal: goal.slice(0, 400),
      ...(pathPrefix ? { scope: pathPrefix } : {}),
      changed: [...new Set(mutatedPaths)],
      verified: verification.verified,
      failed: verification.failures,
      blockers: [...notes]
        .slice(0, 8)
        .map((note) => clipWorkerText(note, CODING_WORKER_BLOCKER_MAX_CHARS)),
    }
    // Per-worker completion is a status event, NOT onCodingDone: that one is the
    // batch verdict and marks every slot done / collapses the card. Firing it
    // here made one finished worker close the card while its sibling still ran.
    const doneLine =
      digestBody
        .split('\n')
        .find((line) => line.trim())
        ?.trim() ?? ''
    opts.ui?.onCodingEvent?.({
      workerId: opts.workerId,
      text: `${opts.workerLabel} done${doneLine ? ` — ${doneLine.slice(0, 120)}` : ''}`,
      level: verification.failures.length > 0 ? 'warn' : 'ok',
      status: 'done',
    })
    return { digest, mutations, structured }
  }

  const parseArgs = (
    raw: string | Record<string, unknown> | undefined,
  ): Record<string, unknown> => {
    if (raw && typeof raw === 'object') return raw
    if (typeof raw !== 'string' || !raw.trim()) return {}
    try {
      const parsed = JSON.parse(raw) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }

  const executeWorkerTool = async (
    name: string,
    rawArgs: string | Record<string, unknown> | undefined,
  ): Promise<string> => {
    const args = parseArgs(rawArgs)

    if (CODING_WORKER_MUTATION_TOOLS.has(name)) {
      const rel = pathFromWorkerToolArgs(name, args)
      if (!rel) return `Error: ${name} requires a path argument.`
      if (!isPathInWorkerScope(rel, pathPrefix)) {
        return `Error: path "${rel}" is outside path_prefix "${pathPrefix}". Stay in scope.`
      }
      const lockErr = acquireWorkerFileLock(opts.fileLocks, opts.workerId, rel)
      if (lockErr) return lockErr
    }

    if (name === 'execute_command') {
      const command = typeof args.command === 'string' ? args.command : ''
      const redirectErr = shellRedirectConflictsWithLock(command, opts.fileLocks, opts.workerId)
      if (redirectErr) return redirectErr
    }

    if (name === 'read_file' && readBudget <= 0) {
      if (!readBudgetNoteLogged) {
        readBudgetNoteLogged = true
        notes.push('Read budget exhausted — worker could not read more files.')
        emitEvent(`${opts.workerLabel} read budget exhausted`, 'warn')
      }
      // Give the model an explicit instruction so it stops retrying dead reads
      // and produces a usable summary instead of burning the round budget.
      return (
        'Error: worker read budget exhausted; you cannot read more files. ' +
        'Do NOT call read_file again. Finish now: make any remaining in-scope edits from what you already know, ' +
        'then return a short final summary (files changed, verification, or the blocker).'
      )
    }

    const execArgs = { ...args }
    if (
      pathPrefix &&
      (name === 'search_files' || name === 'glob_files' || name === 'list_directory') &&
      typeof execArgs.path_prefix !== 'string' &&
      (name === 'list_directory' ? typeof execArgs.path !== 'string' : true)
    ) {
      if (name === 'list_directory' && !execArgs.path) {
        execArgs.path = pathPrefix
      } else if (name !== 'list_directory' && !execArgs.path_prefix) {
        execArgs.path_prefix = pathPrefix
      }
    }

    let result = await opts.executeTool(name, execArgs)
    if (name === 'read_file') {
      if (result.length >= readBudget) {
        // Return the meaningful remainder (never an empty slice) and then
        // soft-stop further reads with guidance, so a nearly-exhausted budget
        // still yields useful content instead of a silent empty read.
        const keep = Math.max(0, readBudget)
        readBudget = 0
        result =
          keep > 0
            ? `${result.slice(0, keep)}\n…[worker read budget exhausted — final read; finish without more reads]`
            : '[worker read budget exhausted — no content returned; finish without more reads]'
      } else {
        readBudget -= result.length
      }
    }
    if (result.length > 12_000) {
      result = `${result.slice(0, 12_000)}\n…[truncated for worker context]`
    }
    return result
  }

  try {
    const result = await runSharedToolLoop<NativeSubAgentMessage, NativeSubAgentToolCall>({
      initialMessages: messages,
      maxToolRounds: maxRounds,
      maxRequiredToolReprompts: 2,
      mustCallTool: true,
      signal: opts.signal,
      appendToolRequiredReprompt: (target) => {
        target.push({
          role: 'user',
          content:
            'Do not reply with a plan or a summary. Start the assigned work now with a coding tool call ' +
            '(read_file, search_files, glob_files, list_directory, write_file, edit_code, or execute_command).',
        })
      },
      appendToolBudgetWarningReprompt: (target) => {
        target.push({
          role: 'user',
          content:
            'Only two tool rounds remain. If the assigned goal is satisfied, stop calling tools and provide the final summary now. Do not begin broad new searches.',
        })
      },
      appendToolBudgetExhaustedReprompt: (target) => {
        target.push({
          role: 'user',
          content:
            'Tool budget exhausted. Do not call more tools. Return a concise final summary of files changed, verification, or the blocker.',
        })
      },
      onDelta: () => {},
      streamRound: async ({ messages: roundMessages, signal, onDelta, onThinkingDelta }) => {
        const out = await callNativeSubAgentToolRound({
          messages: roundMessages,
          tools,
          config: codingConfig,
          keys: opts.keys,
          signal,
          maxTokens,
        })
        onDelta(out.content)
        if (out.thinking) onThinkingDelta?.(out.thinking)
        return {
          content: out.content,
          thinking: out.thinking,
          toolCalls: out.toolCalls,
        }
      },
      toSharedToolCalls: (calls) =>
        calls.map((call) => ({
          name: call.function.name,
          argsRaw: call.function.arguments,
          raw: call,
        })),
      appendAssistantWithToolCalls: ({ messages: target, content, thinking, toolCalls }) => {
        const replayThinking = thinking.trim()
        target.push({
          role: 'assistant',
          content,
          ...(replayThinking
            ? codingProvider === 'ollama'
              ? { thinking: replayThinking }
              : codingProvider === 'opencode-go'
                ? { reasoning_content: replayThinking }
                : { reasoning: replayThinking }
            : {}),
          tool_calls: toolCalls,
        } as NativeSubAgentMessage)
      },
      appendToolResult: ({ messages: target, call, name, result: toolResult }) => {
        target.push({
          role: 'tool',
          content: toolResult,
          tool_call_id: call.id,
          name,
        })
      },
      executeToolCall: (name, argsRaw) => {
        if (!CODING_WORKER_ALLOWED_TOOLS.has(name)) {
          return Promise.resolve(
            `Error: tool "${name}" is not allowed for coding workers. Allowed: ${[...CODING_WORKER_ALLOWED_TOOLS].join(', ')}.`,
          )
        }
        return executeWorkerTool(name, argsRaw)
      },
      onToolStart: ({ name, args }) => {
        toolTrail.push(name)
        const target = workerToolTarget(name, args)
        opts.ui?.onCodingStart?.(
          `${opts.workerLabel} · ${toolTrail.length}/${maxRounds} · ${name}${target ? ` ${target}` : ''}`,
        )
      },
      onToolResult: ({ name, result: toolResult, args }) => {
        const looksOk = !/^\s*error\s*:/i.test(toolResult)
        if (looksOk && CODING_WORKER_MUTATION_TOOLS.has(name)) {
          const rel = pathFromWorkerToolArgs(name, args || {})
          if (rel) {
            mutatedPaths.push(rel)
            mutations.push({
              tool: name as 'write_file' | 'edit_code',
              path: rel,
              args: args || {},
              result: toolResult,
            })
            opts.blackboard?.entries.push({ worker: opts.workerLabel, path: rel })
            emitEvent(`${opts.workerLabel} wrote ${rel}`, 'ok')
          }
        }
        if (!looksOk) {
          notes.push(`${name}: ${toolResult.slice(0, 240)}`)
          emitEvent(`${opts.workerLabel} ${name} failed`, 'warn')
        }
      },
      injectWorkingSet: () => {
        const injection = buildWorkerInjection({
          blackboard: opts.blackboard,
          blackboardSeen,
          workerLabel: opts.workerLabel,
          steerQueue: opts.steerQueue,
          onSteerDrained: (label, correction) =>
            emitEvent(`${label} received steer: ${correction.slice(0, 80)}`, 'ok'),
        })
        blackboardSeen = injection.nextCount
        return injection.text
      },
      trimToolResultForLlm: (_name, toolResult) => toolResult,
    })
    // Verify once at the end (was: a full tsc after every write/edit). A failed
    // check lands in the structured report; the main agent still runs its own
    // post-worker check_types pass over the whole turn.
    let verification: WorkerTypeCheckResult = { verified: [], failures: [] }
    try {
      verification = await runWorkerTypeCheck(mutatedPaths, opts.executeTool)
      for (const ok of verification.verified) emitEvent(`${opts.workerLabel} ${ok}`, 'ok')
      for (const failed of verification.failures) emitEvent(`${opts.workerLabel} ${failed}`, 'err')
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      verification = { verified: [], failures: [`check_types failed: ${msg}`] }
      emitEvent(`${opts.workerLabel} check_types failed: ${msg}`, 'err')
    }
    return finishWith(result.content, verification)
  } finally {
    releaseWorkerFileLocks(opts.fileLocks, opts.workerId)
  }
}

export type RunCodingWorkersOpts = {
  tasks: CodingWorkerTask[]
  context?: CodingWorkerContext
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
   * parent memo and the next read_file can be soft-denied due to a stale cache entry.
   */
  codingContextMemoRef?: MutableRefObject<CodingContextMemo>
  codingFileCacheRef?: MutableRefObject<CodingFileCache>
  codingProjectPath?: string
  /** Live user course corrections for these workers (composer pushes mid-run). */
  steerQueue?: WorkerSteerQueue
}

/**
 * Assemble the batch report the main agent receives (and the UI card shows):
 * the deterministic touched-file list (from tool results, not model prose), the
 * capped per-worker digests, and one compact JSON line per worker so the
 * orchestrator does not have to parse prose. Pure, so the upstream payload
 * stays testable.
 */
export function buildCodingWorkersReport(settled: WorkerRunResult[]): string {
  const touchedPaths = [...new Set(settled.flatMap((s) => s.mutations.map((m) => m.path)))]
  const report = [
    `Coding workers finished (${settled.length}):`,
    touchedPaths.length
      ? `Files touched by workers (${touchedPaths.length}): ${touchedPaths.join(', ')}`
      : 'Files touched by workers: none.',
    ...settled.map((s) => `---\n${s.digest}`),
  ].join('\n')
  const structured = settled
    .map((s) => s.structured)
    .filter((s): s is WorkerStructuredReport => Boolean(s))
    .map((s) => ({
      ...s,
      blockers: s.blockers.map((note) => clipWorkerText(note, CODING_WORKER_BLOCKER_MAX_CHARS)),
    }))
  return structured.length
    ? `${report}\n\nStructured worker reports (JSON):\n\`\`\`json\n${JSON.stringify(structured)}\n\`\`\``
    : report
}

/**
 * Run 1–2 coding workers in parallel; returns a combined report for the main agent.
 */
export async function runCodingWorkers(opts: RunCodingWorkersOpts): Promise<string> {
  const tasks = opts.tasks.slice(0, CODING_WORKER_MAX_TASKS)
  if (tasks.length === 0) return 'Error: no tasks to run.'
  const dispatchError = validateCodingWorkerDispatch(tasks)
  if (dispatchError) return dispatchError

  const fileLocks = createWorkerFileLock()
  const blackboard: WorkerBlackboard = { entries: [] }
  const contextPacket = buildWorkerContextPacket(opts.context)
  const n = tasks.length
  opts.ui?.onCodingStart?.(
    n === 1 ? 'WORKER 1 · starting' : `WORKERS 1–${n} · starting in parallel`,
  )

  const settled: WorkerRunResult[] = await Promise.all(
    tasks.map((task, i) => {
      const workerId = `worker-${i + 1}`
      const workerLabel = `WORKER ${i + 1}`
      const mutationSink: WorkerMutation[] = []
      return runOneCodingWorker({
        mutationSink,
        workerId,
        workerLabel,
        task,
        siblingTasks: tasks.filter((_, taskIndex) => taskIndex !== i),
        contextPacket,
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
        blackboard,
        steerQueue: opts.steerQueue,
      }).catch((e): WorkerRunResult => {
        const msg = e instanceof Error ? e.message : String(e)
        opts.ui?.onCodingEvent?.({
          workerId,
          text: `${workerLabel} failed: ${msg.slice(0, 120)}`,
          level: 'err',
          status: 'error',
        })
        // Keep whatever the worker already wrote before it failed.
        return {
          digest: `${workerLabel}: Error: ${msg}`,
          mutations: mutationSink,
          structured: {
            worker: workerLabel,
            goal: task.goal.slice(0, 400),
            ...(task.pathPrefix ? { scope: task.pathPrefix } : {}),
            changed: [...new Set(mutationSink.map((m) => m.path))],
            verified: [],
            failed: [],
            blockers: [`Error: ${msg}`],
          },
        }
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

  const withStructured = buildCodingWorkersReport(settled)
  opts.ui?.onCodingDone?.(
    withStructured.length > 4000 ? `${withStructured.slice(0, 4000)}…` : withStructured,
  )
  return withStructured
}
