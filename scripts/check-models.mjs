#!/usr/bin/env node
/**
 * Voidcast — cloud LLM preset checker (dev-time tool).
 *
 * Compares the curated model presets in electron-app/src/lib/cloudLlmPresets.ts
 * (and context overrides in electron-app/src/lib/contextLimit.ts) against the
 * live catalogs and prints ONLY the differences:
 *
 *   [+] NEW      — model exists upstream but is not in the curated list
 *   [-] REMOVED  — curated model is no longer offered upstream
 *   [~] CONTEXT  — app context override differs from the live value
 *
 * Without --apply this only reports, you decide. With --apply it enters an
 * interactive mode: you pick which NEW models to add, REMOVED models to drop,
 * and CONTEXT overrides to update, and it edits the two source files for you.
 *
 * Usage:
 *   node scripts/check-models.mjs                # both providers, filtered
 *   node scripts/check-models.mjs --openrouter   # OpenRouter only
 *   node scripts/check-models.mjs --opencode     # OpenCode Go only
 *   node scripts/check-models.mjs --nvidia       # NVIDIA only
 *   node scripts/check-models.mjs --crofai       # CrofAI only
 *   node scripts/check-models.mjs --days 14      # new-model recency window in days (default 30)
 *   node scripts/check-models.mjs --all          # also include all new OpenRouter models (unfiltered)
 *   node scripts/check-models.mjs --apply        # interactive: pick changes, writes the .ts files
 *
 * Sources (all public, no API key):
 *   OpenRouter  GET https://openrouter.ai/api/v1/models
 *   OpenCode Go GET https://models.dev/api.json  (provider key: "opencode-go")
 *   NVIDIA      GET https://integrate.api.nvidia.com/v1/models
 *   CrofAI      GET https://crof.ai/v1/models
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const PRESETS_PATH = join(ROOT, 'electron-app', 'src', 'lib', 'cloudLlmPresets.ts')
const CONTEXT_PATH = join(ROOT, 'electron-app', 'src', 'lib', 'contextLimit.ts')

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/models'
const MODELSDEV_URL = 'https://models.dev/api.json'
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/models'
const CROFAI_URL = 'https://crof.ai/v1/models'

// App-internal routing ids that never appear in the OpenRouter catalog.
const SYNTHETIC_OPENROUTER_IDS = new Set([
  'openrouter/free',
  'openrouter/fusion',
  'openrouter/auto-beta',
])

const ALL_FLAG = process.argv.includes('--all')
const OPENROUTER_ONLY = process.argv.includes('--openrouter')
const OPENCODE_ONLY = process.argv.includes('--opencode')
const NVIDIA_ONLY = process.argv.includes('--nvidia')
const CROFAI_ONLY = process.argv.includes('--crofai')
const APPLY_FLAG = process.argv.includes('--apply')

const DAYS = (() => {
  const i = process.argv.indexOf('--days')
  const v = i < 0 ? 30 : Number(process.argv[i + 1])
  return Number.isFinite(v) && v > 0 ? v : 30
})()

// OpenRouter routing/pricing variants (not distinct models) — hidden from "new".
const ROUTE_VARIANT_SUFFIXES = new Set(['batch', 'nitro', 'floor', 'extended', 'exacto'])

function isRouteVariant(id) {
  const i = id.lastIndexOf(':')
  return i >= 0 && ROUTE_VARIANT_SUFFIXES.has(id.slice(i + 1).toLowerCase())
}

// ---- source parsing (single source of truth = the .ts files) -------------

/** Extract the `id: '...'` entries from a specific `*_LLM_PRESET_MODELS` array. */
function extractPresetIds(source, constName) {
  const block = source.match(new RegExp(`export const ${constName}[^=]*=\\s*\\[([\\s\\S]*?)\\]`))
  if (!block) return []
  const ids = []
  const idRe = /id:\s*'([^']+)'/g
  let m
  while ((m = idRe.exec(block[1]))) ids.push(m[1])
  return ids
}

/** Extract MODEL_CONTEXT_OVERRIDES as { id: number }. */
function extractContextOverrides(source) {
  const block = source.match(/MODEL_CONTEXT_OVERRIDES[^=]*=\s*\{([\s\S]*?)\}/)
  if (!block) return {}
  const out = {}
  const re = /'([^']+)':\s*(\d[\d_]*)/g
  let m
  while ((m = re.exec(block[1]))) out[m[1]] = parseInt(m[2].replace(/_/g, ''), 10)
  return out
}

