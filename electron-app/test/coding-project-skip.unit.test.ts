import { describe, expect, it } from 'vitest'
import {
  filterCodingSearchMatches,
  isCodingGeneratedArtifactPath,
  shouldSkipCodingProjectDir,
} from '../src/lib/codingProjectSkip'

describe('shouldSkipCodingProjectDir', () => {
  it('skips release and dist-electron', () => {
    expect(shouldSkipCodingProjectDir('release')).toBe(true)
    expect(shouldSkipCodingProjectDir('dist-electron')).toBe(true)
    expect(shouldSkipCodingProjectDir('src')).toBe(false)
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
})

describe('filterCodingSearchMatches', () => {
  it('drops generated artifact matches', () => {
    const out = filterCodingSearchMatches([
      { path: 'src/a.ts', line: 1, text: 'foo' },
      { path: 'release/app/index-abc12345.js', line: 2, text: 'foo' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.path).toBe('src/a.ts')
  })
})
