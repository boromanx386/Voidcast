/// <reference types="vite/client" />

import type { ProgressInfo } from 'electron-updater'
import type { CodingSearchProcessedResult } from '@/lib/codingSearch'

// ---------------------------------------------------------------------------
// Voidcast preload bridge — mirrors electron/preload/index.ts exactly
// ---------------------------------------------------------------------------

interface VoidcastBridge {
  webSearch: (query: string) => Promise<{ ok: boolean; text: string }>

  getWeather: (payload: {
    city: string
    forecast: boolean
  }) => Promise<{ ok: boolean; text: string }>

  scrapeUrl: (payload: {
    url: string
    max_chars?: number
  }) => Promise<{ ok: boolean; text: string }>

  saveImageFromUrl: (payload: {
    imageUrl: string
    outputDir: string
    filename?: string
  }) => Promise<{ ok: true; path: string } | { ok: false; error?: string }>

  saveAudioFromUrl: (payload: {
    audioUrl: string
    outputDir: string
    filename?: string
  }) => Promise<{ ok: true; path: string } | { ok: false; error?: string }>

  runwareProxy: (payload: {
    api_base_url: string
    api_key: string
    tasks: unknown[]
  }) => Promise<{ ok: true; data: unknown } | { ok: false; detail: string }>

  llmChatProxy: (payload: {
    api_base_url: string
    api_key: string
    body: unknown
  }) => Promise<{ ok: true; data: unknown; status: number } | { ok: false; detail: string; status?: number }>

  getAppVersion: () => Promise<string>

  listAgentSkills: (payload?: { projectPath?: string }) => Promise<
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
  >

  readAgentSkill: (payload: { name: string; projectPath?: string }) => Promise<
    | { ok: true; name: string; content: string; dirPath: string }
    | { ok: false; error?: string }
  >

  readProjectAgentInstructions: (payload: { projectPath: string }) => Promise<
    | { ok: true; files: { fileName: string; content: string }[] }
    | { ok: false; error?: string; files: { fileName: string; content: string }[] }
  >

  openPath: (filePath: string) => Promise<{ ok: boolean; text: string }>

  mcpListTools: (payload?: {
    projectPath?: string
    enabledServers?: Record<string, boolean>
    trustedProjectPaths?: string[]
  }) => Promise<
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
  >

  mcpExecuteTool: (payload: {
    serverId?: string
    toolName?: string
    qualifiedName?: string
    args?: Record<string, unknown>
    projectPath?: string
    enabledServers?: Record<string, boolean>
    trustedProjectPaths?: string[]
  }) => Promise<{ ok: true; result: string; qualifiedName?: string } | { ok: false; result: string }>

  mcpReadResult: (payload: {
    path: string
    startLine?: number
    endLine?: number
    offset?: number
    maxChars?: number
    itemOffset?: number
    itemLimit?: number
    query?: string
  }) => Promise<{ ok: boolean; result: string }>

  mcpReload: (payload?: {
    projectPath?: string
    enabledServers?: Record<string, boolean>
    trustedProjectPaths?: string[]
  }) => Promise<
    | {
        ok: true
        status: {
          id: string
          state: 'running' | 'error' | 'stopped' | 'disabled'
          toolCount: number
          error?: string
          oauthEnabled?: boolean
          authState?: 'none' | 'authenticated' | 'needs_sign_in'
        }[]
      }
    | {
        ok: false
        status: {
          id: string
          state: 'running' | 'error' | 'stopped' | 'disabled'
          toolCount: number
          error?: string
          oauthEnabled?: boolean
          authState?: 'none' | 'authenticated' | 'needs_sign_in'
        }[]
        error?: string
      }
  >

