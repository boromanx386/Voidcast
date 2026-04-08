import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

const components: Components = {
  p: ({ children }) => <p className='mb-2 last:mb-0'>{children}</p>,
  strong: ({ children }) => (
    <strong className='font-semibold text-zinc-50'>{children}</strong>
  ),
  em: ({ children }) => <em className='italic text-zinc-200'>{children}</em>,
  hr: () => <hr className='my-4 border-zinc-600' />,
  ul: ({ children }) => (
    <ul className='mb-2 list-disc space-y-1 pl-5 last:mb-0'>{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className='mb-2 list-decimal space-y-1 pl-5 last:mb-0'>{children}</ol>
  ),
  li: ({ children }) => <li className='leading-relaxed'>{children}</li>,
  h1: ({ children }) => (
    <h1 className='mb-2 mt-3 text-lg font-semibold text-zinc-50 first:mt-0'>
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className='mb-2 mt-3 text-base font-semibold text-zinc-50 first:mt-0'>
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className='mb-2 mt-2 text-sm font-semibold text-zinc-100 first:mt-0'>
      {children}
    </h3>
  ),
  blockquote: ({ children }) => (
    <blockquote className='mb-2 border-l-2 border-zinc-500 pl-3 text-zinc-300'>
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className='text-indigo-400 underline decoration-indigo-500/40 underline-offset-2 hover:text-indigo-300'
      target='_blank'
      rel='noopener noreferrer'
    >
      {children}
    </a>
  ),
  pre: ({ children }) => (
    <pre className='mb-2 overflow-x-auto rounded-lg bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-200 last:mb-0'>
      {children}
    </pre>
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = Boolean(className?.includes('language-'))
    if (isBlock) {
      return (
        <code className={`font-mono ${className ?? ''}`} {...props}>
          {children}
        </code>
      )
    }
    return (
      <code
        className='rounded bg-zinc-900/90 px-1 py-0.5 font-mono text-[0.88em] text-indigo-200'
        {...props}
      >
        {children}
      </code>
    )
  },
  table: ({ children }) => (
    <div className='mb-2 overflow-x-auto last:mb-0'>
      <table className='w-full border-collapse border border-zinc-600 text-left text-xs'>
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className='bg-zinc-900/80'>{children}</thead>,
  th: ({ children }) => (
    <th className='border border-zinc-600 px-2 py-1.5 font-semibold'>{children}</th>
  ),
  td: ({ children }) => (
    <td className='border border-zinc-700 px-2 py-1.5'>{children}</td>
  ),
  tr: ({ children }) => <tr className='border-zinc-700'>{children}</tr>,
}

type Props = {
  content: string
  className?: string
}

export function ChatMarkdown({ content, className }: Props) {
  return (
    <div
      className={`break-words text-[15px] leading-[1.65] text-zinc-200/95 ${className ?? ''}`}
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
