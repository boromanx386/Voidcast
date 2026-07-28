import { describe, expect, it } from 'vitest'
import {
  detectCheckKind,
  filterTscDiagnostics,
  formatTypecheckReport,
  parsePyrightJsonDiagnostics,
  parseRuffJsonDiagnostics,
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

describe('detectCheckKind', () => {
  it('selects python from .py paths', () => {
    expect(
      detectCheckKind({
        paths: ['tts-server/main.py'],
        hasTsconfig: true,
        hasPythonProject: false,
      }),
    ).toBe('python')
  })

  it('selects typescript from .ts paths', () => {
    expect(
      detectCheckKind({
        paths: ['src/a.ts'],
        hasTsconfig: false,
        hasPythonProject: true,
      }),
    ).toBe('typescript')
  })

  it('prefers tsconfig when no paths', () => {
    expect(
      detectCheckKind({ hasTsconfig: true, hasPythonProject: true }),
    ).toBe('typescript')
  })

  it('falls back to python markers', () => {
    expect(
      detectCheckKind({ hasTsconfig: false, hasPythonProject: true }),
    ).toBe('python')
  })

  it('returns null when nothing matches', () => {
    expect(detectCheckKind({ hasTsconfig: false, hasPythonProject: false })).toBeNull()
  })
})

describe('parseRuffJsonDiagnostics', () => {
  it('parses ruff JSON array', () => {
    const output = JSON.stringify([
      {
        code: 'F401',
        message: '`os` imported but unused',
        filename: 'main.py',
        location: { row: 2, column: 8 },
      },
    ])
    expect(parseRuffJsonDiagnostics(output)).toEqual([
      {
        file: 'main.py',
        line: 2,
        column: 8,
        code: 'F401',
        message: '`os` imported but unused',
      },
    ])
  })

  it('returns empty on invalid JSON', () => {
    expect(parseRuffJsonDiagnostics('not json')).toEqual([])
  })
})

describe('parsePyrightJsonDiagnostics', () => {
  it('parses generalDiagnostics and converts 0-based lines', () => {
    const output = JSON.stringify({
      generalDiagnostics: [
        {
          file: 'C:/proj/tts_main.py',
          severity: 'error',
          message: 'Type "None" is not assignable',
          rule: 'reportReturnType',
          range: { start: { line: 9, character: 4 }, end: { line: 9, character: 8 } },
        },
        {
          file: 'C:/proj/tts_main.py',
          severity: 'information',
          message: 'ignored',
          range: { start: { line: 0, character: 0 } },
        },
      ],
    })
    const diags = parsePyrightJsonDiagnostics(output)
    expect(diags).toHaveLength(1)
    expect(diags[0]).toMatchObject({
      line: 10,
      column: 5,
      code: 'reportReturnType',
      message: 'Type "None" is not assignable',
    })
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

  it('names the python checker', () => {
    const text = formatTypecheckReport({
      checkRootLabel: 'tts-server',
      diagnostics: [],
      exitCode: 0,
      checker: 'ruff',
    })
    expect(text).toBe('No ruff errors found (tts-server).')
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
