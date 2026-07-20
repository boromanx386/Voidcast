import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('voidcast', {
  webSearch: (query: string) => ipcRenderer.invoke('voidcast:web-search', query),
  getWeather: (payload: { city: string; forecast: boolean }) =>
    ipcRenderer.invoke('voidcast:get-weather', payload),
  scrapeUrl: (payload: { url: string; max_chars?: number }) =>
    ipcRenderer.invoke('voidcast:scrape-url', payload),
  saveImageFromUrl: (payload: {
    imageUrl: string
    outputDir: string
    filename?: string
  }) => ipcRenderer.invoke('voidcast:save-image-from-url', payload),
  saveAudioFromUrl: (payload: {
    audioUrl: string
    outputDir: string
    filename?: string
  }) => ipcRenderer.invoke('voidcast:save-audio-from-url', payload),
  runwareProxy: (payload: {
    api_base_url: string
    api_key: string
    tasks: unknown[]
  }) =>
    ipcRenderer.invoke('voidcast:runware-proxy', payload) as Promise<
      | { ok: true; data: unknown }
      | { ok: false; detail: string }
    >,
  llmChatProxy: (payload: {
    api_base_url: string
    api_key: string
    body: unknown
  }) =>
    ipcRenderer.invoke('voidcast:llm-chat-proxy', payload) as Promise<
      | { ok: true; data: unknown; status: number }
      | { ok: false; detail: string; status?: number }
    >,
  getAppVersion: () => ipcRenderer.invoke('voidcast:get-app-version') as Promise<string>,
  listAgentSkills: (payload?: { projectPath?: string }) =>
    ipcRenderer.invoke('voidcast:list-agent-skills', payload) as Promise<
      | {
          ok: true
          skills: {
            id: string
            name: string
            description: string
            dirPath: string
            source: 'project' | 'agents' | 'claude' | 'cursor'
          }[]
        }
      | {
          ok: false
          error?: string
          skills: {
            id: string
            name: string
            description: string
            dirPath: string
            source: 'project' | 'agents' | 'claude' | 'cursor'
          }[]
        }
    >,
  readAgentSkill: (payload: { name: string; projectPath?: string }) =>
    ipcRenderer.invoke('voidcast:read-agent-skill', payload) as Promise<
      | { ok: true; name: string; content: string; dirPath: string }
      | { ok: false; error?: string }
    >,
  readProjectAgentInstructions: (payload: { projectPath: string }) =>
    ipcRenderer.invoke('voidcast:read-project-agent-instructions', payload) as Promise<
      | { ok: true; files: { fileName: string; content: string }[] }
      | { ok: false; error?: string; files: { fileName: string; content: string }[] }
    >,
  openPath: (filePath: string) => ipcRenderer.invoke('voidcast:open-path', filePath),
  mcpListTools: (payload?: {
    projectPath?: string
    enabledServers?: Record<string, boolean>
    trustedProjectPaths?: string[]
  }) =>
    ipcRenderer.invoke('voidcast:mcp-list-tools', payload) as Promise<
      | {
          ok: true
          tools: {
            serverId: string
            name: string
            qualifiedName: string
            description: string
            parameters: Record<string, unknown>
          }[]
        }
      | {
          ok: false
          tools: {
            serverId: string
            name: string
            qualifiedName: string
            description: string
            parameters: Record<string, unknown>
          }[]
          error?: string
        }
    >,
  mcpExecuteTool: (payload: {
    serverId?: string
    toolName?: string
    qualifiedName?: string
    args?: Record<string, unknown>
    projectPath?: string
    enabledServers?: Record<string, boolean>
    trustedProjectPaths?: string[]
  }) =>
    ipcRenderer.invoke('voidcast:mcp-execute-tool', payload) as Promise<
      | { ok: true; result: string; qualifiedName?: string }
      | { ok: false; result: string }
    >,
  mcpReadResult: (payload: {
    path: string
    startLine?: number
    endLine?: number
    offset?: number
    maxChars?: number
    itemOffset?: number
    itemLimit?: number
    query?: string
  }) =>
    ipcRenderer.invoke('voidcast:mcp-read-result', payload) as Promise<{
      ok: boolean
      result: string
    }>,
  mcpReload: (payload?: {
    projectPath?: string
    enabledServers?: Record<string, boolean>
    trustedProjectPaths?: string[]
  }) =>
    ipcRenderer.invoke('voidcast:mcp-reload', payload) as Promise<
      | {
          ok: true
          status: {
            id: string
            state: 'running' | 'error' | 'stopped' | 'disabled'
            toolCount: number
            error?: string
          }[]
        }
      | {
          ok: false
          status: {
            id: string
            state: 'running' | 'error' | 'stopped' | 'disabled'
            toolCount: number
            error?: string
          }[]
          error?: string
        }
    >,
  mcpStatus: (payload?: {
    projectPath?: string
    ensure?: boolean
    enabledServers?: Record<string, boolean>
    trustedProjectPaths?: string[]
  }) =>
    ipcRenderer.invoke('voidcast:mcp-status', payload) as Promise<
      | {
          ok: true
          status: {
            id: string
            state: 'running' | 'error' | 'stopped' | 'disabled'
            toolCount: number
            error?: string
          }[]
          configPath: string
        }
      | {
          ok: false
          status: {
            id: string
            state: 'running' | 'error' | 'stopped' | 'disabled'
            toolCount: number
            error?: string
          }[]
          configPath: string
          error?: string
        }
    >,
  mcpOpenConfig: () =>
    ipcRenderer.invoke('voidcast:mcp-open-config') as Promise<
      { ok: true; path: string } | { ok: false; path?: string; error?: string }
    >,
  mcpStopAll: () =>
    ipcRenderer.invoke('voidcast:mcp-stop-all') as Promise<{ ok: true }>,
  mcpCancelActiveCalls: () =>
    ipcRenderer.invoke('voidcast:mcp-cancel-active-calls') as Promise<{ ok: true }>,
  mcpProjectConfigPreview: (payload?: { projectPath?: string }) =>
    ipcRenderer.invoke('voidcast:mcp-project-config-preview', payload) as Promise<
      | {
          ok: true
          servers: { id: string; transport: 'stdio' | 'url'; summary: string }[]
          normalizedProjectPath?: string
        }
      | {
          ok: false
          error?: string
          servers: { id: string; transport: 'stdio' | 'url'; summary: string }[]
        }
    >,
  mcpOAuthSignIn: (payload: {
    serverId: string
    projectPath?: string
    enabledServers?: Record<string, boolean>
    trustedProjectPaths?: string[]
  }) =>
    ipcRenderer.invoke('voidcast:mcp-oauth-sign-in', payload) as Promise<
      | { ok: true; status: { id: string; state: string; toolCount: number; error?: string }[] }
      | {
          ok: false
          status: { id: string; state: string; toolCount: number; error?: string }[]
          error?: string
        }
    >,
  mcpOAuthSignOut: (payload: {
    serverId: string
    projectPath?: string
    enabledServers?: Record<string, boolean>
    trustedProjectPaths?: string[]
  }) =>
    ipcRenderer.invoke('voidcast:mcp-oauth-sign-out', payload) as Promise<
      | { ok: true; status: { id: string; state: string; toolCount: number; error?: string }[] }
      | {
          ok: false
          status: { id: string; state: string; toolCount: number; error?: string }[]
          error?: string
        }
    >,
  pickDirectory: () =>
    ipcRenderer.invoke('voidcast:pick-directory') as Promise<
      { ok: true; path: string } | { ok: false }
    >,
  pickCodingDirectory: () =>
    ipcRenderer.invoke('voidcast:coding-pick-directory') as Promise<
      { ok: true; path: string } | { ok: false }
    >,
  codingListDirectory: (payload: { projectPath: string; path?: string }) =>
    ipcRenderer.invoke('voidcast:coding-list-directory', payload) as Promise<
      | {
          ok: true
          entries: {
            name: string
            path: string
            type: 'file' | 'directory'
            size?: number
          }[]
        }
      | { ok: false; error?: string }
    >,
  codingWatchProject: (payload: { projectPath: string | null }) =>
    ipcRenderer.invoke('voidcast:coding-watch-project', payload) as Promise<
      { ok: true } | { ok: false; error?: string }
    >,
  onCodingFsChange: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('voidcast:coding-fs-change', listener)
    return () => ipcRenderer.removeListener('voidcast:coding-fs-change', listener)
  },
  onCodingCommandOutput: (
    callback: (event: {
      runId: string
      stream?: 'stdout' | 'stderr' | 'system'
      text?: string
      done?: boolean
      code?: number
      timedOut?: boolean
      killed?: boolean
    }) => void,
  ) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      payload: {
        runId: string
        stream?: 'stdout' | 'stderr' | 'system'
        text?: string
        done?: boolean
        code?: number
        timedOut?: boolean
        killed?: boolean
      },
    ) => callback(payload)
    ipcRenderer.on('voidcast:coding-command-output', listener)
    return () => ipcRenderer.removeListener('voidcast:coding-command-output', listener)
  },
  codingReadFile: (payload: {
    projectPath: string
    path: string
    startLine?: number
    endLine?: number
    maxChars?: number
    allowLargeRead?: boolean
  }) =>
    ipcRenderer.invoke('voidcast:coding-read-file', payload) as Promise<
      | { ok: true; content: string; lineEndings: 'crlf' | 'lf' }
      | { ok: false; error?: string }
    >,
  codingWriteFile: (payload: { projectPath: string; path: string; content: string }) =>
    ipcRenderer.invoke('voidcast:coding-write-file', payload) as Promise<
      | { ok: true; path: string }
      | { ok: false; error?: string }
    >,
  codingSearchFiles: (payload: {
    projectPath: string
    query: string
    pathPrefix?: string
    recentFiles?: string[]
  }) =>
    ipcRenderer.invoke('voidcast:coding-search-files', payload) as Promise<
      | { ok: true; result: import('../../src/lib/codingSearch').CodingSearchProcessedResult }
      | { ok: false; error?: string }
    >,
  codingGlobFiles: (payload: {
    projectPath: string
    pathPrefix?: string
    extensions?: string[]
    maxResults?: number
  }) =>
    ipcRenderer.invoke('voidcast:coding-glob-files', payload) as Promise<
      | { ok: true; paths: string[] }
      | { ok: false; error?: string }
    >,
  codingGit: (payload: {
    projectPath: string
    mode:
      | 'status'
      | 'diff'
      | 'log'
      | 'show'
      | 'stage'
      | 'unstage'
      | 'commit'
      | 'discard'
      | 'discardAll'
    path?: string
    staged?: boolean
    commitAll?: boolean
    commitMessage?: string
    logMaxCount?: number
    logPath?: string
    showRef?: string
    showPath?: string
  }) =>
    ipcRenderer.invoke('voidcast:coding-git', payload) as Promise<
      | { ok: true; text: string }
      | { ok: false; error?: string }
    >,
  codingCheckTypes: (payload: {
    projectPath: string
    pathPrefix?: string
    paths?: string[]
  }) =>
    ipcRenderer.invoke('voidcast:coding-check-types', payload) as Promise<
      | { ok: true; text: string }
      | { ok: false; error?: string }
    >,
  codingExecuteCommand: (payload: {
    projectPath: string
    command: string
    timeoutSec?: number
    runInBackground?: boolean
  }) =>
    ipcRenderer.invoke('voidcast:coding-execute-command', payload) as Promise<
      | {
          ok: true
          stdout: string
          stderr: string
          code: number
          timedOut?: boolean
          killed?: boolean
          pid?: number
          runId: string
          streamed: boolean
        }
      | { ok: false; error?: string; runId?: string; streamed?: boolean }
    >,
  codingKillCommand: (payload: { runId: string }) =>
    ipcRenderer.invoke('voidcast:coding-kill-command', payload) as Promise<
      { ok: true } | { ok: false; error?: string }
    >,
  pickChatAttachments: () =>
    ipcRenderer.invoke('voidcast:pick-chat-attachments') as Promise<
      | {
          ok: true
          images: { base64: string; mime: string; name: string; path: string }[]
          files: {
            name: string
            path: string
            mime: string
            size: number
            ext: string
            content?: string
            truncated?: boolean
          }[]
        }
      | { ok: false; error?: string }
    >,
  readImageFile: (payload: { path: string }) =>
    ipcRenderer.invoke('voidcast:read-image-file', payload) as Promise<
      | {
          ok: true
          file: { base64: string; mime: string; name: string; path: string }
        }
      | { ok: false; error?: string }
    >,
  /** LAN IPv4 addresses of this machine (for mobile web UI URLs). */
  getLanNetworkInfo: () =>
    ipcRenderer.invoke('voidcast:get-lan-network-info') as Promise<{ ips: string[] }>,
  showWindow: () => ipcRenderer.invoke('voidcast:show-window'),
  hideWindow: () => ipcRenderer.invoke('voidcast:hide-window'),
  quitApp: () => ipcRenderer.invoke('voidcast:quit-app'),
  checkForUpdates: () => ipcRenderer.invoke('check-update'),
  setAutoUpdateEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('set-auto-update-enabled', enabled) as Promise<{
      ok: true
      autoUpdateEnabled: boolean
    }>,
  startUpdateDownload: () => ipcRenderer.invoke('start-download'),
  quitAndInstallUpdate: () => ipcRenderer.invoke('quit-and-install'),
  onUpdateCanAvailable: (
    callback: (payload: { update?: boolean; version?: string; newVersion?: string }) => void,
  ) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      callback((payload ?? {}) as { update?: boolean; version?: string; newVersion?: string })
    ipcRenderer.on('update-can-available', listener)
    return () => ipcRenderer.removeListener('update-can-available', listener)
  },
  onUpdateError: (
    callback: (payload: { message?: string; error?: unknown }) => void,
  ) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      callback((payload ?? {}) as { message?: string; error?: unknown })
    ipcRenderer.on('update-error', listener)
    return () => ipcRenderer.removeListener('update-error', listener)
  },
  onUpdateDownloadProgress: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('download-progress', listener)
    return () => ipcRenderer.removeListener('download-progress', listener)
  },
  onUpdateDownloaded: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('update-downloaded', listener)
    return () => ipcRenderer.removeListener('update-downloaded', listener)
  },
  onClipboardTts: (callback: (text: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, text: unknown) =>
      callback(String(text ?? ''))
    ipcRenderer.on('voidcast:read-clipboard-tts', listener)
    return () => ipcRenderer.removeListener('voidcast:read-clipboard-tts', listener)
  },
  onNewChat: (callback: () => void) => {
    ipcRenderer.on('voidcast:new-chat', callback)
    return () => ipcRenderer.removeListener('voidcast:new-chat', callback)
  },
})

