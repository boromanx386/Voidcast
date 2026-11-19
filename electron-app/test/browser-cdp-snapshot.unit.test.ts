import { describe, expect, test } from 'vitest'
import type { WebContents } from 'electron'
import { CdpSession } from '../electron/main/browser/cdp'

type AxNode = {
  nodeId: string
  parentId?: string
  role: string
  name?: string
  ignored?: boolean
  backendDOMNodeId?: number
  url?: string
}

/** A CdpSession whose Accessibility.getFullAXTree returns `nodes`. */
async function snapshotOf(nodes: AxNode[], maxNodes?: number): Promise<string> {
  const wire = nodes.map((n) => ({
    nodeId: n.nodeId,
    parentId: n.parentId,
    ignored: n.ignored ?? false,
    role: { value: n.role },
    name: n.name === undefined ? undefined : { value: n.name },
    backendDOMNodeId: n.backendDOMNodeId,
    properties: n.url === undefined ? undefined : [{ name: 'url', value: { value: n.url } }],
  }))
  const wc = {
    getURL: () => 'http://localhost/',
    getTitle: () => 'Game',
    debugger: {
      attach: () => undefined,
      isAttached: () => true,
      on: () => undefined,
      removeListener: () => undefined,
      detach: () => undefined,
      sendCommand: async (method: string) =>
        method === 'Accessibility.getFullAXTree' ? { nodes: wire } : {},
    },
  } as unknown as WebContents
  const session = new CdpSession(wc)
  await session.attach()
  const text = await session.snapshot(maxNodes)
  return text.split('\n').slice(2).join('\n')
}

describe('CdpSession snapshot page text', () => {
  test('plain text in a div shows up, merged per element', async () => {
    const out = await snapshotOf([
      { nodeId: '1', role: 'RootWebArea', name: 'Game' },
      { nodeId: '2', parentId: '1', role: 'generic' },
      { nodeId: '3', parentId: '2', role: 'StaticText', name: 'Score:' },
      { nodeId: '4', parentId: '2', role: 'StaticText', name: '120' },
      { nodeId: '5', parentId: '1', role: 'button', name: 'Start', backendDOMNodeId: 9 },
      { nodeId: '6', parentId: '5', role: 'StaticText', name: 'Start' },
      { nodeId: '7', parentId: '1', role: 'StaticText', name: 'Game over' },
    ])
    expect(out).toBe(
      [
        '1 RootWebArea name="Game"',
        'text "Score: 120"',
        '5 button name="Start"',
        'text "Game over"',
      ].join('\n'),
    )
  })

  test('canvas fallback text stays out', async () => {
    const out = await snapshotOf([
      { nodeId: '1', role: 'RootWebArea' },
      { nodeId: '2', parentId: '1', role: 'Canvas' },
      {
        nodeId: '3',
        parentId: '2',
        role: 'StaticText',
        name: 'Your browser does not support canvas.',
      },
    ])
    expect(out).toBe('1 RootWebArea\n2 Canvas')
  })

  test('hidden text stays out', async () => {
    const out = await snapshotOf([
      { nodeId: '1', role: 'RootWebArea' },
      { nodeId: '2', parentId: '1', role: 'StaticText', name: 'secret', ignored: true },
    ])
    expect(out).toBe('1 RootWebArea')
  })

  test('text does not use up the element cap', async () => {
    const nodes: AxNode[] = [{ nodeId: '1', role: 'RootWebArea' }]
    for (let i = 0; i < 5; i++) {
      nodes.push({ nodeId: `p${i}`, parentId: '1', role: 'paragraph' })
      nodes.push({ nodeId: `t${i}`, parentId: `p${i}`, role: 'StaticText', name: `line ${i}` })
    }
    nodes.push({ nodeId: 'b', parentId: '1', role: 'button', name: 'Go' })
    const out = await snapshotOf(nodes, 7)
    expect(out).toContain('b button name="Go"')
    expect(out).toContain('text "line 4"')
    expect(out).not.toContain('truncated')
  })

  test('page text is capped as a whole', async () => {
    const nodes: AxNode[] = [{ nodeId: '1', role: 'RootWebArea' }]
    for (let i = 0; i < 40; i++) {
      nodes.push({ nodeId: `p${i}`, parentId: '1', role: 'paragraph' })
      nodes.push({ nodeId: `t${i}`, parentId: `p${i}`, role: 'StaticText', name: 'x'.repeat(250) })
    }
    const out = await snapshotOf(nodes)
    expect(out.match(/^text /gm)?.length).toBe(16)
    expect(out).toContain('(page text cut at 4000 chars)')
  })
})

describe('CdpSession snapshot links', () => {
  test('links carry their url, same-origin ones without the origin', async () => {
    const out = await snapshotOf([
      { nodeId: '1', role: 'RootWebArea', url: 'http://localhost/' },
      { nodeId: '2', parentId: '1', role: 'link', name: 'Story', url: 'https://example.com/a?b=1' },
      {
        nodeId: '3',
        parentId: '1',
        role: 'link',
        name: '12 comments',
        url: 'http://localhost/item?id=7',
      },
      { nodeId: '4', parentId: '1', role: 'link', name: 'No href' },
    ])
    expect(out).toBe(
      [
        '1 RootWebArea',
        '2 link name="Story" url="https://example.com/a?b=1"',
        '3 link name="12 comments" url="/item?id=7"',
        '4 link name="No href"',
      ].join('\n'),
    )
  })
})
