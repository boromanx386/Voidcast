import { beforeEach, describe, expect, test, vi } from 'vitest'

const readAgentSkillBody = vi.fn(async (name: string) => ({
  ok: true as const,
  name,
  content: 'body',
}))

vi.mock('@/lib/agentSkills', () => ({ readAgentSkillBody }))

const { handleReadSkill } = await import('../src/lib/toolHandlers/appHandlers')

describe('read_skill and project trust', () => {
  beforeEach(() => readAgentSkillBody.mockClear())

  test('an untrusted project resolves global skills only', async () => {
    await handleReadSkill({ name: 'deploy' }, {
      skillsEnabled: true,
      codingProjectPath: 'Q:/repos/cloned',
      mcpTrustedProjectPaths: [],
    } as never)
    expect(readAgentSkillBody).toHaveBeenCalledWith('deploy', undefined)
  })

  test('a trusted project resolves its own skills', async () => {
    await handleReadSkill({ name: 'deploy' }, {
      skillsEnabled: true,
      codingProjectPath: 'Q:\\repos\\mine',
      mcpTrustedProjectPaths: ['q:/repos/mine'],
    } as never)
    expect(readAgentSkillBody).toHaveBeenCalledWith('deploy', 'Q:\\repos\\mine')
  })
})
