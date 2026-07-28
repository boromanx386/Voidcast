import { describe, it, expect } from 'vitest'
import {
  detectLanguageFromExt,
  extractSymbols,
  formatSymbolsOutline,
  type SymbolEntry,
} from '../src/lib/codingOutline'

describe('detectLanguageFromExt', () => {
  it('detects known extensions', () => {
    expect(detectLanguageFromExt('foo.ts')).toBe('ts')
    expect(detectLanguageFromExt('bar.tsx')).toBe('ts')
    expect(detectLanguageFromExt('a.js')).toBe('js')
    expect(detectLanguageFromExt('a.mjs')).toBe('js')
    expect(detectLanguageFromExt('srv.py')).toBe('py')
    expect(detectLanguageFromExt('main.go')).toBe('go')
    expect(detectLanguageFromExt('lib.rs')).toBe('rs')
    expect(detectLanguageFromExt('README.md')).toBe('md')
  })
  it('returns null for unknown / no extension', () => {
    expect(detectLanguageFromExt('index.html')).toBeNull()
    expect(detectLanguageFromExt('Makefile')).toBeNull()
    expect(detectLanguageFromExt('')).toBeNull()
  })
})

const TS_FIXTURE = `import { x } from './x'

export const VERSION = '1.0.0'

export interface User {
  id: number
  name: string
}

export type Status = 'on' | 'off'

export enum Color {
  Red,
  Green,
}

export class Handler {
  private count = 0

  public handleGlobFiles(args: unknown, ctx: unknown) {
    return null
  }

  async fetchData(url: string) {
    return null
  }
}

export async function bootstrap() {
  return null
}

function helper() {
  return 1
}

const arrow = (n: number) => n + 1
`

describe('extractSymbols — TypeScript', () => {
  const syms = extractSymbols(TS_FIXTURE, 'ts')

  it('finds const, interface, type, enum, class, functions, methods', () => {
    const names = syms.map((s) => s.name)
    expect(names).toContain('VERSION')
    expect(names).toContain('User')
    expect(names).toContain('Status')
    expect(names).toContain('Color')
    expect(names).toContain('Handler')
    expect(names).toContain('handleGlobFiles')
    expect(names).toContain('fetchData')
    expect(names).toContain('bootstrap')
    expect(names).toContain('helper')
    expect(names).toContain('arrow')
  })

  it('reports correct kinds', () => {
    const byName = new Map(syms.map((s) => [s.name, s]))
    expect(byName.get('VERSION')?.kind).toBe('const')
    expect(byName.get('User')?.kind).toBe('interface')
    expect(byName.get('Status')?.kind).toBe('type')
    expect(byName.get('Color')?.kind).toBe('enum')
    expect(byName.get('Handler')?.kind).toBe('class')
    expect(byName.get('handleGlobFiles')?.kind).toBe('method')
    expect(byName.get('fetchData')?.kind).toBe('method')
    expect(byName.get('bootstrap')?.kind).toBe('async_function')
    expect(byName.get('helper')?.kind).toBe('function')
  })

  it('line numbers are 1-based and increasing', () => {
    const lines = syms.map((s) => s.line)
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i]).toBeGreaterThan(lines[i - 1])
    }
    expect(syms[0].line).toBeGreaterThanOrEqual(1)
  })
})

const PY_FIXTURE = `class Service:
    def run(self):
        pass

    async def stop(self):
        pass

def main():
    pass

async def fetch():
    pass
`

describe('extractSymbols — Python', () => {
  const syms = extractSymbols(PY_FIXTURE, 'py')
  it('finds def, async def, class', () => {
    const byName = new Map(syms.map((s) => [s.name, s]))
    expect(byName.get('Service')?.kind).toBe('class')
    expect(byName.get('run')?.kind).toBe('def')
    expect(byName.get('stop')?.kind).toBe('async_def')
    expect(byName.get('main')?.kind).toBe('def')
    expect(byName.get('fetch')?.kind).toBe('async_def')
  })
})

const MD_FIXTURE = `# Title

Some intro.

## Section A

text

### Subsection

## Section B
`

describe('extractSymbols — Markdown', () => {
  const syms = extractSymbols(MD_FIXTURE, 'md')
  it('finds headings with level signature', () => {
    const names = syms.map((s) => s.name)
    expect(names).toEqual(['Title', 'Section A', 'Subsection', 'Section B'])
    expect(syms[0].signature).toBe('h1')
    expect(syms[1].signature).toBe('h2')
    expect(syms[2].signature).toBe('h3')
  })
})