  mcpStatus: (payload?: {
    projectPath?: string
    ensure?: boolean
    enabledServers?: Record<string, boolean>
    trustedProjectPaths?: string[]
  }) => Promise<
    | {
        ok: true
        status: {
          id: string
          state: 'running' | 'error' | 'stopped' | 'disabled'
          toolCount: number
          error?: string
          oauthEnabled?: boolean
          authState?: 'none' | 'authenticated' | 'needs_sign_in'
        }[]
        configPath: string
        pendingProjectTrust?: boolean
      }
    | {
        ok: false
        status: {
          id: string
          state: 'running' | 'error' | 'stopped' | 'disabled'
          toolCount: number
          error?: string
          oauthEnabled?: boolean
          authState?: 'none' | 'authenticated' | 'needs_sign_in'
        }[]
        configPath: string
        pendingProjectTrust?: boolean
        error?: string
      }
  >

  mcpOpenConfig: () => Promise<{ ok: true; path: string } | { ok: false; path?: string; error?: string }>

  mcpStopAll: () => Promise<{ ok: true }>

  mcpCancelActiveCalls: () => Promise<{ ok: true }>

  mcpProjectConfigPreview: (payload?: { projectPath?: string }) => Promise<
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
  >

  mcpOAuthSignIn: (payload: {
    serverId: string
    projectPath?: string
    enabledServers?: Record<string, boolean>
    trustedProjectPaths?: string[]
  }) => Promise<
    | {
        ok: true
        status: {
          id: string
          state: 'running' | 'error' | 'stopped' | 'disabled'
          toolCount: number
          error?: string
          oauthEnabled?: boolean
          authState?: 'none' | 'authenticated' | 'needs_sign_in'
        }[]
      }
    | {
        ok: false
        status: {
          id: string
          state: 'running' | 'error' | 'stopped' | 'disabled'
          toolCount: number
          error?: string
          oauthEnabled?: boolean
          authState?: 'none' | 'authenticated' | 'needs_sign_in'
        }[]
        error?: string
      }
  >

  mcpOAuthSignOut: (payload: {
    serverId: string
    projectPath?: string
    enabledServers?: Record<string, boolean>
    trustedProjectPaths?: string[]
  }) => Promise<
    | {
        ok: true
        status: {
          id: string
          state: 'running' | 'error' | 'stopped' | 'disabled'
          toolCount: number
          error?: string
          oauthEnabled?: boolean
          authState?: 'none' | 'authenticated' | 'needs_sign_in'
        }[]
      }
    | {
        ok: false
        status: {
          id: string
          state: 'running' | 'error' | 'stopped' | 'disabled'
          toolCount: number
          error?: string
          oauthEnabled?: boolean
          authState?: 'none' | 'authenticated' | 'needs_sign_in'
        }[]
        error?: string
      }
  >

  pickDirectory: () => Promise<{ ok: true; path: string } | { ok: false }>

  pickCodingDirectory: () => Promise<{ ok: true; path: string } | { ok: false }>

  codingListDirectory: (payload: {
    projectPath: string
    path?: string
    includeIgnored?: boolean
  }) => Promise<
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
  >

  /** Start/stop recursive fs.watch on the coding project (null/empty stops). */
  codingWatchProject: (payload: {
    projectPath: string | null
  }) => Promise<{ ok: true } | { ok: false; error?: string }>

  /** Fired (debounced) when files change under the watched coding project. */
  onCodingFsChange: (callback: () => void) => () => void

