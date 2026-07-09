/**
 * Agent Skills — Cursor/Claude-style progressive disclosure.
 * Catalog (name + description) goes in the system prompt; full SKILL.md via read_skill.
 * Also loads project AGENTS.md / CLAUDE.md when a coding project is open.
 */

export type AgentSkillSource = 'project' | 'agents' | 'claude' | 'cursor'

export type AgentSkillMeta = {
  /** Stable id: usually the skill name from frontmatter (or folder name). */
  id: string
  name: string
  description: string
  /** Absolute path to the skill directory (desktop only). */
  dirPath: string
  source: AgentSkillSource
}

export type ProjectAgentInstructions = {
  /** Relative filename that was loaded (e.g. AGENTS.md). */
  fileName: string
  content: string
}

/** Relative roots under os.homedir(), after project roots (first wins on name clash). */
export const AGENT_SKILL_ROOT_SPECS: ReadonlyArray<{
  source: Exclude<AgentSkillSource, 'project'>
  segments: readonly string[]
}> = [
  { source: 'agents', segments: ['.agents', 'skills'] },
  { source: 'claude', segments: ['.claude', 'skills'] },
  { source: 'cursor', segments: ['.cursor', 'skills'] },
]

/** Relative skill roots under the coding project (scanned first → override globals). */
export const PROJECT_SKILL_ROOT_SEGMENTS: ReadonlyArray<readonly string[]> = [
  ['.cursor', 'skills'],
  ['.claude', 'skills'],
  ['.agents', 'skills'],
  ['skills'],
]

/** Project instruction files, in preference order when multiple exist. */
export const PROJECT_AGENT_INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md'] as const

export const AGENT_SKILL_BODY_MAX_CHARS = 100_000
export const PROJECT_AGENT_INSTRUCTIONS_MAX_CHARS = 50_000

let skillsCacheKey = ''
let skillsCache: AgentSkillMeta[] | null = null
let skillsCachePromise: Promise<AgentSkillMeta[]> | null = null

let projectInstructionsCacheKey = ''
let projectInstructionsCache: ProjectAgentInstructions[] | null = null
let projectInstructionsPromise: Promise<ProjectAgentInstructions[]> | null = null

/** Parse YAML-ish frontmatter for `name` and `description` only (no full YAML dependency). */
export function parseSkillFrontmatter(raw: string): {
  name?: string
  description?: string
  body: string
} {
  const text = raw.replace(/^\uFEFF/, '')
  if (!text.startsWith('---')) {
    return { body: text }
  }
  const end = text.indexOf('\n---', 3)
  if (end < 0) {
    return { body: text }
  }
  const fm = text.slice(3, end).replace(/^\r?\n/, '')
  const body = text.slice(end + 4).replace(/^\r?\n/, '')
  return {
    name: extractFrontmatterScalar(fm, 'name'),
    description: extractFrontmatterScalar(fm, 'description'),
    body,
  }
}

function readIndentedBlock(lines: string[], startIdx: number): string {
  const parts: string[] = []
  let j = startIdx
  while (j < lines.length && /^\s+/.test(lines[j] ?? '')) {
    parts.push((lines[j] ?? '').replace(/^\s+/, ''))
    j++
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

function extractFrontmatterScalar(fm: string, key: string): string | undefined {
  const lines = fm.split(/\r?\n/)
  const keyRe = new RegExp(`^${key}\\s*:\\s*(.*)$`, 'i')
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]?.match(keyRe)
    if (!m) continue
    let rest = m[1].trim()
    if (rest === '>' || rest === '|' || rest === '>-' || rest === '|-') {
      return readIndentedBlock(lines, i + 1) || undefined
    }
    if (!rest) {
      const next = lines[i + 1]?.trim() ?? ''
      if (next === '>' || next === '|' || next === '>-' || next === '|-') {
        return readIndentedBlock(lines, i + 2) || undefined
      }
      if (/^\s+\S/.test(lines[i + 1] ?? '')) {
        return readIndentedBlock(lines, i + 1) || undefined
      }
      return undefined
    }
    if (
      (rest.startsWith('"') && rest.endsWith('"') && rest.length >= 2) ||
      (rest.startsWith("'") && rest.endsWith("'") && rest.length >= 2)
    ) {
      rest = rest.slice(1, -1)
    }
    return rest.trim() || undefined
  }
  return undefined
}

