/**
 * Which shell runs `execute_command`. Models write bash, so on Windows Git Bash is used when
 * it is installed and cmd.exe stays the fallback. Pure functions (fs passed in) so the
 * detection is unit-testable without a Windows host.
 */
import { codingShellCommandLine } from './codingProcessStdio'

export type CodingShellKind = 'bash' | 'cmd' | 'sh'

export type CodingShell = { kind: 'bash'; path: string } | { kind: 'cmd' } | { kind: 'sh' }

type PathApi = {
  join: (...parts: string[]) => string
  dirname: (p: string) => string
  basename: (p: string) => string
}

/** Windows path helpers that do not depend on the host's `path` flavour (tests run anywhere). */
const winPath: PathApi = {
  join: (...parts) =>
    parts
      .filter(Boolean)
      .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, '')))
      .join('\\'),
  dirname: (p) => p.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, ''),
  basename: (p) => p.replace(/[\\/]+$/, '').replace(/^.*[\\/]/, ''),
}

/**
 * `C:\Windows\System32\bash.exe` is the WSL launcher: it runs Linux, where the project's
 * Windows paths and the user's Windows tools do not resolve. WindowsApps holds the same stub.
 */
function isWslBashStub(p: string): boolean {
  const lower = p.toLowerCase().replace(/\//g, '\\')
  return lower.includes('\\windows\\system32\\') || lower.includes('\\windowsapps\\')
}

function envGet(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase())
  return key ? env[key] : undefined
}

/**
 * Finds Git for Windows' `bin\bash.exe`. `bin\bash.exe` (not `usr\bin\bash.exe`) is the
 * launcher that puts Git's `usr\bin` (grep, sed, head …) on PATH for the child.
 * Order: `VOIDCAST_BASH_PATH`, the standard install folders, then a Git found on PATH.
 */
export function findGitBash(env: NodeJS.ProcessEnv, exists: (p: string) => boolean): string | null {
  const ok = (p: string | undefined): p is string => !!p && !isWslBashStub(p) && exists(p)

  const override = envGet(env, 'VOIDCAST_BASH_PATH')?.trim()
  if (ok(override)) return override

  const roots = [
    envGet(env, 'ProgramFiles'),
    envGet(env, 'ProgramW6432'),
    envGet(env, 'ProgramFiles(x86)'),
    envGet(env, 'LOCALAPPDATA') && winPath.join(envGet(env, 'LOCALAPPDATA') as string, 'Programs'),
  ]
  for (const root of roots) {
    if (!root) continue
    const candidate = winPath.join(root, 'Git', 'bin', 'bash.exe')
    if (ok(candidate)) return candidate
  }

  // Portable or custom installs: Git's `cmd\` or `bin\` folder is on PATH.
  for (const dir of (envGet(env, 'PATH') ?? '').split(';')) {
    const d = dir.trim().replace(/^"|"$/g, '')
    if (!d || !exists(winPath.join(d, 'git.exe'))) continue
    // git.exe lives in `<root>\cmd`, `<root>\bin` or `<root>\mingw64\bin`.
    const parent = winPath.dirname(d)
    const root = /^(mingw64|usr)$/i.test(winPath.basename(parent))
      ? winPath.dirname(parent)
      : parent
    const candidate = winPath.join(root, 'bin', 'bash.exe')
    if (ok(candidate)) return candidate
  }
  return null
}

export function resolveCodingShell(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  exists: (p: string) => boolean,
): CodingShell {
  if (platform !== 'win32') return { kind: 'sh' }
  if (envGet(env, 'VOIDCAST_SHELL')?.trim().toLowerCase() === 'cmd') return { kind: 'cmd' }
  const bash = findGitBash(env, exists)
  return bash ? { kind: 'bash', path: bash } : { kind: 'cmd' }
}

export type CodingShellSpawn = { file: string; args: string[]; shell: boolean }

/**
 * Runs before every Git Bash command. The hidden console still starts on the OEM code page, so
 * chcp switches it to UTF-8 for programs that encode piped output with it (same reason as the
 * cmd prefix). Models write `python3`, which on Windows is usually missing or the Microsoft
 * Store alias in WindowsApps ("Python was not found"); a function sends it to `python`.
 * `;` keeps the command's own exit status.
 */
export const GIT_BASH_COMMAND_PREFIX =
  'chcp.com 65001 >/dev/null 2>&1; ' +
  'case "$(command -v python3)" in ""|*[Ww]indows[Aa]pps*) ' +
  'python3() { python "$@"; }; export -f python3 ;; esac; '

/** `spawn(file, args, { shell })` for one command in the resolved shell. */
export function codingShellSpawn(shell: CodingShell, command: string): CodingShellSpawn {
  if (shell.kind === 'bash') {
    return {
      file: shell.path,
      args: ['-c', `${GIT_BASH_COMMAND_PREFIX}${command}`],
      shell: false,
    }
  }
  if (shell.kind === 'cmd') {
    return { file: codingShellCommandLine(command, 'win32'), args: [], shell: true }
  }
  return { file: command, args: [], shell: true }
}

/**
 * Git Bash prints POSIX paths (`/tmp/x.png`, `/c/Users/...`), and models pass them on to file
 * tools that run in Node. Maps the two mounts Git for Windows always has: `/tmp` (the user's
 * temp folder) and drive letters. Anything else is returned unchanged.
 */
export function gitBashPathToWindows(p: string, tmpDir: string): string {
  const s = p.trim()
  const tmp = s.match(/^\/tmp(\/.*)?$/i)
  if (tmp) return `${tmpDir.replace(/[\\/]+$/, '')}${(tmp[1] ?? '').replace(/\//g, '\\')}`
  const drive = s.match(/^\/([a-zA-Z])(\/.*)?$/)
  if (drive) return `${drive[1].toUpperCase()}:${(drive[2] ?? '\\').replace(/\//g, '\\')}`
  return s
}

/** One line for the tool description; nothing where the model's bash default already holds. */
export function codingShellNote(kind: CodingShellKind | undefined): string {
  if (kind === 'bash') return ' Shell: Git Bash on Windows; write paths with forward slashes.'
  if (kind === 'cmd') return ' Shell: cmd.exe (Windows), not bash.'
  return ''
}
