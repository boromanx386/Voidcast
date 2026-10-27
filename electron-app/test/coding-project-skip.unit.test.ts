import { describe, expect, it } from 'vitest'
import {
  filterCodingSearchMatches,
  isCodingGeneratedArtifactPath,
  isCodingGitStatePath,
  shouldSkipCodingProjectDir,
} from '../src/lib/codingProjectSkip'

describe('shouldSkipCodingProjectDir', () => {
  it('skips release and dist-electron', () => {
    expect(shouldSkipCodingProjectDir('release')).toBe(true)
    expect(shouldSkipCodingProjectDir('dist-electron')).toBe(true)
    expect(shouldSkipCodingProjectDir('src')).toBe(false)
  })

  it('skips the .voidcast scratch dir', () => {
    expect(shouldSkipCodingProjectDir('.voidcast')).toBe(true)
  })
})

describe('isCodingGeneratedArtifactPath', () => {
  it('skips paths under release and dist-electron', () => {
    expect(isCodingGeneratedArtifactPath('release/1.0/app.css')).toBe(true)
    expect(isCodingGeneratedArtifactPath('dist-electron/main/index.js')).toBe(true)
    expect(isCodingGeneratedArtifactPath('src/hooks/useChatAgent.ts')).toBe(false)
  })

  it('skips minified and hashed bundles', () => {
    expect(isCodingGeneratedArtifactPath('dist/assets/index-GO3eqiis.js')).toBe(true)
    expect(isCodingGeneratedArtifactPath('dist/assets/app.min.js')).toBe(true)
    expect(isCodingGeneratedArtifactPath('dist/assets/index.web-abc123.js')).toBe(true)
    expect(isCodingGeneratedArtifactPath('src/main.ts')).toBe(false)
  })

  it('skips dependency lock files', () => {
    expect(isCodingGeneratedArtifactPath('electron-app/package-lock.json')).toBe(true)
    expect(isCodingGeneratedArtifactPath('pnpm-lock.yaml')).toBe(true)
    expect(isCodingGeneratedArtifactPath('src/lib/lock.ts')).toBe(false)
  })
})

describe('filterCodingSearchMatches', () => {
  it('drops generated artifact matches', () => {
    const out = filterCodingSearchMatches([
      { path: 'src/a.ts', line: 1, text: 'foo' },
      { path: 'electron-app/package-lock.json', line: 2, text: 'foo' },
      { path: 'release/app/index-abc12345.js', line: 3, text: 'foo' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.path).toBe('src/a.ts')
  })
})

describe('isCodingGitStatePath', () => {
  it('accepts the files a commit, checkout or stage changes', () => {
    expect(isCodingGitStatePath('.git/HEAD')).toBe(true)
    expect(isCodingGitStatePath('.git/index')).toBe(true)
    expect(isCodingGitStatePath('.git/refs/heads/main')).toBe(true)
    expect(isCodingGitStatePath('.git\\refs\\heads\\main')).toBe(true)
  })

  it('rejects object writes, lock files and other paths', () => {
    expect(isCodingGitStatePath('.git/objects/ab/cdef')).toBe(false)
    expect(isCodingGitStatePath('.git/index.lock')).toBe(false)
    expect(isCodingGitStatePath('.git/logs/HEAD')).toBe(false)
    expect(isCodingGitStatePath('src/.git/HEAD')).toBe(false)
    expect(isCodingGitStatePath('src/index.ts')).toBe(false)
  })
})
