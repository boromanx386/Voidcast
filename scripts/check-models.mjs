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
 * Nothing is written to the app — this only reports, you decide.
 *
 * Usage:
 *   node scripts/check-models.mjs                # both providers, filtered
 *   node scripts/check-models.mjs --openrouter   # OpenRouter only
 *   node scripts/check-models.mjs --opencode     # OpenCode Go only
 *   node scripts/check-models.mjs --days 14      # new-model recency window in days (default 30)
 *   node scripts/check-models.mjs --all          # also list ALL new OpenRouter models (unfiltered)
 *
 * Sources (both public, no API key):
 *   OpenRouter  GET https://openrouter.ai/api/v1/models
 *   OpenCode Go GET https://models.dev/api.json  (provider key: "opencode-go")
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const PRESETS_PATH = join(ROOT, 'electron-app', 'src', 'lib', 'cloudLlmPresets.ts')
const CONTEXT_PATH = join(ROOT, 'electron-app', 'src', 'lib', 'contextLimit.ts')

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/models'
const MODELSDEV_URL = 'https://models.dev/api.json'

// App-internal routing ids that never appear in the OpenRouter catalog.
const SYNTHETIC_OPENROUTER_IDS = new Set([
  'openrouter/free',
  'openrouter/fusion',
  'openrouter/auto-beta',
])

const ALL_FLAG = process.argv.includes('--all')
const OPENROUTER_ONLY = process.argv.includes('--openrouter')
const OPENCODE_ONLY = process.argv.includes('--opencode')

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

// ---- helpers -------------------------------------------------------------

async function fetchJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: { 'user-agent': 'voidcast-check-models' },
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res.json()
}

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
    return
  }

  const live = new Map(models.map((m) => [m.id, m]))
  const curatedSet = new Set(curated)

  // REMOVED
  const removed = curated.filter((id) => !SYNTHETIC_OPENROUTER_IDS.has(id) && !live.has(id))
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
    return
  }

  const curatedSet = new Set(curated)

  // REMOVED
  const removed = curated.filter((id) => !(id in models))
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
  if (ctx.length) {
    console.log(`  CONTEXT mismatch (${ctx.length}) — app override -> live:`)
    for (const [id, ov, lv] of ctx) console.log(`    [~] ${id}: ${fmtNum(ov)} -> ${fmtNum(lv)}`)
  }

  // NEW (small list — show everything)
  const fresh = Object.keys(models)
    .filter((id) => !curatedSet.has(id))
    .sort()
  if (fresh.length) {
    console.log(`  NEW (${fresh.length}):`)
    for (const id of fresh) {
      const m = models[id]
      console.log(`    [+] ${id}`)
      console.log(`        ctx ${fmtNum(m.limit?.context)}  ${money(m.cost?.input)} in · ${money(m.cost?.output)} out`)
    }
  }

  if (!removed.length && !ctx.length && !fresh.length) {
    console.log('  no changes (curated list is up to date).')
  }
  console.log('  note: MiniMax/Qwen may use /messages, gpt-5.6-luna /responses — verify endpoint before adding.')
  console.log('')
}

// ---- main ----------------------------------------------------------------

async function main() {
  const presetsSource = readFileSync(PRESETS_PATH, 'utf8')
  const contextSource = readFileSync(CONTEXT_PATH, 'utf8')

  const curatedOpenRouter = extractPresetIds(presetsSource, 'OPENROUTER_LLM_PRESET_MODELS')
  const curatedOpenCode = extractPresetIds(presetsSource, 'OPENCODE_GO_LLM_PRESET_MODELS')
  const overrides = extractContextOverrides(contextSource)

  console.log('Voidcast — cloud model preset checker')
  console.log(`  curated: OpenRouter ${curatedOpenRouter.length} · OpenCode Go ${curatedOpenCode.length}`)
  console.log('')

  if (!OPENCODE_ONLY) await checkOpenRouter(curatedOpenRouter, overrides)
  if (!OPENROUTER_ONLY) await checkOpenCodeGo(curatedOpenCode, overrides)

  console.log('To add a model, edit electron-app/src/lib/cloudLlmPresets.ts (+ aliases/context in contextLimit.ts).')
}

main().catch((e) => {
  console.error('error:', e.message)
  process.exit(1)
})
