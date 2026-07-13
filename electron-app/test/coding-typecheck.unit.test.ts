import { describe, expect, it } from 'vitest'
import {
  filterTscDiagnostics,
  formatTypecheckReport,
  parseTscDiagnostics,
} from '../src/lib/codingTypecheck'

describe('parseTscDiagnostics', () => {
  it('parses parenthesis-style tsc errors', () => {
    const output = `src/foo.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.`
    const diags = parseTscDiagnostics(output)
    expect(diags).toEqual([
      {
        file: 'src/foo.ts',
        line: 10,
        column: 5,
        code: 'TS2322',
        message: "Type 'string' is not assignable to type 'number'.",
      },
    ])
  })

  it('parses colon-style tsc errors', () => {
    const output = `src/bar.tsx:42:11 - error TS2345: Argument of type 'null' is not assignable.`
    const diags = parseTscDiagnostics(output)
    expect(diags).toEqual([
      {
        file: 'src/bar.tsx',
        line: 42,
        column: 11,
        code: 'TS2345',
        message: "Argument of type 'null' is not assignable.",
      },
    ])
  })
})

describe('filterTscDiagnostics', () => {
  const diags = parseTscDiagnostics(
    [
      'src/a.ts(1,1): error TS1000: a',
      'src/b.ts(2,2): error TS1000: b',
      'lib/c.ts(3,3): error TS1000: c',
    ].join('\n'),
  )

  it('returns all diagnostics when no filter paths', () => {
    expect(filterTscDiagnostics(diags, [])).toHaveLength(3)
  })

  it('filters by project-relative path with path_prefix', () => {
    const filtered = filterTscDiagnostics(diags, ['electron-app/src/a.ts'], 'electron-app')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].file).toBe('src/a.ts')
  })
})

describe('formatTypecheckReport', () => {
  it('reports clean typecheck', () => {
    const text = formatTypecheckReport({
      checkRootLabel: 'electron-app',
      diagnostics: [],
      exitCode: 0,
    })
    expect(text).toBe('No TypeScript errors found (electron-app).')
  })

  it('formats capped error list', () => {
    const diags = parseTscDiagnostics('src/x.ts(1,1): error TS1000: boom')
    const text = formatTypecheckReport({
      checkRootLabel: 'project root',
      diagnostics: diags,
      exitCode: 2,
    })
    expect(text).toContain('1 error')
    expect(text).toContain('src/x.ts:1:1 — TS1000: boom')
  })
})
