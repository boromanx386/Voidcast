import { describe, expect, test } from 'vitest'
import {
  buildSkillsCatalogHint,
  dedupeSkillsByName,
  parseSkillFrontmatter,
  truncateSkillBody,
  type AgentSkillMeta,
} from '../src/lib/agentSkills'

function skill(partial: Partial<AgentSkillMeta> & Pick<AgentSkillMeta, 'name'>): AgentSkillMeta {
  return {
    id: partial.id ?? partial.name,
    name: partial.name,
    description: partial.description ?? '',
    dirPath: partial.dirPath ?? `/skills/${partial.name}`,
    source: partial.source ?? 'claude',
  }
}

describe('parseSkillFrontmatter', () => {
  test('parses simple name and description', () => {
    const raw = `---
name: hyperframes
description: Make videos from HTML
---

# Body
hello
`
    const parsed = parseSkillFrontmatter(raw)
    expect(parsed.name).toBe('hyperframes')
    expect(parsed.description).toBe('Make videos from HTML')
    expect(parsed.body).toContain('# Body')
  })

  test('parses folded description block scalar', () => {
    const raw = `---
name: create-skill
description: >-
  Create Cursor Agent Skills. Use when authoring
  a new skill or asking about SKILL.md structure.
---

# Creating Skills
`
    const parsed = parseSkillFrontmatter(raw)
    expect(parsed.name).toBe('create-skill')
    expect(parsed.description).toContain('Create Cursor Agent Skills')
    expect(parsed.description).toContain('SKILL.md structure')
    expect(parsed.body).toContain('# Creating Skills')
  })

  test('returns body only when no frontmatter', () => {
    const parsed = parseSkillFrontmatter('# Just markdown\n')
    expect(parsed.name).toBeUndefined()
    expect(parsed.description).toBeUndefined()
    expect(parsed.body).toContain('# Just markdown')
  })

  test('handles quoted scalars', () => {
    const raw = `---
name: "my-skill"
description: 'A quoted description'
---
body
`
    const parsed = parseSkillFrontmatter(raw)
    expect(parsed.name).toBe('my-skill')
    expect(parsed.description).toBe('A quoted description')
  })
})

describe('dedupeSkillsByName', () => {
  test('keeps first occurrence (case-insensitive)', () => {
    const out = dedupeSkillsByName([
      skill({ name: 'HyperFrames', description: 'from agents', source: 'agents' }),
      skill({ name: 'hyperframes', description: 'from claude', source: 'claude' }),
      skill({ name: 'other', description: 'x', source: 'cursor' }),
    ])
    expect(out).toHaveLength(2)
    expect(out[0]?.source).toBe('agents')
    expect(out[0]?.description).toBe('from agents')
    expect(out[1]?.name).toBe('other')
  })
})

describe('buildSkillsCatalogHint', () => {
  test('returns empty string for empty catalog', () => {
    expect(buildSkillsCatalogHint([])).toBe('')
  })

  test('lists skills and instructs read_skill', () => {
    const hint = buildSkillsCatalogHint([
      skill({ name: 'hyperframes', description: 'Video from HTML' }),
      skill({ name: 'slideshow', description: '' }),
    ])
    expect(hint).toContain('read_skill')
    expect(hint).toContain('- hyperframes: Video from HTML')
    expect(hint).toContain('- slideshow: (no description)')
  })
})

describe('truncateSkillBody', () => {
  test('leaves short content unchanged', () => {
    expect(truncateSkillBody('hello', 100)).toBe('hello')
  })

  test('truncates long content', () => {
    const long = 'x'.repeat(50)
    const out = truncateSkillBody(long, 20)
    expect(out.startsWith('x'.repeat(20))).toBe(true)
    expect(out).toContain('truncated')
  })
})
