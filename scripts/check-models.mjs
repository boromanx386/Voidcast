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
 *   node scripts/check-models.mjs                # all providers, filtered
 *   node scripts/check-models.mjs --openrouter   # OpenRouter only
 *   node scripts/check-models.mjs --opencode     # OpenCode Go only
 *   node scripts/check-models.mjs --nvidia       # NVIDIA only
 *   node scripts/check-models.mjs --days 14      # new-model recency window in days (default 30)
 *   node scripts/check-models.mjs --all          # also include all new OpenRouter models (unfiltered)
 *   node scripts/check-models.mjs --apply        # interactive: pick changes, writes the .ts files
 *
 * Sources (all public, no API key):
 *   OpenRouter  GET https://openrouter.ai/api/v1/models
 *   OpenCode Go GET https://opencode.ai/zen/go/v1/models  (live catalog; it is a
 *                 chat/completions-first feed and OMITS /v1/messages-only models such as
 *                 claude-haiku-5-5, so it is not the only existence check)
 *               +  https://models.dev/api.json  (ctx/pricing enrichment, and the per-model
 *                 endpoint via `provider.npm`: @ai-sdk/anthropic = /v1/messages,
 *                 @ai-sdk/openai = /v1/responses, @ai-sdk/openai-compatible = /v1/chat/completions)
 *   NVIDIA      GET https://integrate.api.nvidia.com/v1/models
 *
 * OpenCode Go endpoints handled: `/v1/chat/completions` and `/v1/messages` (both are first-class
 * app presets — the app routes per model via openCodeGoApiStyle()). `/v1/responses` is not
 * implemented by the app, so those models are skipped rather than suggested.
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
const OPENCODE_URL = 'https://opencode.ai/zen/go/v1/models'
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/models'


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

/**
 * Extract the quoted entries of a `new Set([...])` block, e.g.
 * OPENCODE_GO_ANTHROPIC_MESSAGES_MODELS (the app's per-model /v1/messages routing set).
 */
function extractSetEntries(source, constName) {
  const block = source.match(setBlockRe(constName))
  if (!block) return new Set()
  const out = new Set()
  const re = /'([^']+)'/g
  let m
  while ((m = re.exec(block[2]))) out.add(m[1])
  return out
}