// ---- source editing (used only in --apply mode) --------------------------

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Insert `{ id, label }` before the closing `]` of a specific preset array. */
function addPresetToArray(source, constName, id, label) {
  if (extractPresetIds(source, constName).includes(id)) return source
  const re = new RegExp(`(export const ${constName}[^=]*=\\s*\\[)([\\s\\S]*?)(\\])`)
  const m = source.match(re)
  if (!m) return source
  const entry = `  { id: '${id}', label: '${label}' },\n`
  const insertAt = m.index + m[1].length + m[2].length
  return source.slice(0, insertAt) + entry + source.slice(insertAt)
}

/** Remove the `{ id, label }` entry for a model from a specific preset array. */
function removePresetFromArray(source, constName, id) {
  const re = new RegExp(`(export const ${constName}[^=]*=\\s*\\[)([\\s\\S]*?)(\\])`)
  const m = source.match(re)
  if (!m) return source
  const body = m[2]
  const entryRe = new RegExp(`\\{\\s*id: '${escapeRe(id)}'[^}]*\\},\\s*\\n?`)
  const newBody = body.replace(entryRe, '')
  return source.slice(0, m.index + m[1].length) + newBody + source.slice(m.index + m[1].length + m[2].length)
}

/** Insert `'id': value,` before the closing `}` of MODEL_CONTEXT_OVERRIDES. */
function addContextOverride(source, id, value) {
  const re = /(MODEL_CONTEXT_OVERRIDES[^=]*=\s*\{)([\s\S]*?)(\})/
  const m = source.match(re)
  if (!m) return source
  const entry = `  '${id}': ${value},\n`
  const insertAt = m.index + m[1].length + m[2].length
  return source.slice(0, insertAt) + entry + source.slice(insertAt)
}

/** Remove a single `'id': value,` line from MODEL_CONTEXT_OVERRIDES. */
function removeContextOverride(source, id) {
  const re = new RegExp(`\\s*'${escapeRe(id)}':\\s*[\\d_]+,\\n?`)
  return source.replace(re, '')
}

/** Rewrite the numeric value of an existing context override. */
function updateContextOverride(source, id, value) {
  const re = new RegExp(`('${escapeRe(id)}':\\s*)[\\d_]+`)
  return source.replace(re, `$1${value}`)
}

/** Add or update a context override (no duplicate keys). */
function upsertContextOverride(source, id, value) {
  const exists = new RegExp(`'${escapeRe(id)}':\\s*[\\d_]+`).test(source)
  return exists ? updateContextOverride(source, id, value) : addContextOverride(source, id, value)
}

// ---- label / formatting helpers ------------------------------------------

function fmtNum(n) {
  return n == null ? '?' : Number(n).toLocaleString('en-US')
}

/** Format a USD-per-1M-tokens number as "$X.XX/M". */
function money(v) {
  if (v == null || Number.isNaN(Number(v))) return '?'
  const n = Number(v)
  if (n === 0) return '$0/M'
  if (n < 0.01) return '$' + n.toFixed(4) + '/M'
  return '$' + n.toFixed(2) + '/M'
}

function fmtCtx(n) {
  if (n == null) return ''
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M ctx'
  if (n >= 1_000) return Math.round(n / 1_000) + 'K ctx'
  return String(n) + ' ctx'
}

/** Derive a human label from a model id (e.g. `z-ai/glm-5.3` -> `GLM 5.3`). */
function makeLabel(id, ctx) {
  let name = id
  name = name.replace(/:(free|nitro|batch|floor|extended|exacto)$/i, '')
  const slash = name.indexOf('/')
  if (slash > 0) name = name.slice(slash + 1)
  let label = name
    .split(/[-_.]/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(' ')
  label = label
    .replace(/\bGpt\b/g, 'GPT')
    .replace(/\bGrok\b/g, 'Grok')
    .replace(/\bGlm\b/g, 'GLM')
    .replace(/\bQwen\b/g, 'Qwen')
    .replace(/\bKimi\b/g, 'Kimi')
    .replace(/\bNemotron\b/g, 'Nemotron')
  if (ctx) label += ` (${fmtCtx(ctx)})`
  return label
}

function parseSelection(ans) {
  const t = ans.trim().toLowerCase()
  if (!t || t === 'n' || t === 'no' || t === 'none' || t === '0') return []
  if (t === 'a' || t === 'all' || t === 'y' || t === 'yes') return 'all'
  return t
    .split(/[,\s]+/)
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n > 0)
}

