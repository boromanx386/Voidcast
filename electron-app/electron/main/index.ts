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
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
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
let toolsServerProcess: ChildProcessWithoutNullStreams | null = null
let toolsServerStarting = false
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

function getToolsServerDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'tts-server')
    : path.join(process.env.APP_ROOT, '..', 'tts-server')
}

function getBundledToolsExePath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'tools', 'voidcast-tools-server.exe')
    : path.join(process.env.APP_ROOT, '..', 'tts-server', 'dist', 'voidcast-tools-server.exe')
}

async function isToolsServerHealthy(baseUrl = 'http://127.0.0.1:8765'): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`)
    return res.ok
  } catch {
    return false
  }
}

function startToolsServerWithCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        OMNIVOICE_ENABLE_TTS: '0',
      },
      windowsHide: true,
    })
    toolsServerProcess = child
    let settled = false
    let stderrText = ''

    child.stdout.on('data', (chunk) => {
      const text = String(chunk)
      if (text.trim()) console.log(`[tools-server] ${text.trim()}`)
    })
    child.stderr.on('data', (chunk) => {
      const text = String(chunk)
      stderrText += text
      if (text.trim()) console.warn(`[tools-server] ${text.trim()}`)
    })

    const settle = (ok: boolean) => {
      if (settled) return
      settled = true
      resolve(ok)
    }

    child.once('error', () => {
      if (toolsServerProcess === child) toolsServerProcess = null
      settle(false)
    })

    child.once('exit', () => {
      if (toolsServerProcess === child) toolsServerProcess = null
      if (!settled && /No module named|ModuleNotFoundError/i.test(stderrText)) {
        settle(false)
        return
      }
      settle(false)
    })

    // If process stays alive a bit, treat startup as successful candidate.
    setTimeout(() => {
      settle(!child.killed && child.exitCode === null)
    }, 1200)
  })
}

async function ensureToolsServerRunning(): Promise<void> {
  if (toolsServerStarting) return
  toolsServerStarting = true
  try {
    if (await isToolsServerHealthy()) return
    const cwd = getToolsServerDir()
    const bundledExe = getBundledToolsExePath()
    const args = [
      '-m',
      'uvicorn',
      'tools_main:app',
      '--host',
      '127.0.0.1',
      '--port',
      '8765',
      '--app-dir',
      cwd,
    ]
    const candidates: Array<{ command: string; args: string[] }> = []
    candidates.push({ command: bundledExe, args: [] })
    if (!app.isPackaged) {
      const devPython = path.join(process.env.APP_ROOT, '..', '.venv', 'Scripts', 'python.exe')
      candidates.push({ command: devPython, args })
    }
    candidates.push({ command: 'py', args: ['-3', ...args] })
    candidates.push({ command: 'python', args })

    for (const candidate of candidates) {
      const ok = await startToolsServerWithCommand(candidate.command, candidate.args, cwd)
      if (!ok) continue
      for (let i = 0; i < 12; i++) {
        if (await isToolsServerHealthy()) {
          console.log('[tools-server] Ready on http://127.0.0.1:8765')
          return
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      toolsServerProcess?.kill()
      toolsServerProcess = null
    }
    console.warn(
      '[tools-server] Auto-start failed. Build may be missing bundled tools executable.',
    )
  } finally {
    toolsServerStarting = false
  }
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
  if (toolsServerProcess && !toolsServerProcess.killed) {
    toolsServerProcess.kill()
    toolsServerProcess = null
  }
  globalShortcut.unregisterAll()
})

app.whenReady().then(() => {
  void ensureToolsServerRunning()
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
      images?: { mime?: string; base64: string }[]
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

function resolveInsideProject(projectPath: string, inputPath: string): string {
  const root = path.resolve(projectPath)
  const requested = inputPath.trim() ? inputPath.trim() : '.'
  const abs = path.resolve(root, requested)
  const rel = path.relative(root, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path escapes project root.')
  }
  return abs
}

/** Skip heavy / generated dirs when walking project trees for search & glob. */
const CODING_SKIP_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  'target',
  'out',
  '__pycache__',
  '.turbo',
  '.cache',
  '.venv',
  'venv',
  'Pods',
  '.gradle',
  'DerivedData',
])

const CODING_READ_SOFT_CHAR_LIMIT = 220_000

function shouldSkipCodingWalkDir(name: string): boolean {
  if (name.startsWith('.')) {
    return name === '.git' || name === '.next' || name === '.turbo' || name === '.cache' || name === '.venv'
  }
  return CODING_SKIP_DIR_NAMES.has(name)
}

const MAX_GIT_OUTPUT_CHARS = 450_000
const GIT_COMMAND_TIMEOUT_MS = 25_000

function truncateGitOutput(text: string): string {
  if (text.length <= MAX_GIT_OUTPUT_CHARS) return text
  return `${text.slice(0, MAX_GIT_OUTPUT_CHARS)}\n\n… [output truncated to ${MAX_GIT_OUTPUT_CHARS} characters]`
}

function runGitCapture(
  cwd: string,
  args: string[],
  timeoutMs = GIT_COMMAND_TIMEOUT_MS,
): Promise<{ ok: true; stdout: string; stderr: string; code: number } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, shell: false, windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      resolve({ ok: false, error: `Git command timed out after ${Math.round(timeoutMs / 1000)}s.` })
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const code = (err as NodeJS.ErrnoException).code
      resolve({
        ok: false,
        error:
          code === 'ENOENT' || err.message.includes('ENOENT')
            ? 'Git executable not found on PATH.'
            : err.message,
      })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: true, stdout: stdout.trimEnd(), stderr: stderr.trimEnd(), code: code ?? 0 })
    })
  })
}

ipcMain.handle('voidcast:coding-pick-directory', async () => {
  const opts: OpenDialogOptions = {
    title: 'Choose coding project folder',
    properties: ['openDirectory'],
  }
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (result.canceled || !result.filePaths?.[0]) return { ok: false as const }
  return { ok: true as const, path: result.filePaths[0] }
})

ipcMain.handle(
  'voidcast:coding-list-directory',
  async (_evt, payload: { projectPath?: string; path?: string }) => {
    try {
      const projectPath = String(payload?.projectPath ?? '').trim()
      if (!projectPath) return { ok: false as const, error: 'Missing coding project path.' }
      const absDir = resolveInsideProject(projectPath, String(payload?.path ?? ''))
      const entries = await readdir(absDir, { withFileTypes: true })
      const mapped = await Promise.all(
        entries
          .filter((e) => !e.name.startsWith('.git'))
          .map(async (entry) => {
            const fullPath = path.join(absDir, entry.name)
            const st = await stat(fullPath).catch(() => null)
            return {
              name: entry.name,
              path: path.relative(projectPath, fullPath).replace(/\\/g, '/'),
              type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
              size: entry.isDirectory() ? undefined : st?.size,
            }
          }),
      )
      mapped.sort((a, b) =>
        a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1,
      )
      return { ok: true as const, entries: mapped }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  },
)

ipcMain.handle(
  'voidcast:coding-read-file',
  async (
    _evt,
    payload: {
      projectPath?: string
      path?: string
      startLine?: number
      endLine?: number
      maxChars?: number
      allowLargeRead?: boolean
    },
  ) => {
    try {
      const projectPath = String(payload?.projectPath ?? '').trim()
      const filePath = String(payload?.path ?? '').trim()
      if (!projectPath || !filePath) {
        return { ok: false as const, error: 'Missing projectPath or path.' }
      }
      const absFile = resolveInsideProject(projectPath, filePath)
      const content = await readFile(absFile, 'utf8')
      const allowLarge = payload?.allowLargeRead === true
      const startLine =
        typeof payload?.startLine === 'number' && Number.isFinite(payload.startLine)
          ? Math.max(1, Math.floor(payload.startLine))
          : undefined
      const endLine =
        typeof payload?.endLine === 'number' && Number.isFinite(payload.endLine)
          ? Math.max(1, Math.floor(payload.endLine))
          : undefined
      const maxChars =
        typeof payload?.maxChars === 'number' && Number.isFinite(payload.maxChars)
          ? Math.min(500_000, Math.max(1, Math.floor(payload.maxChars)))
          : undefined

      const hasPartial =
        startLine !== undefined || endLine !== undefined || maxChars !== undefined

      if (!allowLarge && !hasPartial && content.length > CODING_READ_SOFT_CHAR_LIMIT) {
        return {
          ok: false as const,
          error: `File is too large to read at once (${content.length} chars; soft limit ${CODING_READ_SOFT_CHAR_LIMIT}). Use start_line/end_line (1-based) or max_chars, or read a smaller range.`,
        }
      }

      let out = content
      let lineRangeNote = ''

      if (startLine !== undefined || endLine !== undefined) {
        const lines = content.split(/\r?\n/)
        const total = lines.length
        const from = startLine !== undefined ? startLine - 1 : 0
        let to =
          endLine !== undefined ? endLine - 1 : startLine !== undefined ? startLine - 1 + 399 : total - 1
        if (endLine === undefined && startLine !== undefined) {
          to = Math.min(startLine - 1 + 399, total - 1)
        }
        const safeFrom = Math.max(0, Math.min(from, total > 0 ? total - 1 : 0))
        const safeTo = Math.max(safeFrom, Math.min(to, total > 0 ? total - 1 : 0))
        const slice = lines.slice(safeFrom, safeTo + 1)
        const numbered = slice.map((line, i) => {
          const n = safeFrom + i + 1
          return `${n}| ${line}`
        })
        out = numbered.join('\n')
        lineRangeNote = `\n(lines ${safeFrom + 1}-${safeTo + 1} of ${total})`
      }

      if (maxChars !== undefined && out.length > maxChars) {
        out = `${out.slice(0, maxChars)}\n\n… [truncated to ${maxChars} characters]${lineRangeNote}`
      } else if (lineRangeNote && !out.endsWith(lineRangeNote.trim())) {
        out = `${out}${lineRangeNote}`
      }

      return { ok: true as const, content: out }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  },
)

ipcMain.handle(
  'voidcast:coding-write-file',
  async (_evt, payload: { projectPath?: string; path?: string; content?: string }) => {
    try {
      const projectPath = String(payload?.projectPath ?? '').trim()
      const filePath = String(payload?.path ?? '').trim()
      if (!projectPath || !filePath) {
        return { ok: false as const, error: 'Missing projectPath or path.' }
      }
      const absFile = resolveInsideProject(projectPath, filePath)
      const content = String(payload?.content ?? '')
      await mkdir(path.dirname(absFile), { recursive: true })
      try {
        const previous = await readFile(absFile, 'utf8')
        const backupPath = `${absFile}.bak-${Date.now()}`
        await writeFile(backupPath, previous, 'utf8')
      } catch {
        // New file; no backup needed.
      }
      await writeFile(absFile, content, 'utf8')
      return { ok: true as const, path: filePath.replace(/\\/g, '/') }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  },
)

ipcMain.handle(
  'voidcast:coding-search-files',
  async (_evt, payload: { projectPath?: string; query?: string; pathPrefix?: string }) => {
    try {
      const projectPath = String(payload?.projectPath ?? '').trim()
      const query = String(payload?.query ?? '').trim()
      if (!projectPath || !query) {
        return { ok: false as const, error: 'Missing projectPath or query.' }
      }
      const root = path.resolve(projectPath)
      const prefix = String(payload?.pathPrefix ?? '').trim()
      const searchRoot = prefix ? resolveInsideProject(projectPath, prefix) : root
      const results: Array<{ path: string; line: number; text: string }> = []
      const visit = async (dir: string): Promise<void> => {
        const entries = await readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (shouldSkipCodingWalkDir(entry.name)) continue
            await visit(path.join(dir, entry.name))
            continue
          }
          const full = path.join(dir, entry.name)
          const rel = path.relative(root, full).replace(/\\/g, '/')
          if (!/\.(ts|tsx|js|jsx|json|md|txt|py|java|cs|css|html|yml|yaml|rs|go|vue|svelte)$/i.test(rel))
            continue
          const content = await readFile(full, 'utf8').catch(() => '')
          if (!content) continue
          const lines = content.split(/\r?\n/)
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(query.toLowerCase())) {
              results.push({ path: rel, line: i + 1, text: lines[i].trim().slice(0, 240) })
              if (results.length >= 200) return
            }
          }
        }
      }
      await visit(searchRoot)
      return { ok: true as const, matches: results }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  },
)

ipcMain.handle(
  'voidcast:coding-glob-files',
  async (
    _evt,
    payload: {
      projectPath?: string
      pathPrefix?: string
      extensions?: string[]
      maxResults?: number
    },
  ) => {
    try {
      const projectPath = String(payload?.projectPath ?? '').trim()
      if (!projectPath) return { ok: false as const, error: 'Missing projectPath.' }
      const root = path.resolve(projectPath)
      const prefix = String(payload?.pathPrefix ?? '').trim()
      const walkRoot = prefix ? resolveInsideProject(projectPath, prefix) : root
      const rawExt = Array.isArray(payload?.extensions) ? payload.extensions : []
      const extensions = rawExt
        .map((e) => String(e).trim().replace(/^\./, '').toLowerCase())
        .filter(Boolean)
      const defaultExt = ['ts', 'tsx', 'js', 'jsx', 'json', 'md', 'css', 'html', 'py', 'rs', 'go', 'vue']
      const useExt = extensions.length > 0 ? extensions : defaultExt
      const maxRaw = Number(payload?.maxResults)
      const maxResults = Number.isFinite(maxRaw)
        ? Math.min(500, Math.max(1, Math.floor(maxRaw)))
        : 150

      const paths: string[] = []
      const visit = async (dir: string): Promise<void> => {
        if (paths.length >= maxResults) return
        const entries = await readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (paths.length >= maxResults) return
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            if (shouldSkipCodingWalkDir(entry.name)) continue
            await visit(full)
            continue
          }
          const rel = path.relative(root, full).replace(/\\/g, '/')
          const dot = rel.lastIndexOf('.')
          const ext = dot >= 0 ? rel.slice(dot + 1).toLowerCase() : ''
          if (!useExt.includes(ext)) continue
          paths.push(rel)
        }
      }
      await visit(walkRoot)
      return { ok: true as const, paths }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  },
)

ipcMain.handle(
  'voidcast:coding-git',
  async (
    _evt,
    payload: {
      projectPath?: string
      mode?: 'status' | 'diff'
      path?: string
      staged?: boolean
    },
  ) => {
    try {
      const projectPath = String(payload?.projectPath ?? '').trim()
      if (!projectPath) return { ok: false as const, error: 'Missing projectPath.' }
      const root = path.resolve(projectPath)
      const mode = payload?.mode === 'diff' ? 'diff' : 'status'

      const inside = await runGitCapture(root, ['rev-parse', '--is-inside-work-tree'])
      if (!inside.ok) return { ok: false as const, error: inside.error }
      if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
        const hint = inside.stderr?.trim() || 'Not a git repository.'
        return {
          ok: false as const,
          error: /not a git repository/i.test(hint) ? 'Not a git repository.' : hint,
        }
      }

      if (mode === 'status') {
        const r = await runGitCapture(root, [
          '-c',
          'core.quotepath=false',
          'status',
          '--short',
          '--branch',
          '--untracked-files=all',
        ])
        if (!r.ok) return { ok: false as const, error: r.error }
        if (r.code !== 0) {
          return {
            ok: false as const,
            error: r.stderr.trim() || `git status failed (exit ${r.code}).`,
          }
        }
        const combined = [r.stdout, r.stderr].filter(Boolean).join('\n').trim()
        return {
          ok: true as const,
          text: truncateGitOutput(combined || '(no status output)'),
        }
      }

      const staged = payload?.staged === true
      const rel = String(payload?.path ?? '').trim()
      const args: string[] = staged ? ['diff', '--cached', '--no-color'] : ['diff', '--no-color']
      if (rel) {
        const abs = resolveInsideProject(projectPath, rel)
        const relGit = path.relative(root, abs).replace(/\\/g, '/')
        args.push('--', relGit)
      }
      const r = await runGitCapture(root, args)
      if (!r.ok) return { ok: false as const, error: r.error }
      if (r.code !== 0) {
        return {
          ok: false as const,
          error: r.stderr.trim() || `git diff failed (exit ${r.code}).`,
        }
      }
      let out = r.stdout
      if (r.stderr) out = [out, r.stderr].filter(Boolean).join('\n')
      const trimmed = out.trim()
      return {
        ok: true as const,
        text: truncateGitOutput(trimmed ? trimmed : '(no diff)'),
      }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  },
)

ipcMain.handle(
  'voidcast:coding-execute-command',
  async (_evt, payload: { projectPath?: string; command?: string; timeoutSec?: number; runInBackground?: boolean }) => {
    const projectPath = String(payload?.projectPath ?? '').trim()
    const command = String(payload?.command ?? '').trim()
    if (!projectPath || !command) {
      return { ok: false as const, error: 'Missing projectPath or command.' }
    }
    const timeoutSecRaw = Number(payload?.timeoutSec)
    const timeoutMs = Number.isFinite(timeoutSecRaw)
      ? Math.min(120_000, Math.max(3_000, Math.round(timeoutSecRaw * 1000)))
      : 20_000
    const runInBackground = payload?.runInBackground === true
    return new Promise<{ ok: true; stdout: string; stderr: string; code: number; timedOut?: boolean; pid?: number } | { ok: false; error: string }>((resolve) => {
      const child = spawn(command, {
        cwd: projectPath,
        shell: true,
        detached: runInBackground,
        stdio: runInBackground ? 'ignore' : 'pipe',
        windowsHide: true,
      })
      if (runInBackground) {
        child.unref()
        resolve({
          ok: true,
          stdout: `Started in background (pid ${child.pid ?? 'n/a'})`,
          stderr: '',
          code: 0,
          pid: child.pid ?? undefined,
        })
        return
      }
      let stdout = ''
      let stderr = ''
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        try {
          child.kill()
        } catch {
          // ignore kill errors
        }
        resolve({
          ok: true,
          stdout: stdout.trim(),
          stderr: [stderr.trim(), `Command timed out after ${Math.round(timeoutMs / 1000)}s and was stopped.`]
            .filter(Boolean)
            .join('\n'),
          code: 124,
          timedOut: true,
        })
      }, timeoutMs)
      child.stdout?.on('data', (chunk) => {
        stdout += String(chunk)
      })
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk)
      })
      child.on('error', (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ ok: false, error: err.message })
      })
      child.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ ok: true, stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 0 })
      })
    })
  },
)

const MAX_CHAT_IMAGE_BYTES = 4 * 1024 * 1024
const MAX_CHAT_IMAGE_FILES = 4
const MAX_CHAT_FILE_BYTES = 5 * 1024 * 1024
const MAX_CHAT_FILE_SNAPSHOT_BYTES = 400 * 1024
const MAX_CHAT_FILE_COUNT = 8
const CHAT_FILE_EXTENSIONS = new Set([
  'txt',
  'md',
  'pdf',
  'docx',
  'csv',
  'json',
  'js',
  'ts',
  'py',
  'java',
  'cs',
  'html',
  'css',
])
const CHAT_TEXT_FILE_EXTENSIONS = new Set([
  'txt',
  'md',
  'pdf',
  'docx',
  'csv',
  'json',
  'js',
  'ts',
  'py',
  'java',
  'cs',
  'html',
  'css',
])
const CHAT_IMAGE_EXTENSIONS = [
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
]
const CHAT_IMAGE_EXTENSION_SET = new Set(CHAT_IMAGE_EXTENSIONS)

function clampSnapshotText(raw: string): { content?: string; truncated?: boolean } {
  const text = String(raw ?? '')
  if (!text.trim()) return {}
  if (text.length <= MAX_CHAT_FILE_SNAPSHOT_BYTES) return { content: text }
  return {
    content: text.slice(0, MAX_CHAT_FILE_SNAPSHOT_BYTES),
    truncated: true,
  }
}

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

function extFromPath(filePath: string): string {
  return path.extname(filePath).replace(/^\./, '').toLowerCase()
}

function mimeFromChatFilePath(filePath: string): string {
  const ext = extFromPath(filePath)
  const map: Record<string, string> = {
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    js: 'text/javascript',
    ts: 'text/typescript',
    py: 'text/x-python',
    java: 'text/x-java-source',
    cs: 'text/plain',
    html: 'text/html',
    css: 'text/css',
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }
  return map[ext] || 'application/octet-stream'
}

async function toChatFileSnapshot(filePath: string): Promise<{
  name: string
  path: string
  mime: string
  size: number
  ext: string
  content?: string
  truncated?: boolean
}> {
  const st = await stat(filePath)
  if (st.size > MAX_CHAT_FILE_BYTES) {
    throw new Error(`Too large (max 5 MB): ${path.basename(filePath)}`)
  }
  const ext = extFromPath(filePath)
  if (!CHAT_FILE_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file type: ${path.basename(filePath)}`)
  }
  const base = {
    name: path.basename(filePath),
    path: filePath,
    mime: mimeFromChatFilePath(filePath),
    size: st.size,
    ext,
  }
  if (!CHAT_TEXT_FILE_EXTENSIONS.has(ext)) return base
  if (ext === 'pdf') {
    try {
      const pdfParseMod = await import('pdf-parse')
      const buf = await readFile(filePath)
      const PDFParseCtor = (pdfParseMod as { PDFParse: new (args: { data: Buffer }) => {
        getText: () => Promise<{ text?: string }>
        destroy: () => Promise<void>
      } }).PDFParse
      const parser = new PDFParseCtor({ data: buf })
      try {
        const parsed = await parser.getText()
        return { ...base, ...clampSnapshotText(parsed?.text || '') }
      } finally {
        await parser.destroy().catch(() => {})
      }
    } catch {
      return base
    }
  }
  if (ext === 'docx') {
    try {
      const mammothMod = await import('mammoth')
      const mammoth = mammothMod.default ?? mammothMod
      const extracted = await mammoth.extractRawText({ path: filePath })
      return { ...base, ...clampSnapshotText(extracted?.value || '') }
    } catch {
      return base
    }
  }
  const buf = await readFile(filePath)
  return { ...base, ...clampSnapshotText(buf.toString('utf8')) }
}

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

