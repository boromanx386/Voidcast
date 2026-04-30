/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BUILD_TARGET?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  /** Present in Electron; absent in the standalone web build. */
  ipcRenderer?: import('electron').IpcRenderer
  voidcast?: {
    webSearch: (query: string) => Promise<
      | { ok: boolean; text: string }
      | string
    >
    getWeather: (payload: {
      city: string
      forecast: boolean
    }) => Promise<{ ok: boolean; text: string } | string>
    scrapeUrl: (payload: {
      url: string
      max_chars?: number
    }) => Promise<{ ok: boolean; text: string } | string>
    savePdf: (payload: {
      content: string
      title?: string
      filename?: string
      outputDir: string
      images?: { mime?: string; base64: string }[]
    }) => Promise<{ ok: boolean; text: string } | string>
    saveImageFromUrl: (payload: {
      imageUrl: string
      outputDir: string
      filename?: string
    }) => Promise<{ ok: boolean; text: string } | string>
    saveAudioFromUrl: (payload: {
      audioUrl: string
      outputDir: string
      filename?: string
    }) => Promise<{ ok: boolean; text: string } | string>
    runwareProxy: (payload: {
      api_base_url: string
      api_key: string
      tasks: unknown[]
    }) => Promise<
      | { ok: true; data: unknown }
      | { ok: false; detail: string }
    >
    getAppVersion: () => Promise<string>
    openPath: (filePath: string) => Promise<{ ok: boolean; text: string } | string>
    pickDirectory: () => Promise<{ ok: true; path: string } | { ok: false }>
    pickCodingDirectory: () => Promise<{ ok: true; path: string } | { ok: false }>
    codingListDirectory: (payload: { projectPath: string; path?: string }) => Promise<
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
    codingReadFile: (payload: { projectPath: string; path: string }) => Promise<
      | { ok: true; content: string }
      | { ok: false; error?: string }
    >
    codingWriteFile: (payload: { projectPath: string; path: string; content: string }) => Promise<
      | { ok: true; path: string }
      | { ok: false; error?: string }
    >
    codingSearchFiles: (payload: { projectPath: string; query: string }) => Promise<
      | {
          ok: true
          matches: { path: string; line: number; text: string }[]
        }
      | { ok: false; error?: string }
    >
    codingExecuteCommand: (payload: {
      projectPath: string
      command: string
      timeoutSec?: number
      runInBackground?: boolean
    }) => Promise<
      | { ok: true; stdout: string; stderr: string; code: number; timedOut?: boolean; pid?: number }
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
    onNewChat: (callback: () => void) => () => void
  }
}
