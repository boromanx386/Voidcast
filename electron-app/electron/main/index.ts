import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  shell,
  Tray,
  nativeImage,
  type NativeImage,
  type OpenDialogOptions,
} from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { update } from './update'
import { scrapePublicUrlToText } from './scrape'
import { savePdfToFolder } from './pdf'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron-Main
// │ └─┬ preload
// │   └── index.mjs   > Preload-Scripts
// ├─┬ dist
// │ └── index.html    > Electron-Renderer
//
process.env.APP_ROOT = path.join(__dirname, '../..')

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

// Disable GPU Acceleration for Windows 7
if (os.release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win: BrowserWindow | null = null
let tray: Tray | null = null
/** True when user chose Quit (vs close-to-tray). */
let isQuitting = false
const preload = path.join(__dirname, '../preload/index.mjs')
const indexHtml = path.join(RENDERER_DIST, 'index.html')
const appIconPath = app.isPackaged
  ? path.join(process.resourcesPath, 'logo_app_nobg.png')
  : path.join(process.env.APP_ROOT, '..', 'logo_app_nobg.png')

function createZoomedTrayIcon(iconPath: string): NativeImage | null {
  const src = nativeImage.createFromPath(iconPath)
  if (src.isEmpty()) return null

  const { width, height } = src.getSize()
  if (width <= 0 || height <= 0) return null

  // Crop to center so the symbol occupies more of the tray icon.
  const cropWidth = Math.max(1, Math.floor(width * 0.5))
  const cropHeight = Math.max(1, Math.floor(height * 0.5))
  const x = Math.max(0, Math.floor((width - cropWidth) / 2))
  const y = Math.max(0, Math.floor((height - cropHeight) / 2))

  return src
    .crop({ x, y, width: cropWidth, height: cropHeight })
    .resize({ width: 18, height: 18 })
}

function createZoomedWindowIcon(iconPath: string): NativeImage | null {
  const src = nativeImage.createFromPath(iconPath)
  if (src.isEmpty()) return null

  const { width, height } = src.getSize()
  if (width <= 0 || height <= 0) return null

  // Stronger crop than tray so Windows taskbar/app icon appears visually larger.
  const cropWidth = Math.max(1, Math.floor(width * 0.55))
  const cropHeight = Math.max(1, Math.floor(height * 0.55))
  const x = Math.max(0, Math.floor((width - cropWidth) / 2))
  const y = Math.max(0, Math.floor((height - cropHeight) / 2))

  return src
    .crop({ x, y, width: cropWidth, height: cropHeight })
    .resize({ width: 256, height: 256 })
}

// Create tray icon
function createTray() {
  // Try app icon first, fallback to a simple icon.
  const iconPath = appIconPath

  try {
    const zoomedIcon = createZoomedTrayIcon(iconPath)
    if (zoomedIcon) {
      tray = new Tray(zoomedIcon)
    } else {
      tray = new Tray(createDefaultIcon())
    }
  } catch {
    tray = new Tray(createDefaultIcon())
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Voidcast',
      click: () => {
        if (win) {
          win.show()
          win.focus()
        }
      },
    },
    {
      label: 'New Chat',
      click: () => {
        if (win) {
          win.show()
          win.focus()
          win.webContents.send('voidcast:new-chat')
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])
  
  tray.setToolTip('Voidcast')
  tray.setContextMenu(contextMenu)
  
  // Double-click to show window
  tray.on('double-click', () => {
    if (win) {
      win.show()
      win.focus()
    }
  })
}

// Create a simple default icon (cyan triangle)
function createDefaultIcon(): NativeImage {
  // Create a 16x16 PNG icon
  const size = 16
  const canvas = Buffer.alloc(size * size * 4)
  
  // Fill with transparent and draw a cyan triangle
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4
      
      // Calculate if pixel is inside triangle
      const cx = size / 2
      const cy = size / 2
      const margin = 2
      const height = size - margin * 2
      
      // Triangle: top center to bottom left and bottom right
      const topY = margin
      const bottomY = size - margin
      const leftX = margin
      const rightX = size - margin
      
      // Check if inside triangle
      const relY = (y - topY) / (bottomY - topY)
      if (relY < 0 || relY > 1) {
        canvas[idx] = 0     // R
        canvas[idx + 1] = 0 // G
        canvas[idx + 2] = 0 // B
        canvas[idx + 3] = 0 // A (transparent)
        continue
      }
      
      const halfWidth = (leftX + (rightX - leftX) * relY) / 2
      const leftEdge = cx - halfWidth
      const rightEdge = cx + halfWidth
      
      if (x >= leftEdge && x <= rightEdge) {
        // Cyan color #00f5ff
        canvas[idx] = 0       // R
        canvas[idx + 1] = 245 // G
        canvas[idx + 2] = 255 // B
        canvas[idx + 3] = 255 // A
      } else {
        canvas[idx] = 0
        canvas[idx + 1] = 0
        canvas[idx + 2] = 0
        canvas[idx + 3] = 0
      }
    }
  }
  
  return nativeImage.createFromBuffer(canvas, {
    width: size,
    height: size,
  })
}

