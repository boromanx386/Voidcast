import { afterEach, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import {
  appendProcessOutputBuffer,
  sliceProcessOutputBuffer,
} from '../src/lib/codingActiveProcesses'
import {
  attachCodingProcessStdio,
  CODING_COMMAND_SPAWN_DETACHED,
  codingCommandSpawnEnv,
} from '../src/lib/codingProcessStdio'

const children: ChildProcess[] = []

afterEach(async () => {
  for (const child of children.splice(0)) {
    try {
      if (child.pid) {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
          })
        } else {
          child.kill('SIGKILL')
        }
      }
    } catch {
      // ignore
    }
  }
  await new Promise((r) => setTimeout(r, 50))
})

function waitFor(
  pred: () => boolean,
  timeoutMs = 3_000,
  stepMs = 50,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      if (pred()) return resolve()
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`timeout after ${timeoutMs}ms waiting for predicate`))
      }
      setTimeout(tick, stepMs)
    }
    tick()
  })
}

describe('codingProcessStdio', () => {
  it('keeps spawn detached=false so pipes stay attached', () => {
    expect(CODING_COMMAND_SPAWN_DETACHED).toBe(false)
  })

  it('sets PYTHONUNBUFFERED by default', () => {
    const env = codingCommandSpawnEnv({ PATH: '/x' } as NodeJS.ProcessEnv)
    expect(env.PYTHONUNBUFFERED).toBe('1')
    expect(env.PATH).toBe('/x')
  })

  it('captures periodic stdout from an explicitly-background-style spawn into the ring buffer', async () => {
    let state = { buffer: '', startOffset: 0 }
    // Use process.stdout.write (not console.log) so Node pipe buffering is less likely to hide ticks.
    const script =
      "let n=0; const t=setInterval(()=>{ process.stdout.write('tick '+ (n++) +'\\n'); if(n>40) clearInterval(t); }, 150);"
    const command =
      process.platform === 'win32'
        ? `node -e "${script.replace(/"/g, '\\"')}"`
        : `node -e '${script}'`

    const child = spawn(command, {
      shell: true,
      detached: CODING_COMMAND_SPAWN_DETACHED,
      stdio: 'pipe',
      windowsHide: true,
      env: codingCommandSpawnEnv(),
    })
    children.push(child)

    const stdio = attachCodingProcessStdio(child, (_stream, text) => {
      state = appendProcessOutputBuffer(state, text)
    }, 30)

    await waitFor(() => state.buffer.includes('tick'), 4_000)
    stdio.flush()

    const sliced = sliceProcessOutputBuffer(state)
    expect(sliced.text).toMatch(/tick\s+\d+/)
    expect(sliced.nextOffset).toBeGreaterThan(0)
  }, 10_000)
})
