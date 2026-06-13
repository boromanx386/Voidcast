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
    'Terminal link established. Awaiting input.',
    'Greenline channel open. Enter your prompt.',
    'System ready. Type to continue.',
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

export { EMPTY_STATE_VARIANTS }

export function getEmptyStateMessage(
  theme: string,
  seed: number,
): string {
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
