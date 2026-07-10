import hljs from 'highlight.js/lib/core'
import type { LanguageFn } from 'highlight.js'
import bash from 'highlight.js/lib/languages/bash'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import graphql from 'highlight.js/lib/languages/graphql'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import less from 'highlight.js/lib/languages/less'
import lua from 'highlight.js/lib/languages/lua'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

const registered = new Set<string>()

function registerLanguage(name: string, mod: LanguageFn) {
  if (registered.has(name)) return
  hljs.registerLanguage(name, mod)
  registered.add(name)
}

registerLanguage('bash', bash)
registerLanguage('csharp', csharp)
registerLanguage('css', css)
registerLanguage('dockerfile', dockerfile)
registerLanguage('go', go)
registerLanguage('graphql', graphql)
registerLanguage('ini', ini)
registerLanguage('java', java)
registerLanguage('javascript', javascript)
registerLanguage('json', json)
registerLanguage('kotlin', kotlin)
registerLanguage('less', less)
registerLanguage('lua', lua)
registerLanguage('markdown', markdown)
registerLanguage('php', php)
registerLanguage('python', python)
registerLanguage('ruby', ruby)
registerLanguage('rust', rust)
registerLanguage('scss', scss)
registerLanguage('sql', sql)
registerLanguage('swift', swift)
registerLanguage('typescript', typescript)
registerLanguage('xml', xml)
registerLanguage('yaml', yaml)

export function escapePreviewHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Highlight one source line for the coding file preview (line numbers rendered separately). */
export function highlightPreviewLine(line: string, language: string | null): string {
  if (!language) return escapePreviewHtml(line)
  if (line.length === 0) return '\u00a0'
  try {
    return hljs.highlight(line, { language, ignoreIllegals: true }).value
  } catch {
    return escapePreviewHtml(line)
  }
}