/** Keep first occurrence of each skill name (case-insensitive). */
export function dedupeSkillsByName(skills: AgentSkillMeta[]): AgentSkillMeta[] {
  const seen = new Set<string>()
  const out: AgentSkillMeta[] = []
  for (const s of skills) {
    const key = s.name.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

export function buildSkillsCatalogHint(skills: AgentSkillMeta[]): string {
  if (skills.length === 0) return ''
  const lines = skills.map((s) => {
    const desc = s.description.trim() || '(no description)'
    const src = s.source === 'project' ? ' [project]' : ''
    return `- ${s.name}${src}: ${desc}`
  })
  return [
    'Agent skills (progressive disclosure): a catalog of specialized instruction packs is available.',
    'When a user request matches a skill description, call read_skill with that skill name BEFORE following its workflow.',
    'Do not invent skill contents; only use what read_skill returns.',
    'Project skills (marked [project]) override global skills with the same name.',
    'Available skills:',
    ...lines,
  ].join('\n')
}

export function buildProjectInstructionsHint(files: ProjectAgentInstructions[]): string {
  if (files.length === 0) return ''
  const blocks = files.map((f) => {
    const body = truncateSkillBody(f.content, PROJECT_AGENT_INSTRUCTIONS_MAX_CHARS)
    return `### ${f.fileName}\n${body}`
  })
  return [
    'Project agent instructions (from the open coding project). Follow these for work in this repository:',
    ...blocks,
  ].join('\n\n')
}

export function truncateSkillBody(content: string, maxChars = AGENT_SKILL_BODY_MAX_CHARS): string {
  if (content.length <= maxChars) return content
  return `${content.slice(0, maxChars)}\n\n…[truncated: content exceeded ${maxChars} characters]`
}

function hasSkillsBridge(): boolean {
  return typeof window !== 'undefined' && typeof window.voidcast?.listAgentSkills === 'function'
}

function normalizeProjectPath(projectPath?: string): string {
  return (projectPath ?? '').trim()
}

export async function discoverAgentSkills(opts?: {
  force?: boolean
  projectPath?: string
}): Promise<AgentSkillMeta[]> {
  const projectPath = normalizeProjectPath(opts?.projectPath)
  const cacheKey = projectPath
  if (!opts?.force && skillsCache && skillsCacheKey === cacheKey) return skillsCache
  if (!opts?.force && skillsCachePromise && skillsCacheKey === cacheKey) return skillsCachePromise
  if (!hasSkillsBridge()) {
    skillsCacheKey = cacheKey
    skillsCache = []
    return skillsCache
  }
  skillsCacheKey = cacheKey
  skillsCachePromise = (async () => {
    try {
      const res = await window.voidcast!.listAgentSkills(
        projectPath ? { projectPath } : undefined,
      )
      if (!res.ok) {
        skillsCache = []
        return skillsCache
      }
      skillsCache = dedupeSkillsByName(res.skills)
      return skillsCache
    } catch {
      skillsCache = []
      return skillsCache
    } finally {
      skillsCachePromise = null
    }
  })()
  return skillsCachePromise
}

export async function rescanAgentSkills(projectPath?: string): Promise<AgentSkillMeta[]> {
  skillsCache = null
  skillsCachePromise = null
  skillsCacheKey = ''
  return discoverAgentSkills({ force: true, projectPath })
}

export function getCachedAgentSkills(): AgentSkillMeta[] {
  return skillsCache ?? []
}

export async function loadProjectAgentInstructions(opts?: {
  force?: boolean
  projectPath?: string
}): Promise<ProjectAgentInstructions[]> {
  const projectPath = normalizeProjectPath(opts?.projectPath)
  if (!projectPath) {
    projectInstructionsCacheKey = ''
    projectInstructionsCache = []
    return []
  }
  if (
    !opts?.force &&
    projectInstructionsCache &&
    projectInstructionsCacheKey === projectPath
  ) {
    return projectInstructionsCache
  }
  if (
    !opts?.force &&
    projectInstructionsPromise &&
    projectInstructionsCacheKey === projectPath
  ) {
    return projectInstructionsPromise
  }
  if (
    typeof window === 'undefined' ||
    typeof window.voidcast?.readProjectAgentInstructions !== 'function'
  ) {
    projectInstructionsCacheKey = projectPath
    projectInstructionsCache = []
    return []
  }
  projectInstructionsCacheKey = projectPath
  projectInstructionsPromise = (async () => {
    try {
      const res = await window.voidcast!.readProjectAgentInstructions({ projectPath })
      if (!res.ok) {
        projectInstructionsCache = []
        return projectInstructionsCache
      }
      projectInstructionsCache = res.files
      return projectInstructionsCache
    } catch {
      projectInstructionsCache = []
      return projectInstructionsCache
    } finally {
      projectInstructionsPromise = null
    }
  })()
  return projectInstructionsPromise
}

export async function readAgentSkillBody(
  name: string,
  projectPath?: string,
): Promise<{ ok: true; name: string; content: string } | { ok: false; error: string }> {
  const skillName = name.trim()
  if (!skillName) return { ok: false, error: 'Missing skill name.' }
  if (!hasSkillsBridge() || typeof window.voidcast?.readAgentSkill !== 'function') {
    return { ok: false, error: 'Agent skills are only available in the desktop app.' }
  }
  try {
    const path = normalizeProjectPath(projectPath)
    const res = await window.voidcast.readAgentSkill({
      name: skillName,
      ...(path ? { projectPath: path } : {}),
    })
    if (!res.ok) return { ok: false, error: res.error || 'Failed to read skill.' }
    return {
      ok: true,
      name: res.name,
      content: truncateSkillBody(res.content),
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