function setBlockRe(constName) {
  return new RegExp(`((?:export )?const ${constName}\\s*(?::[^=]+)?=\\s*new Set\\(\\[)([\\s\\S]*?)(\\]\\))`)
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

/**
 * Insert a quoted id into a `new Set([...])` block — used to pin a newly added
 * /v1/messages model in OPENCODE_GO_ANTHROPIC_MESSAGES_MODELS so the app routes it
 * to `{base}/messages` instead of /v1/chat/completions.
 */
function addSetEntry(source, constName, id) {
  if (extractSetEntries(source, constName).has(id)) return source
  const m = source.match(setBlockRe(constName))
  if (!m) return source
  const insertAt = m.index + m[1].length + m[2].length
  return source.slice(0, insertAt) + `  '${id}',\n` + source.slice(insertAt)
}

/** Remove a quoted id line from a `new Set([...])` block. */
function removeSetEntry(source, constName, id) {
  const m = source.match(setBlockRe(constName))
  if (!m) return source
  const newBody = m[2].replace(new RegExp(`[ \\t]*'${escapeRe(id)}',\\r?\\n`), '')
  if (newBody === m[2]) return source
  return source.slice(0, m.index + m[1].length) + newBody + source.slice(m.index + m[1].length + m[2].length)
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

// OpenCode Go serves three wire formats (https://opencode.ai/docs/go/, Endpoints table).
// The app implements two of them — see CloudLlmApiStyle in cloudLlmPresets.ts:
//   /v1/chat/completions → 'openai-chat'
//   /v1/messages         → 'anthropic-messages'   (MiniMax, Qwen, Claude Haiku 5.5)
//   /v1/responses        → not implemented, so those models are never suggested.
//
// The app already knows per model which endpoint to use: openCodeGoApiStyle() consults
// OPENCODE_GO_ANTHROPIC_MESSAGES_MODELS. This checker mirrors that set, so a
// /v1/messages model is a normal preset candidate — and when applied, the id is also
// pinned into that routing set (addSetEntry), otherwise the app would POST it to
// /v1/chat/completions and get a 404.
const OPENCODE_ENDPOINT_LABEL = {
  'openai-chat': '/v1/chat/completions',
  'anthropic-messages': '/v1/messages',
  'openai-responses': '/v1/responses',
}

// models.dev carries the AI SDK package per model (`provider.npm`) and it maps 1:1 to
// the docs' endpoint column.
const OPENCODE_NPM_ENDPOINT = {
  '@ai-sdk/anthropic': 'anthropic-messages',
  '@ai-sdk/openai': 'openai-responses',
  '@ai-sdk/openai-compatible': 'openai-chat',
}

// Fallback for ids models.dev does not know: the families the Go docs pin to another
// endpoint. MiniMax + Qwen are /v1/messages (every listed variant is), Grok / Muse
// Spark / *-luna are /v1/responses. The provider-level npm
// ('@ai-sdk/openai-compatible') is only a default and must not win here, or a Qwen id
// without a model-level npm would be misread as chat/completions.
const OPENCODE_MESSAGES_FAMILIES = [/^minimax/i, /^qwen/i]
const OPENCODE_RESPONSES_FAMILIES = [/^grok/i, /^muse-spark/i, /^gpt-[0-9.]+-luna/i]

/** Resolve the OpenCode Go wire endpoint for a model id → { style, verified }. */
function openCodeEndpoint(id, npm) {
  const mapped = npm && OPENCODE_NPM_ENDPOINT[npm]
  if (mapped === 'anthropic-messages' || mapped === 'openai-responses') {
    return { style: mapped, verified: true }
  }
  if (OPENCODE_MESSAGES_FAMILIES.some((re) => re.test(id))) {
    return { style: 'anthropic-messages', verified: false }
  }
  if (OPENCODE_RESPONSES_FAMILIES.some((re) => re.test(id))) {
    return { style: 'openai-responses', verified: false }
  }
  return { style: 'openai-chat', verified: true }
}

// Legacy ids still returned by /v1/models but absent from the official Go model list
// (https://opencode.ai/docs/go/) — no docs row and no models.dev entry, so their
// endpoint cannot be verified. Don't suggest:
//   deepseek-flash → superseded by deepseek-v4-flash
//   grok-4.5       → superseded by grok-4.6/4.7 (which use /responses anyway)
//   minimax-m2.5   → superseded by minimax-m2.7
//   qwen3.5-plus   → superseded by qwen3.7-plus
const OPENCODE_LEGACY_IDS = new Set(['deepseek-flash', 'grok-4.5', 'minimax-m2.5', 'qwen3.5-plus'])

async function checkOpenCodeGo(curated, overrides, appMessages) {
  console.log('=== OPENCODE GO ===')

  // Live catalog. NOTE: this feed is chat/completions-first and omits /v1/messages-only
  // models (claude-haiku-5-5 is missing from it today), so existence is judged on the
  // union below, never on this list alone.
  let liveIds
  try {
    const d = await fetchJson(OPENCODE_URL)
    const list = Array.isArray(d) ? d : d.data || []
    liveIds = list.map((m) => m.id)
  } catch (e) {
    console.log(`  fetch failed (real API): ${e.message}`)
    console.log('')
    return null
  }

  // Enrichment: models.dev has ctx/pricing AND the wire endpoint (`provider.npm`).
  let md = {}
  try {
    const d = await fetchJson(MODELSDEV_URL)
    md = d['opencode-go']?.models || {}
  } catch {
    // enrichment is optional — existence checks below still work without it
  }

  const live = new Set(liveIds)
  const mdIds = new Set(Object.keys(md))
  const curatedSet = new Set(curated)
  const messagesSet = appMessages instanceof Set ? appMessages : new Set(appMessages || [])
  const result = { provider: 'opencode-go', newModels: [], removed: [], ctx: [] }

  const endpointOf = (id) => openCodeEndpoint(id, md[id]?.provider?.npm)
  const exists = (id) => live.has(id) || mdIds.has(id) || messagesSet.has(id)

  // REMOVED — in app, gone from every source (live feed, models.dev, app routing set)
  const removed = curated.filter((id) => !exists(id))
  result.removed = removed
  if (removed.length) {
    console.log(`  REMOVED (${removed.length}) — in app, gone from OpenCode Go:`)
    for (const id of removed) console.log(`    [-] ${id}`)
  }

  // STALE ROUTING — the app pins a model to /v1/messages that nothing upstream lists
  const staleMessages = [...messagesSet].filter((id) => !live.has(id) && !mdIds.has(id))
  if (staleMessages.length) {
    console.log(`  STALE ROUTING (${staleMessages.length}) — in OPENCODE_GO_ANTHROPIC_MESSAGES_MODELS, not upstream:`)
    for (const id of staleMessages) console.log(`    [!] ${id}`)
  }

  // MISROUTED — upstream serves it on /v1/messages but the app does not pin it, so it
  // would POST to /v1/chat/completions and fail.
  const misrouted = curated.filter(
    (id) => endpointOf(id).style === 'anthropic-messages' && !messagesSet.has(id),
  )
  if (misrouted.length) {
    console.log(`  MISROUTED (${misrouted.length}) — /v1/messages model missing from the app routing set:`)
    for (const id of misrouted) {
      console.log(`    [!] ${id} — app would POST /v1/chat/completions; add it to OPENCODE_GO_ANTHROPIC_MESSAGES_MODELS`)
    }
  }

  // CONTEXT mismatch (app override vs models.dev limit.context, when models.dev knows it)
  const ctx = []
  for (const id of curated) {
    if (!exists(id)) continue
    const m = md[id]
    const ov = overrides[id]
    const lv = m?.limit?.context
    if (ov != null && lv != null && ov !== lv) ctx.push([id, ov, lv])
  }
  result.ctx = ctx
  if (ctx.length) {
    console.log(`  CONTEXT mismatch (${ctx.length}) — app override -> live:`)
    for (const [id, ov, lv] of ctx) console.log(`    [~] ${id}: ${fmtNum(ov)} -> ${fmtNum(lv)}`)
  }

  // NEW — reachable by the app, not curated. `/v1/messages` models count: the app
  // routes them via openCodeGoApiStyle(), so they are normal presets.
  const candidates = [...new Set([...liveIds, ...messagesSet])].sort()
  const allFresh = candidates.filter((id) => !curatedSet.has(id))
  const fresh = allFresh.filter((id) => endpointOf(id).style !== 'openai-responses' && !OPENCODE_LEGACY_IDS.has(id))
  const skipped = allFresh.filter((id) => endpointOf(id).style === 'openai-responses')
  const legacy = allFresh.filter((id) => endpointOf(id).style !== 'openai-responses' && OPENCODE_LEGACY_IDS.has(id))
  result.newModels = fresh.map((id) => ({
    id,
    ctx: md[id]?.limit?.context,
    apiStyle: endpointOf(id).style,
  }))
  if (skipped.length) {
    console.log(
      `  (skipped ${skipped.length} /v1/responses-only model${skipped.length === 1 ? '' : 's'} — app speaks chat/completions + messages: ${skipped.join(', ')})`,
    )
  }
  if (legacy.length) {
    console.log(
      `  (ignored ${legacy.length} legacy model${legacy.length === 1 ? '' : 's'} not in Go docs: ${legacy.join(', ')})`,
    )
  }
  if (fresh.length) {
    console.log(`  NEW (${fresh.length}):`)
    for (const it of result.newModels) {
      const m = md[it.id]
      const ep = endpointOf(it.id)
      const tag =
        it.apiStyle === 'anthropic-messages'
          ? `  →  ${OPENCODE_ENDPOINT_LABEL[it.apiStyle]} (Anthropic Messages)${ep.verified ? '' : ' — endpoint unverified, not in models.dev'}`
          : ''
      if (m?.limit?.context != null) {
        console.log(`    [+] ${it.id}${tag}`)
        console.log(`        ctx ${fmtNum(m.limit.context)}  ${money(m.cost?.input)} in · ${money(m.cost?.output)} out`)
      } else {
        console.log(`    [+] ${it.id}${tag}  (ctx unknown — not in models.dev)`)
      }
    }
  }

  if (!removed.length && !ctx.length && !fresh.length && !misrouted.length && !staleMessages.length) {
    console.log('  (no changes — curated list is up to date).')
  }
  console.log('  note: /v1/chat/completions and /v1/messages models are both suggested; adding a /v1/messages model also pins it in OPENCODE_GO_ANTHROPIC_MESSAGES_MODELS. /v1/responses-only models (Grok, Muse Spark, *-luna) are skipped.')
  console.log('')
  return result
}

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

async function interactiveApply(or, oc, nv, presetsSource, contextSource) {
  const state = { presets: presetsSource, context: contextSource, added: 0, removed: 0, changed: 0 }

  const groups = []
  const ocChat = (oc?.newModels || []).filter((m) => m.apiStyle !== 'anthropic-messages')
  const ocMessages = (oc?.newModels || []).filter((m) => m.apiStyle === 'anthropic-messages')
  if (or?.newModels.length)
    groups.push({ title: 'ADD — OpenRouter', items: or.newModels, kind: 'add', preset: 'OPENROUTER_LLM_PRESET_MODELS' })
  if (ocChat.length)
    groups.push({ title: 'ADD — OpenCode Go (/v1/chat/completions)', items: ocChat, kind: 'add', preset: 'OPENCODE_GO_LLM_PRESET_MODELS' })
  if (ocMessages.length)
    groups.push({ title: 'ADD — OpenCode Go (/v1/messages · Anthropic)', items: ocMessages, kind: 'add', preset: 'OPENCODE_GO_LLM_PRESET_MODELS' })
  if (nv?.newModels.length)
    groups.push({ title: 'ADD — NVIDIA', items: nv.newModels, kind: 'add', preset: 'NVIDIA_LLM_PRESET_MODELS' })
  if (or?.removed.length)
    groups.push({ title: 'REMOVE — OpenRouter', items: or.removed.map((id) => ({ id })), kind: 'remove', preset: 'OPENROUTER_LLM_PRESET_MODELS' })
  if (oc?.removed.length)
    groups.push({ title: 'REMOVE — OpenCode Go', items: oc.removed.map((id) => ({ id })), kind: 'remove', preset: 'OPENCODE_GO_LLM_PRESET_MODELS' })
  if (nv?.removed.length)
    groups.push({ title: 'REMOVE — NVIDIA', items: nv.removed.map((id) => ({ id })), kind: 'remove', preset: 'NVIDIA_LLM_PRESET_MODELS' })
  if (or?.ctx.length)
    groups.push({ title: 'UPDATE CONTEXT — OpenRouter', items: or.ctx.map(([id, ov, lv]) => ({ id, ov, lv })), kind: 'ctx' })
  if (oc?.ctx.length)
    groups.push({ title: 'UPDATE CONTEXT — OpenCode Go', items: oc.ctx.map(([id, ov, lv]) => ({ id, ov, lv })), kind: 'ctx' })
  if (nv?.ctx.length)
    groups.push({ title: 'UPDATE CONTEXT — NVIDIA', items: nv.ctx.map(([id, ov, lv]) => ({ id, ov, lv })), kind: 'ctx' })

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
  const isMessagesModel = it.apiStyle === 'anthropic-messages' && g.preset === 'OPENCODE_GO_LLM_PRESET_MODELS'
  if (g.kind === 'add') {
    let label = makeLabel(it.id, it.ctx)
    if (isMessagesModel) {
      label = label.endsWith(')') ? label.slice(0, -1) + ' · Anthropic Messages)' : `${label} (Anthropic Messages)`
    }
    state.presets = addPresetToArray(state.presets, g.preset, it.id, label)
    if (isMessagesModel) {
      // Routing: the app must POST this id to `{base}/messages`, not /v1/chat/completions.
      state.presets = addSetEntry(state.presets, 'OPENCODE_GO_ANTHROPIC_MESSAGES_MODELS', it.id)
    }
    if (it.ctx != null) state.context = upsertContextOverride(state.context, it.id, it.ctx)
    state.added++
    console.log(`    + added ${it.id}  (${label})`)
  } else if (g.kind === 'remove') {
    state.presets = removePresetFromArray(state.presets, g.preset, it.id)
    if (g.preset === 'OPENCODE_GO_LLM_PRESET_MODELS') {
      state.presets = removeSetEntry(state.presets, 'OPENCODE_GO_ANTHROPIC_MESSAGES_MODELS', it.id)
    }
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
  const overrides = extractContextOverrides(contextSource)
  // The app's per-model /v1/messages routing set (config, not just metadata).
  const openCodeMessages = extractSetEntries(presetsSource, 'OPENCODE_GO_ANTHROPIC_MESSAGES_MODELS')

  console.log('Voidcast — cloud model preset checker')
  console.log('')

  const or = !OPENCODE_ONLY && !NVIDIA_ONLY ? await checkOpenRouter(curatedOpenRouter, overrides) : null
  const oc = !OPENROUTER_ONLY && !NVIDIA_ONLY
    ? await checkOpenCodeGo(curatedOpenCode, overrides, openCodeMessages)
    : null
  const nv = !OPENROUTER_ONLY && !OPENCODE_ONLY ? await checkOpenAICompat({ title: 'NVIDIA', url: NVIDIA_URL, preset: 'NVIDIA_LLM_PRESET_MODELS', curated: curatedNvidia, overrides, filter: isNvidiaChatModel }) : null

  if (APPLY_FLAG) {
    await interactiveApply(or, oc, nv, presetsSource, contextSource)
  } else {
    console.log('To add a model, edit electron-app/src/lib/cloudLlmPresets.ts (+ aliases/context in contextLimit.ts).')
    console.log('Or run: node scripts/check-models.mjs --apply   (pick changes interactively, edits the source files)')
  }
}

main().catch((e) => {
  console.error('error:', e.message)
  process.exit(1)
})