const GO_FIXTURE = `package main

type User struct {
    ID int
}

type Reader interface {
    Read(p []byte) (n int, err error)
}

func main() {
}

func (u *User) Name() string {
    return ""
}
`

describe('extractSymbols — Go', () => {
  const syms = extractSymbols(GO_FIXTURE, 'go')
  it('finds func, struct, interface', () => {
    const byName = new Map(syms.map((s) => [s.name, s]))
    expect(byName.get('User')?.kind).toBe('struct')
    expect(byName.get('Reader')?.kind).toBe('interface')
    expect(byName.get('main')?.kind).toBe('function')
    expect(byName.get('Name')?.kind).toBe('function')
  })
})

const RS_FIXTURE = `pub struct Config {
    pub name: String,
}

pub enum Kind {
    A,
    B,
}

pub trait Store {
    fn get(&self) -> u32;
}

impl Store for Config {
    fn get(&self) -> u32 {
        0
    }
}

pub async fn load() -> Config {
    todo!()
}
`

describe('extractSymbols — Rust', () => {
  const syms = extractSymbols(RS_FIXTURE, 'rs')
  it('finds struct, enum, trait, fn', () => {
    expect(syms.some((s) => s.kind === 'struct' && s.name === 'Config')).toBe(true)
    expect(syms.some((s) => s.kind === 'enum' && s.name === 'Kind')).toBe(true)
    expect(syms.some((s) => s.kind === 'trait' && s.name === 'Store')).toBe(true)
    expect(syms.some((s) => s.kind === 'async_function' && s.name === 'load')).toBe(true)
  })
  it('detects impl block', () => {
    expect(syms.some((s) => s.kind === 'impl' && s.name === 'Config')).toBe(true)
  })
})

describe('extractSymbols — maxSymbols cap', () => {
  it('caps the number of returned symbols', () => {
    const big = Array.from({ length: 50 }, (_, i) => `function f${i}() {}`).join('\n')
    const syms = extractSymbols(big, 'js', 5)
    expect(syms.length).toBe(5)
  })

  it('applies query before the maxSymbols cap so late matches survive', () => {
    const early = Array.from({ length: 20 }, (_, i) => `function early${i}() {}`).join('\n')
    const late = 'function needleTarget() {}'
    const content = `${early}\n${late}`
    // Cap of 5 without query would only return early0..early4
    const without = extractSymbols(content, 'js', 5)
    expect(without.some((s) => s.name === 'needleTarget')).toBe(false)
    const withQuery = extractSymbols(content, 'js', 5, 'needle')
    expect(withQuery.map((s) => s.name)).toEqual(['needleTarget'])
  })
})

describe('formatSymbolsOutline', () => {
  const syms: SymbolEntry[] = [
    { line: 3, kind: 'const', name: 'VERSION', signature: "export const VERSION = '1.0.0'" },
    { line: 12, kind: 'class', name: 'Handler' },
    { line: 16, kind: 'method', name: 'handleGlobFiles', signature: 'handleGlobFiles(args, ctx)' },
  ]

  it('produces a header and line-prefixed rows', () => {
    const out = formatSymbolsOutline('src/foo.ts', syms, 200)
    const lines = out.split('\n')
    expect(lines[0]).toBe('find_symbols: src/foo.ts (200 lines, 3 symbols)')
    expect(lines[1]).toMatch(/^\s*3\s+const\s+VERSION/)
    expect(lines[2]).toMatch(/^\s*12\s+class\s+Handler/)
    expect(lines[3]).toMatch(/^\s*16\s+method\s+handleGlobFiles/)
  })

  it('every row line prefix matches the numeric pattern', () => {
    const out = formatSymbolsOutline('a.ts', syms, 200)
    const rows = out.split('\n').slice(1)
    for (const r of rows) {
      expect(r).toMatch(/^\s*(\d+)\s+\w+\s+/)
    }
  })

  it('query filter narrows by name substring (case-insensitive)', () => {
    const out = formatSymbolsOutline('src/foo.ts', syms, 200, { query: 'Glob' })
    const lines = out.split('\n')
    expect(lines[0]).toContain('1 symbol')
    expect(lines[1]).toMatch(/handleGlobFiles/)
  })

  it('reports "(No symbols...)" when nothing matches query', () => {
    const out = formatSymbolsOutline('src/foo.ts', syms, 200, { query: 'zzz' })
    expect(out).toContain('No symbols matching "zzz"')
  })
})