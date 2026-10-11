#!/usr/bin/env node
/**
 * Voidcast release helper.
 *
 * 1) (opciono) `--bump` podigne verziju u:
 *      electron-app/package.json
 *      electron-app/package-lock.json
 *      electron-app/src/hooks/useAppSettings.ts  (default appVersion)
 * 2) commit svih izmena  ("chore: release vX.Y.Z")
 * 3) tag vX.Y.Z
 * 4) push grane + tag
 *
 * GitHub Actions (.github/workflows/release.yml) tada sagradi Windows i Linux
 * i objavi jedan GitHub Release (installeri + latest*.yml za auto-update).
 *
 * Usage:
 *   node scripts/release.mjs --bump patch   bump + commit + tag + push
 *   node scripts/release.mjs --bump minor
 *   node scripts/release.mjs                commit + tag + push (verzija već podignuta)
 *   node scripts/release.mjs --dry-run      samo prikaži šta bi uradio
 *   node scripts/release.mjs --no-push      commit + tag lokalno, bez push-a
 *   node scripts/release.mjs -m "poruka"    custom commit poruka
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const msgIdx = args.findIndex((a) => a === '-m' || a === '--message')
const customMessage = msgIdx >= 0 ? args[msgIdx + 1] : undefined
const bumpIdx = args.findIndex((a) => a === '--bump' || a.startsWith('--bump='))
const bumpRaw =
  bumpIdx < 0
    ? undefined
    : args[bumpIdx].startsWith('--bump=')
      ? args[bumpIdx].slice('--bump='.length)
      : args[bumpIdx + 1]

// Indeksi argumenata koji su VREDNOSTI (ne flagovi) — da ne uđu u `flags`.
const valueIdx = new Set()
if (msgIdx >= 0) valueIdx.add(msgIdx + 1)
if (bumpIdx >= 0 && !args[bumpIdx].startsWith('--bump=')) valueIdx.add(bumpIdx + 1)

const flags = new Set(
  args.filter((a, i) => a.startsWith('-') && i !== msgIdx && i !== bumpIdx && !valueIdx.has(i)),
)
const DRY = flags.has('--dry-run')
const NO_PUSH = flags.has('--no-push')

const BUMP_KINDS = ['patch', 'minor', 'major']

const C = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
}
const log = (m) => console.log(`${C.cyan('[release]')} ${m}`)
const ok = (m) => console.log(`${C.green('✓')} ${m}`)
const warn = (m) => console.log(`${C.yellow('!')} ${m}`)
const die = (m) => {
  console.error(`${C.red('✗')} ${m}`)
  process.exit(1)
}

if (flags.has('--help') || flags.has('-h')) {
  console.log(`
Voidcast release helper

  node scripts/release.mjs [opcije]

Opcije:
  --bump <kind>    podigni verziju pre commit-a: patch | minor | major
                   (piše u package.json, package-lock.json i useAppSettings.ts)
  --dry-run        prikaži šta bi uradio, bez izmena
  --no-push        commit + tag lokalno, bez push-a
  -m, --message    poruka commita (default: "chore: release vX.Y.Z")
  -h, --help       ova pomoć
`)
  process.exit(0)
}

function git(...a) {
  const r = spawnSync('git', a, { cwd: root, encoding: 'utf8' })
  if (r.error) die(`git nije dostupan: ${r.error.message}`)
  if (r.status !== 0) die(`git ${a.join(' ')} → ${(r.stderr || r.stdout || '').trim()}`)
  return (r.stdout || '').trim()
}
function gitTry(...a) {
  const r = spawnSync('git', a, { cwd: root, encoding: 'utf8' })
  return { ok: r.status === 0, out: (r.stdout || '').trim() }
}

// --- repo + verzija -----------------------------------------------------
if (!gitTry('rev-parse', '--show-toplevel').ok) die('Nisi unutar git repozitorijuma.')

const pkgPath = join(root, 'electron-app', 'package.json')
const lockPath = join(root, 'electron-app', 'package-lock.json')
const tsPath = join(root, 'electron-app', 'src', 'hooks', 'useAppSettings.ts')

let version = ''
try {
  version = JSON.parse(readFileSync(pkgPath, 'utf8')).version || ''
} catch (e) {
  die(`Ne mogu da pročitam ${pkgPath}: ${e.message}`)
}
if (!version) die(`Nema "version" u ${pkgPath}`)

// --- bump verzije -------------------------------------------------------
function nextVersion(cur, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(cur)
  if (!m) die(`Ne mogu da parsiram verziju "${cur}" (očekujem x.y.z).`)
  let major = Number(m[1])
  let minor = Number(m[2])
  let patch = Number(m[3])
  if (kind === 'major') {
    major += 1
    minor = 0
    patch = 0
  } else if (kind === 'minor') {
    minor += 1
    patch = 0
  } else {
    patch += 1
  }
  return `${major}.${minor}.${patch}`
}

function bumpJsonVersion(file, from, to) {
  let json
  try {
    json = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    warn(`${file}: ${e.message} — preskačem`)
    return 0
  }
  let hits = 0
  if (json.version === from) {
    json.version = to
    hits += 1
  }
  const rootPkg = json.packages && json.packages['']
  if (rootPkg && rootPkg.version === from) {
    rootPkg.version = to
    hits += 1
  }
  if (!hits) {
    warn(`${file}: nema verzije ${from} — preskačem`)
    return 0
  }
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`)
  return hits
}

function bumpTsDefault(file, to) {
  let src
  try {
    src = readFileSync(file, 'utf8')
  } catch {
    warn(`${file}: nema fajla — preskačem`)
    return 0
  }
  const re = /(\[appVersion[^\]]*\]\s*=\s*useState\()\s*'[^']*'/
  if (!re.test(src)) {
    warn(`${file}: ne nalazim appVersion useState — preskačem`)
    return 0
  }
  writeFileSync(file, src.replace(re, `$1'${to}'`))
  return 1
}

if (bumpRaw !== undefined) {
  if (!BUMP_KINDS.includes(bumpRaw)) {
    die(`Nepoznat --bump "${bumpRaw}" (dozvoljeno: ${BUMP_KINDS.join(' | ')})`)
  }
  const next = nextVersion(version, bumpRaw)
  log(`bump verzije: ${C.bold(version)} → ${C.bold(next)} (${bumpRaw})`)
  if (DRY) {
    log('[dry] upisujem verziju u package.json, package-lock.json i useAppSettings.ts')
  } else {
    let hits = 0
    hits += bumpJsonVersion(pkgPath, version, next)
    hits += bumpJsonVersion(lockPath, version, next)
    hits += bumpTsDefault(tsPath, next)
    ok(`verzija upisana na ${hits} ${hits === 1 ? 'mesto' : 'mesta'}`)
  }
  version = next
}

const tag = `v${version}`
const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
if (branch === 'HEAD') die('Detached HEAD — prebaci se na granu (npr. main).')

log(`verzija ${C.bold(version)}  ·  grana ${C.bold(branch)}  ·  tag ${C.bold(tag)}`)

// --- tag već postoji? ---------------------------------------------------
if (gitTry('rev-parse', '-q', '--verify', `refs/tags/${tag}`).ok) {
  die(`Tag ${tag} već postoji lokalno.`)
}
const remoteHas = gitTry('ls-remote', '--tags', 'origin', tag)
if (remoteHas.ok && remoteHas.out.includes(`refs/tags/${tag}`)) {
  die(`Tag ${tag} već postoji na origin-u.`)
}

// --- commit -------------------------------------------------------------
const dirty = git('status', '--porcelain')
const commitMsg = customMessage || `chore: release ${tag}`
if (dirty) {
  const n = dirty.split('\n').filter(Boolean).length
  log(`commit-ujem ${n} izmena: ${C.dim(commitMsg)}`)
  if (!DRY) {
    git('add', '-A')
    git('commit', '-m', commitMsg)
  }
  ok(DRY ? '[dry] commit' : 'commit napravljen')
} else {
  warn('nema izmena — tagujem postojeći HEAD')
}

// --- tag ----------------------------------------------------------------
if (!DRY) git('tag', '-a', tag, '-m', tag)
ok(DRY ? `[dry] git tag -a ${tag}` : `tag ${tag} napravljen`)

// --- push ---------------------------------------------------------------
if (NO_PUSH) {
  warn(`push preskočen (--no-push). Ručno: git push origin ${branch} && git push origin ${tag}`)
} else if (DRY) {
  log(`[dry] git push origin ${branch} && git push origin ${tag}`)
} else {
  log(`pushujem ${branch} + ${tag} ...`)
  git('push', 'origin', branch)
  git('push', 'origin', tag)
  ok('pushovano')
}

// --- link ---------------------------------------------------------------
const remoteUrl = gitTry('remote', 'get-url', 'origin').out
const m = /github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remoteUrl)
const url = m ? `https://github.com/${m[1]}/${m[2]}/actions` : null
console.log('')
if (url) ok(`GitHub Actions: ${C.bold(url)}`)
else ok('Gotovo — pogledaj GitHub → Actions.')
