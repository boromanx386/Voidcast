/**
 * Window focus/visibility helpers.
 *
 * `document.hasFocus()` is NOT a reliable "is the app in the foreground" test in
 * Electron: a minimized or background window can still report the document as
 * focused, so guards built on it let focus calls through. Any DOM focus (or
 * `window.focus()`) then makes Electron lift the OS window back out of the
 * taskbar while the agent is still working.
 *
 * Ask the main process instead — `win.isFocused()` / `win.isMinimized()` are the
 * authoritative values — and fall back to the DOM heuristic only when the
 * preload bridge is unavailable (plain web build).
 */

export type WindowFocusState = {
  focused: boolean
  minimized: boolean
  visible: boolean
}

/**
 * True only when the app window is genuinely in the foreground (focused, not
 * minimized). Safe to gate `window.focus()` / `element.focus()` calls on this
 * for anything the agent triggers in the background.
 */
export async function isWindowForeground(): Promise<boolean> {
  const api = typeof window !== 'undefined' ? window.voidcast : undefined
  if (api?.windowFocusState) {
    try {
      const state = await api.windowFocusState()
      return state.focused && !state.minimized && state.visible
    } catch {
      /* fall through to the DOM heuristic */
    }
  }
  return typeof document !== 'undefined' && document.hasFocus()
}
