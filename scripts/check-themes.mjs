#!/usr/bin/env node
/**
 * Voidcast — UI theme token gate (dev-time tool, wired into `npm run lint`).
 *
 * Why it exists: a theme file that forgets a token family does not fail, it
 * silently inherits the dystopian `:root` value. The terminal theme shipped with
 * no `--coding-*` block at all, so an amber shell rendered pure-yellow "M"
 * badges, magenta renames and cyan untracked files. The same class of bug left
 * matrix's hunk header on the add colour, so `@@` rows read as insertions.
 *
 * What it reports:
 *
 *   Parity      Every theme against the union of all declared tokens.
 *   Diff        `--coding-diff-add-fg` / `-del-` / `-hunk-` must stay three
 *               distinguishable values (the matrix bug above).
 *   Contrast    WCAG ratios for body, strong, dim, accent and the three diff
 *               lines, measured against the backgrounds they actually sit on —
 *               including the row wash, whose alpha is read out of App.css so
 *               this model cannot drift away from the stylesheet.
 *   Prunable    Declared across the themes but read by nothing.
 *
 * Severity, deliberately split:
 *
 *   - Missing `--coding-*` tokens FAIL. That family exists to be owned per
 *     theme; absence there is how the terminal bug happened.
 *   - Missing base palette tokens (`--color-*`, `--font-*`) WARN. `:root` is a
 *     complete dystopian palette on purpose, and a theme overriding only part of
 *     it is supported by design — so inheritance is reported, never fatal.
 *   - A Tailwind palette entry counts as AVAILABILITY, not consumption: the
 *     config maps `text-glitch-red` onto `rgb(var(--color-glitch-red) / …)`, but
 *     an app that never writes that class never paints it, and a static scan
 *     cannot tell the two apart. So the two get different markers instead of one
 *     over-claiming `painted`.
 *   - Contrast is advisory (AA floor / AAA target) and becomes fatal under
 *     `--strict`; the honest fix for a thin pair is a palette decision, not a
 *     build break.
 *
 * Usage:
 *   node scripts/check-themes.mjs              report, exit 1 on a failure
 *   node scripts/check-themes.mjs --strict     treat below-AA contrast as fatal
 *   node scripts/check-themes.mjs --json       machine-readable report
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const SRC = join(ROOT, 'electron-app', 'src')
const APP_CSS = join(SRC, 'App.css')

const flags = new Set(process.argv.slice(2))
const STRICT = flags.has('--strict')
const AS_JSON = flags.has('--json')

/** Absent is legitimate here: the tree tokens resolve through a var() fallback in
 *  App.css, and the effect dials are opt-in — a theme that omits them keeps the
 *  effect, and the reduced-motion block in index.css zeroes them globally. */
const OPTIONAL_TOKENS = new Set([
  '--coding-tree-name-fg',
  '--coding-tree-ignored-fg',
  '--crt-opacity',
  '--digit-rain-opacity',
  '--glitch-intensity',
])

/** The family a theme is expected to own outright. */
const THEME_OWNED_PREFIX = '--coding-'

const DIFF_TOKENS = ['--coding-diff-add-fg', '--coding-diff-del-fg', '--coding-diff-hunk-fg']

/** `wash` marks a row whose background is the fg colour at some alpha over the
 *  surface — see `.coding-diff-line--*` in App.css. */
const CONTRAST_PAIRS = [
  { label: 'body text on app bg', fg: '--color-void-text', bg: '--color-void-black', min: 4.5, target: 7 },
  { label: 'body text on panel', fg: '--color-void-text', bg: '--color-void-mid', min: 4.5, target: 7 },
  { label: 'strong text on app bg', fg: '--color-void-light', bg: '--color-void-black', min: 4.5, target: 7 },
  { label: 'dim text on app bg', fg: '--color-void-dim', bg: '--color-void-black', min: 3, target: 4.5 },
  { label: 'accent on app bg', fg: '--coding-accent-fg', bg: '--color-void-black', min: 3, target: 4.5 },
  { label: 'diff add line', fg: '--coding-diff-add-fg', bg: '--color-void-black', wash: 'add', min: 3, target: 4.5 },
  { label: 'diff del line', fg: '--coding-diff-del-fg', bg: '--color-void-black', wash: 'del', min: 3, target: 4.5 },
  { label: 'diff hunk header', fg: '--coding-diff-hunk-fg', bg: '--color-void-black', wash: 'hunk', min: 3, target: 4.5 },
]