// --------- Preload scripts loading ---------
function domReady(condition: DocumentReadyState[] = ['complete', 'interactive']) {
  return new Promise(resolve => {
    if (condition.includes(document.readyState)) {
      resolve(true)
    } else {
      document.addEventListener('readystatechange', () => {
        if (condition.includes(document.readyState)) {
          resolve(true)
        }
      })
    }
  })
}

const safeDOM = {
  append(parent: HTMLElement, child: HTMLElement) {
    if (!Array.from(parent.children).find(e => e === child)) {
      return parent.appendChild(child)
    }
  },
  remove(parent: HTMLElement, child: HTMLElement) {
    if (Array.from(parent.children).find(e => e === child)) {
      return parent.removeChild(child)
    }
  },
}

/**
 * https://tobiasahlin.com/spinkit
 * https://connoratherton.com/loaders
 * https://projects.lukehaas.me/css-loaders
 * https://matejkustec.github.io/SpinThatShit
 */
function useLoading() {
  const className = `loaders-css__square-spin`
  const styleContent = `
@keyframes square-spin {
  25% { transform: perspective(100px) rotateX(180deg) rotateY(0); }
  50% { transform: perspective(100px) rotateX(180deg) rotateY(180deg); }
  75% { transform: perspective(100px) rotateX(0) rotateY(180deg); }
  100% { transform: perspective(100px) rotateX(0) rotateY(0); }
}
.${className} > div {
  animation-fill-mode: both;
  width: 50px;
  height: 50px;
  background: #fff;
  animation: square-spin 3s 0s cubic-bezier(0.09, 0.57, 0.49, 0.9) infinite;
}
.app-loading-wrap {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #282c34;
  z-index: 9;
}
    `
  const oStyle = document.createElement('style')
  const oDiv = document.createElement('div')

  oStyle.id = 'app-loading-style'
  oStyle.innerHTML = styleContent
  oDiv.className = 'app-loading-wrap'
  oDiv.innerHTML = `<div class="${className}"><div></div></div>`

  return {
    appendLoading() {
      safeDOM.append(document.head, oStyle)
      safeDOM.append(document.body, oDiv)
    },
    removeLoading() {
      safeDOM.remove(document.head, oStyle)
      safeDOM.remove(document.body, oDiv)
    },
  }
}

// ----------------------------------------------------------------------

const { appendLoading, removeLoading } = useLoading()
domReady().then(appendLoading)

window.onmessage = (ev) => {
  ev.data.payload === 'removeLoading' && removeLoading()
}

setTimeout(removeLoading, 4999)