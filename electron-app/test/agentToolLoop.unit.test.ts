import { describe, expect, it } from 'vitest'
import { runSharedToolLoop, WORKING_SET_SUPERSEDED_PLACEHOLDER } from '../src/lib/agentToolLoop'
import { TOOL_BUDGET_NO_REPO_ACTION_FALLBACK_REPLY } from '../src/lib/agentToolUtils'

type Message = { role: string; content: string }
type ProviderCall = { id: string; name: string; args: Record<string, unknown> }
type LoopHooks = {
  firstContent?: string
  onIntermediateResponse?: (ctx: { round: number; content: string }) => void
  onToolStart?: (ctx: { id: string; name: string }) => void
  onToolFinish?: (ctx: { id: string; name: string }) => void
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function runToolRound(
  toolCalls: ProviderCall[],
  executeToolCall: (name: string, argsRaw: Record<string, unknown>) => Promise<string>,
  maxParallelToolCalls = 4,
  hooks: LoopHooks = {},
) {
  let streamCount = 0
  const messages: Message[] = []
  const committedResults: string[] = []

  const loopResult = await runSharedToolLoop<Message, ProviderCall>({
    initialMessages: messages,
    maxToolRounds: 3,
    maxParallelToolCalls,
    maxRequiredToolReprompts: 0,
    mustCallTool: false,
    streamRound: async () => {
      if (streamCount++ === 0) {
        return { content: hooks.firstContent ?? '', thinking: '', toolCalls }
      }
      return { content: 'done', thinking: '', toolCalls: [] }
    },
    toSharedToolCalls: (calls) =>
      calls.map((call) => ({ name: call.name, argsRaw: call.args, raw: call })),
    appendAssistantWithToolCalls: ({ messages: target, content }) => {
      target.push({ role: 'assistant', content })
    },
    appendToolResult: ({ messages: target, name, result }) => {
      target.push({ role: 'tool', content: `${name}:${result}` })
      committedResults.push(`${name}:${result}`)
    },
    appendToolRequiredReprompt: () => {},
    executeToolCall: (name, argsRaw) => executeToolCall(name, argsRaw as Record<string, unknown>),
    onDelta: () => {},
    onIntermediateResponse: hooks.onIntermediateResponse,
    onToolStart: hooks.onToolStart,
    onToolFinish: hooks.onToolFinish,
  })
  return { ...loopResult, committedResults }
}

describe('runSharedToolLoop turn usage', () => {
  it('sums usage over every round, keeping the last round for context fill', async () => {
    let round = 0
    const result = await runSharedToolLoop<Message, ProviderCall>({
      initialMessages: [],
      maxToolRounds: 5,
      maxRequiredToolReprompts: 0,
      mustCallTool: false,
      streamRound: async () => {
        round += 1
        if (round <= 2) {
          return {
            content: '',
            thinking: '',
            toolCalls: [{ id: `c${round}`, name: 'read_file', args: {} }],
            usage: { prompt_eval_count: 1000 * round, eval_count: 10, cached_prompt_tokens: 500 },
          }
        }
        return {
          content: 'done',
          thinking: '',
          toolCalls: [],
          usage: { prompt_eval_count: 3000, eval_count: 50 },
        }
      },
      toSharedToolCalls: (calls) =>
        calls.map((call) => ({ name: call.name, argsRaw: call.args, raw: call })),
      appendAssistantWithToolCalls: () => {},
      appendToolResult: () => {},
      appendToolRequiredReprompt: () => {},
      executeToolCall: async () => 'ok',
      onDelta: () => {},
    })
    expect(result.usage?.prompt_eval_count).toBe(3000)
    expect(result.usage?.turnTotals).toEqual({
      rounds: 3,
      promptTokens: 6000,
      completionTokens: 70,
      cachedPromptTokens: 1000,
      unreportedRounds: 0,
      firstRoundPromptTokens: 1000,
    })
  })

  it('counts rounds that reported no usage so the sums read as a lower bound', async () => {
    let round = 0
    const result = await runSharedToolLoop<Message, ProviderCall>({
      initialMessages: [],
      maxToolRounds: 5,
      maxRequiredToolReprompts: 0,
      mustCallTool: false,
      streamRound: async () => {
        round += 1
        return round === 1
          ? { content: '', thinking: '', toolCalls: [{ id: 'c1', name: 'read_file', args: {} }] }
          : {
              content: 'done',
              thinking: '',
              toolCalls: [],
              usage: { prompt_eval_count: 400, eval_count: 20 },
            }
      },
      toSharedToolCalls: (calls) =>
        calls.map((call) => ({ name: call.name, argsRaw: call.args, raw: call })),
      appendAssistantWithToolCalls: () => {},
      appendToolResult: () => {},
      appendToolRequiredReprompt: () => {},
      executeToolCall: async () => 'ok',
      onDelta: () => {},
    })
    expect(result.usage?.turnTotals).toMatchObject({ rounds: 2, unreportedRounds: 1 })
  })
})

describe('runSharedToolLoop recalled images', () => {
  type ImgMessage = { role: string; content: string; images?: string[] }

  it('keeps the model notes in the digest once the pixels are dropped', async () => {
    let round = 0
    const seen: ImgMessage[][] = []
    await runSharedToolLoop<ImgMessage, ProviderCall>({
      initialMessages: [],
      maxToolRounds: 5,
      maxRequiredToolReprompts: 0,
      mustCallTool: false,
      streamRound: async ({ messages }) => {
        seen.push(messages.map((m) => ({ ...m, images: m.images ? [...m.images] : undefined })))
        round += 1
        if (round === 1) {
          return {
            content: '',
            thinking: '',
            toolCalls: [{ id: 'r', name: 'image_recall', args: {} }],
          }
        }
        if (round === 2) {
          return {
            content: '',
            thinking: 'The screenshot shows score 40 and two of three lives lost.',
            toolCalls: [{ id: 'f', name: 'read_file', args: {} }],
          }
        }
        return { content: 'done', thinking: '', toolCalls: [] }
      },
      toSharedToolCalls: (calls) =>
        calls.map((call) => ({ name: call.name, argsRaw: call.args, raw: call })),
      appendAssistantWithToolCalls: ({ messages, content }) => {
        messages.push({ role: 'assistant', content })
      },
      appendToolResult: ({ messages, name, result }) => {
        messages.push({ role: 'tool', content: `${name}:${result}` })
      },
      appendToolRequiredReprompt: () => {},
      executeToolCall: async () => 'ok',
      collectRecalledImages: ({ name }) =>
        name === 'image_recall'
          ? [{ base64: 'AAAA', mime: 'image/png', digest: '- img_1 (shot.png): seen' }]
          : [],
      appendRuntimeRecalledImages: (messages, recalled) => {
        messages.push({ role: 'user', content: 'pixels', images: recalled.map((x) => x.base64) })
      },
      onDelta: () => {},
    })

    const withPixels = seen[1]!.find((m) => m.role === 'user')
    expect(withPixels?.images).toEqual(['AAAA'])

    const afterDrop = seen[2]!.find((m) => m.role === 'user')
    expect(afterDrop?.images).toEqual([])
    expect(afterDrop?.content).toContain('- img_1 (shot.png): seen')
    expect(afterDrop?.content).toContain(
      'Your notes from the round you saw it: The screenshot shows score 40',
    )
  })
})

describe('runSharedToolLoop parallel tool execution', () => {
  it('runs adjacent read-only calls concurrently and commits their results in provider order', async () => {
    let active = 0
    let maxActive = 0
    const result = await runToolRound(
      [
        { id: 'a', name: 'read_file', args: { id: 'a' } },
        { id: 'b', name: 'read_file', args: { id: 'b' } },
      ],
      async (_name, args) => {
        const id = String(args.id)
        active += 1
        maxActive = Math.max(maxActive, active)
        await sleep(id === 'a' ? 30 : 5)
        active -= 1
        return id
      },
      2,
    )

    expect(maxActive).toBe(2)
    expect(result.committedResults).toEqual(['read_file:a', 'read_file:b'])
    expect(result.content).toBe('done')
  })

  it('treats a mutating tool as a serial barrier', async () => {
    let active = 0
    let maxActive = 0
    const startOrder: string[] = []

    await runToolRound(
      [
        { id: 'a', name: 'read_file', args: { id: 'a' } },
        { id: 'b', name: 'write_file', args: { id: 'b' } },
        { id: 'c', name: 'read_file', args: { id: 'c' } },
      ],
      async (name, args) => {
        const id = String(args.id)
        startOrder.push(`${name}:${id}`)
        active += 1
        maxActive = Math.max(maxActive, active)
        await sleep(5)
        active -= 1
        return id
      },
      3,
    )

    expect(maxActive).toBe(1)
    expect(startOrder).toEqual(['read_file:a', 'write_file:b', 'read_file:c'])
  })

  it('reports intermediate drafts and the lifecycle of each parallel tool', async () => {
    const progress: Array<{ round: number; content: string }> = []
    const starts: string[] = []
    const finishes: string[] = []

    await runToolRound(
      [
        { id: 'a', name: 'read_file', args: { id: 'a' } },
        { id: 'b', name: 'read_file', args: { id: 'b' } },
      ],
      async (_name, args) => String(args.id),
      2,
      {
        firstContent: 'I will inspect both files first.',
        onIntermediateResponse: (ctx) => progress.push(ctx),
        onToolStart: ({ id, name }) => starts.push(`${name}:${id}`),
        onToolFinish: ({ id, name }) => finishes.push(`${name}:${id}`),
      },
    )

    expect(progress).toEqual([{ round: 0, content: 'I will inspect both files first.' }])
    expect(starts).toEqual(['read_file:round-0-tool-0', 'read_file:round-0-tool-1'])
    expect(new Set(finishes)).toEqual(new Set(starts))
  })

  it('converts a serial tool exception into a tool error', async () => {
    const result = await runToolRound(
      [{ id: 'a', name: 'write_file', args: { id: 'a' } }],
      async () => {
        throw new Error('write failed')
      },
    )

    expect(result.committedResults).toEqual(['write_file:Error: write failed'])
    expect(result.content).toBe('done')
  })

  it('propagates abort errors instead of converting them into tool results', async () => {
    const abortError = new Error('Aborted')
    abortError.name = 'AbortError'

    await expect(
      runToolRound([{ id: 'a', name: 'write_file', args: { id: 'a' } }], async () => {
        throw abortError
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('enforces the configured concurrency limit for larger read-only batches', async () => {
    let active = 0
    let maxActive = 0
    const result = await runToolRound(
      [
        { id: 'a', name: 'read_file', args: { id: 'a' } },
        { id: 'b', name: 'read_file', args: { id: 'b' } },
        { id: 'c', name: 'read_file', args: { id: 'c' } },
      ],
      async (_name, args) => {
        const id = String(args.id)
        active += 1
        maxActive = Math.max(maxActive, active)
        await sleep(5)
        active -= 1
        return id
      },
      2,
    )

    expect(maxActive).toBe(2)
    expect(result.committedResults).toEqual(['read_file:a', 'read_file:b', 'read_file:c'])
  })

  it('commits successful results and converts a failed sibling into a tool error', async () => {
    const result = await runToolRound(
      [
        { id: 'a', name: 'read_file', args: { id: 'a' } },
        { id: 'b', name: 'read_file', args: { id: 'b' } },
        { id: 'c', name: 'read_file', args: { id: 'c' } },
      ],
      async (_name, args) => {
        const id = String(args.id)
        if (id === 'b') throw new Error('read failed')
        return id
      },
      3,
    )

    expect(result.committedResults).toEqual([
      'read_file:a',
      'read_file:Error: read failed',
      'read_file:c',
    ])
    expect(result.content).toBe('done')
  })

  it('rejects budget wrap-up prose when guardRepoActionTruth and no repo mutations', async () => {
    let streamCount = 0
    const result = await runSharedToolLoop<
      { role: string; content: string },
      { id: string; name: string; args: Record<string, unknown> }
    >({
      initialMessages: [],
      maxToolRounds: 1,
      maxRequiredToolReprompts: 0,
      mustCallTool: false,
      guardRepoActionTruth: true,
      streamRound: async () => {
        if (streamCount++ === 0) {
          return {
            content: '',
            thinking: '',
            toolCalls: [{ id: 'a', name: 'read_file', args: {} }],
          }
        }
        return {
          content: 'All files committed and tests pass.',
          thinking: '',
          toolCalls: [],
        }
      },
      toSharedToolCalls: (calls) => calls.map((c) => ({ name: c.name, argsRaw: c.args, raw: c })),
      appendAssistantWithToolCalls: ({ messages, content }) => {
        messages.push({ role: 'assistant', content })
      },
      appendToolResult: ({ messages, name, result: r }) => {
        messages.push({ role: 'tool', content: `${name}:${r}` })
      },
      appendToolRequiredReprompt: () => {},
      appendToolBudgetExhaustedReprompt: () => {},
      executeToolCall: async () => '1| hello',
      onDelta: () => {},
    })

    expect(result.content).toBe(TOOL_BUDGET_NO_REPO_ACTION_FALLBACK_REPLY)
  })
})

describe('runSharedToolLoop submit_plan', () => {
  it('ends the turn after a successful submit_plan without another model round', async () => {
    const result = await runToolRound(
      [{ id: 'p1', name: 'submit_plan', args: { title: 'T', steps: ['a'] } }],
      async () => 'Plan submitted: "T" (1 steps).',
      4,
      { firstContent: 'Short note.' },
    )
    expect(result.content).toBe('Short note.')
    expect(result.committedResults).toEqual(['submit_plan:Plan submitted: "T" (1 steps).'])
    expect(result.usage?.turnTotals?.rounds ?? 1).toBe(1)
  })

  it('keeps going when submit_plan returns an error so the model can fix it', async () => {
    const result = await runToolRound(
      [{ id: 'p1', name: 'submit_plan', args: { title: 'T' } }],
      async () => 'Error: the plan needs steps.',
    )
    expect(result.content).toBe('done')
    expect(result.committedResults).toEqual(['submit_plan:Error: the plan needs steps.'])
  })
})

describe('runSharedToolLoop debug events', () => {
  it('logs rounds, tool results and the round an old result was cleared', async () => {
    const events: Array<Record<string, unknown>> = []
    let round = 0
    const big = 'x'.repeat(3000)
    await runSharedToolLoop<Message, ProviderCall>({
      initialMessages: [],
      maxToolRounds: 10,
      maxRequiredToolReprompts: 0,
      mustCallTool: false,
      streamRound: async () => {
        round += 1
        if (round <= 4) {
          return {
            content: '',
            thinking: '',
            toolCalls: [{ id: `c${round}`, name: 'execute_command', args: { command: 'curl x' } }],
            usage: { prompt_eval_count: 100, eval_count: 5 },
          }
        }
        return { content: 'done', thinking: '', toolCalls: [] }
      },
      toSharedToolCalls: (calls) =>
        calls.map((call) => ({ name: call.name, argsRaw: call.args, raw: call })),
      appendAssistantWithToolCalls: ({ messages: target, content }) => {
        target.push({ role: 'assistant', content })
      },
      appendToolResult: ({ messages: target, result }) => {
        target.push({ role: 'tool', content: result })
      },
      appendToolRequiredReprompt: () => {},
      executeToolCall: async () => big,
      oldToolResultClearing: {
        keepRecentRounds: 2,
        minChars: 2000,
        shouldClear: () => true,
        placeholder: () => '[cleared]',
      },
      onDelta: () => {},
      onDebugEvent: (e) => events.push(e as Record<string, unknown>),
    })

    const tools = events.filter((e) => e.t === 'tool')
    expect(tools).toHaveLength(4)
    expect(tools[0]).toMatchObject({ round: 0, name: 'execute_command', resultChars: 3000 })
    expect(tools[0]!.args).toContain('curl x')
    expect(tools[0]!.argsChars).toBe(JSON.stringify({ command: 'curl x' }).length)
    expect(String(tools[0]!.head)).toHaveLength(300)

    const cleared = events.filter((e) => e.t === 'cleared')
    expect(cleared[0]).toMatchObject({ round: 3, fromRound: 0, name: 'execute_command' })

    const rounds = events.filter((e) => e.t === 'round')
    expect(rounds).toHaveLength(5)
    expect(rounds[0]).toMatchObject({ round: 0, promptTokens: 100, toolCalls: ['execute_command'] })
  })

  it('clears nothing while the prompt is under the trigger, then clears once over it', async () => {
    const big = 'x'.repeat(3000)
    const run = async (promptTokens: number) => {
      const events: Array<Record<string, unknown>> = []
      let round = 0
      await runSharedToolLoop<Message, ProviderCall>({
        initialMessages: [],
        maxToolRounds: 10,
        maxRequiredToolReprompts: 0,
        mustCallTool: false,
        streamRound: async () => {
          round += 1
          if (round <= 6) {
            return {
              content: '',
              thinking: '',
              toolCalls: [{ id: `c${round}`, name: 'execute_command', args: {} }],
              usage: { prompt_eval_count: promptTokens, eval_count: 5 },
            }
          }
          return { content: 'done', thinking: '', toolCalls: [] }
        },
        toSharedToolCalls: (calls) =>
          calls.map((call) => ({ name: call.name, argsRaw: call.args, raw: call })),
        appendAssistantWithToolCalls: ({ messages: target, content }) => {
          target.push({ role: 'assistant', content })
        },
        appendToolResult: ({ messages: target, result }) => {
          target.push({ role: 'tool', content: result })
        },
        appendToolRequiredReprompt: () => {},
        executeToolCall: async () => big,
        oldToolResultClearing: {
          keepRecentRounds: 2,
          minChars: 2000,
          triggerPromptTokens: 50_000,
          shouldClear: () => true,
          placeholder: () => '[cleared]',
        },
        onDelta: () => {},
        onDebugEvent: (e) => events.push(e as Record<string, unknown>),
      })
      return events.filter((e) => e.t === 'cleared')
    }

    expect(await run(20_000)).toHaveLength(0)
    const cleared = await run(60_000)
    expect(cleared.length).toBeGreaterThan(0)
    expect(cleared[0]).toMatchObject({ fromRound: 0, promptTokens: 60_000 })
  })

  it('keeps one working-set message in context instead of one per round', async () => {
    const hints = ['A', 'A', 'B', 'B', 'B']
    let round = 0
    const sent: Message[][] = []
    await runSharedToolLoop<Message, ProviderCall>({
      initialMessages: [],
      maxToolRounds: 10,
      maxRequiredToolReprompts: 0,
      mustCallTool: false,
      streamRound: async ({ messages }) => {
        sent.push((messages as Message[]).map((m) => ({ ...m })))
        round += 1
        if (round <= 5) {
          return {
            content: '',
            thinking: '',
            toolCalls: [{ id: `c${round}`, name: 'write_file', args: {} }],
          }
        }
        return { content: 'done', thinking: '', toolCalls: [] }
      },
      toSharedToolCalls: (calls) =>
        calls.map((call) => ({ name: call.name, argsRaw: call.args, raw: call })),
      appendAssistantWithToolCalls: ({ messages: target, content }) => {
        target.push({ role: 'assistant', content })
      },
      appendToolResult: ({ messages: target, result }) => {
        target.push({ role: 'tool', content: result })
      },
      appendToolRequiredReprompt: () => {},
      executeToolCall: async () => 'ok',
      injectWorkingSet: () => `[Working memory] ${hints[round - 1] ?? 'B'}`,
      onDelta: () => {},
    })

    const last = sent[sent.length - 1]!
    const full = last.filter((m) => m.content.startsWith('[Working memory]'))
    expect(full).toEqual([{ role: 'user', content: '[Working memory] B' }])
    // The 'A' copy was superseded in place; repeats of 'B' added nothing.
    expect(last.filter((m) => m.content === WORKING_SET_SUPERSEDED_PLACEHOLDER)).toHaveLength(1)
  })

  it('a throwing debug sink does not break the turn', async () => {
    const result = await runSharedToolLoop<Message, ProviderCall>({
      initialMessages: [],
      maxToolRounds: 3,
      maxRequiredToolReprompts: 0,
      mustCallTool: false,
      streamRound: async () => ({ content: 'done', thinking: '', toolCalls: [] }),
      toSharedToolCalls: () => [],
      appendAssistantWithToolCalls: () => {},
      appendToolResult: () => {},
      appendToolRequiredReprompt: () => {},
      executeToolCall: async () => 'ok',
      onDelta: () => {},
      onDebugEvent: () => {
        throw new Error('disk full')
      },
    })
    expect(result.content).toBe('done')
  })
})