async function createWindow() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
  }

  const windowIcon = process.platform === 'win32'
    ? (createZoomedWindowIcon(appIconPath) ?? appIconPath)
    : appIconPath

  win = new BrowserWindow({
    title: 'Voidcast',
    autoHideMenuBar: true,
    icon: windowIcon,
    show: false, // Start hidden until ready
    webPreferences: {
      preload,
      // Warning: Enable nodeIntegration and disable contextIsolation is not secure in production
      // nodeIntegration: true,

      // Consider using contextBridge.exposeInMainWorld
      // Read more on https://www.electronjs.org/docs/latest/tutorial/context-isolation
      // contextIsolation: false,
    },
  })

  if (VITE_DEV_SERVER_URL) { // #298
    win.loadURL(VITE_DEV_SERVER_URL)
    // Open devTool if the app is not packaged
    win.webContents.openDevTools()
  } else {
    win.loadFile(indexHtml)
  }

  // Show window when ready
  win.once('ready-to-show', () => {
    win?.show()
  })

  // Test actively push message to the Electron-Renderer
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Minimize to tray instead of closing
  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      win?.hide()
    }
  })

  // Auto update
  update(win)

  // Register clipboard TTS shortcut
  const readClipboardTtsShortcut = 'CommandOrControl+Alt+Shift+V'
  win.webContents.once('did-finish-load', () => {
    const ok = globalShortcut.register(readClipboardTtsShortcut, () => {
      if (!win) return
      const text = clipboard.readText().trim()
      if (!text) return
      // TTS can run in the tray: do not show/focus the window
      win.webContents.send('voidcast:read-clipboard-tts', text)
    })
    if (!ok) {
      console.warn(
        `Voidcast: could not register global shortcut ${readClipboardTtsShortcut}`,
      )
    }
  })
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.whenReady().then(() => {
  createWindow()
  createTray()
})

app.on('window-all-closed', () => {
  // On macOS, don't quit when all windows closed (menu bar app style)
  if (process.platform !== 'darwin') {
    // Don't quit, stay in tray
  }
})

app.on('second-instance', () => {
  if (win) {
    // Focus on the main window if the user tried to open another
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    createWindow()
  }
})

// Handle before-quit to set isQuitting flag
app.on('before-quit', () => {
  isQuitting = true
})