  /** Live stdout/stderr chunks while a foreground coding command runs. */
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
  ) => () => void

  onCodingProcessUpdate: (
    callback: (
      event:
        | {
            action: 'upsert'
            process: {
              runId: string
              pid: number
              command: string
              kind: 'foreground' | 'background'
              startedAt: number
              lastLines: string[]
            }
          }
        | { action: 'remove'; runId: string },
    ) => void,
  ) => () => void

  codingReadFile: (payload: {
    projectPath: string
    path: string
    startLine?: number
    endLine?: number
    maxChars?: number
    allowLargeRead?: boolean
  }) => Promise<{ ok: true; content: string; lineEndings: 'crlf' | 'lf' } | { ok: false; error?: string }>

  codingWriteFile: (payload: {
    projectPath: string
    path: string
    content: string
  }) => Promise<{ ok: true; path: string } | { ok: false; error?: string }>

  codingSearchFiles: (payload: {
    projectPath: string
    query: string
    pathPrefix?: string
    recentFiles?: string[]
  }) => Promise<
    | {
        ok: true
        result: CodingSearchProcessedResult
      }
    | { ok: false; error?: string }
  >

  codingGlobFiles: (payload: {
    projectPath: string
    pathPrefix?: string
    extensions?: string[]
    maxResults?: number
  }) => Promise<{ ok: true; paths: string[] } | { ok: false; error?: string }>

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
  }) => Promise<{ ok: true; text: string } | { ok: false; error?: string }>

  codingCheckTypes: (payload: {
    projectPath: string
    pathPrefix?: string
    paths?: string[]
  }) => Promise<{ ok: true; text: string } | { ok: false; error?: string }>

  codingExecuteCommand: (payload: {
    projectPath: string
    command: string
    timeoutSec?: number
    runInBackground?: boolean
  }) => Promise<
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
  >

  codingKillCommand: (payload: { runId: string }) => Promise<
    { ok: true } | { ok: false; error?: string }
  >

  codingListActiveProcesses: () => Promise<{
    processes: {
      runId: string
      pid: number
      command: string
      kind: 'foreground' | 'background'
      startedAt: number
      lastLines: string[]
    }[]
  }>

  codingReadProcessOutput: (payload: {
    runId: string
    offset?: number
  }) => Promise<
    | {
        ok: true
        text: string
        nextOffset: number
        truncatedFromStart: boolean
        startOffset: number
        command: string
        kind: 'foreground' | 'background'
      }
    | { ok: false; error?: string }
  >

  codingKillAllActiveProcesses: () => Promise<{ ok: true; count: number }>

  pickChatAttachments: () => Promise<
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
  >

  parseChatAttachmentBuffer: (payload: {
    name: string
    ext: string
    bytes: ArrayBuffer
  }) => Promise<
    | { ok: true; content?: string; truncated?: boolean }
    | { ok: false; error?: string }
  >

  readImageFile: (payload: { path: string }) => Promise<
    | { ok: true; file: { base64: string; mime: string; name: string; path: string } }
    | { ok: false; error?: string }
  >

  getLanNetworkInfo: () => Promise<{ ips: string[] }>

  showWindow: () => Promise<void>

  hideWindow: () => Promise<void>

  windowMinimize: () => Promise<void>

  windowToggleMaximize: () => Promise<boolean>

  windowClose: () => Promise<void>

  windowIsMaximized: () => Promise<boolean>

  onWindowMaximizedChange: (callback: (maximized: boolean) => void) => () => void

  quitApp: () => Promise<void>

  checkForUpdates: () => Promise<unknown>

  setAutoUpdateEnabled: (enabled: boolean) => Promise<{ ok: true; autoUpdateEnabled: boolean }>

  startUpdateDownload: () => Promise<void>

  quitAndInstallUpdate: () => Promise<void>

  onUpdateCanAvailable: (
    callback: (payload: { update?: boolean; version?: string; newVersion?: string }) => void,
  ) => () => void

  onUpdateError: (callback: (payload: { message?: string; error?: unknown }) => void) => () => void

  onUpdateDownloadProgress: (callback: (payload: ProgressInfo) => void) => () => void

  onUpdateDownloaded: (callback: () => void) => () => void

  onClipboardTts: (callback: (text: string) => void) => () => void

  onNewChat: (callback: () => void) => () => void
}

// ---------------------------------------------------------------------------
// Extend the global Window interface
// ---------------------------------------------------------------------------

declare global {
  interface ImportMetaEnv {
    readonly VITE_BUILD_TARGET?: string
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv
  }

  interface Window {
    /** Present in Electron; absent in the standalone web build. */
    voidcast?: VoidcastBridge
  }
}

export {}
