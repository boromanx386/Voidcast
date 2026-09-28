import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import {
  activeBrowserPage,
  browserStatus,
  closeBrowserPage,
  disposeBrowserView,
  emulateBrowser,
  historyStep,
  listBrowserPages,
  navigateTo,
  openBrowserPage,
  reloadPage,
  selectBrowserPage,
  setBrowserBounds,
  setBrowserVisible,
  takeBrowserScreenshot,
  withSession,
} from './viewManager'

/**
 * IPC surface for the Voidcast browser.
 *
 * Every channel resolves to `{ ok: true, ... }` or `{ ok: false, error }` — a
 * rejected promise would surface in the renderer as an unhandled rejection
 * instead of a readable tool error for the agent.
 */

type GetWindow = () => BrowserWindow | null

function fail(e: unknown): { ok: false; error: string } {
  return { ok: false, error: e instanceof Error ? e.message : String(e) }
}

function asInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** Guard + the page the agent is currently driving (the same one the panel paints). */
function sessionOrThrow() {
  const page = activeBrowserPage()
  if (!page) {
    throw new Error('No browser page is open yet — use browser_new_page or the panel URL bar.')
  }
  return page
}

export function registerBrowserIpc(getWindow: GetWindow): void {
  ipcMain.handle('voidcast:browser-status', async () => {
    try {
      return { ok: true as const, ...browserStatus() }
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle(
    'voidcast:browser-set-bounds',
    async (_event, payload: { x?: number; y?: number; width?: number; height?: number }) => {
      try {
        setBrowserBounds({
          x: typeof payload?.x === 'number' ? payload.x : 0,
          y: typeof payload?.y === 'number' ? payload.y : 0,
          width: typeof payload?.width === 'number' ? payload.width : 0,
          height: typeof payload?.height === 'number' ? payload.height : 0,
        })
        return { ok: true as const }
      } catch (e) {
        return fail(e)
      }
    },
  )

  ipcMain.handle('voidcast:browser-set-visible', async (_event, payload: { visible?: boolean } | boolean) => {
    try {
      // Tolerate both shapes: a bare boolean coerced to false here, which kept the
      // native view parked off-screen no matter what the panel asked for.
      const wanted = typeof payload === 'boolean' ? payload : Boolean(payload?.visible)
      setBrowserVisible(wanted)
      return { ok: true as const }
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle(
    'voidcast:browser-navigate',
    async (_event, payload: { url?: string; projectPath?: string }) => {
      try {
        const url = typeof payload?.url === 'string' ? payload.url : ''
        return await withSession(getWindow(), payload?.projectPath, async () => {
          const finalUrl = await navigateTo(url)
          return { ok: true as const, url: finalUrl }
        })
      } catch (e) {
        return fail(e)
      }
    },
  )

  ipcMain.handle('voidcast:browser-back', async () => {
    try {
      sessionOrThrow()
      return { ok: true as const, url: await historyStep('back') }
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('voidcast:browser-forward', async () => {
    try {
      sessionOrThrow()
      return { ok: true as const, url: await historyStep('forward') }
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('voidcast:browser-reload', async () => {
    try {
      sessionOrThrow()
      return { ok: true as const, url: await reloadPage() }
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle(
    'voidcast:browser-snapshot',
    async (_event, payload: { maxNodes?: number; projectPath?: string }) => {
      try {
        const maxNodes = asInt(payload?.maxNodes, 400, 1, 2000)
        return await withSession(getWindow(), payload?.projectPath, async (s) => {
          const text = await s.cdp.snapshot(maxNodes)
          return { ok: true as const, text }
        })
      } catch (e) {
        return fail(e)
      }
    },
  )

  ipcMain.handle(
    'voidcast:browser-click',
    async (_event, payload: { uid?: string; projectPath?: string }) => {
      try {
        const uid = typeof payload?.uid === 'string' ? payload.uid.trim() : ''
        if (!uid) throw new Error('Missing uid.')
        return await withSession(getWindow(), payload?.projectPath, async (s) => {
          const text = await s.cdp.clickByUid(uid)
          return { ok: true as const, text }
        })
      } catch (e) {
        return fail(e)
      }
    },
  )

  ipcMain.handle(
    'voidcast:browser-fill',
    async (_event, payload: { uid?: string; text?: string; submit?: boolean; projectPath?: string }) => {
      try {
        const uid = typeof payload?.uid === 'string' ? payload.uid.trim() : ''
        if (!uid) throw new Error('Missing uid.')
        const text = typeof payload?.text === 'string' ? payload.text : ''
        return await withSession(getWindow(), payload?.projectPath, async (s) => {
          const result = await s.cdp.fillByUid(uid, text, Boolean(payload?.submit))
          return { ok: true as const, text: result }
        })
      } catch (e) {
        return fail(e)
      }
    },
  )

  ipcMain.handle(
    'voidcast:browser-press-key',
    async (_event, payload: { key?: string; projectPath?: string }) => {
      try {
        const key = typeof payload?.key === 'string' ? payload.key.trim() : ''
        if (!key) throw new Error('Missing key.')
        return await withSession(getWindow(), payload?.projectPath, async (s) => {
          const text = await s.cdp.pressKey(key)
          return { ok: true as const, text }
        })
      } catch (e) {
        return fail(e)
      }
    },
  )

  ipcMain.handle(
    'voidcast:browser-screenshot',
    async (
      _event,
      payload: { projectPath?: string; uid?: string; fullPage?: boolean },
    ) => {
      try {
        const projectPath =
          typeof payload?.projectPath === 'string' && payload.projectPath.trim()
            ? payload.projectPath.trim()
            : undefined
        const uid = typeof payload?.uid === 'string' ? payload.uid.trim() : ''
        return await withSession(getWindow(), projectPath, async () => {
          const shot = await takeBrowserScreenshot(projectPath, {
            uid: uid || undefined,
            fullPage: Boolean(payload?.fullPage),
          })
          return { ok: true as const, ...shot }
        })
      } catch (e) {
        return fail(e)
      }
    },
  )

  ipcMain.handle(
    'voidcast:browser-emulate',
    async (
      _event,
      payload: {
        width?: number
        height?: number
        deviceScaleFactor?: number
        mobile?: boolean
        darkMode?: boolean
        reset?: boolean
        projectPath?: string
      },
    ) => {
      try {
        return await withSession(getWindow(), payload?.projectPath, async () => {
          const text = await emulateBrowser({
            width: payload?.width,
            height: payload?.height,
            deviceScaleFactor: payload?.deviceScaleFactor,
            mobile: payload?.mobile,
            darkMode: payload?.darkMode,
            reset: payload?.reset,
          })
          return { ok: true as const, text }
        })
      } catch (e) {
        return fail(e)
      }
    },
  )

  ipcMain.handle('voidcast:browser-console-logs', async (_event, payload: { limit?: number }) => {
    try {
      const s = sessionOrThrow()
      return { ok: true as const, text: s.cdp.consoleLogText(asInt(payload?.limit, 25, 1, 200)) }
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle(
    'voidcast:browser-network-requests',
    async (_event, payload: { limit?: number }) => {
      try {
        const s = sessionOrThrow()
        return { ok: true as const, text: s.cdp.networkRequestText(asInt(payload?.limit, 25, 1, 200)) }
      } catch (e) {
        return fail(e)
      }
    },
  )

  ipcMain.handle(
    'voidcast:browser-wait-for',
    async (
      _event,
      payload: {
        selector?: string
        text?: string
        urlPattern?: string
        networkIdle?: boolean
        timeoutMs?: number
        projectPath?: string
      },
    ) => {
      try {
        const selector = typeof payload?.selector === 'string' ? payload.selector.trim() : ''
        const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
        const urlPattern = typeof payload?.urlPattern === 'string' ? payload.urlPattern.trim() : ''
        if (!selector && !text && !urlPattern && !payload?.networkIdle) {
          throw new Error('Nothing to wait for — pass selector, text, urlPattern or networkIdle.')
        }
        return await withSession(getWindow(), payload?.projectPath, async (s) => {
          const result = await s.cdp.waitFor({
            selector: selector || undefined,
            text: text || undefined,
            urlPattern: urlPattern || undefined,
            networkIdle: Boolean(payload?.networkIdle),
            timeoutMs: asInt(payload?.timeoutMs, 10000, 250, 60000),
          })
          return { ok: true as const, text: result }
        })
      } catch (e) {
        return fail(e)
      }
    },
  )

  ipcMain.handle(
    'voidcast:browser-handle-dialog',
    async (_event, payload: { accept?: boolean; promptText?: string; projectPath?: string }) => {
      try {
        return await withSession(getWindow(), payload?.projectPath, async (s) => {
          const result = await s.cdp.handleDialog({
            accept: payload?.accept !== false,
            promptText: typeof payload?.promptText === 'string' ? payload.promptText : undefined,
          })
          return { ok: true as const, text: result }
        })
      } catch (e) {
        return fail(e)
      }
    },
  )

  ipcMain.handle('voidcast:browser-list-pages', async () => {
    try {
      // Listing never creates a page — an empty browser is a valid answer.
      return { ok: true as const, ...listBrowserPages() }
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle(
    'voidcast:browser-new-page',
    async (_event, payload: { url?: string; background?: boolean; projectPath?: string }) => {
      try {
        const url = typeof payload?.url === 'string' ? payload.url.trim() : ''
        if (!url) throw new Error('Missing url.')
        const res = await openBrowserPage(
          getWindow(),
          url,
          Boolean(payload?.background),
          payload?.projectPath,
        )
        return { ok: true as const, ...res }
      } catch (e) {
        return fail(e)
      }
    },
  )

  ipcMain.handle('voidcast:browser-select-page', async (_event, payload: { pageId?: string }) => {
    try {
      const pageId = typeof payload?.pageId === 'string' ? payload.pageId.trim() : ''
      if (!pageId) throw new Error('Missing pageId.')
      return { ok: true as const, ...selectBrowserPage(pageId) }
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('voidcast:browser-close-page', async (_event, payload: { pageId?: string }) => {
    try {
      const pageId = typeof payload?.pageId === 'string' ? payload.pageId.trim() : ''
      if (!pageId) throw new Error('Missing pageId.')
      return { ok: true as const, ...closeBrowserPage(pageId) }
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('voidcast:browser-open-external', async (_event, payload: { url?: string }) => {
    try {
      const url = typeof payload?.url === 'string' ? payload.url.trim() : ''
      if (!/^https?:/i.test(url)) throw new Error('Only http(s) URLs can be opened externally.')
      await shell.openExternal(url)
      return { ok: true as const }
    } catch (e) {
      return fail(e)
    }
  })

  app.on('before-quit', () => disposeBrowserView())
}
