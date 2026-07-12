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
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="border-b border-void-muted/30 pb-3">
          <h2 className="font-mono text-sm text-void-light">
            <span className="mr-2 text-neon-green">◌</span>
            IMAGE_TOOL
          </h2>
          <p className="mt-1 text-xs font-mono text-void-dim">
            Text-to-image and image edit. Choose Runware or OpenRouter; API keys live in
            General.
          </p>
        </div>
        <RunwareOptionsPanel settings={settings} setSettings={setSettings} variant="embedded" />
      </section>

      <section className="space-y-4">
        <div className="border-b border-void-muted/30 pb-3">
          <h2 className="font-mono text-sm text-void-light">
            <span className="mr-2 text-neon-green">♫</span>
            MUSIC_TOOL
          </h2>
          <p className="mt-1 text-xs font-mono text-void-dim">
            Text-to-audio via Runware. Uses RUNWARE_API_KEY from General.
          </p>
        </div>
        <RunwareMusicOptionsPanel settings={settings} setSettings={setSettings} variant="embedded" />
      </section>
    </div>
  )
}
