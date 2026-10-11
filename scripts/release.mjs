#!/usr/bin/env node
/**
 * Voidcast release helper — BEZ bump-a verzije.
 *
 * Verziju podigneš sam u electron-app/package.json (ručno, ili u electron-app sa
 * `npm version x.y.z --no-git-tag-version`). Ova skripta onda radi:
 *   1) commit svih izmena  ("chore: release vX.Y.Z")
 *   2) tag vX.Y.Z
 *   3) push grane + tag
 *
 * GitHub Actions (.github/workflows/release.yml) tada sagradi Windows i Linux
 * i objavi jedan GitHub Release (installeri + latest*.yml za auto-update).
 *
 * Usage:
 *   node scripts/release.mjs              commit + tag + push
 *   node scripts/release.mjs --dry-run    samo prikaži šta bi uradio
 *   node scripts/release.mjs --no-push    commit + tag lokalno, bez push-a
 *   node scripts/release.mjs -m "poruka"  custom commit poruka
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('-') && a !== '-m'))
const msgIdx = args.findIndex((a) => a === '-m' || a === '--message')
const customMessage = msgIdx >= 0 ? args[msgIdx + 1] : undefined

const DRY = flags.has('--dry-run')
const NO_PUSH = flags.has('--no-push')

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
Voidcast release helper (bez bump-a verzije)

  node scripts/release.mjs [opcije]

Opcije:
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
let version = ''
try {
  version = JSON.parse(readFileSync(pkgPath, 'utf8')).version || ''
} catch (e) {
  die(`Ne mogu da pročitam ${pkgPath}: ${e.message}`)
}
if (!version) die(`Nema "version" u ${pkgPath}`)

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
