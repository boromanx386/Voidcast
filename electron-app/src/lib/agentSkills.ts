/**
 * Agent Skills — Cursor/Claude-style progressive disclosure.
 * Catalog (name + description) goes in the system prompt; full SKILL.md via read_skill.
 */

export type AgentSkillSource = 'agents' | 'claude' | 'cursor'

export type AgentSkillMeta = {
  /** Stable id: usually the skill name from frontmatter (or folder name). */
  id: string
  name: string
  description: string
  /** Absolute path to the skill directory (desktop only). */
  dirPath: string
  source: AgentSkillSource
}

/** Relative roots under os.homedir(), in discovery priority order (first wins on name clash). */
export const AGENT_SKILL_ROOT_SPECS: ReadonlyArray<{
  source: AgentSkillSource
  segments: readonly string[]
}> = [
  { source: 'agents', segments: ['.agents', 'skills'] },
  { source: 'claude', segments: ['.claude', 'skills'] },
  { source: 'cursor', segments: ['.cursor', 'skills'] },
]

export const AGENT_SKILL_BODY_MAX_CHARS = 100_000

let skillsCache: AgentSkillMeta[] | null = null
let skillsCachePromise: Promise<AgentSkillMeta[]> | null = null

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
    return `- ${s.name}: ${desc}`
  })
  return [
    'Agent skills (progressive disclosure): a catalog of specialized instruction packs is available.',
    'When a user request matches a skill description, call read_skill with that skill name BEFORE following its workflow.',
    'Do not invent skill contents; only use what read_skill returns.',
    'Available skills:',
    ...lines,
  ].join('\n')
}

export function truncateSkillBody(content: string, maxChars = AGENT_SKILL_BODY_MAX_CHARS): string {
  if (content.length <= maxChars) return content
  return `${content.slice(0, maxChars)}\n\n…[truncated: skill body exceeded ${maxChars} characters]`
}

function hasSkillsBridge(): boolean {
  return typeof window !== 'undefined' && typeof window.voidcast?.listAgentSkills === 'function'
}

export async function discoverAgentSkills(opts?: { force?: boolean }): Promise<AgentSkillMeta[]> {
  if (!opts?.force && skillsCache) return skillsCache
  if (!opts?.force && skillsCachePromise) return skillsCachePromise
  if (!hasSkillsBridge()) {
    skillsCache = []
    return skillsCache
  }
  skillsCachePromise = (async () => {
    try {
      const res = await window.voidcast!.listAgentSkills()
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

export async function rescanAgentSkills(): Promise<AgentSkillMeta[]> {
  skillsCache = null
  skillsCachePromise = null
  return discoverAgentSkills({ force: true })
}

export function getCachedAgentSkills(): AgentSkillMeta[] {
  return skillsCache ?? []
}

export async function readAgentSkillBody(name: string): Promise<
  { ok: true; name: string; content: string } | { ok: false; error: string }
> {
  const skillName = name.trim()
  if (!skillName) return { ok: false, error: 'Missing skill name.' }
  if (!hasSkillsBridge() || typeof window.voidcast?.readAgentSkill !== 'function') {
    return { ok: false, error: 'Agent skills are only available in the desktop app.' }
  }
  try {
    const res = await window.voidcast.readAgentSkill({ name: skillName })
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
