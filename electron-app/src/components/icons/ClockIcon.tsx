import type { SVGProps } from 'react'

/** Lucide-style clock outline (reminders / scheduled). */
export function ClockIcon({
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
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}
