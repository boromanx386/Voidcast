import { describe, expect, it } from 'vitest'
import { runSharedToolLoop } from '../src/lib/agentToolLoop'

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
    expect(result.committedResults)
      .toEqual(['read_file:a', 'read_file:b'])
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
      runToolRound(
        [{ id: 'a', name: 'write_file', args: { id: 'a' } }],
        async () => {
          throw abortError
        },
      ),
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
    expect(result.committedResults)
      .toEqual(['read_file:a', 'read_file:b', 'read_file:c'])
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
})
