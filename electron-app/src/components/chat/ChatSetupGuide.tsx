import { useEffect, useState, type ReactNode } from 'react'
import { SubAgentEndpointPicker } from '@/components/options/SubAgentOptionsPanel'
import type { VoidcastApp } from '@/hooks/useVoidcastApp'
import type { SubAgentProviderId } from '@/lib/cloudLlmPresets'
import { llmModelLabel } from '@/lib/llmProviderDisplay'
import type { AppSettings, SetupGuideStep, SttProvider, TtsProvider } from '@/lib/settings'
import {
  applyMediaProvider,
  availableMediaProviders,
  availableSttProviders,
  availableTtsProviders,
  currentMediaModels,
  detectMainVision,
  disableMediaTools,
  finishSetupStep,
  mediaModelOptions,
  pendingSetupSteps,
  type MainVision,
  type MediaProvider,
} from '@/lib/setupGuide'

type GuideApp = Pick<
  VoidcastApp,
  | 'settings'
  | 'setSettings'
  | 'ollamaModels'
  | 'modelsLoading'
  | 'modelsError'
  | 'loadModels'
  | 'openOptions'
>

const STEP_TITLE: Record<SetupGuideStep, string> = {
  vision: 'Images you attach',
  media: 'Image and music generation',
  voice: 'Voice',
}

const MEDIA_LABEL: Record<MediaProvider, string> = {
  runware: 'Runware',
  openrouter: 'OpenRouter',
}

const TTS_LABEL: Partial<Record<TtsProvider, string>> = {
  none: 'Off',
  'openrouter-tts': 'OpenRouter',
  'runware-xai': 'Runware',
}

const STT_LABEL: Record<SttProvider, string> = {
  none: 'Off',
  whistle: 'Whistle (offline, 17 MB, no key)',
  openrouter: 'OpenRouter Whisper',
}

/**
 * First-start checklist under a connected model: one step at a time, each skippable,
 * and the whole guide can be closed. Everything it sets stays editable in Options.
 */
export function ChatSetupGuide({ app }: { app: GuideApp }) {
  const { settings, setSettings } = app
  const pending = pendingSetupSteps(settings)
  const step = pending[0]
  if (!step) return null

  const total = 3
  const index = total - pending.length + 1
  const finish = (patch?: (s: AppSettings) => AppSettings) =>
    setSettings((s) => finishSetupStep(patch ? patch(s) : s, step))
  const dismiss = () =>
    setSettings((s) => ({ ...s, setupGuide: { ...s.setupGuide, dismissed: true } }))

  return (
    <section
      className="rounded-lg border border-void-muted/50 bg-void-mid/70 p-6 text-left animate-fade-in-up"
      aria-label="Finish setting up"
    >
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-void-light">
          Finish setting up{' '}
          <span className="text-xs font-normal text-void-text">
            {index} of {total} · {STEP_TITLE[step]}
          </span>
        </h2>
        <button
          type="button"
          className="text-xs text-void-text underline decoration-void-muted underline-offset-2 hover:text-void-light"
          onClick={dismiss}
        >
          Hide guide
        </button>
      </div>

      {step === 'vision' && <VisionStep app={app} finish={finish} />}
      {step === 'media' && <MediaStep app={app} finish={finish} />}
      {step === 'voice' && <VoiceStep app={app} finish={finish} />}
    </section>
  )
}

type StepProps = {
  app: GuideApp
  finish: (patch?: (s: AppSettings) => AppSettings) => void
}

