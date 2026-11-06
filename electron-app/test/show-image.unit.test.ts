import { afterEach, describe, expect, test, vi } from 'vitest'
import { imageCatalogId } from '../src/lib/imageVisionCache'
import { resolveLocalImagePath } from '../src/lib/imageProjectRecall'
import { handleShowImage, mediaHandlersRegistry } from '../src/lib/toolHandlers/mediaHandlers'
import { registerTurnCatalogImages } from '../src/lib/toolHandlers/helpers'
import { buildToolsList } from '../src/lib/toolDefinitions'
import { toolPhaseForAgentTool } from '../src/lib/agentToolPhase'
import type { ExecCtx } from '../src/lib/toolExecTypes'

type SavePayload = { imageUrl: string; outputDir: string; filename?: string }

function stubDesktop(files: Record<string, string>) {
  const saves: SavePayload[] = []
  const voidcast = {
    readImageFile: vi.fn(async ({ path }: { path: string }) =>
      path in files
        ? {
            ok: true,
            file: { base64: files[path], mime: 'image/png', name: path.split('/').pop(), path },
          }
        : { ok: false, error: 'missing' },
    ),
    saveImageFromUrl: vi.fn(async (payload: SavePayload) => {
      saves.push(payload)
      const name = payload.filename || 'voidcast-image'
      const saved = `/out/${name}.png`
      files[saved] = payload.imageUrl.split(',')[1] ?? ''
      return { ok: true, text: `Saved image: ${saved}` }
    }),
  }
  vi.stubGlobal('window', { voidcast })
  return { saves, voidcast }
}

function makeCtx(over: Partial<ExecCtx> = {}): ExecCtx {
  return {
    userImages: [],
    userImageMimes: [],
    userImagePaths: [],
    ...over,
  } as unknown as ExecCtx
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('show_image', () => {
  test('copies a file into the output folder, so the chat outlives the original', async () => {
    const { saves } = stubDesktop({ '/tmp/chart.png': 'QUJD' })
    const ctx = makeCtx({ runware: { outputDir: '/out' } as ExecCtx['runware'] })
    const res = await handleShowImage({ reference_image_paths: '/tmp/chart.png' }, ctx)

    expect(saves[0].outputDir).toBe('/out')
    expect(saves[0].filename).toBe('chart')
    expect(saves[0].imageUrl).toBe('data:image/png;base64,QUJD')
    expect(res).toContain('Saved image: /out/chart.png')
    expect(res).toContain(`image_id: ${imageCatalogId({ path: '/out/chart.png', base64: '' })}`)
  })

  test('the shown image is usable by id in the same turn', async () => {
    stubDesktop({ '/tmp/chart.png': 'QUJD' })
    const ctx = makeCtx()
    await handleShowImage({ reference_image_paths: '/tmp/chart.png' }, ctx)

    expect(ctx.userImagePaths).toEqual(['/out/chart.png'])
    expect(ctx.userImages).toEqual(['QUJD'])
    expect(ctx.userImageMimes).toEqual(['image/png'])
    // The id handed to the model must match what the catalog derives from path + bytes.
    expect(imageCatalogId({ path: ctx.userImagePaths?.[0], base64: 'QUJD' })).toBe(
      imageCatalogId({ path: '/out/chart.png', base64: '' }),
    )
  })

  test('a catalog image that already has a file is not copied again', async () => {
    const { saves } = stubDesktop({ '/chat/a.png': 'QUJD' })
    const ctx = makeCtx({
      userImages: ['QUJD'],
      userImageMimes: ['image/png'],
      userImagePaths: ['/chat/a.png'],
    })
    const id = imageCatalogId({ path: '/chat/a.png', base64: 'QUJD' })
    const res = await handleShowImage({ reference_image_ids: id }, ctx)

    expect(saves).toHaveLength(0)
    expect(res).toContain('Saved image: /chat/a.png')
    expect(ctx.userImagePaths).toEqual(['/chat/a.png'])
  })

  test('a catalog image without a file is saved first', async () => {
    const { saves } = stubDesktop({})
    const ctx = makeCtx({
      userImages: ['QUJD'],
      userImageMimes: ['image/png'],
      userImagePaths: [''],
    })
    const res = await handleShowImage({ reference_image_indexes: '1' }, ctx)

    expect(saves).toHaveLength(1)
    expect(res).toContain('Saved image: /out/voidcast-image.png')
  })

  test('reports partial failures next to what worked', async () => {
    stubDesktop({ '/tmp/ok.png': 'QUJD' })
    const res = await handleShowImage(
      { reference_image_paths: '/tmp/ok.png, /tmp/gone.png, /tmp/notes.txt' },
      makeCtx(),
    )
    expect(res).toContain('Saved image: /out/ok.png')
    expect(res).toContain('Could not read image: /tmp/gone.png')
    expect(res).toContain('Not a usable image path: /tmp/notes.txt')
  })

  test('returns errors the model can act on', async () => {
    stubDesktop({})
    expect(await handleShowImage({}, makeCtx())).toMatch(/^Error: missing image references/)
    expect(await handleShowImage({ reference_image_ids: 'img_deadbeef' }, makeCtx())).toContain(
      'Unknown id: img_deadbeef',
    )
    expect(await handleShowImage({ reference_image_paths: 'rel/a.png' }, makeCtx())).toMatch(
      /^Error: show_image could not show any image/,
    )
  })

  test('is desktop only', async () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome' })
    expect(await handleShowImage({ reference_image_paths: '/a.png' }, makeCtx())).toMatch(
      /only available in the desktop app/,
    )
  })

  test('is offered and registered in every agent mode', () => {
    const none = { coding: false, runwareImage: false } as never
    for (const opts of [undefined, { agentMode: 'plan' as const }]) {
      const names = buildToolsList(none, false, opts).map((t) => t.function.name)
      expect(names).toContain('show_image')
    }
    expect(mediaHandlersRegistry.show_image).toBe(handleShowImage)
    expect(toolPhaseForAgentTool('show_image')).toBe('vision')
  })
})

describe('resolveLocalImagePath', () => {
  test('takes absolute paths anywhere, relative ones only inside the project', () => {
    expect(resolveLocalImagePath('', 'C:\\temp\\a.png')).toBe('C:\\temp\\a.png')
    expect(resolveLocalImagePath('', '/tmp/a.webp')).toBe('/tmp/a.webp')
    expect(resolveLocalImagePath('/repo', 'demos/a.png')).toBe('/repo/demos/a.png')
    expect(resolveLocalImagePath('', 'demos/a.png')).toBeNull()
    expect(resolveLocalImagePath('/repo', '../a.png')).toBeNull()
    expect(resolveLocalImagePath('/repo', '/tmp/a.txt')).toBeNull()
  })
})

describe('registerTurnCatalogImages', () => {
  test('appends, keeps indexes stable and skips known or unreadable files', async () => {
    stubDesktop({ '/a.png': 'QQ==', '/b.png': 'Qg==' })
    const ctx = {
      userImages: ['QQ=='],
      userImageMimes: ['image/png'],
      userImagePaths: ['/a.png'],
    }
    await registerTurnCatalogImages(['/A.PNG', '/b.png', '/gone.png'], ctx)
    expect(ctx.userImagePaths).toEqual(['/a.png', '/b.png'])
    expect(ctx.userImages).toEqual(['QQ==', 'Qg=='])
    expect(ctx.userImageMimes).toHaveLength(2)
  })
})
