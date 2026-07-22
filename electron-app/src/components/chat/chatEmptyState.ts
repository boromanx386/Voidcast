import type { UiTheme } from '@/lib/settings'

const EMPTY_STATE_VARIANTS = {
  dystopian: [
    'NEURAL INTERFACE READY. AWAITING INPUT.',
    'SYSTEM LINK STABLE. ENTER COMMAND.',
    'CHANNEL OPEN. FEED PROMPT TO CONTINUE.',
  ],
  minimal: [
    'Chat is ready. Type your first message.',
    'New session started. Ask anything.',
    'All set. Enter a prompt to continue.',
  ],
  matrix: [
    'Wake up, Neo… the terminal is listening.',
    'Follow the white rabbit. Enter your prompt.',
    'The Matrix has you. Type to jack in.',
  ],
  light: [
    'Workspace ready. Start with a prompt.',
    'You are all set. Ask anything.',
    'Session is ready. Type to continue.',
  ],
  'blood-moon': [
    'The void is listening. Feed it a prompt.',
    'Crimson channel open. Transmit when ready.',
    'Blood moon rising. Await your command.',
  ],
  obsidian: [
    'The archive is silent. Enter your query.',
    'Channel stable. Transmit when ready.',
    'Obsidian surface awaits your mark.',
  ],
} as const

const PLAN_EMPTY_STATE_VARIANTS = {
  dystopian: [
    'Plan mode: describe the task. No writes until you approve a plan card.',
    'Read-only exploration. You will get an editable plan — then Approve & build.',
    'Outline what to change. The agent will not edit files until you approve.',
  ],
  minimal: [
    'Plan mode is on. Describe what to build — file changes wait for your approval.',
    'Exploration only. You will get a plan card to review before anything is edited.',
    'Describe the goal. Approve the plan when you are ready to implement.',
  ],
  matrix: [
    'Plan channel open. Describe target — mutations locked until approval.',
    'Read-only scan. A plan artifact will appear for your sign-off.',
    'Input objective. Build phase starts only after Approve & build.',
  ],
  light: [
    'Plan mode: describe what you want. Edits are blocked until you approve.',
    'Explore read-only. Review the plan card, then approve to implement.',
    'Share your goal. Nothing on disk changes until you approve the plan.',
  ],
  'blood-moon': [
    'The blueprint awaits. Describe the work — blood is not spilled until approval.',
    'Plan mode: reconnaissance only. Seal the plan before the build.',
    'Whisper your intent. Files remain untouched until you approve.',
  ],
  obsidian: [
    'Planning only. Describe the task — changes apply after you approve the plan.',
    'Read-only pass. Review the plan card, then approve to build.',
    'State your goal. The workspace stays unchanged until approval.',
  ],
} as const

/** Chat input placeholder — one line per UI theme. */
export const CHAT_COMPOSER_PLACEHOLDER: Record<UiTheme, string> = {
  dystopian: 'Transmit message...',
  minimal: 'Ask anything...',
  matrix: 'Enter the code...',
  light: 'Type a message...',
  'blood-moon': 'Feed the void...',
  obsidian: 'Enter your query...',
}

export { EMPTY_STATE_VARIANTS }

export function getEmptyStateMessage(
  theme: string,
  seed: number,
  agentMode: 'agent' | 'plan' = 'agent',
): string {
  if (agentMode === 'plan') {
    const variants =
      theme === 'dystopian'
        ? PLAN_EMPTY_STATE_VARIANTS.dystopian
        : theme === 'matrix'
          ? PLAN_EMPTY_STATE_VARIANTS.matrix
          : theme === 'light'
            ? PLAN_EMPTY_STATE_VARIANTS.light
            : theme === 'blood-moon'
              ? PLAN_EMPTY_STATE_VARIANTS['blood-moon']
              : theme === 'obsidian'
                ? PLAN_EMPTY_STATE_VARIANTS.obsidian
                : PLAN_EMPTY_STATE_VARIANTS.minimal
    return variants[seed % variants.length]
  }
  const variants =
    theme === 'dystopian'
      ? EMPTY_STATE_VARIANTS.dystopian
      : theme === 'matrix'
        ? EMPTY_STATE_VARIANTS.matrix
        : theme === 'light'
          ? EMPTY_STATE_VARIANTS.light
          : theme === 'blood-moon'
            ? EMPTY_STATE_VARIANTS['blood-moon']
            : theme === 'obsidian'
              ? EMPTY_STATE_VARIANTS.obsidian
              : EMPTY_STATE_VARIANTS.minimal
  return variants[seed % variants.length]
}

export function getChatComposerPlaceholder(
  theme: string,
  agentMode: 'agent' | 'plan' = 'agent',
): string {
  if (agentMode === 'plan') {
    return 'Describe what to plan…'
  }
  if (theme in CHAT_COMPOSER_PLACEHOLDER) {
    return CHAT_COMPOSER_PLACEHOLDER[theme as UiTheme]
  }
  return CHAT_COMPOSER_PLACEHOLDER.minimal
}