// ---- helpers -------------------------------------------------------------

async function fetchJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: { 'user-agent': 'voidcast-check-models' },
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res.json()
}

// ---- per-provider checks --------------------------------------------------

async function checkOpenRouter(curated, overrides) {
  console.log('=== OPENROUTER ===')
  let models
  try {
    const d = await fetchJson(OPENROUTER_URL)
    models = Array.isArray(d) ? d : d.data || []
  } catch (e) {
    console.log(`  fetch failed: ${e.message}`)
    console.log('')
    return null
  }

  const live = new Map(models.map((m) => [m.id, m]))
  const curatedSet = new Set(curated)
  const result = { provider: 'openrouter', newModels: [], removed: [], ctx: [] }

  // REMOVED
  const removed = curated.filter((id) => !SYNTHETIC_OPENROUTER_IDS.has(id) && !live.has(id))
  result.removed = removed
  if (removed.length) {
    console.log(`  REMOVED (${removed.length}) — in app, gone from OpenRouter:`)
    for (const id of removed) console.log(`    [-] ${id}`)
  }

  // CONTEXT mismatch (app override vs live context_length)
  const ctx = []
  for (const id of curated) {
    const m = live.get(id)
    if (!m) continue
    const ov = overrides[id]
    if (ov != null && m.context_length != null && ov !== m.context_length) {
      ctx.push([id, ov, m.context_length])
    }
  }
  result.ctx = ctx
  if (ctx.length) {
    console.log(`  CONTEXT mismatch (${ctx.length}) — app override -> live:`)
    for (const [id, ov, lv] of ctx) console.log(`    [~] ${id}: ${fmtNum(ov)} -> ${fmtNum(lv)}`)
  }

  // NEW
  let fresh = models.filter((m) => !curatedSet.has(m.id))
  if (!ALL_FLAG) {
    const cutoff = Date.now() / 1000 - DAYS * 86_400
    fresh = fresh.filter(
      (m) => !isRouteVariant(m.id) && (m.created == null || m.created >= cutoff),
    )
  }
  fresh.sort((a, b) => a.id.localeCompare(b.id))
  result.newModels = fresh.map((m) => ({ id: m.id, ctx: m.context_length }))
  if (fresh.length) {
    console.log(`  NEW (${fresh.length}${ALL_FLAG ? ' — all, unfiltered' : ` — last ${DAYS}d`}):`)
    for (const m of fresh) {
      const pv = m.pricing ? Number(m.pricing.prompt) * 1e6 : null
      const cv = m.pricing ? Number(m.pricing.completion) * 1e6 : null
      console.log(`    [+] ${m.id}`)
      console.log(`        ctx ${fmtNum(m.context_length)}  ${money(pv)} in · ${money(cv)} out`)
    }
  }

  if (!removed.length && !ctx.length && !fresh.length) {
    console.log('  no changes (curated list is up to date).')
  }
  console.log('')
  return result
}

