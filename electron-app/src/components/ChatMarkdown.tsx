import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

const components: Components = {
  p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
  strong: ({ children }) => (
    <strong className="font-semibold text-neon-cyan">{children}</strong>
  ),
  em: ({ children }) => <em className="italic text-void-light">{children}</em>,
  hr: () => (
    <hr className="my-4 border-void-muted/50" />
  ),
  ul: ({ children }) => (
    <ul className="mb-3 list-none space-y-1.5 last:mb-0 pl-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 list-decimal space-y-1.5 pl-5 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="leading-relaxed flex items-start gap-2">
      <span className="text-neon-cyan mt-1 shrink-0">▸</span>
      <span>{children}</span>
    </li>
  ),
  h1: ({ children }) => (
    <h1 className="mb-3 mt-4 text-xl font-display font-bold tracking-wide text-neon-cyan first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-3 mt-4 text-lg font-display font-semibold tracking-wide text-void-white first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-3 text-base font-display font-medium tracking-wide text-void-light first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-2 mt-2 text-sm font-display font-medium uppercase tracking-wider text-void-text first:mt-0">
      {children}
    </h4>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 border-neon-magenta/50 pl-4 py-1 bg-neon-magenta/5 italic text-void-light last:mb-0">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-neon-cyan underline decoration-neon-cyan/30 underline-offset-2 hover:text-neon-magenta hover:decoration-neon-magenta/50 transition-colors"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  pre: ({ children }) => (
    <pre className="mb-3 overflow-x-auto rounded bg-void-black border border-void-dim/30 p-4 text-xs leading-relaxed last:mb-0">
      {children}
    </pre>
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = Boolean(className?.includes('language-'))
    if (isBlock) {
      return (
        <code className={`font-mono text-neon-green ${className ?? ''}`} {...props}>
          {children}
        </code>
      )
    }
    return (
      <code
        className="rounded bg-void-mid/80 px-1.5 py-0.5 font-mono text-[0.88em] text-neon-cyan"
        {...props}
      >
        {children}
      </code>
    )
  },
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto last:mb-0 rounded border border-void-dim/30">
      <table className="w-full border-collapse text-left text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-void-mid/50">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="border-b border-void-dim/30 px-3 py-2 font-mono font-semibold text-neon-cyan uppercase tracking-wider text-xs">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-t border-void-dim/20 px-3 py-2 text-void-light">
      {children}
    </td>
  ),
  tr: ({ children }) => (
    <tr className="border-t border-void-dim/20 hover:bg-void-mid/20 transition-colors">
      {children}
    </tr>
  ),
  // Checkbox/task list support
  input: ({ type, checked, ...props }) => {
    if (type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={checked}
          readOnly
          className="mr-2 accent-neon-cyan"
          {...props}
        />
      )
    }
    return <input type={type} {...props} />
  },
  del: ({ children }) => (
    <del className="text-void-dim line-through">{children}</del>
  ),
}

type Props = {
  content: string
  className?: string
}

export function ChatMarkdown({ content, className }: Props) {
  return (
    <div
      className={`break-words text-sm leading-[1.7] text-void-light font-body ${className ?? ''}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
