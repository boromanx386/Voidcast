/**
 * Key descriptions for `browser_press_key`.
 *
 * A page sees three things for every key — `e.key`, `e.code` and `e.keyCode` — and all
 * three have to match what a physical keyboard produces. A `code` Chromium does not
 * recognise is dropped silently: the old code sent "Key1" for the digit row, so a page (or
 * a canvas game) switching on `e.code === "Digit1"` never fired and the page saw
 * `e.code === ""`.
 */

/** CDP modifier bits, as the Input domain expects them. */
export const MODIFIER_BITS: Record<string, number> = {
  Alt: 1,
  Control: 2,
  Ctrl: 2,
  Meta: 4,
  Command: 4,
  Cmd: 4,
  Shift: 8,
}

export const SHIFT_BIT = 8

/** One key press: what the page sees as `e.key`, `e.code` and `e.keyCode`. */
export type KeySpec = { key: string; code: string; vk: number; text?: string; modifierBit?: number }

const KEY_TABLE: Record<string, KeySpec> = {
  Enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  NumpadEnter: { key: 'Enter', code: 'NumpadEnter', vk: 13 },
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Esc: { key: 'Escape', code: 'Escape', vk: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  Delete: { key: 'Delete', code: 'Delete', vk: 46 },
  Insert: { key: 'Insert', code: 'Insert', vk: 45 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  Home: { key: 'Home', code: 'Home', vk: 36 },
  End: { key: 'End', code: 'End', vk: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', vk: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', vk: 34 },
  Space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
  Shift: { key: 'Shift', code: 'ShiftLeft', vk: 16 },
  Control: { key: 'Control', code: 'ControlLeft', vk: 17 },
  Alt: { key: 'Alt', code: 'AltLeft', vk: 18 },
  Meta: { key: 'Meta', code: 'MetaLeft', vk: 91 },
}

/** Physical codes accepted verbatim, so "Digit1" / "KeyA" / "Numpad1" / "F5" all work. */
const CODE_ALIASES = new Map<string, KeySpec>()
for (let d = 0; d <= 9; d++) {
  CODE_ALIASES.set(`Digit${d}`, { key: String(d), code: `Digit${d}`, vk: 48 + d, text: String(d) })
  CODE_ALIASES.set(`Numpad${d}`, { key: String(d), code: `Numpad${d}`, vk: 96 + d, text: String(d) })
}
for (let f = 1; f <= 12; f++) CODE_ALIASES.set(`F${f}`, { key: `F${f}`, code: `F${f}`, vk: 111 + f })
for (let i = 0; i < 26; i++) {
  const upper = String.fromCharCode(65 + i)
  CODE_ALIASES.set(`Key${upper}`, {
    key: upper.toLowerCase(),
    code: `Key${upper}`,
    vk: 65 + i,
    text: upper.toLowerCase(),
  })
}

/** Punctuation: the physical code and virtual key code a US layout reports. */
const CHAR_KEYS: Record<string, [string, number]> = {
  ' ': ['Space', 32],
  '-': ['Minus', 189],
  '=': ['Equal', 187],
  '[': ['BracketLeft', 219],
  ']': ['BracketRight', 221],
  ';': ['Semicolon', 186],
  "'": ['Quote', 222],
  '`': ['Backquote', 192],
  ',': ['Comma', 188],
  '.': ['Period', 190],
  '/': ['Slash', 191],
  '\\': ['Backslash', 220],
}

/** Shifted characters → the unshifted key a US layout produces while Shift is held. */
const SHIFTED_CHARS: Record<string, string> = {
  '!': '1',
  '@': '2',
  '#': '3',
  '$': '4',
  '%': '5',
  '^': '6',
  '&': '7',
  '*': '8',
  '(': '9',
  ')': '0',
  _: '-',
  '+': '=',
  '{': '[',
  '}': ']',
  '|': '\\',
  ':': ';',
  '"': "'",
  '~': '`',
  '<': ',',
  '>': '.',
  '?': '/',
}

/** Resolve one token of a key chord ("a", "1", "+", "Digit1", "ArrowUp"). */
function keySpecForToken(token: string): KeySpec | null {
  const named = KEY_TABLE[token] ?? CODE_ALIASES.get(token)
  if (named) return named
  if (token.length !== 1) return null
  const shifted = SHIFTED_CHARS[token]
  if (shifted) {
    const base = keySpecForToken(shifted)
    return base ? { ...base, key: token, text: token, modifierBit: SHIFT_BIT } : null
  }
  if (token >= 'a' && token <= 'z') {
    const upper = token.toUpperCase()
    return { key: token, code: `Key${upper}`, vk: upper.charCodeAt(0), text: token }
  }
  if (token >= 'A' && token <= 'Z') {
    return {
      key: token,
      code: `Key${token}`,
      vk: token.charCodeAt(0),
      text: token,
      modifierBit: SHIFT_BIT,
    }
  }
  if (token >= '0' && token <= '9') {
    return { key: token, code: `Digit${token}`, vk: 48 + Number(token), text: token }
  }
  const punct = CHAR_KEYS[token]
  return punct ? { key: token, code: punct[0], vk: punct[1], text: token } : null
}

/**
 * Parse "1", "a", "+", "Digit1", "KeyA", "Numpad1", "F5", "ArrowUp", "Control+A", …
 * Throws with a usable message when a token or a modifier is not recognised.
 */
export function parseKeyChord(rawKey: string): { spec: KeySpec; modifiers: number } {
  const chord = rawKey.length > 1 && rawKey.includes('+') ? rawKey.split('+') : [rawKey]
  let modifiers = 0
  for (const part of chord.slice(0, -1)) {
    const bit = MODIFIER_BITS[part]
    if (bit === undefined) throw new Error(`Unknown modifier "${part}" in "${rawKey}".`)
    modifiers |= bit
  }
  const spec = keySpecForToken(chord[chord.length - 1])
  if (!spec) {
    throw new Error(
      `Unknown key "${rawKey}" — use a character ("1", "a", "+"), a physical code ("Digit1", "KeyA", "Numpad1", "F5") or a name ("Enter", "Escape", "Tab", "ArrowUp", "Space"), optionally with modifiers ("Control+A").`,
    )
  }
  return { spec, modifiers }
}
