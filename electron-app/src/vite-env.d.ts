/// <reference types="vite/client" />

import type { ProgressInfo } from 'electron-updater'

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

  pickDirectory: () => Promise<{ ok: true; path: string } | { ok: false }>

  pickCodingDirectory: () => Promise<{ ok: true; path: string } | { ok: false }>

  codingListDirectory: (payload: {
    projectPath: string
    path?: string
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
  }) => Promise<
    | {
        ok: true
        matches: { path: string; line: number; text: string }[]
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
        pid?: number
      }
    | { ok: false; error?: string }
  >

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

  readImageFile: (payload: { path: string }) => Promise<
    | { ok: true; file: { base64: string; mime: string; name: string; path: string } }
    | { ok: false; error?: string }
  >

  getLanNetworkInfo: () => Promise<{ ips: string[] }>

  showWindow: () => Promise<void>

  hideWindow: () => Promise<void>

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
