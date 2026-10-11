#!/usr/bin/env node
/**
 * Cross-platform launcher for the local Python server in tts-server/.
 *
 *   npm run dev:tts         -> tools_main:app   (tools + TTS/STT server, port 8765)
 *   npm run dev:tts:local   -> tts_main:app     (local TTS only, port 8765)
 *
 * package.json also exposes explicit shortcuts if you prefer to see the raw
 * command: dev:tts:win / dev:tts:unix and dev:tts:local:win / dev:tts:local:unix.
 *
 * Set VOIDCAST_DRY=1 to print the resolved interpreter + args and exit
 * (useful for checking the venv is found without starting the server).
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const which = (process.argv[2] ?? 'tools') === 'tts' ? 'tts_main:app' : 'tools_main:app'

const pythonCandidates =
  process.platform === 'win32'
    ? ['.venv/Scripts/python.exe', '.venv/Scripts/python']
    : ['.venv/bin/python3', '.venv/bin/python']

const python = pythonCandidates
  .map((rel) => join(root, rel))
  .find((abs) => existsSync(abs))

if (!python) {
  console.error(
    `\n[dev:tts] Python venv nije nadjen u ${join(root, '.venv')}\n` +
      `  Napravi ga:  python -m venv .venv\n` +
      `  Pa instaliraj:  .venv\\Scripts\\pip install -r tts-server\\requirements.txt   (Windows)\n` +
      `                  .venv/bin/pip install -r tts-server/requirements.txt         (Linux/macOS)\n`
  )
  process.exit(1)
}

const cwd = join(root, 'tts-server')
const args = ['-m', 'uvicorn', which, '--host', '0.0.0.0', '--port', '8765']

if (process.env.VOIDCAST_DRY === '1') {
  console.log(`[dev:tts] python: ${python}`)
  console.log(`[dev:tts] cwd:    ${cwd}`)
  console.log(`[dev:tts] cmd:    ${python} ${args.join(' ')}`)
  process.exit(0)
}

const child = spawn(python, args, { cwd, stdio: 'inherit' })

child.on('error', (err) => {
  console.error(`[dev:tts] Ne mogu da pokrenem server: ${err.message}`)
  process.exit(1)
})

child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0))