ipcMain.handle(
  'voidcast:web-search',
  async (_evt, query: string) => {
    try {
      const q = String(query ?? '').trim()
      if (!q) return { ok: false, text: 'Empty query' }
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`
      const res = await fetch(url)
      if (!res.ok) return { ok: false, text: `HTTP ${res.status}` }
      const data = (await res.json()) as {
        AbstractText?: string
        AbstractURL?: string
        Answer?: string
        RelatedTopics?: { Text?: string }[]
      }
      const parts: string[] = []
      if (data.Answer) parts.push(data.Answer)
      if (data.AbstractText) parts.push(data.AbstractText)
      if (data.AbstractURL) parts.push(`Source: ${data.AbstractURL}`)
      const topics = (data.RelatedTopics ?? [])
        .slice(0, 5)
        .map((t) => t.Text)
        .filter(Boolean) as string[]
      if (topics.length) parts.push(`Related: ${topics.join('; ')}`)
      if (parts.length === 0) {
        return {
          ok: true,
          text: 'No instant results from DuckDuckGo. Try rephrasing the query.',
        }
      }
      return { ok: true, text: parts.join('\n\n') }
    } catch (e) {
      return {
        ok: false,
        text: e instanceof Error ? e.message : String(e),
      }
    }
  },
)

type WttrJson = {
  current_condition?: Array<{
    temp_C?: string
    humidity?: string
    windspeedKmph?: string
    weatherDesc?: Array<{ value?: string }>
  }>
  weather?: Array<{
    date?: string
    maxtempC?: string
    mintempC?: string
    hourly?: Array<{ weatherDesc?: Array<{ value?: string }> }>
  }>
}

function formatWttrText(data: WttrJson, city: string, forecast: boolean): string {
  const curr = data.current_condition?.[0]
  if (!curr) return 'No weather data returned for this location.'
  const desc = curr.weatherDesc?.[0]?.value ?? ''
  let res = `Weather for ${city}: ${curr.temp_C ?? '?'}°C, ${desc}\n`
  res += `Humidity: ${curr.humidity ?? '?'}%, Wind: ${curr.windspeedKmph ?? '?'} km/h`
  if (forecast && data.weather && data.weather.length > 0) {
    res += '\n\nForecast (3 days):'
    for (const day of data.weather.slice(0, 3)) {
      const d = day.date ?? '?'
      const mx = day.maxtempC ?? '?'
      const mn = day.mintempC ?? '?'
      const hourlyDesc = day.hourly?.[0]?.weatherDesc?.[0]?.value ?? ''
      res += `\n- ${d}: ${mx}°C / ${mn}°C — ${hourlyDesc}`
    }
  }
  return res
}

ipcMain.handle(
  'voidcast:scrape-url',
  async (_evt, payload: { url?: string; max_chars?: number }) => {
    const url = String(payload?.url ?? '').trim()
    return scrapePublicUrlToText(url, payload?.max_chars)
  },
)

ipcMain.handle(
  'voidcast:save-pdf',
  async (
    _evt,
    payload: {
      content?: string
      title?: string
      filename?: string
      outputDir?: string
    },
  ) => {
    return savePdfToFolder(payload)
  },
)

function sanitizeBaseName(input: string): string {
  const clean = input
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return clean || 'runware-image'
}

function extFromContentType(contentType: string): string {
  const ct = contentType.toLowerCase()
  if (ct.includes('image/png')) return '.png'
  if (ct.includes('image/webp')) return '.webp'
  if (ct.includes('image/gif')) return '.gif'
  if (ct.includes('image/jpeg') || ct.includes('image/jpg')) return '.jpg'
  return '.jpg'
}

function extFromAudioContentType(contentType: string): string {
  const ct = contentType.toLowerCase()
  if (ct.includes('audio/mpeg') || ct.includes('audio/mp3')) return '.mp3'
  if (ct.includes('audio/wav') || ct.includes('audio/wave') || ct.includes('audio/x-wav')) return '.wav'
  if (ct.includes('audio/flac')) return '.flac'
  if (ct.includes('audio/ogg')) return '.ogg'
  return '.mp3'
}

async function nextAvailablePath(outputDir: string, baseName: string, ext: string): Promise<string> {
  for (let i = 0; i < 500; i++) {
    const suffix = i === 0 ? '' : `-${i + 1}`
    const candidate = path.join(outputDir, `${baseName}${suffix}${ext}`)
    try {
      await stat(candidate)
      continue
    } catch {
      return candidate
    }
  }
  return path.join(outputDir, `${baseName}-${Date.now()}${ext}`)
}

ipcMain.handle(
  'voidcast:save-image-from-url',
  async (
    _evt,
    payload: {
      imageUrl?: string
      outputDir?: string
      filename?: string
    },
  ) => {
    try {
      const imageUrl = String(payload?.imageUrl ?? '').trim()
      const outputDir = String(payload?.outputDir ?? '').trim()
      if (!imageUrl) return { ok: false, text: 'Missing imageUrl' }
      if (!outputDir) return { ok: false, text: 'Missing outputDir' }
      await mkdir(outputDir, { recursive: true })

      const res = await fetch(imageUrl)
      if (!res.ok) {
        return { ok: false, text: `Image download failed: HTTP ${res.status}` }
      }
      const ab = await res.arrayBuffer()
      const contentType = res.headers.get('content-type') || 'image/jpeg'

      const urlName = (() => {
        try {
          const p = new URL(imageUrl).pathname
          return path.basename(p) || ''
        } catch {
          return ''
        }
      })()
      const inputBase = String(payload?.filename ?? '').trim()
      const fallbackBase = `runware-image-${new Date().toISOString().replace(/[:.]/g, '-')}`
      const chosenBase = sanitizeBaseName(
        inputBase || path.basename(urlName, path.extname(urlName)) || fallbackBase,
      )
      const ext = path.extname(urlName) || extFromContentType(contentType)
      const outPath = await nextAvailablePath(outputDir, chosenBase, ext)

      await writeFile(outPath, Buffer.from(ab))
      return { ok: true, text: `Saved image: ${outPath}` }
    } catch (e) {
      return { ok: false, text: e instanceof Error ? e.message : String(e) }
    }
  },
)

ipcMain.handle(
  'voidcast:save-audio-from-url',
  async (
    _evt,
    payload: {
      audioUrl?: string
      outputDir?: string
      filename?: string
    },
  ) => {
    try {
      const audioUrl = String(payload?.audioUrl ?? '').trim()
      const outputDir = String(payload?.outputDir ?? '').trim()
      if (!audioUrl) return { ok: false, text: 'Missing audioUrl' }
      if (!outputDir) return { ok: false, text: 'Missing outputDir' }
      await mkdir(outputDir, { recursive: true })

      const res = await fetch(audioUrl)
      if (!res.ok) {
        return { ok: false, text: `Audio download failed: HTTP ${res.status}` }
      }
      const ab = await res.arrayBuffer()
      const contentType = res.headers.get('content-type') || 'audio/mpeg'

      const urlName = (() => {
        try {
          const p = new URL(audioUrl).pathname
          return path.basename(p) || ''
        } catch {
          return ''
        }
      })()
      const inputBase = String(payload?.filename ?? '').trim()
      const fallbackBase = `runware-audio-${new Date().toISOString().replace(/[:.]/g, '-')}`
      const chosenBase = sanitizeBaseName(
        inputBase || path.basename(urlName, path.extname(urlName)) || fallbackBase,
      )
      const ext = path.extname(urlName) || extFromAudioContentType(contentType)
      const outPath = await nextAvailablePath(outputDir, chosenBase, ext)

      await writeFile(outPath, Buffer.from(ab))
      return { ok: true, text: `Saved audio: ${outPath}` }
    } catch (e) {
      return { ok: false, text: e instanceof Error ? e.message : String(e) }
    }
  },
)

ipcMain.handle(
  'voidcast:runware-proxy',
  async (
    _evt,
    payload: {
      api_base_url?: string
      api_key?: string
      tasks?: unknown[]
    },
  ) => {
    try {
      const base = String(payload?.api_base_url ?? '').trim().replace(/\/+$/, '')
      const key = String(payload?.api_key ?? '').trim()
      const tasks = Array.isArray(payload?.tasks) ? payload.tasks : []
      if (!base) return { ok: false, detail: 'api_base_url is required' }
      if (!base.startsWith('https://')) {
        return { ok: false, detail: 'Runware base URL must use https://' }
      }
      if (!key) return { ok: false, detail: 'api_key is required' }
      if (tasks.length === 0) return { ok: false, detail: 'tasks must not be empty' }

      const res = await fetch(base, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(tasks),
      })
      const data = (await res.json().catch(() => ({}))) as {
        errors?: Array<{ message?: string }>
        message?: string
        error?: string
      }
      if (!res.ok) {
        const detail =
          data?.errors?.[0]?.message ||
          data?.message ||
          data?.error ||
          `Runware HTTP ${res.status}`
        return { ok: false, detail }
      }
      return { ok: true, data }
    } catch (e) {
      return {
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      }
    }
  },
)

ipcMain.handle('voidcast:pick-directory', async () => {
  const opts: OpenDialogOptions = {
    title: 'Choose folder for PDFs',
    properties: ['openDirectory'],
  }
  const result = win
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts)
  if (result.canceled || !result.filePaths?.[0]) {
    return { ok: false as const }
  }
  return { ok: true as const, path: result.filePaths[0] }
})

const MAX_CHAT_IMAGE_BYTES = 4 * 1024 * 1024
const MAX_CHAT_IMAGE_FILES = 4

function mimeFromImagePath(filePath: string): string {
  const e = path.extname(filePath).replace(/^\./, '').toLowerCase()
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    avif: 'image/avif',
    ico: 'image/x-icon',
    svg: 'image/svg+xml',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    heic: 'image/heic',
    heif: 'image/heif',
  }
  return map[e] ?? 'image/png'
}

/** Native file dialog + fs.readFile — avoids hidden `<input type=file>` + `.click()` issues on some Windows/Electron builds. */
ipcMain.handle('voidcast:pick-images', async () => {
  const opts: OpenDialogOptions = {
    title: 'Choose image(s) for chat',
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Images',
        extensions: [
          'png',
          'jpg',
          'jpeg',
          'webp',
          'gif',
          'bmp',
          'avif',
          'tif',
          'tiff',
          'svg',
          'heic',
          'heif',
        ],
      },
    ],
  }
  const result = win
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts)
  if (result.canceled || !result.filePaths?.length) {
    return { ok: false as const }
  }
  const paths = result.filePaths.slice(0, MAX_CHAT_IMAGE_FILES)
  for (const fp of paths) {
    try {
      const st = await stat(fp)
      if (st.size > MAX_CHAT_IMAGE_BYTES) {
        return {
          ok: false as const,
          error: `Too large (max 4 MB): ${path.basename(fp)}`,
        }
      }
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  }
  const files: { base64: string; mime: string; name: string; path: string }[] = []
  for (const fp of paths) {
    const buf = await readFile(fp)
    files.push({
      base64: buf.toString('base64'),
      mime: mimeFromImagePath(fp),
      name: path.basename(fp),
      path: fp,
    })
  }
  return { ok: true as const, files }
})

ipcMain.handle('voidcast:read-image-file', async (_evt, payload: { path?: string }) => {
  try {
    const fp = String(payload?.path ?? '').trim()
    if (!fp) return { ok: false as const, error: 'Missing image path.' }
    const buf = await readFile(fp)
    return {
      ok: true as const,
      file: {
        base64: buf.toString('base64'),
        mime: mimeFromImagePath(fp),
        name: path.basename(fp),
        path: fp,
      },
    }
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    }
  }
})

ipcMain.handle(
  'voidcast:get-weather',
  async (_evt, payload: { city?: string; forecast?: boolean }) => {
    try {
      const city = String(payload?.city ?? '').trim()
      if (!city) return { ok: false, text: 'Empty city' }
      const forecast = Boolean(payload.forecast)
      const path = encodeURIComponent(city)
      const url = `https://wttr.in/${path}?format=j1`
      const res = await fetch(url)
      if (!res.ok) return { ok: false, text: `HTTP ${res.status}` }
      const data = (await res.json()) as WttrJson
      return { ok: true, text: formatWttrText(data, city, forecast) }
    } catch (e) {
      return {
        ok: false,
        text: e instanceof Error ? e.message : String(e),
      }
    }
  },
)