async function checkOpenCodeGo(curated, overrides) {
  console.log('=== OPENCODE GO ===')
  let models
  try {
    const d = await fetchJson(MODELSDEV_URL)
    models = d['opencode-go']?.models || {}
  } catch (e) {
    console.log(`  fetch failed: ${e.message}`)
    console.log('')
    return null
  }

  const curatedSet = new Set(curated)
  const result = { provider: 'opencode-go', newModels: [], removed: [], ctx: [] }

  // REMOVED
  const removed = curated.filter((id) => !(id in models))
  result.removed = removed
  if (removed.length) {
    console.log(`  REMOVED (${removed.length}) — in app, gone from OpenCode Go:`)
    for (const id of removed) console.log(`    [-] ${id}`)
  }

  // CONTEXT mismatch (app override vs models.dev limit.context)
  const ctx = []
  for (const id of curated) {
    const m = models[id]
    if (!m) continue
    const ov = overrides[id]
    const lv = m.limit?.context
    if (ov != null && lv != null && ov !== lv) ctx.push([id, ov, lv])
  }
  result.ctx = ctx
  if (ctx.length) {
    console.log(`  CONTEXT mismatch (${ctx.length}) — app override -> live:`)
    for (const [id, ov, lv] of ctx) console.log(`    [~] ${id}: ${fmtNum(ov)} -> ${fmtNum(lv)}`)
  }

  // NEW (small list — show everything)
  const fresh = Object.keys(models)
    .filter((id) => !curatedSet.has(id))
    .sort()
  result.newModels = fresh.map((id) => ({ id, ctx: models[id].limit?.context }))
  if (fresh.length) {
    console.log(`  NEW (${fresh.length}):`)
    for (const id of fresh) {
      const m = models[id]
      console.log(`    [+] ${id}`)
      console.log(`        ctx ${fmtNum(m.limit?.context)}  ${money(m.cost?.input)} in · ${money(m.cost?.output)} out`)
    }
  }

  if (!removed.length && !ctx.length && !fresh.length) {
    console.log('  (no changes — curated list is up to date).')
  }
  console.log('  note: MiniMax/Qwen may use /messages, gpt-5.6-luna /responses — verify endpoint before adding.')
  console.log('')
  return result
}

/** Generic OpenAI-compatible `/v1/models` catalog check (NVIDIA, CrofAI). */
// Non-chat / non-LLM families on NVIDIA's catalog that are not useful as chat
// presets (embeddings, vision encoders, safety guards, reward/rerank, TTS/ASR,
// image gen, etc.). Kept in a set for fast lookup.
const NVIDIA_NON_CHAT_FAMILIES = new Set([
  'embed', 'nvclip', 'nv-embed', 'nvolve', 'guard', 'safety', 'moderation',
  'reward', 'detector', 'retriever', 'rerank', 'riva', 'translate', 'tts',
  'asr', 'speech', 'voice', 'audio', 'sdxl', 'flux', 'consistory', 'stable',
  'img', 'image', 'diffusion', 'paint', 'stylegan', 'vila', 'siglip', 'clip',
  'vlm', 'ocr', 'catalog', 'llama-guard', 'nemoguard',
])

function isNvidiaChatModel(id) {
  const base = id.toLowerCase()
  for (const fam of NVIDIA_NON_CHAT_FAMILIES) {
    if (base.includes(fam)) return false
  }
  return true
}

async function checkOpenAICompat({ title, url, preset, curated, overrides, filter }) {
  console.log(`=== ${title} ===`)
  let models
  try {
    const d = await fetchJson(url)
    models = Array.isArray(d) ? d : d.data || []
  } catch (e) {
    console.log(`  fetch failed: ${e.message}`)
    console.log('')
    return null
  }

  if (filter) {
    const before = models.length
    models = models.filter((m) => filter(m.id))
    if (before !== models.length) {
      console.log(`  (filtered ${before - models.length} non-chat / non-LLM models)`)
    }
  }

  const live = new Map(models.map((m) => [m.id, m]))
  const curatedSet = new Set(curated)
  const result = { provider: preset, newModels: [], removed: [], ctx: [] }

  // REMOVED
  const removed = curated.filter((id) => !live.has(id))
  result.removed = removed
  if (removed.length) {
    console.log(`  REMOVED (${removed.length}) — in app, gone from ${title}:`)
    for (const id of removed) console.log(`    [-] ${id}`)
  }

  // CONTEXT mismatch (app override vs live context_length)
  const ctx = []
  for (const id of curated) {
    const m = live.get(id)
    if (!m) continue
    const ov = overrides[id]
    if (ov != null && m.context_length != null && ov !== m.context_length) {
      ctx.push([id, ov, m.context_length])
    }
  }
  result.ctx = ctx
  if (ctx.length) {
    console.log(`  CONTEXT mismatch (${ctx.length}) — app override -> live:`)
    for (const [id, ov, lv] of ctx) console.log(`    [~] ${id}: ${fmtNum(ov)} -> ${fmtNum(lv)}`)
  }

  // NEW (small curated lists — show everything)
  const fresh = models
    .filter((m) => !curatedSet.has(m.id))
    .sort((a, b) => a.id.localeCompare(b.id))
  result.newModels = fresh.map((m) => ({ id: m.id, ctx: m.context_length }))
  if (fresh.length) {
    console.log(`  NEW (${fresh.length}):`)
    for (const m of fresh) {
      console.log(`    [+] ${m.id}`)
      console.log(`        ctx ${fmtNum(m.context_length)}`)
    }
  }

  if (!removed.length && !ctx.length && !fresh.length) {
    console.log('  no changes (curated list is up to date).')
  }
  console.log('')
  return result
}

