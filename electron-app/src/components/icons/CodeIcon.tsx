import type { SVGProps } from 'react'

/** Terminal / coding panel (Lucide-style). */
export function CodeIcon({
  className = 'h-4 w-4 text-current',
  'aria-hidden': ariaHidden = true,
  ...rest
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={ariaHidden}
      {...rest}
    >
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" x2="20" y1="19" y2="19" />
    </svg>
  )
}
