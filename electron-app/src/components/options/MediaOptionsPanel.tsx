import { RunwareMusicOptionsPanel } from '@/components/options/RunwareMusicOptionsPanel'
import { RunwareOptionsPanel } from '@/components/options/RunwareOptionsPanel'
import type { AppSettings } from '@/lib/settings'
import type { Dispatch, SetStateAction } from 'react'

type Props = {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
}

export function MediaOptionsPanel({ settings, setSettings }: Props) {
  return (
    <div className="grid gap-4 text-sm">
      <div className="space-y-4 rounded border border-neon-green/25 bg-neon-green/[0.04] p-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-neon-green">
            <span>◌</span>
            <span>Image Generation</span>
          </p>
          <p className="mt-1 text-xs text-void-dim">
            Text-to-image and image edit. Choose{' '}
            <span className="font-mono text-void-light">Runware</span> or{' '}
            <span className="font-mono text-void-light">OpenRouter</span>; API keys live in General.
          </p>
        </div>
        <RunwareOptionsPanel settings={settings} setSettings={setSettings} variant="embedded" />
      </div>

      <div className="space-y-4 rounded border border-neon-purple/25 bg-neon-purple/[0.04] p-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-neon-purple">
            <span>♫</span>
            <span>Music Generation</span>
          </p>
          <p className="mt-1 text-xs text-void-dim">
            Text-to-music. Choose <span className="font-mono text-void-light">Runware</span>{' '}
            (ACE-Step) or <span className="font-mono text-void-light">OpenRouter</span> (Lyria); API
            keys live in General.
          </p>
        </div>
        <RunwareMusicOptionsPanel
          settings={settings}
          setSettings={setSettings}
          variant="embedded"
        />
      </div>
    </div>
  )
}