ipcMain.handle('voidcast:pick-chat-attachments', async () => {
  const opts: OpenDialogOptions = {
    title: 'Choose attachment(s) for chat',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Supported attachments', extensions: [...CHAT_IMAGE_EXTENSIONS, ...Array.from(CHAT_FILE_EXTENSIONS)] },
    ],
  }
  const result = win
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts)
  if (result.canceled || !result.filePaths?.length) {
    return { ok: false as const }
  }
  const imagePaths = result.filePaths.filter((fp) => CHAT_IMAGE_EXTENSION_SET.has(extFromPath(fp))).slice(0, MAX_CHAT_IMAGE_FILES)
  const filePaths = result.filePaths.filter((fp) => !CHAT_IMAGE_EXTENSION_SET.has(extFromPath(fp))).slice(0, MAX_CHAT_FILE_COUNT)
  const images: { base64: string; mime: string; name: string; path: string }[] = []
  for (const fp of imagePaths) {
    const st = await stat(fp)
    if (st.size > MAX_CHAT_IMAGE_BYTES) {
      return { ok: false as const, error: `Too large (max 4 MB): ${path.basename(fp)}` }
    }
    const buf = await readFile(fp)
    images.push({
      base64: buf.toString('base64'),
      mime: mimeFromImagePath(fp),
      name: path.basename(fp),
      path: fp,
    })
  }
  const files: Array<{
    name: string
    path: string
    mime: string
    size: number
    ext: string
    content?: string
    truncated?: boolean
  }> = []
  for (const fp of filePaths) {
    files.push(await toChatFileSnapshot(fp))
  }
  return { ok: true as const, images, files }
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