const TOKEN_RE = /^\s*(--[a-zA-Z0-9-]+)\s*:\s*([^;\n]+);/gm
const THEME_ID_RE = /html\[data-ui-theme='([^']+)'\]/
const USAGE_RE = /var\(\s*(--[a-zA-Z0-9-]+)/g
const TAILWIND_CANDIDATES = ['tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.cjs', 'tailwind.config.mjs']

function die(message) {
  process.stderr.write(`check-themes: ${message}\n`)
  process.exit(1)
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

function parseTheme(file) {
  const css = readFileSync(file, 'utf8')
  const tokens = new Map()
  for (const match of css.matchAll(TOKEN_RE)) tokens.set(match[1], match[2].trim())
  const id = THEME_ID_RE.exec(css)
  return { name: basename(file), theme: id ? id[1] : 'dystopian', tokens }
}

function countUsages(text, map) {
  for (const match of text.matchAll(USAGE_RE)) map.set(match[1], (map.get(match[1]) ?? 0) + 1)
}

/* ---------- contrast maths (WCAG relative luminance) ---------- */

function parseTriplet(value) {
  const match = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/.exec((value ?? '').trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

function channel(value) {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(rgb) {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
}

function contrast(fg, bg) {
  const a = luminance(fg)
  const b = luminance(bg)
  const [hi, lo] = a >= b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

function blend(fg, bg, alpha) {
  return fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)))
}

/** The real row backgrounds are the line colour at a low alpha over the panel,
 *  so read those alphas out of App.css instead of keeping a second copy. */
function readWashAlphas() {
  const fallback = { add: 0.1, del: 0.1, hunk: 0.12 }
  if (!existsSync(APP_CSS)) return { ...fallback, source: 'fallback (App.css unreadable)' }
  const css = readFileSync(APP_CSS, 'utf8')
  const pick = (kind) => {
    const match = new RegExp(`var\\(--coding-diff-${kind}-fg\\)\\s*/\\s*([\\d.]+)`).exec(css)
    return match ? Number(match[1]) : fallback[kind]
  }
  return { add: pick('add'), del: pick('del'), hunk: pick('hunk'), source: 'App.css' }
}

/* ---------- gather ---------- */

if (!existsSync(SRC)) die(`no such directory: ${SRC}`)

const themeFiles = [
  join(SRC, 'index.css'),
  ...readdirSync(SRC)
    .filter((file) => file.startsWith('theme-') && file.endsWith('.css'))
    .sort()
    .map((file) => join(SRC, file)),
].filter(existsSync)

if (themeFiles.length < 2) die(`expected index.css plus theme-*.css, found ${themeFiles.length} file(s)`)

const themes = themeFiles.map(parseTheme)
const union = [...new Set(themes.flatMap((theme) => [...theme.tokens.keys()]))].sort()

const configFile = TAILWIND_CANDIDATES.map((name) => join(ROOT, 'electron-app', name)).find(existsSync)
const palette = new Map()
const paint = new Map()
for (const file of walk(SRC)) {
  if (!/\.(css|ts|tsx)$/.test(file)) continue
  countUsages(readFileSync(file, 'utf8'), paint)
}
if (configFile) countUsages(readFileSync(configFile, 'utf8'), palette)

/** `*` proves a var() read in src; `+` means the token is only reachable through
 *  the Tailwind palette, where a class nobody writes is indistinguishable from
 *  one that paints. */
const marker = (token) => (paint.has(token) ? '*' : palette.has(token) ? '+' : '')

const problems = []
const notes = []

/* ---------- 1. parity ---------- */

const parity = themes.map((theme) => {
  const missingAll = union.filter((token) => !theme.tokens.has(token))
  const missing = missingAll.filter((token) => !OPTIONAL_TOKENS.has(token))
  const owned = missing.filter((token) => token.startsWith(THEME_OWNED_PREFIX))
  const base = missing.filter((token) => !token.startsWith(THEME_OWNED_PREFIX))
  const liveOwned = owned.filter((token) => paint.has(token))
  for (const token of liveOwned) {
    problems.push(
      `${theme.theme}: no ${token}, but it is painted ${paint.get(token)}x outside the theme files — ` +
        `inherits the dystopian value`,
    )
  }
  for (const token of owned.filter((token) => !paint.has(token))) {
    notes.push(`${theme.theme}: no ${token} (owned family, read by nothing)`)
  }
  return {
    theme,
    optionalAbsent: missingAll.length - missing.length,
    owned,
    liveOwned,
    base: base.map((token) => ({ token, painted: paint.get(token) ?? 0, palette: palette.get(token) ?? 0 })),
  }
})

/* ---------- 2. diff semantics ---------- */

const diffReport = themes.map((theme) => {
  const present = DIFF_TOKENS.map((token) => [token, theme.tokens.get(token)]).filter(([, value]) => value !== undefined)
  const collisions = []
  for (let i = 0; i < present.length; i += 1) {
    for (let j = i + 1; j < present.length; j += 1) {
      if (present[i][1] === present[j][1]) collisions.push(`${present[i][0]} == ${present[j][0]} (${present[i][1]})`)
    }
  }
  for (const collision of collisions) problems.push(`${theme.theme}: ${collision}`)
  return { theme, collisions, complete: present.length === DIFF_TOKENS.length }
})

/* ---------- 3. contrast ---------- */

const wash = readWashAlphas()
const contrastRows = []
for (const theme of themes) {
  for (const pair of CONTRAST_PAIRS) {
    const fg = parseTriplet(theme.tokens.get(pair.fg))
    const surface = parseTriplet(theme.tokens.get(pair.bg))
    if (!fg || !surface) continue
    const bg = pair.wash ? blend(fg, surface, wash[pair.wash]) : surface
    const ratio = contrast(fg, bg)
    const level = ratio < pair.min ? 'low' : ratio < pair.target ? 'thin' : 'ok'
    contrastRows.push({ theme: theme.theme, label: pair.label, ratio, min: pair.min, target: pair.target, level })
  }
}

const lowRows = contrastRows.filter((row) => row.level === 'low')
const thinRows = contrastRows.filter((row) => row.level === 'thin')
if (STRICT) {
  for (const row of lowRows) {
    problems.push(`${row.theme}: ${row.label} is ${row.ratio.toFixed(2)}:1 (floor ${row.min}, target ${row.target})`)
  }
}

/* ---------- 4. prunable ---------- */

const prunable = union.filter((token) => !paint.has(token) && !palette.has(token))

/* ---------- 5. app theme list vs css blocks ---------- */

const declaredIds = new Set(themes.map((theme) => theme.theme))
const unionIds = new Set()
for (const file of walk(SRC)) {
  if (!/\.tsx?$/.test(file)) continue
  const match = /type\s+UiTheme\s*=([\s\S]{0,400}?);/.exec(readFileSync(file, 'utf8'))
  if (!match) continue
  for (const id of match[1].matchAll(/'([a-z][a-z0-9-]*)'/g)) unionIds.add(id[1])
}
if (unionIds.size > 1) {
  for (const id of unionIds) {
    if (!declaredIds.has(id)) problems.push(`UiTheme lists '${id}' but no theme-*.css block defines it`)
  }
  for (const id of declaredIds) {
    if (!unionIds.has(id)) notes.push(`theme block '${id}' is not in the UiTheme union — unreachable`)
  }
}

/* ---------- report ---------- */

const payload = {
  config: configFile ? basename(configFile) : null,
  unionTokens: union.length,
  themes: parity.map((entry) => ({
    theme: entry.theme.theme,
    file: entry.theme.name,
    tokens: entry.theme.tokens.size,
    missingOptional: entry.optionalAbsent,
    missingOwned: entry.owned,
    missingBase: entry.base,
  })),
  diff: diffReport.map((entry) => ({ theme: entry.theme.theme, collisions: entry.collisions })),
  contrast: contrastRows,
  wash,
  prunable,
  problems,
  notes,
  strict: STRICT,
}

if (AS_JSON) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
} else {
  const line = (text) => process.stdout.write(`${text}\n`)
  line(
    `Theme token check — ${themes.length} themes, ${union.length} tokens, ` +
      `${paint.size} painted via var(), palette: ${configFile ? basename(configFile) : 'none'}`,
  )
  line('')

  line('Parity')
  for (const entry of parity) {
    const optional = entry.optionalAbsent ? `, ${entry.optionalAbsent} optional absent` : ''
    if (entry.liveOwned.length) line(`  FAIL ${entry.theme.theme}: owns no ${entry.liveOwned.join(', ')} (painted!)`)
    else if (entry.owned.length) line(`  warn ${entry.theme.theme}: owns no ${entry.owned.join(', ')} (read by nothing)`)
    else if (entry.base.length) {
      const listed = entry.base.map((item) => `${item.token}${marker(item.token)}`).join(', ')
      line(`  warn ${entry.theme.theme}: inherits ${entry.base.length} base token(s)${optional}: ${listed}`)
    } else line(`  ok   ${entry.theme.theme}: every theme-owned token declared${optional}`)
  }
  line('  (*) read by a var() in src, so the inherited value definitely renders')
  line('  (+) only reachable through the Tailwind palette — may or may not be written')
  line('')

  line('Diff colours')
  for (const entry of diffReport) {
    if (entry.collisions.length) line(`  FAIL ${entry.theme.theme}: ${entry.collisions.join('; ')}`)
    else if (!entry.complete) line(`  warn ${entry.theme.theme}: add/del/hunk not all declared`)
    else line(`  ok   ${entry.theme.theme}: add, del and hunk all distinct`)
  }
  line('')

  line('Contrast (advisory — --strict to enforce the floor)')
  const themeWidth = Math.max(...contrastRows.map((row) => row.theme.length), 5)
  const labelWidth = Math.max(...contrastRows.map((row) => row.label.length), 4)
  for (const row of lowRows) {
    line(
      `  LOW  ${row.theme.padEnd(themeWidth)}  ${row.label.padEnd(labelWidth)}  ` +
        `${row.ratio.toFixed(2)}:1  floor ${row.min}, target ${row.target}`,
    )
  }
  if (!lowRows.length) line('  ok   nothing below its floor')
  if (thinRows.length) {
    line(`  ${thinRows.length} pair(s) clear the floor but sit under the AAA target (--json for the table)`)
  }
  line('')

  line('Prunable (declared, read by nothing)')
  line(prunable.length ? `  ${prunable.join(' ')}` : '  none')
  line('')

  if (notes.length) {
    line(`Notes (${notes.length})`)
    for (const note of notes) line(`  - ${note}`)
    line('')
  }

  if (problems.length) {
    line(`Problems (${problems.length})`)
    for (const problem of problems) line(`  - ${problem}`)
  } else {
    line('No structural problems.')
  }
}

process.exit(problems.length ? 1 : 0)