// ---- interactive apply ------------------------------------------------------

async function interactiveApply(or, oc, nv, cf, presetsSource, contextSource) {
  const state = { presets: presetsSource, context: contextSource, added: 0, removed: 0, changed: 0 }

  const groups = []
  if (or?.newModels.length)
    groups.push({ title: 'ADD — OpenRouter', items: or.newModels, kind: 'add', preset: 'OPENROUTER_LLM_PRESET_MODELS' })
  if (oc?.newModels.length)
    groups.push({ title: 'ADD — OpenCode Go', items: oc.newModels, kind: 'add', preset: 'OPENCODE_GO_LLM_PRESET_MODELS' })
  if (nv?.newModels.length)
    groups.push({ title: 'ADD — NVIDIA', items: nv.newModels, kind: 'add', preset: 'NVIDIA_LLM_PRESET_MODELS' })
  if (cf?.newModels.length)
    groups.push({ title: 'ADD — CrofAI', items: cf.newModels, kind: 'add', preset: 'CROFAI_LLM_PRESET_MODELS' })
  if (or?.removed.length)
    groups.push({ title: 'REMOVE — OpenRouter', items: or.removed.map((id) => ({ id })), kind: 'remove', preset: 'OPENROUTER_LLM_PRESET_MODELS' })
  if (oc?.removed.length)
    groups.push({ title: 'REMOVE — OpenCode Go', items: oc.removed.map((id) => ({ id })), kind: 'remove', preset: 'OPENCODE_GO_LLM_PRESET_MODELS' })
  if (nv?.removed.length)
    groups.push({ title: 'REMOVE — NVIDIA', items: nv.removed.map((id) => ({ id })), kind: 'remove', preset: 'NVIDIA_LLM_PRESET_MODELS' })
  if (cf?.removed.length)
    groups.push({ title: 'REMOVE — CrofAI', items: cf.removed.map((id) => ({ id })), kind: 'remove', preset: 'CROFAI_LLM_PRESET_MODELS' })
  if (or?.ctx.length)
    groups.push({ title: 'UPDATE CONTEXT — OpenRouter', items: or.ctx.map(([id, ov, lv]) => ({ id, ov, lv })), kind: 'ctx' })
  if (oc?.ctx.length)
    groups.push({ title: 'UPDATE CONTEXT — OpenCode Go', items: oc.ctx.map(([id, ov, lv]) => ({ id, ov, lv })), kind: 'ctx' })
  if (nv?.ctx.length)
    groups.push({ title: 'UPDATE CONTEXT — NVIDIA', items: nv.ctx.map(([id, ov, lv]) => ({ id, ov, lv })), kind: 'ctx' })
  if (cf?.ctx.length)
    groups.push({ title: 'UPDATE CONTEXT — CrofAI', items: cf.ctx.map(([id, ov, lv]) => ({ id, ov, lv })), kind: 'ctx' })

  if (!groups.length) {
    console.log('Nothing to apply — no changes detected.')
    return
  }

  const rl = createInterface({ input, output })

  for (const g of groups) {
    console.log(`\n=== ${g.title} ===`)
    g.items.forEach((it, i) => {
      if (g.kind === 'ctx') console.log(`  [${i + 1}] ${it.id}  ${fmtNum(it.ov)} -> ${fmtNum(it.lv)}`)
      else console.log(`  [${i + 1}] ${it.id}${it.ctx ? '  (' + fmtCtx(it.ctx) + ')' : ''}`)
    })
    const verb = g.kind === 'add' ? 'ADD' : g.kind === 'remove' ? 'REMOVE' : 'UPDATE'
    const ans = await rl.question(`  ${verb} which? (numbers, 'a' = all, Enter = none): `)
    const sel = parseSelection(ans)
    const targets = sel === 'all' ? g.items.map((_, i) => i) : sel.map((n) => n - 1).filter((i) => i >= 0 && i < g.items.length)
    for (const i of targets) applyOne(g, i, state)
  }

  rl.close()

  if (state.added || state.removed || state.changed) {
    writeFileSync(PRESETS_PATH, state.presets)
    writeFileSync(CONTEXT_PATH, state.context)
    console.log('\nApplied. Wrote:')
    if (state.added) console.log(`  + ${state.added} preset(s) added (with context override)`)
    if (state.removed) console.log(`  - ${state.removed} preset(s) removed`)
    if (state.changed) console.log(`  ~ ${state.changed} context override(s) updated`)
    console.log('Review before committing:')
    console.log('  git diff electron-app/src/lib/cloudLlmPresets.ts electron-app/src/lib/contextLimit.ts')
  } else {
    console.log('\nNo changes applied.')
  }
}

