/**
 * Desktop shell detection. Preload exposes `window.voidcast`, but the first React paint can
 * run before contextBridge — fall back to the Electron user agent.
 */
export function isElectron(): boolean {
  if (typeof window === 'undefined') return false
  if (window.voidcast) return true
  return navigator.userAgent.toLowerCase().includes('electron')
}
/**
 * True when the desktop shell draws its own window chrome: frameless title bar with custom
 * caption buttons and an app-region drag header. Electron supports `titleBarStyle: 'hidden'`
 * on Windows and Linux; macOS keeps its native traffic lights and is excluded on purpose.
 */
export function usesCustomWindowChrome(): boolean {
  if (!isElectron() || typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return ua.includes('Windows') || ua.includes('Linux')
}

export const DEFAULT_TTS_BASE_URL = 'http://127.0.0.1:8765'
export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434'

/** OpenCode Go sends no CORS headers, so the renderer always goes through the local tools proxy. */
export function opencodeGoApiBaseUrl(ttsBaseUrl?: string): string {
  const tts = (ttsBaseUrl || DEFAULT_TTS_BASE_URL).trim().replace(/\/+$/, '')
  return `${tts}/api/opencode-go/v1`
}