// New window example arg: new windows url
ipcMain.handle('open-win', (_, arg) => {
  const childWindow = new BrowserWindow({
    autoHideMenuBar: true,
    webPreferences: {
      preload,
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    childWindow.loadURL(`${VITE_DEV_SERVER_URL}#${arg}`)
  } else {
    childWindow.loadFile(indexHtml, { hash: arg })
  }
})

// IPC to show/hide window
ipcMain.handle('voidcast:show-window', () => {
  if (win) {
    win.show()
    win.focus()
  }
})

ipcMain.handle('voidcast:hide-window', () => {
  if (win) {
    win.hide()
  }
})

ipcMain.handle('voidcast:quit-app', () => {
  isQuitting = true
  app.quit()
})

ipcMain.handle('voidcast:get-lan-network-info', () => {
  const nets = os.networkInterfaces()
  const ips: string[] = []
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      const fam = net.family
      const isV4 = fam === 'IPv4'
      if (isV4 && !net.internal) {
        ips.push(net.address)
      }
    }
  }
  return { ips: [...new Set(ips)] }
})

ipcMain.handle('voidcast:open-path', async (_evt, filePath: string) => {
  const p = String(filePath ?? '').trim()
  if (!p) return { ok: false, text: 'Missing file path' }
  try {
    const err = await shell.openPath(p)
    if (err) return { ok: false, text: err }
    return { ok: true, text: `Opened: ${p}` }
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle('voidcast:get-app-version', () => {
  return app.getVersion()
})
