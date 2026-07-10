import { AmbientParticles, CrtOverlay, GlitchText } from '@/components/chat/ChatChrome'
import { GeneralOptionsPanel } from '@/components/options/GeneralOptionsPanel'
import { LlmOptionsPanel } from '@/components/options/LlmOptionsPanel'
import { RunwareOptionsPanel } from '@/components/options/RunwareOptionsPanel'
import { RunwareMusicOptionsPanel } from '@/components/options/RunwareMusicOptionsPanel'
import { ToolsOptionsPanel } from '@/components/options/ToolsOptionsPanel'
import { SkillsOptionsPanel } from '@/components/options/SkillsOptionsPanel'
import { TtsOptionsPanel } from '@/components/options/TtsOptionsPanel'
import { SubAgentOptionsPanel } from '@/components/options/SubAgentOptionsPanel'
import { isWebStandalone } from '@/lib/platform'
import type { VoidcastApp } from '@/hooks/useVoidcastApp'
import type { OptionsTab } from '@/types/voidcast'

type Props = { app: VoidcastApp }

export function OptionsScreen({ app }: Props) {
  const {
    settings,
    setSettings,
    setScreen,
    optionsTab,
    setOptionsTab,
    activeSessionUseLongMemory,
    setUseLongMemoryForActiveChat,
    longMemories,
    deleteLongMemoryById,
    updateLongMemoryById,
    reminders,
    handleDeleteReminder,
    handleMarkDoneReminder,
    loadModels,
    modelsLoading,
    ollamaModels,
    modelsError,
    refreshTts,
    cloneRef,
    onPickCloneFile,
    onClearClone,
    voiceAnchor,
    onBakeVoiceAnchor,
    onClearVoiceAnchor,
    applyCodingProjectPath,
    effectivePdfOutputDir,
  } = app

  const uiDystopian = settings.uiTheme === 'dystopian'

  return (
      <div className={`voidcast-app${uiDystopian ? ' grid-bg' : ''}`}>
        {uiDystopian && (
          <>
            <CrtOverlay />
            <AmbientParticles />
          </>
        )}
        
        {/* Header */}
        <header className="voidcast-header">
          <button
            type="button"
            onClick={() => setScreen('chat')}
            className="cyber-btn text-sm"
          >
            ← RETURN
          </button>
          
          <GlitchText className="voidcast-logo text-xl">
            SETTINGS
          </GlitchText>
          
          <div className="w-24" /> {/* Spacer */}
        </header>

        {/* Tabs */}
        <div className="flex border-b border-void-muted/30 bg-void-dark/50">
          {(['general', 'llm', 'runware', 'runwareMusic', 'tts', 'tools', 'skills', 'subAgent'] as OptionsTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setOptionsTab(tab)}
              title={tab === 'tts' ? 'Text-to-speech & speech-to-text' : undefined}
              className={`option-tab flex-1 ${optionsTab === tab ? 'active' : ''}`}
            >
              {tab === 'general' && '◆ GENERAL'}
              {tab === 'llm' && '◇ LLM'}
              {tab === 'runware' && '◌ IMAGE'}
              {tab === 'runwareMusic' && '♫ MUSIC'}
              {tab === 'tts' && (isWebStandalone() ? '◉ TTS' : '◉ TTS/STT')}
              {tab === 'tools' && '⬡ TOOLS'}
              {tab === 'skills' && '✦ SKILLS'}
              {tab === 'subAgent' && '⬢ SUB'}
            </button>
          ))}
        </div>

        {/* Content */}
        <main className="options-panel flex-1 overflow-y-auto">
          <div className="cyber-panel p-6 max-w-2xl mx-auto">
            <div className="corner-tl" />
            <div className="corner-tr" />
            <div className="corner-bl" />
            <div className="corner-br" />
            
            {optionsTab === 'general' ? (
              <GeneralOptionsPanel
                settings={settings}
                setSettings={setSettings}
                useLongMemoryInActiveChat={activeSessionUseLongMemory}
                onToggleUseLongMemoryInActiveChat={setUseLongMemoryForActiveChat}
                longMemories={longMemories}
                onDeleteLongMemory={deleteLongMemoryById}
                onUpdateLongMemory={updateLongMemoryById}
                reminders={reminders}
                onDeleteReminder={(id) => void handleDeleteReminder(id)}
                onMarkDoneReminder={(id) => void handleMarkDoneReminder(id)}
              />
            ) : optionsTab === 'llm' ? (
              <LlmOptionsPanel
                settings={settings}
                setSettings={setSettings}
                loadModels={loadModels}
                modelsLoading={modelsLoading}
                ollamaModels={ollamaModels}
                modelsError={modelsError}
              />
            ) : optionsTab === 'tts' ? (
              <TtsOptionsPanel
                settings={settings}
                setSettings={setSettings}
                refreshTts={refreshTts}
                cloneRef={cloneRef}
                onPickCloneFile={onPickCloneFile}
                onClearClone={onClearClone}
                voiceAnchor={voiceAnchor}
                onBakeVoiceAnchor={onBakeVoiceAnchor}
                onClearVoiceAnchor={onClearVoiceAnchor}
              />
            ) : optionsTab === 'runware' ? (
              <RunwareOptionsPanel settings={settings} setSettings={setSettings} />
            ) : optionsTab === 'runwareMusic' ? (
              <RunwareMusicOptionsPanel settings={settings} setSettings={setSettings} />
            ) : optionsTab === 'subAgent' ? (
              <SubAgentOptionsPanel
                settings={settings}
                setSettings={setSettings}
                loadModels={loadModels}
                modelsLoading={modelsLoading}
                ollamaModels={ollamaModels}
                modelsError={modelsError}
              />
            ) : optionsTab === 'skills' ? (
              <SkillsOptionsPanel settings={settings} setSettings={setSettings} />
            ) : (
              <ToolsOptionsPanel
                settings={settings}
                setSettings={setSettings}
                onCodingProjectPathApplied={applyCodingProjectPath}
                effectivePdfOutputDir={effectivePdfOutputDir}
              />
            )}
          </div>
        </main>
      </div>
  )
}
