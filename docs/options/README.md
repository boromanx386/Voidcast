# Options (Settings Screen)

This is the reference documentation for the **Settings** screen in the desktop/web app. The screen is rendered by `electron-app/src/components/options/OptionsScreen.tsx` and contains **exactly seven tabs**, in this order:

1. [General](general.md) — interface theme, cloud API keys, notification sounds, auto-save chat, auto-update, reminders, long-term memory.
2. [LLM](llm.md) — chat model provider and per-provider endpoints/models, generation defaults, think level, system prompt.
3. [Media](media.md) — image generation (OpenRouter vs Runware) and music generation (Runware ACE-Step).
4. [TTS](tts.md) — text-to-speech & speech-to-text (labeled **TTS/STT** in desktop builds).
5. [Tools](tools.md) — agent tool enable flags, max tool rounds, MCP servers, coding project path, PDF output directory.
6. [Skills](skills.md) — Agent Skills discovery from `~/.agents`, `~/.claude`, `~/.cursor/skills`.
7. [Sub-Agent](subagent.md) — vision + coding explore/workers, analysis in chat (shown as the **SUB** tab).

## Auto-save

Options **auto-save as you change them**. There is no Save button — every toggle, text field, and selector writes immediately to the settings store (`electron-app/src/lib/settings.ts`, `saveSettings`, localStorage key `voidcast-settings-v1`). The UI state updates via the `setSettings` dispatch passed to each panel.

## Agent-editable vs hidden settings

Some settings are **agent-editable** — the chat agent is allowed to view/change them — while others are hidden from the agent entirely.

Agent-editable fields are listed in `AGENT_EDITABLE_SETTINGS_FIELDS` in `electron-app/src/lib/settings.ts`:

- `llmSystemPrompt`, `llmNumCtx`, `llmTemperature` (LLM defaults)
- `uiTheme` (interface theme)
- `longMemoryAdd` (add long-term memory)
- `autoVoice` (auto text-to-speech)
- `runwareResolution`, `runwareWidth`, `runwareHeight`, `runwareImageModel`, `runwareEditModel` (image generation)

Agent-hidden fields are listed in `AGENT_HIDDEN_SETTINGS_FIELDS` — currently all cloud API keys (`openrouterApiKey`, `nvidiaApiKey`, `deepseekApiKey`, `openaiApiKey`, `opencodeGoApiKey`, `crofaiApiKey`, `runwareApiKey`).

Everything else is configurable only from this Settings screen (or via the local settings store) and is not exposed to the agent.

## Under the hood

All field names used in this documentation are the real `AppSettings` keys from `electron-app/src/lib/settings.ts`. Defaults are listed where relevant, and each tab doc points at the actual React panel that renders the controls.
