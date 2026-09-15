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
import {
  CODING_EXPLORE_ALLOWED_TOOLS,
} from '@/lib/codingSubAgent'
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

/** Conservative overlap check for two worker write scopes. */
export function workerScopesOverlap(left?: string, right?: string): boolean {
  const a = normalizeWorkerPathKey(left || '')
  const b = normalizeWorkerPathKey(right || '')
  // An unscoped parallel worker can touch anything, so it overlaps by default.
  if (!a || !b) return true
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
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
      typeof o.path_prefix === 'string' && o.path_prefix.trim()
        ? o.path_prefix.trim()
        : undefined
    const successCriteria =
      typeof o.success_criteria === 'string' && o.success_criteria.trim()
        ? o.success_criteria.trim()
        : undefined
    const focusPaths = Array.isArray(o.focus_paths)
      ? [...new Set(
          o.focus_paths
            .filter((p): p is string => typeof p === 'string')
            .map((p) => p.trim())
            .filter(Boolean),
        )].slice(0, 8)
      : undefined
    const maxRounds =
      typeof o.max_rounds === 'number' && Number.isFinite(o.max_rounds)
        ? o.max_rounds
        : undefined
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
      lines.push(`Recent failures to avoid repeating: ${memo.recentFailures.slice(0, 4).join(' | ')}`)
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
    reddit: false,
    weather: false,
    scrape: false,
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
}

async function runOneCodingWorker(opts: WorkerRunOpts): Promise<WorkerRunResult> {
  const goal = opts.goal.trim()
  if (!goal) return { digest: `${opts.workerLabel}: Error: missing goal.`, mutations: [] }

  const codingConfig = subAgentConfigForRole(opts.config, 'coding')
  const maxRounds = clampWorkerMaxRounds(opts.maxRounds)
  const pathPrefix = (opts.pathPrefix || '').trim() || undefined
  const recentFiles = opts.recentFiles ?? []
  let readBudget = CODING_WORKER_READ_BUDGET
  const codingProvider = detectSubAgentProvider(codingConfig.model, codingConfig.provider)
  const notes: string[] = []
  const toolTrail: string[] = []
  const mutatedPaths: string[] = []
  const mutations: WorkerMutation[] = []

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

  const finishWith = (body: string): WorkerRunResult => {
    const digestBody = body.trim() || synthesizeWorkerDigest({ goal, pathPrefix, notes, toolTrail, mutatedPaths })
    const digest = `${opts.workerLabel}:\n${digestBody}`
    opts.ui?.onCodingDone?.(digest)
    return { digest, mutations }
  }

  const parseArgs = (raw: string | Record<string, unknown> | undefined): Record<string, unknown> => {
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
      notes.push('Read budget exhausted.')
      return 'Error: nested read_file character budget exhausted.'
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
      if (result.length > readBudget) {
        result = `${result.slice(0, readBudget)}\n…[truncated for worker budget]`
        readBudget = 0
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
      maxRequiredToolReprompts: 0,
      mustCallTool: false,
      signal: opts.signal,
      appendToolRequiredReprompt: () => {},
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
      onToolStart: ({ name }) => {
        toolTrail.push(name)
        opts.ui?.onCodingStart?.(`${opts.workerLabel} · ${toolTrail.length}/${maxRounds} · ${name}`)
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
          }
        }
        if (!looksOk) notes.push(`${name}: ${toolResult.slice(0, 240)}`)
      },
      trimToolResultForLlm: (_name, toolResult) => toolResult,
    })
    return finishWith(result.content)
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
  const dispatchError = validateCodingWorkerDispatch(tasks)
  if (dispatchError) return dispatchError

  const fileLocks = createWorkerFileLock()
  const contextPacket = buildWorkerContextPacket(opts.context)
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