function VisionStep({ app, finish }: StepProps) {
  const { settings, setSettings } = app
  const model = llmModelLabel(settings)
  const [vision, setVision] = useState<MainVision | 'checking'>('checking')
  const [pickHelper, setPickHelper] = useState(settings.subAgent.enabled)

  useEffect(() => {
    let cancelled = false
    setVision('checking')
    void detectMainVision(settings).then((v) => {
      if (!cancelled) setVision(v)
    })
    return () => {
      cancelled = true
    }
    // Re-check only when the main model changes, not on every settings edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.llmProvider, model])

  const keepMainVision = () =>
    finish((s) => ({ ...s, subAgent: { ...s.subAgent, enabled: false } }))

  const startHelper = () => {
    setPickHelper(true)
    setSettings((s) => ({
      ...s,
      subAgent: {
        ...s.subAgent,
        enabled: true,
        // The main provider already has a key (or a running Ollama), so start there.
        provider: s.subAgent.model ? s.subAgent.provider : (s.llmProvider as SubAgentProviderId),
      },
    }))
  }

  if (pickHelper) {
    const sub = settings.subAgent
    return (
      <>
        <StepText>
          Pick a model that can see images. When you attach one, it describes the picture and{' '}
          <Mono>{model}</Mono> answers from that description.
        </StepText>
        <div className="mb-4">
          <SubAgentEndpointPicker
            role="vision"
            label="VISION"
            provider={(sub.provider ?? 'ollama') as SubAgentProviderId}
            model={sub.model}
            openrouterProviderOnly={sub.openrouterProviderOnly ?? ''}
            settings={settings}
            setSettings={setSettings}
            loadModels={app.loadModels}
            modelsLoading={app.modelsLoading}
            ollamaModels={app.ollamaModels}
            modelsError={app.modelsError}
          />
        </div>
        <Actions>
          <Primary onClick={() => finish()} disabled={!sub.model.trim()}>
            Done
          </Primary>
          <Secondary
            onClick={() => finish((s) => ({ ...s, subAgent: { ...s.subAgent, enabled: false } }))}
          >
            Skip — images won&apos;t be understood
          </Secondary>
        </Actions>
      </>
    )
  }

  if (vision === 'checking') {
    return <StepText>Checking whether {model} can see images…</StepText>
  }

  if (vision === 'yes') {
    return (
      <>
        <StepText>
          <Mono>{model}</Mono> can see images, so attached pictures go straight to it. No helper
          model needed — the vision sub-agent stays off. You can still turn it on in Options → Sub
          to have a cheaper model describe images.
        </StepText>
        <Actions>
          <Primary onClick={keepMainVision}>Got it</Primary>
        </Actions>
      </>
    )
  }

  return (
    <>
      <StepText>
        {vision === 'no' ? (
          <>
            <Mono>{model}</Mono> can&apos;t see images. To understand pictures you attach, add a
            helper model (the vision sub-agent) that describes them for it.
          </>
        ) : (
          <>
            Can <Mono>{model}</Mono> see images? If it can, pictures go straight to it. If not, a
            helper model (the vision sub-agent) describes them for it.
          </>
        )}
      </StepText>
      <Actions>
        {vision === 'unknown' && <Primary onClick={keepMainVision}>Yes, it sees images</Primary>}
        {vision === 'no' ? (
          <Primary onClick={startHelper}>Pick a helper model</Primary>
        ) : (
          <Secondary onClick={startHelper}>No, add a helper model</Secondary>
        )}
        {vision === 'no' && <Secondary onClick={() => finish()}>Skip</Secondary>}
      </Actions>
    </>
  )
}

function MediaStep({ app, finish }: StepProps) {
  const { settings, openOptions } = app
  const providers = availableMediaProviders(settings)
  const current: MediaProvider = settings.imageProvider
  const [pick, setPick] = useState<MediaProvider>(
    providers.includes(current) ? current : (providers[0] ?? 'runware'),
  )
  const [models, setModels] = useState(() => currentMediaModels(settings, pick))
  const options = mediaModelOptions(pick)

  const changeProvider = (p: MediaProvider) => {
    setPick(p)
    setModels(currentMediaModels(settings, p))
  }

  if (providers.length === 0) {
    return (
      <>
        <StepText>
          The agent can create images and music with an OpenRouter or Runware key. You don&apos;t
          have either yet — add one any time in Options → General.
        </StepText>
        <Actions>
          <Secondary onClick={() => openOptions('general')}>Open General</Secondary>
          <Secondary onClick={() => finish()}>Skip</Secondary>
        </Actions>
      </>
    )
  }

  return (
    <>
      <StepText>
        {providers.length === 1 ? (
          <>
            Your {MEDIA_LABEL[pick]} key also lets the agent create images and music. Pick the
            models; sizes and the rest are in Options → Media.
          </>
        ) : (
          <>
            You have both keys. Pick which one the agent uses to create images and music, and its
            models; sizes and the rest are in Options → Media.
          </>
        )}
      </StepText>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        {providers.length > 1 && (
          <label className="text-sm text-void-light sm:col-span-2">
            Provider
            <select
              className="form-select mt-1"
              value={pick}
              onChange={(e) => changeProvider(e.target.value as MediaProvider)}
            >
              {providers.map((p) => (
                <option key={p} value={p}>
                  {MEDIA_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
        )}
        <ModelSelect
          label="Image model"
          value={models.image}
          options={options.image}
          onChange={(image) => setModels((m) => ({ ...m, image }))}
        />
        <ModelSelect
          label="Music model"
          value={models.music}
          options={options.music}
          onChange={(music) => setModels((m) => ({ ...m, music }))}
        />
      </div>
      <Actions>
        <Primary onClick={() => finish((s) => applyMediaProvider(s, pick, models))}>
          Use {MEDIA_LABEL[pick]}
        </Primary>
        <Secondary onClick={() => finish(disableMediaTools)}>Turn off</Secondary>
      </Actions>
    </>
  )
}

function VoiceStep({ app, finish }: StepProps) {
  const { settings, openOptions } = app
  const ttsOptions: TtsProvider[] = [...availableTtsProviders(settings), 'none']
  const sttOptions: SttProvider[] = [...availableSttProviders(settings), 'none']
  const [tts, setTts] = useState<TtsProvider>(
    ttsOptions.includes(settings.ttsProvider) ? settings.ttsProvider : ttsOptions[0],
  )
  const [stt, setStt] = useState<SttProvider>(
    settings.sttProvider !== 'none' && sttOptions.includes(settings.sttProvider)
      ? settings.sttProvider
      : 'whistle',
  )

  return (
    <>
      <StepText>
        Read replies aloud and dictate with the microphone button. A local voice (OmniVoice) is in
        Options → TTS/STT.
      </StepText>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-void-light">
          Read aloud
          <select
            className="form-select mt-1"
            value={tts}
            onChange={(e) => setTts(e.target.value as TtsProvider)}
          >
            {ttsOptions.map((p) => (
              <option key={p} value={p}>
                {TTS_LABEL[p] ?? p}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-void-light">
          Dictation
          <select
            className="form-select mt-1"
            value={stt}
            onChange={(e) => setStt(e.target.value as SttProvider)}
          >
            {sttOptions.map((p) => (
              <option key={p} value={p}>
                {STT_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Actions>
        <Primary onClick={() => finish((s) => ({ ...s, ttsProvider: tts, sttProvider: stt }))}>
          Save
        </Primary>
        <Secondary onClick={() => finish()}>Skip</Secondary>
        <Secondary onClick={() => openOptions('tts')}>More voice options</Secondary>
      </Actions>
    </>
  )
}

function ModelSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ id: string; label: string }>
  onChange: (id: string) => void
}) {
  // A custom id set in Options is not in the curated list; keep it selectable as is.
  const list = options.some((o) => o.id === value)
    ? options
    : [{ id: value, label: value }, ...options]
  return (
    <label className="text-sm text-void-light">
      {label}
      <select className="form-select mt-1" value={value} onChange={(e) => onChange(e.target.value)}>
        {list.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function StepText({ children }: { children: ReactNode }) {
  return <p className="mb-4 text-sm text-void-text">{children}</p>
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-void-light">{children}</span>
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>
}

function Primary({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className="cyber-btn text-xs disabled:opacity-40"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

function Secondary({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      className="text-xs text-neon-cyan underline decoration-neon-cyan/35 underline-offset-2 hover:decoration-neon-cyan"
      onClick={onClick}
    >
      {children}
    </button>
  )
}
