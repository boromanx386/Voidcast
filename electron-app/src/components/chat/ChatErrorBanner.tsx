import type { VoidcastApp } from '@/hooks/useVoidcastApp'

type Props = {
  app: Pick<VoidcastApp, 'error'>
}

export function ChatErrorBanner({ app }: Props) {
  const { error } = app
  if (!error) return null

  return (
    <div className="error-banner mx-4 my-2 flex items-center gap-3">
      <span className="text-neon-red">⚠</span>
      <span className="flex-1">{error}</span>
    </div>
  )
}