function applyOne(g, index, state) {
  const it = g.items[index]
  if (g.kind === 'add') {
    const label = makeLabel(it.id, it.ctx)
    state.presets = addPresetToArray(state.presets, g.preset, it.id, label)
    if (it.ctx != null) state.context = upsertContextOverride(state.context, it.id, it.ctx)
    state.added++
    console.log(`    + added ${it.id}  (${label})`)
  } else if (g.kind === 'remove') {
    state.presets = removePresetFromArray(state.presets, g.preset, it.id)
    state.context = removeContextOverride(state.context, it.id)
    state.removed++
    console.log(`    - removed ${it.id}`)
  } else if (g.kind === 'ctx') {
    state.context = updateContextOverride(state.context, it.id, it.lv)
    state.changed++
    console.log(`    ~ ${it.id}: ${fmtNum(it.ov)} -> ${fmtNum(it.lv)}`)
  }
}

// ---- main ----------------------------------------------------------------

async function main() {
  const presetsSource = readFileSync(PRESETS_PATH, 'utf8')
  const contextSource = readFileSync(CONTEXT_PATH, 'utf8')

  const curatedOpenRouter = extractPresetIds(presetsSource, 'OPENROUTER_LLM_PRESET_MODELS')
  const curatedOpenCode = extractPresetIds(presetsSource, 'OPENCODE_GO_LLM_PRESET_MODELS')
  const curatedNvidia = extractPresetIds(presetsSource, 'NVIDIA_LLM_PRESET_MODELS')
  const curatedCrofAi = extractPresetIds(presetsSource, 'CROFAI_LLM_PRESET_MODELS')
  const overrides = extractContextOverrides(contextSource)

  console.log('Voidcast — cloud model preset checker')
  console.log(`  curated: OpenRouter ${curatedOpenRouter.length} · OpenCode Go ${curatedOpenCode.length} · NVIDIA ${curatedNvidia.length} · CrofAI ${curatedCrofAi.length}`)
  console.log('')

  const or = !OPENCODE_ONLY && !NVIDIA_ONLY && !CROFAI_ONLY ? await checkOpenRouter(curatedOpenRouter, overrides) : null
  const oc = !OPENROUTER_ONLY && !NVIDIA_ONLY && !CROFAI_ONLY ? await checkOpenCodeGo(curatedOpenCode, overrides) : null
  const nv = !OPENROUTER_ONLY && !OPENCODE_ONLY && !CROFAI_ONLY ? await checkOpenAICompat({ title: 'NVIDIA', url: NVIDIA_URL, preset: 'NVIDIA_LLM_PRESET_MODELS', curated: curatedNvidia, overrides, filter: isNvidiaChatModel }) : null
  const cf = !OPENROUTER_ONLY && !OPENCODE_ONLY && !NVIDIA_ONLY ? await checkOpenAICompat({ title: 'CrofAI', url: CROFAI_URL, preset: 'CROFAI_LLM_PRESET_MODELS', curated: curatedCrofAi, overrides }) : null

  if (APPLY_FLAG) {
    await interactiveApply(or, oc, nv, cf, presetsSource, contextSource)
  } else {
    console.log('To add a model, edit electron-app/src/lib/cloudLlmPresets.ts (+ aliases/context in contextLimit.ts).')
    console.log('Or run: node scripts/check-models.mjs --apply   (pick changes interactively, edits the source files)')
  }
}

main().catch((e) => {
  console.error('error:', e.message)
  process.exit(1)
})