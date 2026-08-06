import {
  normalizeDeepSeekModelId,
  normalizeNvidiaModelId,
  normalizeOpenAiModelId,
  normalizeOpenCodeGoModelId,
  normalizeOpenRouterModelId,
  detectSubAgentProvider,
} from '@/lib/cloudLlmPresets'
import { normalizePinnedModels } from '@/lib/pinnedModels'
import type { AgentChatMode, SystemPromptPreset } from '@/types/chat'

export type { AgentChatMode, SystemPromptPreset } from '@/types/chat'

export type VoiceMode = 'design' | 'clone'
export type TtsProvider = 'local' | 'runware-xai' | 'openrouter-tts'
export type SttProvider = 'none' | 'openrouter'
/** Backend for generate_image / edit_image_runware tools. */
export type ImageProvider = 'runware' | 'openrouter'

/** Default OpenRouter TTS model (OpenAI gpt-4o-mini-tts was removed from OpenRouter). */
export const OPENROUTER_TTS_MODEL_DEFAULT = 'google/gemini-3.1-flash-tts-preview'

/** Default OpenRouter image model (Nano Banana 2 Lite). */
export const OPENROUTER_IMAGE_MODEL_DEFAULT = 'google/gemini-3.1-flash-lite-image'

/** OpenRouter dedicated Images API model (OpenAI GPT Image 2). */
export const OPENROUTER_GPT_IMAGE_2_MODEL_ID = 'openai/gpt-image-2'

export const OPENROUTER_IMAGE_MODEL_PRESETS: Array<{ id: string; label: string }> = [
  {
    id: OPENROUTER_IMAGE_MODEL_DEFAULT,
    label: 'Google Nano Banana 2 Lite (Gemini 3.1 Flash Lite Image)',
  },
  {
    id: 'google/gemini-3.1-flash-image',
    label: 'Google Nano Banana 2 (Gemini 3.1 Flash Image)',
  },
  {
    id: OPENROUTER_GPT_IMAGE_2_MODEL_ID,
    label: 'OpenAI GPT Image 2',
  },
]

export function usesOpenRouterDedicatedImageApi(model: string | undefined | null): boolean {
  return normalizeOpenRouterImageModel(model) === OPENROUTER_GPT_IMAGE_2_MODEL_ID
}

function defaultOpenRouterImageProfiles(): Record<string, RunwareModelProfile> {
  return {
    [OPENROUTER_IMAGE_MODEL_DEFAULT]: {
      width: 1024,
      height: 1024,
      steps: 20,
      cfgScale: 7,
    },
    'google/gemini-3.1-flash-image': {
      width: 1024,
      height: 1024,
      steps: 20,
      cfgScale: 7,
    },
    [OPENROUTER_GPT_IMAGE_2_MODEL_ID]: {
      width: 1920,
      height: 1080,
      steps: 20,
      cfgScale: 7,
      gptQuality: 'auto',
    },
  }
}

function normalizeOpenRouterImageProfile(
  modelId: string,
  incoming: Partial<RunwareModelProfile> | undefined,
  fallback: RunwareModelProfile,
): RunwareModelProfile {
  const isGpt = usesOpenRouterDedicatedImageApi(modelId)
  const minSide = isGpt ? 480 : 256
  const maxSide = isGpt ? 3840 : 2048
  const w = Number(incoming?.width)
  const h = Number(incoming?.height)
  const gptQualityRaw = typeof incoming?.gptQuality === 'string' ? incoming.gptQuality : ''
  const normalizedGptQuality =
    gptQualityRaw === 'auto' ||
    gptQualityRaw === 'low' ||
    gptQualityRaw === 'medium' ||
    gptQualityRaw === 'high'
      ? gptQualityRaw
      : undefined
  return {
    width: Number.isFinite(w) ? clamp(Math.round(w), minSide, maxSide) : fallback.width,
    height: Number.isFinite(h) ? clamp(Math.round(h), minSide, maxSide) : fallback.height,
    steps: fallback.steps,
    cfgScale: fallback.cfgScale,
    ...(isGpt
      ? { gptQuality: normalizedGptQuality ?? fallback.gptQuality ?? 'auto' }
      : {}),
  }
}

export function normalizeOpenRouterImageModel(model: string | undefined | null): string {
  const trimmed = (model || '').trim()
  if (!trimmed) return OPENROUTER_IMAGE_MODEL_DEFAULT
  return trimmed
}

const RETIRED_OPENROUTER_TTS_MODELS = new Set([
  'openai/gpt-4o-mini-tts-2025-12-15',
  'openai/gpt-4o-mini-tts',
  'gpt-4o-mini-tts-2025-12-15',
  'gpt-4o-mini-tts',
])

const OPENAI_TTS_VOICES = new Set([
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'onyx',
  'nova',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
])

export const OPENROUTER_TTS_MODEL_PRESETS: Array<{ id: string; label: string }> = [
  { id: OPENROUTER_TTS_MODEL_DEFAULT, label: 'Google Gemini 3.1 Flash TTS' },
  { id: 'hexgrad/kokoro-82m', label: 'hexgrad Kokoro 82M (cheapest)' },
  { id: 'mistralai/voxtral-mini-tts-2603', label: 'Mistral Voxtral Mini TTS' },
  { id: 'x-ai/grok-voice-tts-1.0', label: 'xAI Grok Voice TTS' },
  { id: 'microsoft/mai-voice-2', label: 'Microsoft MAI-Voice-2' },
  { id: 'canopylabs/orpheus-3b-0.1-ft', label: 'Canopy Orpheus 3B' },
]

export const OPENROUTER_TTS_VOICES_BY_MODEL: Record<string, readonly string[]> = {
  [OPENROUTER_TTS_MODEL_DEFAULT]: [
    'Zephyr',
    'Puck',
    'Charon',
    'Kore',
    'Fenrir',
    'Aoede',
    'Leda',
    'Orus',
  ],
  'hexgrad/kokoro-82m': [
    'af_bella',
    'af_heart',
    'af_sarah',
    'am_adam',
    'am_michael',
    'bf_emma',
    'bm_george',
  ],
  'mistralai/voxtral-mini-tts-2603': [
    'en_paul_neutral',
    'en_paul_happy',
    'en_paul_sad',
    'en_paul_excited',
    'en_paul_frustrated',
  ],
  'x-ai/grok-voice-tts-1.0': ['eve', 'ara', 'rex', 'sal', 'leo'],
  'microsoft/mai-voice-2': [
    'en-US-Harper:MAI-Voice-2',
    'es-MX-Valeria:MAI-Voice-2',
    'fr-FR-Soleil:MAI-Voice-2',
    'de-DE-Klaus:MAI-Voice-2',
  ],
  'canopylabs/orpheus-3b-0.1-ft': ['tara', 'leah', 'jess', 'leo', 'dan'],
}

export function openRouterTtsVoicesForModel(model: string): readonly string[] {
  const id = model.trim()
  return OPENROUTER_TTS_VOICES_BY_MODEL[id] ?? OPENROUTER_TTS_VOICES_BY_MODEL[OPENROUTER_TTS_MODEL_DEFAULT]
}

export function openRouterTtsDefaultVoice(model: string): string {
  return openRouterTtsVoicesForModel(model)[0] || 'Kore'
}

export function normalizeOpenRouterTtsModel(model: string | undefined): string {
  const trimmed = (model || '').trim()
  if (!trimmed || RETIRED_OPENROUTER_TTS_MODELS.has(trimmed) || trimmed.startsWith('openai/gpt-4o-mini-tts')) {
    return OPENROUTER_TTS_MODEL_DEFAULT
  }
  return trimmed
}

export const RUNWARE_TTS_MODEL_DEFAULT = 'xai:tts@0'

const INWORLD_TTS_VOICES = [
  'Abby',
  'Alex',
  'Amina',
  'Anjali',
  'Arjun',
  'Ashley',
  'Blake',
  'Brian',
  'Callum',
  'Carter',
  'Celeste',
  'Chloe',
  'Claire',
  'Clive',
  'Craig',
  'Darlene',
  'Deborah',
  'Dennis',
  'Derek',
  'Dominus',
  'Edward',
  'Elizabeth',
  'Elliot',
  'Ethan',
  'Evan',
  'Evelyn',
  'Gareth',
  'Graham',
  'Grant',
  'Hades',
  'Hamish',
  'Hana',
  'Hank',
  'Jake',
  'James',
  'Jason',
  'Jessica',
  'Julia',
  'Kayla',
  'Kelsey',
  'Lauren',
  'Liam',
  'Loretta',
  'Luna',
  'Malcolm',
  'Mark',
  'Marlene',
  'Miranda',
  'Mortimer',
  'Nate',
  'Oliver',
  'Olivia',
  'Pippa',
  'Pixie',
  'Priya',
  'Ronald',
  'Rupert',
  'Saanvi',
  'Sarah',
  'Sebastian',
  'Serena',
  'Shaun',
  'Simon',
  'Snik',
  'Tessa',
  'Theodore',
  'Timothy',
  'Tyler',
  'Veronica',
  'Victor',
  'Victoria',
  'Vinny',
  'Wendy',
] as const

const GEMINI_RUNWARE_TTS_VOICES = [
  'Zephyr',
  'Achernar',
  'Achird',
  'Algenib',
  'Algieba',
  'Alnilam',
  'Aoede',
  'Autonoe',
  'Callirrhoe',
  'Charon',
  'Despina',
  'Enceladus',
  'Erinome',
  'Fenrir',
  'Gacrux',
  'Iapetus',
  'Kore',
  'Laomedeia',
  'Leda',
  'Orus',
  'Puck',
  'Pulcherrima',
  'Rasalgethi',
  'Sadachbia',
  'Sadaltager',
  'Schedar',
  'Sulafat',
  'Umbriel',
  'Vindemiatrix',
  'Zubenelgenubi',
] as const

const XAI_RUNWARE_TTS_VOICES = [
  'eve',
  'ara',
  'leo',
  'rex',
  'sal',
  'una',
  'carina',
  'zagan',
  'helix',
  'orion',
  'luna',
  'iris',
  'altair',
  'zenith',
  'perseus',
  'helios',
  'lux',
  'kepler',
  'rigel',
  'cosmo',
  'celeste',
  'ursa',
  'sirius',
  'lumen',
  'castor',
  'naksh',
  'atlas',
] as const

const MINIMAX_TTS_VOICES = [
  'English_expressive_narrator',
  'English_radiant_girl',
  'English_magnetic_voiced_man',
  'English_compelling_lady1',
  'English_Aussie_Bloke',
  'English_captivating_female1',
  'English_Upbeat_Woman',
  'English_Trustworth_Man',
  'English_CalmWoman',
  'English_UpsetGirl',
  'English_Gentle-voiced_man',
  'English_Whispering_girl',
  'English_Diligent_Man',
  'English_Graceful_Lady',
  'English_ReservedYoungMan',
  'English_PlayfulGirl',
  'English_ManWithDeepVoice',
  'English_MaturePartner',
  'English_FriendlyPerson',
  'English_MatureBoss',
  'English_Debator',
  'English_LovelyGirl',
  'English_Steadymentor',
  'English_Deep-VoicedGentleman',
  'English_Wiselady',
  'English_CaptivatingStoryteller',
  'English_DecentYoungMan',
  'English_SentimentalLady',
  'English_ImposingManner',
  'English_SadTeen',
  'English_PassionateWarrior',
  'English_WiseScholar',
  'English_Soft-spokenGirl',
  'English_SereneWoman',
  'English_ConfidentWoman',
  'English_PatientMan',
  'English_Comedian',
  'English_BossyLeader',
  'English_Strong-WilledBoy',
  'English_StressedLady',
  'English_AssertiveQueen',
  'English_AnimeCharacter',
  'English_Jovialman',
  'English_WhimsicalGirl',
  'English_Kind-heartedGirl',
  'Chinese (Mandarin)_Reliable_Executive',
  'Chinese (Mandarin)_News_Anchor',
  'Chinese (Mandarin)_Unrestrained_Young_Man',
  'Chinese (Mandarin)_Mature_Woman',
  'Arrogant_Miss',
  'Robot_Armor',
  'Chinese (Mandarin)_Kind-hearted_Antie',
  'Chinese (Mandarin)_HK_Flight_Attendant',
  'Chinese (Mandarin)_Humorous_Elder',
  'Chinese (Mandarin)_Gentleman',
  'Chinese (Mandarin)_Warm_Bestie',
  'Chinese (Mandarin)_Stubborn_Friend',
  'Chinese (Mandarin)_Sweet_Lady',
  'Chinese (Mandarin)_Southern_Young_Man',
  'Chinese (Mandarin)_Wise_Women',
  'Chinese (Mandarin)_Gentle_Youth',
  'Chinese (Mandarin)_Warm_Girl',
  'Chinese (Mandarin)_Male_Announcer',
  'Chinese (Mandarin)_Kind-hearted_Elder',
  'Chinese (Mandarin)_Cute_Spirit',
  'Chinese (Mandarin)_Radio_Host',
  'Chinese (Mandarin)_Lyrical_Voice',
  'Chinese (Mandarin)_Straightforward_Boy',
  'Chinese (Mandarin)_Sincere_Adult',
  'Chinese (Mandarin)_Gentle_Senior',
  'Chinese (Mandarin)_Crisp_Girl',
  'Chinese (Mandarin)_Pure-hearted_Boy',
  'Chinese (Mandarin)_Soft_Girl',
  'Chinese (Mandarin)_IntellectualGirl',
  'Chinese (Mandarin)_Warm_HeartedGirl',
  'Chinese (Mandarin)_Laid_BackGirl',
  'Chinese (Mandarin)_ExplorativeGirl',
  'Chinese (Mandarin)_Warm-HeartedAunt',
  'Chinese (Mandarin)_BashfulGirl',
  'Japanese_IntellectualSenior',
  'Japanese_DecisivePrincess',
  'Japanese_LoyalKnight',
  'Japanese_DominantMan',
  'Japanese_SeriousCommander',
  'Japanese_ColdQueen',
  'Japanese_DependableWoman',
  'Japanese_GentleButler',
  'Japanese_KindLady',
  'Japanese_CalmLady',
  'Japanese_OptimisticYouth',
  'Japanese_GenerousIzakayaOwner',
  'Japanese_SportyStudent',
  'Japanese_InnocentBoy',
  'Japanese_GracefulMaiden',
  'Cantonese_ProfessionalHost (F)',
  'Cantonese_GentleLady',
  'Cantonese_ProfessionalHost (M)',
  'Cantonese_PlayfulMan',
  'Cantonese_CuteGirl',
  'Cantonese_KindWoman',
  'Korean_AirheadedGirl',
  'Korean_AthleticGirl',
  'Korean_AthleticStudent',
  'Korean_BraveAdventurer',
  'Korean_BraveFemaleWarrior',
  'Korean_BraveYouth',
  'Korean_CalmGentleman',
  'Korean_CalmLady',
  'Korean_CaringWoman',
  'Korean_CharmingElderSister',
  'Korean_CharmingSister',
  'Korean_CheerfulBoyfriend',
  'Korean_CheerfulCoolJunior',
  'Korean_CheerfulLittleSister',
  'Korean_ChildhoodFriendGirl',
  'Korean_CockyGuy',
  'Korean_ColdGirl',
  'Korean_ColdYoungMan',
  'Korean_ConfidentBoss',
  'Korean_ConsiderateSenior',
  'Korean_DecisiveQueen',
  'Korean_DominantMan',
  'Korean_ElegantPrincess',
  'Korean_EnchantingSister',
  'Korean_EnthusiasticTeen',
  'Korean_FriendlyBigSister',
  'Korean_GentleBoss',
  'Korean_GentleWoman',
  'Korean_HaughtyLady',
  'Korean_InnocentBoy',
  'Korean_IntellectualMan',
  'Korean_IntellectualSenior',
  'Korean_LonelyWarrior',
  'Korean_MatureLady',
  'Korean_MysteriousGirl',
  'Korean_OptimisticYouth',
  'Korean_PlayboyCharmer',
  'Korean_PossessiveMan',
  'Korean_QuirkyGirl',
  'Korean_ReliableSister',
  'Korean_ReliableYouth',
  'Korean_SassyGirl',
  'Korean_ShyGirl',
  'Korean_SoothingLady',
  'Korean_StrictBoss',
  'Korean_SweetGirl',
  'Korean_ThoughtfulWoman',
  'Korean_WiseElf',
  'Korean_WiseTeacher',
  'Spanish_SereneWoman',
  'Spanish_MaturePartner',
  'Spanish_CaptivatingStoryteller',
  'Spanish_Narrator',
  'Spanish_WiseScholar',
  'Spanish_Kind-heartedGirl',
  'Spanish_DeterminedManager',
  'Spanish_BossyLeader',
  'Spanish_ReservedYoungMan',
  'Spanish_ConfidentWoman',
  'Spanish_ThoughtfulMan',
  'Spanish_Strong-WilledBoy',
  'Spanish_SophisticatedLady',
  'Spanish_RationalMan',
  'Spanish_AnimeCharacter',
  'Spanish_Deep-tonedMan',
  'Spanish_Fussyhostess',
  'Spanish_SincereTeen',
  'Spanish_FrankLady',
  'Spanish_Comedian',
  'Spanish_Debator',
  'Spanish_ToughBoss',
  'Spanish_Wiselady',
  'Spanish_Steadymentor',
  'Spanish_Jovialman',
  'Spanish_SantaClaus',
  'Spanish_Rudolph',
  'Spanish_Intonategirl',
  'Spanish_Arnold',
  'Spanish_Ghost',
  'Spanish_HumorousElder',
  'Spanish_EnergeticBoy',
  'Spanish_WhimsicalGirl',
  'Spanish_StrictBoss',
  'Spanish_ReliableMan',
  'Spanish_SereneElder',
  'Spanish_AngryMan',
  'Spanish_AssertiveQueen',
  'Spanish_CaringGirlfriend',
  'Spanish_PowerfulSoldier',
  'Spanish_PassionateWarrior',
  'Spanish_ChattyGirl',
  'Spanish_RomanticHusband',
  'Spanish_CompellingGirl',
  'Spanish_PowerfulVeteran',
  'Spanish_SensibleManager',
  'Spanish_ThoughtfulLady',
  'Portuguese_SentimentalLady',
  'Portuguese_BossyLeader',
  'Portuguese_Wiselady',
  'Portuguese_Strong-WilledBoy',
  'Portuguese_Deep-VoicedGentleman',
  'Portuguese_UpsetGirl',
  'Portuguese_PassionateWarrior',
  'Portuguese_AnimeCharacter',
  'Portuguese_ConfidentWoman',
  'Portuguese_AngryMan',
  'Portuguese_CaptivatingStoryteller',
  'Portuguese_Godfather',
  'Portuguese_ReservedYoungMan',
  'Portuguese_SmartYoungGirl',
  'Portuguese_Kind-heartedGirl',
  'Portuguese_Pompouslady',
  'Portuguese_Grinch',
  'Portuguese_Debator',
  'Portuguese_SweetGirl',
  'Portuguese_AttractiveGirl',
  'Portuguese_ThoughtfulMan',
  'Portuguese_PlayfulGirl',
  'Portuguese_GorgeousLady',
  'Portuguese_LovelyLady',
  'Portuguese_SereneWoman',
  'Portuguese_SadTeen',
  'Portuguese_MaturePartner',
  'Portuguese_Comedian',
  'Portuguese_NaughtySchoolgirl',
  'Portuguese_Narrator',
  'Portuguese_ToughBoss',
  'Portuguese_Fussyhostess',
  'Portuguese_Dramatist',
  'Portuguese_Steadymentor',
  'Portuguese_Jovialman',
  'Portuguese_CharmingQueen',
  'Portuguese_SantaClaus',
  'Portuguese_Rudolph',
  'Portuguese_Arnold',
  'Portuguese_CharmingSanta',
  'Portuguese_CharmingLady',
  'Portuguese_Ghost',
  'Portuguese_HumorousElder',
  'Portuguese_CalmLeader',
  'Portuguese_GentleTeacher',
  'Portuguese_EnergeticBoy',
  'Portuguese_ReliableMan',
  'Portuguese_SereneElder',
  'Portuguese_GrimReaper',
  'Portuguese_AssertiveQueen',
  'Portuguese_WhimsicalGirl',
  'Portuguese_StressedLady',
  'Portuguese_FriendlyNeighbor',
  'Portuguese_CaringGirlfriend',
  'Portuguese_PowerfulSoldier',
  'Portuguese_FascinatingBoy',
  'Portuguese_RomanticHusband',
  'Portuguese_StrictBoss',
  'Portuguese_InspiringLady',
  'Portuguese_PlayfulSpirit',
  'Portuguese_ElegantGirl',
  'Portuguese_CompellingGirl',
  'Portuguese_PowerfulVeteran',
  'Portuguese_SensibleManager',
  'Portuguese_ThoughtfulLady',
  'Portuguese_TheatricalActor',
  'Portuguese_FragileBoy',
  'Portuguese_ChattyGirl',
  'Portuguese_Conscientiousinstructor',
  'Portuguese_RationalMan',
  'Portuguese_WiseScholar',
  'Portuguese_FrankLady',
  'Portuguese_DeterminedManager',
  'French_Male_Speech_New',
  'French_Female_News Anchor',
  'French_CasualMan',
  'French_MovieLeadFemale',
  'French_FemaleAnchor',
  'French_MaleNarrator',
  'Indonesian_SweetGirl',
  'Indonesian_ReservedYoungMan',
  'Indonesian_CharmingGirl',
  'Indonesian_CalmWoman',
  'Indonesian_ConfidentWoman',
  'Indonesian_CaringMan',
  'Indonesian_BossyLeader',
  'Indonesian_DeterminedBoy',
  'Indonesian_GentleGirl',
  'German_FriendlyMan',
  'German_SweetLady',
  'German_PlayfulMan',
  'Russian_HandsomeChildhoodFriend',
  'Russian_BrightHeroine',
  'Russian_AmbitiousWoman',
  'Russian_ReliableMan',
  'Russian_CrazyQueen',
  'Russian_PessimisticGirl',
  'Russian_AttractiveGuy',
  'Russian_Bad-temperedBoy',
  'Italian_BraveHeroine',
  'Italian_Narrator',
  'Italian_WanderingSorcerer',
  'Italian_DiligentLeader',
  'Dutch_kindhearted_girl',
  'Dutch_bossy_leader',
  'Vietnamese_kindhearted_girl',
  'Arabic_CalmWoman',
  'Arabic_FriendlyGuy',
  'Turkish_CalmWoman',
  'Turkish_Trustworthyman',
  'Ukrainian_CalmWoman',
  'Ukrainian_WiseScholar',
  'Thai_male_1_sample8',
  'Thai_male_2_sample2',
  'Thai_female_1_sample1',
  'Thai_female_2_sample2',
  'Polish_male_1_sample4',
  'Polish_male_2_sample3',
  'Polish_female_1_sample1',
  'Polish_female_2_sample3',
  'Romanian_male_1_sample2',
  'Romanian_male_2_sample1',
  'Romanian_female_1_sample4',
  'Romanian_female_2_sample1',
  'greek_male_1a_v1',
  'Greek_female_1_sample1',
  'Greek_female_2_sample3',
  'czech_male_1_v1',
  'czech_female_5_v7',
  'czech_female_2_v2',
  'finnish_male_3_v1',
  'finnish_male_1_v2',
  'finnish_female_4_v1',
  'hindi_male_1_v2',
  'hindi_female_2_v1',
  'hindi_female_1_v2',
] as const

export const RUNWARE_TTS_MODEL_PRESETS: Array<{ id: string; label: string }> = [
  { id: RUNWARE_TTS_MODEL_DEFAULT, label: 'xAI Grok Voice TTS' },
  { id: 'google:gemini@3.1-flash-tts', label: 'Google Gemini 3.1 Flash TTS' },
  { id: 'inworld:tts@1.5-max', label: 'Inworld TTS 1.5 Max' },
  { id: 'inworld:tts@1.5-mini', label: 'Inworld TTS 1.5 Mini' },
  { id: 'minimax:speech@2.8', label: 'MiniMax Speech 2.8' },
  { id: 'alibaba:qwen@3-tts-1.7b-customvoice', label: 'Qwen3-TTS 1.7B CustomVoice' },
  { id: 'fishaudio:s2.1@pro', label: 'Fish Audio S2.1 Pro' },
]

export const RUNWARE_TTS_VOICES_BY_MODEL: Record<string, readonly string[]> = {
  [RUNWARE_TTS_MODEL_DEFAULT]: XAI_RUNWARE_TTS_VOICES,
  'google:gemini@3.1-flash-tts': GEMINI_RUNWARE_TTS_VOICES,
  'inworld:tts@1.5-max': INWORLD_TTS_VOICES,
  'inworld:tts@1.5-mini': INWORLD_TTS_VOICES,
  'minimax:speech@2.8': MINIMAX_TTS_VOICES,
  'alibaba:qwen@3-tts-1.7b-customvoice': [
    'vivian',
    'serena',
    'ryan',
    'aiden',
    'dylan',
    'eric',
    'sohee',
    'ono_anna',
    'uncle_fu',
  ],
  'fishaudio:s2.1@pro': [
    'b347db033a6549378b48d00acb0d06cd',
    'bf322df2096a46f18c579d0baa36f41d',
    '933563129e564b19a115bedd57b7406a',
    'e3cd384158934cc9a01029cd7d278634',
    '79d0bd3e4e5444b18f7b6d89b5927bf1',
    '536d3a5e000945adb7038665781a4aca',
    '9a9cf47702da476aa4629e2506d4a857',
    '98655a12fa944e26b274c535e5e03842',
  ],
}

export const RUNWARE_TTS_VOICE_LABELS: Record<string, string> = {
  b347db033a6549378b48d00acb0d06cd: 'Selene',
  bf322df2096a46f18c579d0baa36f41d: 'Adrian',
  '933563129e564b19a115bedd57b7406a': 'Sarah',
  e3cd384158934cc9a01029cd7d278634: 'Laura',
  '79d0bd3e4e5444b18f7b6d89b5927bf1': 'Jordan',
  '536d3a5e000945adb7038665781a4aca': 'Ethan',
  '9a9cf47702da476aa4629e2506d4a857': 'Hannah',
  '98655a12fa944e26b274c535e5e03842': 'Egirl',
}

export function runwareTtsVoicesForModel(model: string): readonly string[] {
  const id = model.trim()
  return RUNWARE_TTS_VOICES_BY_MODEL[id] ?? RUNWARE_TTS_VOICES_BY_MODEL[RUNWARE_TTS_MODEL_DEFAULT]
}

export function runwareTtsDefaultVoice(model: string): string {
  return runwareTtsVoicesForModel(model)[0] || 'eve'
}

export function normalizeRunwareTtsModel(model: string | undefined): string {
  const trimmed = (model || '').trim()
  return trimmed || RUNWARE_TTS_MODEL_DEFAULT
}

export function runwareTtsSupportsLanguage(model: string): boolean {
  const id = model.trim()
  return (
    id === RUNWARE_TTS_MODEL_DEFAULT ||
    id === 'minimax:speech@2.8' ||
    id === 'alibaba:qwen@3-tts-1.7b-customvoice' ||
    id === 'alibaba:qwen@3-tts-1.7b-voicedesign' ||
    id === 'alibaba:qwen@3-tts-1.7b-base'
  )
}

export function runwareTtsLanguagePlaceholder(model: string): string {
  const id = model.trim()
  if (
    id === 'alibaba:qwen@3-tts-1.7b-customvoice' ||
    id === 'alibaba:qwen@3-tts-1.7b-voicedesign' ||
    id === 'alibaba:qwen@3-tts-1.7b-base'
  ) {
    return 'English, Auto, Chinese…'
  }
  if (id === 'minimax:speech@2.8') return 'languageBoost: en, auto, de, es…'
  return 'en, de, es-ES…'
}

const MINIMAX_LANGUAGE_BOOST_CODES = new Set([
  'zh',
  'yue',
  'en',
  'ar',
  'ru',
  'es',
  'fr',
  'pt',
  'de',
  'tr',
  'nl',
  'uk',
  'vi',
  'id',
  'ja',
  'it',
  'ko',
  'th',
  'pl',
  'ro',
  'el',
  'cs',
  'fi',
  'hi',
  'bg',
  'da',
  'he',
  'ms',
  'fa',
  'sk',
  'sv',
  'hr',
  'fil',
  'hu',
  'no',
  'sl',
  'ca',
  'nn',
  'ta',
  'af',
  'auto',
])

function mapRunwareTtsLanguageBoost(language: string): string | undefined {
  const lang = language.trim()
  if (!lang) return undefined
  const lower = lang.toLowerCase()
  const boostMap: Record<string, string> = {
    auto: 'auto',
    en: 'en',
    english: 'en',
    zh: 'zh',
    chinese: 'zh',
    mandarin: 'zh',
    yue: 'yue',
    cantonese: 'yue',
    ar: 'ar',
    arabic: 'ar',
    ru: 'ru',
    russian: 'ru',
    es: 'es',
    spanish: 'es',
    fr: 'fr',
    french: 'fr',
    pt: 'pt',
    portuguese: 'pt',
    de: 'de',
    german: 'de',
    tr: 'tr',
    turkish: 'tr',
    nl: 'nl',
    dutch: 'nl',
    uk: 'uk',
    ukrainian: 'uk',
    vi: 'vi',
    vietnamese: 'vi',
    id: 'id',
    indonesian: 'id',
    ja: 'ja',
    japanese: 'ja',
    it: 'it',
    italian: 'it',
    ko: 'ko',
    korean: 'ko',
    th: 'th',
    thai: 'th',
    pl: 'pl',
    polish: 'pl',
    ro: 'ro',
    romanian: 'ro',
    el: 'el',
    greek: 'el',
    cs: 'cs',
    czech: 'cs',
    fi: 'fi',
    finnish: 'fi',
    hi: 'hi',
    hindi: 'hi',
  }
  const mapped = boostMap[lower] || lower
  return MINIMAX_LANGUAGE_BOOST_CODES.has(mapped) ? mapped : undefined
}

function mapRunwareTtsLanguage(model: string, language: string): string | undefined {
  const lang = language.trim()
  const id = model.trim()
  if (id === RUNWARE_TTS_MODEL_DEFAULT) {
    return lang || undefined
  }
  if (
    id === 'alibaba:qwen@3-tts-1.7b-customvoice' ||
    id === 'alibaba:qwen@3-tts-1.7b-voicedesign' ||
    id === 'alibaba:qwen@3-tts-1.7b-base'
  ) {
    if (!lang) return 'Auto'
    const lower = lang.toLowerCase()
    const qwenMap: Record<string, string> = {
      auto: 'Auto',
      en: 'English',
      english: 'English',
      zh: 'Chinese',
      chinese: 'Chinese',
      ja: 'Japanese',
      japanese: 'Japanese',
      ko: 'Korean',
      korean: 'Korean',
      de: 'German',
      german: 'German',
      fr: 'French',
      french: 'French',
      ru: 'Russian',
      russian: 'Russian',
      pt: 'Portuguese',
      portuguese: 'Portuguese',
      es: 'Spanish',
      spanish: 'Spanish',
      it: 'Italian',
      italian: 'Italian',
    }
    return qwenMap[lower] || lang
  }
  return undefined
}

export function clampRunwareTtsSpeed(speed: number): number {
  return Math.max(0.25, Math.min(4, speed))
}

export function runwareTtsSupportsPositivePrompt(model: string): boolean {
  const id = normalizeRunwareTtsModel(model)
  return (
    id === 'alibaba:qwen@3-tts-1.7b-customvoice' ||
    id === 'alibaba:qwen@3-tts-1.7b-voicedesign'
  )
}

export function buildRunwareTtsSpeechPayload(
  model: string,
  text: string,
  voice: string,
  language: string,
  speed?: number,
): Record<string, unknown> {
  const id = normalizeRunwareTtsModel(model)
  const isQwen = id.startsWith('alibaba:qwen@3-tts-1.7b-')
  const isQwenCustom = id === 'alibaba:qwen@3-tts-1.7b-customvoice'
  const isQwenDesign = id === 'alibaba:qwen@3-tts-1.7b-voicedesign'

  const speech: Record<string, unknown> = {
    text,
    voice: voice.trim() || runwareTtsDefaultVoice(id),
  }

  if (isQwenDesign) {
    speech.voice = 'design'
  } else if (isQwenCustom) {
    speech.voice = voice.trim() || speech.voice
  }

  const mappedLanguage = mapRunwareTtsLanguage(id, language)
  if (mappedLanguage) {
    speech.language = mappedLanguage
  }

  if (isQwen && speed != null && Number.isFinite(speed)) {
    speech.speed = clampRunwareTtsSpeed(speed)
  }

  return speech
}

export function buildRunwareTtsSettingsPayload(
  model: string,
  language: string,
): Record<string, unknown> | undefined {
  const id = normalizeRunwareTtsModel(model)
  if (id !== 'minimax:speech@2.8') return undefined
  const languageBoost = mapRunwareTtsLanguageBoost(language)
  if (!languageBoost) return undefined
  return { languageBoost }
}

/** @deprecated Use string voice ids from `runwareTtsVoicesForModel`. */
export type RunwareXaiVoice = 'una' | 'leo' | 'eve' | 'ara' | 'sal' | 'rex'
export type LlmProvider = 'ollama' | 'openrouter' | 'nvidia' | 'deepseek' | 'openai' | 'opencode-go'

/** Ollama `think` request + UI: off sends `think: false`; on = `true`; low/medium/high for GPT-OSS. */
export type LlmThinkLevel = 'off' | 'low' | 'medium' | 'high' | 'on'

/** UI shell: dystopian (neon/CRT), minimal (zinc/indigo), matrix (green/code rain), light (warm paper), blood-moon (crimson void), obsidian (neutral dark), terminal (amber CLI) */
export type UiTheme = 'dystopian' | 'minimal' | 'matrix' | 'light' | 'blood-moon' | 'obsidian' | 'terminal'

export type RunwareModelProfile = {
  width: number
  height: number
  steps: number
  cfgScale: number
  /** OpenAI GPT Image quality setting (used only for GPT Image models). */
  gptQuality?: 'auto' | 'low' | 'medium' | 'high'
}

/** Per-variant defaults for the ACE-Step music model family. */
export type RunwareMusicModelProfile = {
  outputFormat: 'MP3' | 'WAV' | 'FLAC' | 'OGG'
  durationSec: number
  steps: number
  cfgScale: number
  seed: number | null
}

/** Default Ollama num_ctx for sub-agent calls (vision + long-memory extract). */
export const SUB_AGENT_DEFAULT_CONTEXT_TOKENS = 65536

/** Sub-agent config — delegates tasks (vision, coding explore, etc.) to separate models. */
export type SubAgentConfig = {
  /** When true, image_recall runs sub-agent instead of returning base64. */
  enabled: boolean
  /**
   * When true, enables coding context management: deterministic trim of noisy
   * tool output, clearing of stale tool results from old rounds, and the
   * read-only `coding_explore` tool (which runs on the coding sub-agent model).
   */
  codingEnabled: boolean
  /**
   * Vision (+ long-memory) model id (e.g. 'llava:13b', 'gpt-4o').
   * Kept as `model` for backward-compatible settings JSON.
   */
  model: string
  /**
   * Explicit backend for vision `model`. Set when picking from the SUB options list.
   * When omitted, inferred via detectSubAgentProvider (needed for namespaced Ollama ids).
   */
  provider?: 'ollama' | 'openrouter' | 'deepseek' | 'openai'
  /** Coding explore model id (text-capable). Migrates from `model` when missing. */
  codingModel: string
  /** Explicit backend for codingModel. */
  codingProvider?: 'ollama' | 'openrouter' | 'deepseek' | 'openai'
  /**
   * OpenRouter provider slug lock for the vision model (provider.only, no fallbacks).
   * Kept in sync with `openrouterProviderByModel[model]` when provider is openrouter.
   */
  openrouterProviderOnly?: string
  /**
   * OpenRouter provider slug lock for the coding model.
   * Kept in sync with `openrouterProviderByModel[codingModel]`.
   */
  codingOpenrouterProviderOnly?: string
  /** Max generated tokens per sub-agent call (default 1024). Shared by vision/coding. */
  outputTokens?: number
  /** Context window size sent to Ollama as num_ctx (default 64K). Ignored by OpenRouter. */
  contextTokens?: number
  /** When true, show the floating analysis panel during vision/coding sub-agent (default on). */
  showAnalysisWindow?: boolean
}

/**
 * Project vision or coding endpoint fields onto the shared `model`/`provider` slots
 * so callSubAgent* / describeImages can stay unchanged.
 */
export function subAgentConfigForRole(
  sub: SubAgentConfig,
  role: 'vision' | 'coding',
): SubAgentConfig {
  if (role !== 'coding') return sub
  const model = (sub.codingModel || sub.model || '').trim() || sub.model
  return {
    ...sub,
    model,
    provider: sub.codingProvider ?? sub.provider,
    openrouterProviderOnly: sub.codingOpenrouterProviderOnly ?? sub.openrouterProviderOnly,
  }
}

export const RUNWARE_FLUX_9B_MODEL_ID = 'runware:400@6'
export const RUNWARE_GPT_IMAGE_2_MODEL_ID = 'openai:gpt-image@2'
export const RUNWARE_Z_IMAGE_TURBO_MODEL_ID = 'runware:z-image@turbo'
export const RUNWARE_CONFIGURED_MODELS: Array<{ id: string; label: string }> = [
  { id: RUNWARE_FLUX_9B_MODEL_ID, label: 'FLUX 9B' },
  { id: RUNWARE_Z_IMAGE_TURBO_MODEL_ID, label: 'Z Image Turbo' },
  { id: RUNWARE_GPT_IMAGE_2_MODEL_ID, label: 'GPT Image 2' },
]

export const RUNWARE_ACE_STEP_V1_5_TURBO_MODEL_ID = 'runware:ace-step@v1.5-turbo'
export const RUNWARE_ACE_STEP_V1_5_BASE_MODEL_ID = 'runware:ace-step@v1.5-base'
export const RUNWARE_CONFIGURED_MUSIC_MODELS: Array<{ id: string; label: string }> = [
  { id: RUNWARE_ACE_STEP_V1_5_TURBO_MODEL_ID, label: 'ACE-Step v1.5 Turbo' },
  { id: RUNWARE_ACE_STEP_V1_5_BASE_MODEL_ID, label: 'ACE-Step v1.5 Base' },
]
const configuredMusicModelIdSet = new Set<string>(
  RUNWARE_CONFIGURED_MUSIC_MODELS.map((m) => m.id),
)
/** Per-model UI/clamp cap for inference steps (turbo caps low, base allows up to 300). */
export function maxStepsForMusicModelId(modelId: string): number {
  return modelId === RUNWARE_ACE_STEP_V1_5_BASE_MODEL_ID ? 300 : 20
}

/** Per-tool toggles; extend with new keys as tools are added */
export type ToolsEnabled = {
  webSearch: boolean
  weather: boolean
  /** Fetch public URL in main process → plain text (HTML stripped) */
  scrape: boolean
  /** Save text as PDF into `pdfOutputDir` (main process) */
  pdf: boolean
  /** YouTube search / video info / transcript (TTS server: yt-dlp + transcript API) */
  youtube: boolean
  /** Reddit read-only feed / search / post fetch via public JSON endpoints (TTS server) */
  reddit: boolean
  /** Generate images via Runware API */
  runwareImage: boolean
  /** Generate music/audio via Runware ACE-Step model */
  runwareMusic: boolean
  /** Local coding tools (file read/write/search + terminal command execution) */
  coding: boolean
  /** Agent can switch the conversation into Plan mode (read-only plan flow). */
  enterPlan: boolean
}

export type CodingSettings = {
  enabled: boolean
  projectPath: string
  /** Coding panel: show file tree section */
  showFileTree: boolean
  /** Coding panel: show file preview section */
  showFilePreview: boolean
  /** Coding panel: show terminal section */
  showTerminal: boolean
  /** Coding panel width in px (chat / panel split). */
  panelWidthPx: number
  /** File tree section height in px (FILES ↔ preview/terminal split). */
  fileTreeHeightPx: number
}

/** Default / clamp bounds for the chat ↔ coding panel splitter. */
export const CODING_PANEL_WIDTH_DEFAULT = 416
export const CODING_PANEL_WIDTH_MIN = 280
export const CODING_PANEL_WIDTH_MAX = 1200

/** Default / clamp bounds for FILES ↔ rest vertical split inside coding panel. */
export const CODING_FILE_TREE_HEIGHT_DEFAULT = 220
export const CODING_FILE_TREE_HEIGHT_MIN = 100
export const CODING_FILE_TREE_HEIGHT_MAX = 480

export function clampCodingPanelWidth(px: number, containerWidth?: number): number {
  const maxByContainer =
    typeof containerWidth === 'number' && Number.isFinite(containerWidth)
      ? Math.max(CODING_PANEL_WIDTH_MIN, Math.floor(containerWidth * 0.85))
      : CODING_PANEL_WIDTH_MAX
  const max = Math.min(CODING_PANEL_WIDTH_MAX, maxByContainer)
  if (!Number.isFinite(px)) return CODING_PANEL_WIDTH_DEFAULT
  return Math.min(max, Math.max(CODING_PANEL_WIDTH_MIN, Math.round(px)))
}

export function clampCodingFileTreeHeight(px: number, containerHeight?: number): number {
  const maxByContainer =
    typeof containerHeight === 'number' && Number.isFinite(containerHeight)
      ? Math.max(CODING_FILE_TREE_HEIGHT_MIN, Math.floor(containerHeight * 0.7))
      : CODING_FILE_TREE_HEIGHT_MAX
  const max = Math.min(CODING_FILE_TREE_HEIGHT_MAX, maxByContainer)
  if (!Number.isFinite(px)) return CODING_FILE_TREE_HEIGHT_DEFAULT
  return Math.min(max, Math.max(CODING_FILE_TREE_HEIGHT_MIN, Math.round(px)))
}

export type AppSettings = {
  llmProvider: LlmProvider
  ollamaBaseUrl: string
  ollamaModel: string
  openrouterBaseUrl: string
  openrouterApiKey: string
  openrouterModel: string
  /**
   * When set, OpenRouter requests use provider.only with no fallbacks.
   * Kept in sync with `openrouterProviderByModel[openrouterModel]`.
   */
  openrouterProviderOnly: string
  /** Per OpenRouter model id → provider slug lock (empty = default routing). */
  openrouterProviderByModel: Record<string, string>
  /** User-pinned model IDs (provider-specific ids like "openai/gpt-4.1"). */
  pinnedModels: string[]
  nvidiaBaseUrl: string
  nvidiaApiKey: string
  nvidiaModel: string
  deepseekBaseUrl: string
  deepseekApiKey: string
  deepseekModel: string
  /** Native OpenAI Chat Completions (https://api.openai.com/v1). */
  openaiBaseUrl: string
  openaiApiKey: string
  openaiModel: string
  /** OpenCode Go (https://opencode.ai/zen/go/v1) — OpenAI-compatible chat models. */
  opencodeGoBaseUrl: string
  opencodeGoApiKey: string
  opencodeGoModel: string
  /** Default OpenRouter TTS model id. */
  openrouterTtsModel: string
  /** Optional OpenRouter TTS voice id/preset. */
  openrouterTtsVoice: string
  /** Ollama options.temperature */
  llmTemperature: number
  /** Ollama options.num_ctx — context window size in tokens */
  llmNumCtx: number
  /** Auto-run context compression when prompt usage reaches ~90% of num_ctx. */
  contextAutoCompress: boolean
  /** Default for new chats: whether to include long-term memory retrieval. */
  longMemoryDefaultEnabled: boolean
  /**
   * Ollama `think` level. Thinking models default to on unless `think: false` is sent.
   * OpenRouter/NVIDIA reasoning in the UI is shown when level is not `off`.
   */
  llmThinkLevel: LlmThinkLevel
  /** System message prepended to each request */
  llmSystemPrompt: string
  ttsBaseUrl: string
  /** TTS backend provider. local = OmniVoice HTTP server, runware-xai = Runware xAI TTS. */
  ttsProvider: TtsProvider
  /** STT backend provider. none = disabled, openrouter = OpenRouter Whisper. */
  sttProvider: SttProvider
  /** OpenRouter STT model id (Whisper). */
  openrouterSttModel: string
  voiceInstruct: string
  /** auto = no instruct; design = instruct; clone = ref_audio + optional ref_text */
  voiceMode: VoiceMode
  /** Reference transcript for clone; empty = model may use Whisper (slower) */
  cloneRefText: string
  /** Play TTS automatically after assistant reply finishes */
  autoVoice: boolean
  /** TTS generate speed (>1 faster) */
  ttsSpeed: number
  /** Diffusion steps (fewer = faster, lower quality) */
  ttsNumStep: number
  /** Fixed duration in seconds; null = automatic */
  ttsDurationSec: number | null
  /** Long text split into chunks; approximate chars per chunk */
  ttsChunkMaxChars: number
  /** xAI TTS voice id when Runware xAI provider is selected. */
  runwareXaiVoice: string
  /** Runware TTS model id for cloud speech synthesis. */
  runwareTtsModel: string
  /** Optional xAI language code (auto-detect when empty). */
  runwareXaiLanguage: string
  /** Optional positive prompt for Qwen voice design/custom voice (style/emotion description). */
  runwareXaiPositivePrompt: string
  /** Runware TTS speed (0.25–4). Default 1.0. */
  runwareTtsSpeed: number
  /** Short line spoken when baking a voice anchor (auto/design → consistent chunks) */
  voiceBakePhrase: string
  /** Which LLM tools are registered with Ollama (see Tools settings tab) */
  toolsEnabled: ToolsEnabled
  /**
   * Max agent↔tool loop rounds per assistant turn (each round may include tool calls).
   * Soft wrap-up warning fires near the end; hard wrap-up after exhaustion.
   */
  agentMaxToolRounds: number
  /**
   * Discover Agent Skills from ~/.agents|~/.claude|~/.cursor/skills and expose
   * a catalog + read_skill tool (desktop only).
   */
  skillsEnabled: boolean
  /**
   * Connect to MCP servers from ~/.voidcast/mcp.json (+ project .mcp.json)
   * and register their tools with the agent (desktop only).
   */
  mcpEnabled: boolean
  /**
   * Per-server enable flags (server id from mcp.json). Missing key = enabled.
   * Set to false to keep a server in config but not connect / expose tools.
   */
  mcpServerEnabled: Record<string, boolean>
  /**
   * Project roots the user explicitly trusted to load `.mcp.json` MCP servers from.
   * Untrusted project configs are ignored until approved in Options → Tools.
   */
  mcpTrustedProjectPaths: string[]
  /**
   * Chat agent mode: `agent` implements with full tools; `plan` explores read-only
   * and produces an editable plan for Approve → Build.
   */
  agentMode: AgentChatMode
  /** Standalone coding panel settings. */
  coding: CodingSettings
  /** Backward-compatible top-level alias for coding project path. */
  codingProjectPath: string
  /** Where `save_pdf` writes files (no dialog). Empty = tool returns an error until set. */
  pdfOutputDir: string
  /** Visual chrome: cyberpunk shell vs calmer zinc/indigo layout */
  uiTheme: UiTheme
  /** Image generation backend for generate_image / edit tools */
  imageProvider: ImageProvider
  /** OpenRouter model id for image generation when imageProvider is openrouter */
  openrouterImageModel: string
  /** Per-model width/height/quality when imageProvider is openrouter */
  openrouterImageProfiles: Record<string, RunwareModelProfile>
  /** Runware REST base URL (kept for back-compat; UI no longer exposes it) */
  runwareApiBaseUrl: string
  /** Runware API key (stored locally on this device) */
  runwareApiKey: string
  /** Default Runware model id for text-to-image */
  runwareImageModel: string
  /** Default Runware model id for image editing with references */
  runwareEditModel: string
  /** Default output width for generated images */
  runwareWidth: number
  /** Default output height for generated images */
  runwareHeight: number
  /** Default inference steps for image generation */
  runwareSteps: number
  /** Default guidance scale (model-dependent effect) */
  runwareCfgScale: number
  /** Per-model defaults used for generation/edit parameters */
  runwareModelProfiles: Record<string, RunwareModelProfile>
  /** Optional default negative prompt */
  runwareNegativePrompt: string
  /** Auto-save generated Runware images to this folder (desktop app). */
  runwareImageOutputDir: string
  /** If true, each generated image is saved automatically to output folder. */
  runwareAutoSaveImages: boolean
  /** Active Runware music model id (ACE-Step turbo or base). */
  runwareMusicModel: string
  /** Per-variant defaults for the ACE-Step music family. */
  runwareMusicModelProfiles: Record<string, RunwareMusicModelProfile>
  /** Runware music output format (legacy/back-compat; mirrors active profile.outputFormat). */
  runwareMusicOutputFormat: 'MP3' | 'WAV' | 'FLAC' | 'OGG'
  /** Runware music duration in seconds (legacy/back-compat; mirrors active profile.durationSec). */
  runwareMusicDurationSec: number
  /** Runware music inference steps (legacy/back-compat; mirrors active profile.steps). */
  runwareMusicSteps: number
  /** Runware music guidance scale (legacy/back-compat; mirrors active profile.cfgScale). */
  runwareMusicCfgScale: number
  /** Runware music guidance type. */
  runwareMusicGuidanceType: 'apg' | 'cfg'
  /** Runware music vocals language (ISO 639-1 code or unknown). */
  runwareMusicVocalLanguage: string
  /** Optional fixed Runware seed for reproducible music generation (legacy/back-compat). */
  runwareMusicSeed: number | null
  /** Auto-save generated Runware music to this folder (desktop app). */
  runwareMusicOutputDir: string
  /** If true, each generated music file is saved automatically to output folder. */
  runwareAutoSaveMusic: boolean
  /** If true, app should check updates automatically on startup (desktop). */
  autoUpdate: boolean
  /**
   * Desktop only: push cloud API keys to the local TTS server so LAN/phone web
   * clients can use the proxy. Default off — keys stay in localStorage only.
   */
  lanWebAccessEnabled: boolean
  /** If true, chat sessions are auto-saved. When off, a manual save button appears. */
  autoSaveChat: boolean
  /** If true, the renderer fires a desktop notification when a scheduled reminder becomes due. */
  reminderNotificationsEnabled: boolean
  /** If true, play the user-selected reply/error sound files on chat events. */
  notificationSoundsEnabled: boolean
  /** Output volume (0–1) for chat notification sounds. */
  notificationSoundVolume: number
  /** Sub-agent for delegating tasks (vision, etc.) to a separate model. */
  subAgent: SubAgentConfig
}

export const AGENT_EDITABLE_SETTINGS_FIELDS = [
  'llmSystemPrompt',
  'llmNumCtx',
  'llmTemperature',
  'uiTheme',
  'longMemoryAdd',
  'autoVoice',
  'runwareResolution',
  'runwareWidth',
  'runwareHeight',
  'runwareImageModel',
  'runwareEditModel',
] as const

export type AgentEditableSettingsField = (typeof AGENT_EDITABLE_SETTINGS_FIELDS)[number]

import {
  deepseekApiBaseForRuntime,
  defaultOllamaBaseUrlForRuntime,
  defaultTtsBaseUrlForRuntime,
  isElectron,
  isLanWebClient,
  nvidiaApiBaseForRuntime,
  openaiApiBaseForRuntime,
  openRouterApiBaseForRuntime,
  opencodeGoApiBaseForRuntime,
} from '@/lib/platform'

const STORAGE_KEY = 'voidcast-settings-v1'
/** Previous key; read once to migrate */
const LEGACY_STORAGE_KEY = 'omnivoice-chat-settings-v1'
const AGENT_HIDDEN_SETTINGS_FIELDS = [
  'openrouterApiKey',
  'nvidiaApiKey',
  'deepseekApiKey',
  'openaiApiKey',
  'opencodeGoApiKey',
  'runwareApiKey',
] as const

const DEFAULT_LLM_SYSTEM_PROMPT = `You are Void, a highly intelligent, quick‑witted, and candid virtual assistant.

**Voice & Tone**
- **Smart:** Provide accurate, well‑structured answers with concise explanations, relevant examples, and occasional "deep‑dive" optional sections.
- **Witty:** Sprinkle light, appropriate humor, word‑play, or clever analogies (e.g., "That idea is like a cat on a keyboard—fun but chaotic"). Never sacrifice clarity for a joke.
- **Honest:** If you don't know something, say so outright ("I'm not sure, but here's how you could find out"). When a request is ambiguous, ask a clarifying question. Avoid filler phrases and euphemisms.`

export const SYSTEM_PROMPT_PRESETS: Record<Exclude<SystemPromptPreset, 'default'>, string> = {
  code: `${DEFAULT_LLM_SYSTEM_PROMPT}\n\nYou are in Code mode. Prioritize correct, maintainable implementations. Inspect the repository before editing, make minimal focused changes, and verify them with tests or type checks when practical.`,
  creative: `${DEFAULT_LLM_SYSTEM_PROMPT}\n\nYou are in Creative mode. Generate original ideas with strong taste, vivid detail, and useful structure. Explore multiple directions when helpful, while staying aligned with the user's intent.`,
  teacher: `${DEFAULT_LLM_SYSTEM_PROMPT}\n\nYou are in Teacher mode. Explain concepts clearly from first principles, adapt to the learner's level, use examples, and check for common misunderstandings.`,
}

export function normalizeSystemPromptPreset(value: unknown): SystemPromptPreset {
  return value === 'code' || value === 'creative' || value === 'teacher' ? value : 'default'
}

export function getSystemPromptForPreset(
  preset: unknown,
  settings: Pick<AppSettings, 'llmSystemPrompt'>,
): string {
  const normalized = normalizeSystemPromptPreset(preset)
  return normalized === 'default' ? settings.llmSystemPrompt : SYSTEM_PROMPT_PRESETS[normalized]
}

export const defaults: AppSettings = {
  llmProvider: 'ollama',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2',
  openrouterBaseUrl: 'https://openrouter.ai/api/v1',
  openrouterApiKey: '',
  openrouterModel: 'openrouter/free',
  openrouterProviderOnly: '',
  openrouterProviderByModel: {},
  pinnedModels: [
    'openrouter:anthropic/claude-sonnet-5',
    'openrouter:openai/gpt-5.6-sol',
    'openrouter:openai/gpt-5.6-terra',
  ],
  nvidiaBaseUrl: 'https://integrate.api.nvidia.com/v1',
  nvidiaApiKey: '',
  nvidiaModel: 'nvidia/nemotron-3-super-120b-a12b',
  deepseekBaseUrl: 'https://api.deepseek.com',
  deepseekApiKey: '',
  deepseekModel: 'deepseek-v4-pro',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiApiKey: '',
  openaiModel: 'gpt-5.6-sol',
  opencodeGoBaseUrl: 'https://opencode.ai/zen/go/v1',
  opencodeGoApiKey: '',
  opencodeGoModel: 'deepseek-v4-pro',
  openrouterTtsModel: OPENROUTER_TTS_MODEL_DEFAULT,
  openrouterTtsVoice: '',
  llmTemperature: 0.8,
  llmNumCtx: 100_000,
  contextAutoCompress: true,
  longMemoryDefaultEnabled: true,
  llmThinkLevel: 'on',
  llmSystemPrompt: DEFAULT_LLM_SYSTEM_PROMPT,
  ttsBaseUrl: 'http://127.0.0.1:8765',
  ttsProvider: 'openrouter-tts',
  sttProvider: 'none',
  openrouterSttModel: 'openai/whisper-large-v3-turbo',
  voiceInstruct: '',
  voiceMode: 'design',
  cloneRefText: '',
  autoVoice: false,
  ttsSpeed: 1.0,
  ttsNumStep: 32,
  ttsDurationSec: null,
  ttsChunkMaxChars: 300,
  runwareXaiVoice: 'eve',
  runwareTtsModel: RUNWARE_TTS_MODEL_DEFAULT,
  runwareXaiLanguage: '',
  runwareXaiPositivePrompt: '',
  runwareTtsSpeed: 1.0,
  voiceBakePhrase: 'This is my reference voice for consistent synthesis.',
  toolsEnabled: {
    webSearch: true,
    weather: true,
    scrape: true,
    pdf: true,
    youtube: true,
    reddit: true,
    runwareImage: true,
    runwareMusic: true,
    coding: true,
    enterPlan: true,
  },
  agentMaxToolRounds: 50,
  skillsEnabled: true,
  mcpEnabled: false,
  mcpServerEnabled: {},
  mcpTrustedProjectPaths: [],
  agentMode: 'agent',
  coding: {
    enabled: true,
    projectPath: '',
    showFileTree: true,
    showFilePreview: true,
    showTerminal: true,
    panelWidthPx: CODING_PANEL_WIDTH_DEFAULT,
    fileTreeHeightPx: CODING_FILE_TREE_HEIGHT_DEFAULT,
  },
  codingProjectPath: '',
  pdfOutputDir: '',
  uiTheme: 'obsidian',
  imageProvider: 'runware',
  openrouterImageModel: OPENROUTER_IMAGE_MODEL_DEFAULT,
  openrouterImageProfiles: defaultOpenRouterImageProfiles(),
  runwareApiBaseUrl: 'https://api.runware.ai/v1',
  runwareApiKey: '',
  runwareImageModel: RUNWARE_FLUX_9B_MODEL_ID,
  runwareEditModel: RUNWARE_FLUX_9B_MODEL_ID,
  runwareWidth: 1024,
  runwareHeight: 1024,
  runwareSteps: 4,
  runwareCfgScale: 1,
  runwareModelProfiles: {
    [RUNWARE_FLUX_9B_MODEL_ID]: {
      width: 1024,
      height: 1024,
      steps: 4,
      cfgScale: 1,
    },
    [RUNWARE_GPT_IMAGE_2_MODEL_ID]: {
      width: 1024,
      height: 1024,
      steps: 30,
      cfgScale: 7,
      gptQuality: 'auto',
    },
    [RUNWARE_Z_IMAGE_TURBO_MODEL_ID]: {
      width: 1024,
      height: 1024,
      steps: 8,
      cfgScale: 1,
    },
  },
  runwareNegativePrompt: '',
  runwareImageOutputDir: '',
  runwareAutoSaveImages: false,
  runwareMusicModel: RUNWARE_ACE_STEP_V1_5_TURBO_MODEL_ID,
  runwareMusicModelProfiles: {
    [RUNWARE_ACE_STEP_V1_5_TURBO_MODEL_ID]: {
      outputFormat: 'MP3',
      durationSec: 60,
      steps: 10,
      cfgScale: 10,
      seed: null,
    },
    [RUNWARE_ACE_STEP_V1_5_BASE_MODEL_ID]: {
      outputFormat: 'MP3',
      durationSec: 60,
      steps: 100,
      cfgScale: 10,
      seed: null,
    },
  },
  runwareMusicOutputFormat: 'MP3',
  runwareMusicDurationSec: 60,
  runwareMusicSteps: 10,
  runwareMusicCfgScale: 10,
  runwareMusicGuidanceType: 'apg',
  runwareMusicVocalLanguage: 'en',
  runwareMusicSeed: null,
  runwareMusicOutputDir: '',
  runwareAutoSaveMusic: false,
  autoUpdate: false,
  lanWebAccessEnabled: false,
  autoSaveChat: true,
  reminderNotificationsEnabled: true,
  notificationSoundsEnabled: true,
  notificationSoundVolume: 0.8,
  subAgent: {
    enabled: false,
    codingEnabled: false,
    model: 'llava:13b',
    provider: 'ollama',
    codingModel: 'llava:13b',
    codingProvider: 'ollama',
    openrouterProviderOnly: '',
    codingOpenrouterProviderOnly: '',
    outputTokens: 4096,
    contextTokens: SUB_AGENT_DEFAULT_CONTEXT_TOKENS,
    showAnalysisWindow: true,
  },
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

/** Clamp max tool rounds per agent turn (Tools settings). */
export function clampAgentMaxToolRounds(n: number): number {
  if (!Number.isFinite(n)) return defaults.agentMaxToolRounds
  return clamp(Math.round(n), 5, 120)
}

export const AGENT_MAX_TOOL_ROUNDS_MIN = 5
export const AGENT_MAX_TOOL_ROUNDS_MAX = 120
export const AGENT_MAX_TOOL_ROUNDS_DEFAULT = 50

function normalizeTools(s: AppSettings): AppSettings {
  const te = s.toolsEnabled
  const codingEnabled =
    typeof te?.coding === 'boolean'
      ? te.coding
      : typeof s.coding?.enabled === 'boolean'
        ? s.coding.enabled
        : defaults.toolsEnabled.coding
  const codingProjectPathRaw =
    typeof s.coding?.projectPath === 'string'
      ? s.coding.projectPath
      : typeof s.codingProjectPath === 'string'
        ? s.codingProjectPath
        : defaults.coding.projectPath
  const codingProjectPath = codingProjectPathRaw.trim()
  const showFileTree =
    typeof s.coding?.showFileTree === 'boolean' ? s.coding.showFileTree : defaults.coding.showFileTree
  const showFilePreview =
    typeof s.coding?.showFilePreview === 'boolean'
      ? s.coding.showFilePreview
      : defaults.coding.showFilePreview
  const showTerminal =
    typeof s.coding?.showTerminal === 'boolean' ? s.coding.showTerminal : defaults.coding.showTerminal
  const panelWidthPx = clampCodingPanelWidth(
    typeof s.coding?.panelWidthPx === 'number' ? s.coding.panelWidthPx : defaults.coding.panelWidthPx,
  )
  const fileTreeHeightPx = clampCodingFileTreeHeight(
    typeof s.coding?.fileTreeHeightPx === 'number'
      ? s.coding.fileTreeHeightPx
      : defaults.coding.fileTreeHeightPx,
  )
  let st = showFileTree
  let sp = showFilePreview
  let sm = showTerminal
  if (!st && !sp && !sm) {
    st = defaults.coding.showFileTree
    sp = defaults.coding.showFilePreview
    sm = defaults.coding.showTerminal
  }
  return {
    ...s,
    toolsEnabled: {
      webSearch:
        typeof te?.webSearch === 'boolean' ? te.webSearch : defaults.toolsEnabled.webSearch,
      weather:
        typeof te?.weather === 'boolean' ? te.weather : defaults.toolsEnabled.weather,
      scrape: typeof te?.scrape === 'boolean' ? te.scrape : defaults.toolsEnabled.scrape,
      pdf: typeof te?.pdf === 'boolean' ? te.pdf : defaults.toolsEnabled.pdf,
      youtube:
        typeof te?.youtube === 'boolean' ? te.youtube : defaults.toolsEnabled.youtube,
      reddit:
        typeof te?.reddit === 'boolean' ? te.reddit : defaults.toolsEnabled.reddit,
      runwareImage:
        typeof te?.runwareImage === 'boolean'
          ? te.runwareImage
          : defaults.toolsEnabled.runwareImage,
      runwareMusic:
        typeof te?.runwareMusic === 'boolean'
          ? te.runwareMusic
          : defaults.toolsEnabled.runwareMusic,
      coding: codingEnabled,
      enterPlan:
        typeof te?.enterPlan === 'boolean' ? te.enterPlan : defaults.toolsEnabled.enterPlan,
    },
    agentMaxToolRounds: clampAgentMaxToolRounds(
      typeof s.agentMaxToolRounds === 'number' ? s.agentMaxToolRounds : defaults.agentMaxToolRounds,
    ),
    skillsEnabled:
      typeof s.skillsEnabled === 'boolean' ? s.skillsEnabled : defaults.skillsEnabled,
    mcpEnabled: typeof s.mcpEnabled === 'boolean' ? s.mcpEnabled : defaults.mcpEnabled,
    mcpServerEnabled: normalizeMcpServerEnabled(s.mcpServerEnabled),
    mcpTrustedProjectPaths: normalizeMcpTrustedProjectPaths(s.mcpTrustedProjectPaths),
    coding: {
      enabled: codingEnabled,
      projectPath: codingProjectPath,
      showFileTree: st,
      showFilePreview: sp,
      showTerminal: sm,
      panelWidthPx,
      fileTreeHeightPx,
    },
    codingProjectPath,
  }
}

/** Missing server id ⇒ enabled. Explicit `false` disables. */
export function isMcpServerEnabled(
  serverId: string,
  map: Record<string, boolean> | undefined,
): boolean {
  if (!map || !(serverId in map)) return true
  return map[serverId] !== false
}

function normalizeMcpServerEnabled(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const id = k.trim()
    if (!id || id.includes('__')) continue
    if (typeof v === 'boolean') out[id] = v
  }
  return out
}

function normalizeMcpTrustedProjectPaths(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out = new Set<string>()
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    if (trimmed) out.add(trimmed)
  }
  return [...out].sort()
}

const LLM_THINK_LEVELS = new Set<LlmThinkLevel>(['off', 'low', 'medium', 'high', 'on'])

export function normalizeLlmThinkLevel(
  saved: Record<string, unknown> | AppSettings,
  fallback: LlmThinkLevel = defaults.llmThinkLevel,
): LlmThinkLevel {
  const raw = (saved as Record<string, unknown>).llmThinkLevel
  if (typeof raw === 'string' && LLM_THINK_LEVELS.has(raw as LlmThinkLevel)) {
    return raw as LlmThinkLevel
  }
  const legacy = (saved as Record<string, unknown>).llmThinkingEnabled
  if (typeof legacy === 'boolean') return legacy ? 'on' : 'off'
  return fallback
}

function normalizeLlm(s: AppSettings): AppSettings {
  const providerRaw = typeof s.llmProvider === 'string' ? s.llmProvider : ''
  const llmProvider: LlmProvider =
    providerRaw === 'openrouter'
      ? 'openrouter'
      : providerRaw === 'nvidia'
        ? 'nvidia'
        : providerRaw === 'deepseek'
          ? 'deepseek'
          : providerRaw === 'openai'
            ? 'openai'
            : providerRaw === 'opencode-go'
              ? 'opencode-go'
              : 'ollama'
  const t = Number(s.llmTemperature)
  const ctx = Number(s.llmNumCtx)
  const openrouterBaseUrl =
    typeof s.openrouterBaseUrl === 'string' && s.openrouterBaseUrl.trim()
      ? s.openrouterBaseUrl.trim()
      : defaults.openrouterBaseUrl
  const openrouterApiKey =
    typeof s.openrouterApiKey === 'string' ? s.openrouterApiKey.trim() : ''
  const openrouterModel = normalizeOpenRouterModelId(
    typeof s.openrouterModel === 'string' && s.openrouterModel.trim()
      ? s.openrouterModel.trim()
      : defaults.openrouterModel,
  )
  const openrouterProviderByModel = normalizeOpenRouterProviderByModel(
    s.openrouterProviderByModel,
  )
  const legacyProviderOnly =
    typeof s.openrouterProviderOnly === 'string' ? s.openrouterProviderOnly.trim() : ''
  // Migrate single global provider into the per-model map for the active model.
  if (legacyProviderOnly && !Object.prototype.hasOwnProperty.call(openrouterProviderByModel, openrouterModel)) {
    openrouterProviderByModel[openrouterModel] = legacyProviderOnly
  }
  const openrouterProviderOnly = openrouterProviderByModel[openrouterModel] ?? ''
  const pinnedModels = normalizePinnedModels(s.pinnedModels, defaults.pinnedModels)
  const nvidiaBaseUrl =
    typeof s.nvidiaBaseUrl === 'string' && s.nvidiaBaseUrl.trim()
      ? s.nvidiaBaseUrl.trim()
      : defaults.nvidiaBaseUrl
  const nvidiaApiKey =
    typeof s.nvidiaApiKey === 'string' ? s.nvidiaApiKey.trim() : ''
  const nvidiaModel = normalizeNvidiaModelId(
    typeof s.nvidiaModel === 'string' && s.nvidiaModel.trim()
      ? s.nvidiaModel.trim()
      : defaults.nvidiaModel,
  )
  const deepseekBaseUrl =
    typeof s.deepseekBaseUrl === 'string' && s.deepseekBaseUrl.trim()
      ? s.deepseekBaseUrl.trim()
      : defaults.deepseekBaseUrl
  const deepseekApiKey =
    typeof s.deepseekApiKey === 'string' ? s.deepseekApiKey.trim() : ''
  const deepseekModel = normalizeDeepSeekModelId(
    typeof s.deepseekModel === 'string' && s.deepseekModel.trim()
      ? s.deepseekModel.trim()
      : defaults.deepseekModel,
  )
  const openaiBaseUrl =
    typeof s.openaiBaseUrl === 'string' && s.openaiBaseUrl.trim()
      ? s.openaiBaseUrl.trim()
      : defaults.openaiBaseUrl
  const openaiApiKey =
    typeof s.openaiApiKey === 'string' ? s.openaiApiKey.trim() : ''
  const openaiModel = normalizeOpenAiModelId(
    typeof s.openaiModel === 'string' && s.openaiModel.trim()
      ? s.openaiModel.trim()
      : defaults.openaiModel,
  )
  const opencodeGoBaseUrl =
    typeof s.opencodeGoBaseUrl === 'string' && s.opencodeGoBaseUrl.trim()
      ? s.opencodeGoBaseUrl.trim()
      : defaults.opencodeGoBaseUrl
  const opencodeGoApiKey =
    typeof s.opencodeGoApiKey === 'string' ? s.opencodeGoApiKey.trim() : ''
  const opencodeGoModel = normalizeOpenCodeGoModelId(
    typeof s.opencodeGoModel === 'string' && s.opencodeGoModel.trim()
      ? s.opencodeGoModel.trim()
      : defaults.opencodeGoModel,
  )
  return {
    ...s,
    llmProvider,
    openrouterBaseUrl,
    openrouterApiKey,
    openrouterModel,
    openrouterProviderOnly,
    openrouterProviderByModel,
    pinnedModels,
    nvidiaBaseUrl,
    nvidiaApiKey,
    nvidiaModel,
    deepseekBaseUrl,
    deepseekApiKey,
    deepseekModel,
    openaiBaseUrl,
    openaiApiKey,
    openaiModel,
    opencodeGoBaseUrl,
    opencodeGoApiKey,
    opencodeGoModel,
    llmTemperature: Number.isFinite(t) ? clamp(t, 0, 2) : defaults.llmTemperature,
    llmNumCtx: Number.isFinite(ctx)
      ? clamp(Math.round(ctx), 512, 262144)
      : defaults.llmNumCtx,
    contextAutoCompress:
      typeof s.contextAutoCompress === 'boolean'
        ? s.contextAutoCompress
        : defaults.contextAutoCompress,
    longMemoryDefaultEnabled:
      typeof s.longMemoryDefaultEnabled === 'boolean'
        ? s.longMemoryDefaultEnabled
        : defaults.longMemoryDefaultEnabled,
    llmThinkLevel: normalizeLlmThinkLevel(s, defaults.llmThinkLevel),
    llmSystemPrompt:
      typeof s.llmSystemPrompt === 'string' ? s.llmSystemPrompt : '',
  }
}

function normalizeTts(s: AppSettings): AppSettings {
  const providerRaw = typeof s.ttsProvider === 'string' ? s.ttsProvider : ''
  const ttsProvider: TtsProvider =
    providerRaw === 'runware-xai'
      ? 'runware-xai'
      : providerRaw === 'openrouter-tts'
        ? 'openrouter-tts'
        : 'local'
  const voiceRaw = typeof s.runwareXaiVoice === 'string' ? s.runwareXaiVoice.trim() : ''
  const previousRunwareModel =
    typeof s.runwareTtsModel === 'string' ? s.runwareTtsModel.trim() : ''
  const runwareTtsModel = normalizeRunwareTtsModel(previousRunwareModel)
  const runwareModelChanged =
    Boolean(previousRunwareModel) && runwareTtsModel !== previousRunwareModel
  const allowedVoices = runwareTtsVoicesForModel(runwareTtsModel)
  const voiceAllowed = Boolean(voiceRaw) && allowedVoices.includes(voiceRaw)
  const runwareXaiVoice =
    runwareModelChanged || !voiceAllowed
      ? runwareTtsDefaultVoice(runwareTtsModel)
      : voiceRaw
  const runwareXaiLanguage =
    typeof s.runwareXaiLanguage === 'string' ? s.runwareXaiLanguage.trim() : ''
  const runwareXaiPositivePrompt =
    typeof s.runwareXaiPositivePrompt === 'string' ? s.runwareXaiPositivePrompt : ''
  const runwareTtsSpeedRaw =
    typeof s.runwareTtsSpeed === 'number' && Number.isFinite(s.runwareTtsSpeed)
      ? s.runwareTtsSpeed
      : defaults.runwareTtsSpeed
  const runwareTtsSpeed = clampRunwareTtsSpeed(runwareTtsSpeedRaw)
  const previousModel =
    typeof s.openrouterTtsModel === 'string' ? s.openrouterTtsModel.trim() : ''
  const openrouterTtsModel = normalizeOpenRouterTtsModel(previousModel)
  const orTtsVoiceRaw = typeof s.openrouterTtsVoice === 'string' ? s.openrouterTtsVoice.trim() : ''
  const modelChanged = openrouterTtsModel !== previousModel
  const openrouterTtsVoice =
    modelChanged && OPENAI_TTS_VOICES.has(orTtsVoiceRaw) ? '' : orTtsVoiceRaw
  return {
    ...s,
    ttsProvider,
    runwareXaiVoice,
    runwareTtsModel,
    runwareXaiLanguage,
    runwareXaiPositivePrompt,
    runwareTtsSpeed,
    openrouterTtsModel,
    openrouterTtsVoice,
  }
}

function normalizeSubAgentModelId(
  rawModel: string,
  provider: 'ollama' | 'openrouter' | 'deepseek' | 'openai',
): string {
  if (provider === 'ollama') return rawModel
  if (provider === 'deepseek') return normalizeDeepSeekModelId(rawModel)
  if (provider === 'openai') return normalizeOpenAiModelId(rawModel)
  return normalizeOpenRouterModelId(rawModel)
}

export function normalizeSubAgent(s: AppSettings): AppSettings {
  const raw = s.subAgent
  if (!raw || typeof raw !== 'object') return { ...s, subAgent: { ...defaults.subAgent } }
  const enabled = raw.enabled === true
  const codingEnabled = raw.codingEnabled === true
  const rawModel = (typeof raw.model === 'string' && raw.model.trim()) || defaults.subAgent.model
  const rawProvider =
    raw.provider === 'ollama' ||
    raw.provider === 'openrouter' ||
    raw.provider === 'deepseek' ||
    raw.provider === 'openai'
      ? raw.provider
      : undefined
  const provider = detectSubAgentProvider(rawModel, rawProvider)
  const model = normalizeSubAgentModelId(rawModel, provider)

  const hasCodingModel = typeof raw.codingModel === 'string' && raw.codingModel.trim().length > 0
  const rawCodingModel = hasCodingModel ? raw.codingModel.trim() : model
  const rawCodingProvider =
    raw.codingProvider === 'ollama' ||
    raw.codingProvider === 'openrouter' ||
    raw.codingProvider === 'deepseek' ||
    raw.codingProvider === 'openai'
      ? raw.codingProvider
      : hasCodingModel
        ? undefined
        : provider
  const codingProvider = detectSubAgentProvider(rawCodingModel, rawCodingProvider)
  const codingModel = normalizeSubAgentModelId(rawCodingModel, codingProvider)

  const providerMap = s.openrouterProviderByModel || {}
  const openrouterProviderOnly =
    provider === 'openrouter' && model && Object.prototype.hasOwnProperty.call(providerMap, model)
      ? (providerMap[model] || '').trim()
      : typeof raw.openrouterProviderOnly === 'string'
        ? raw.openrouterProviderOnly.trim()
        : defaults.subAgent.openrouterProviderOnly ?? ''
  const codingOpenrouterProviderOnly =
    codingProvider === 'openrouter' &&
    codingModel &&
    Object.prototype.hasOwnProperty.call(providerMap, codingModel)
      ? (providerMap[codingModel] || '').trim()
      : typeof raw.codingOpenrouterProviderOnly === 'string'
        ? raw.codingOpenrouterProviderOnly.trim()
        : defaults.subAgent.codingOpenrouterProviderOnly ?? ''

  // outputTokens — migrate old maxTokensPerImage key if present
  const rawAny = raw as any
  const outputTokens =
    typeof raw.outputTokens === 'number' && Number.isFinite(raw.outputTokens)
      ? Math.max(50, Math.min(4096, Math.round(raw.outputTokens)))
      : typeof rawAny.maxTokensPerImage === 'number' && Number.isFinite(rawAny.maxTokensPerImage)
        ? Math.max(50, Math.min(4096, Math.round(rawAny.maxTokensPerImage)))
        : defaults.subAgent.outputTokens
  const contextTokens =
    typeof raw.contextTokens === 'number' && Number.isFinite(raw.contextTokens)
      ? Math.max(512, Math.min(131072, Math.round(raw.contextTokens)))
      : defaults.subAgent.contextTokens
  const showAnalysisWindow = raw.showAnalysisWindow !== false
  return {
    ...s,
    subAgent: {
      enabled,
      codingEnabled,
      model,
      provider,
      codingModel,
      codingProvider,
      openrouterProviderOnly,
      codingOpenrouterProviderOnly,
      outputTokens,
      contextTokens,
      showAnalysisWindow,
    },
  }
}

function normalizePdfDir(s: AppSettings): AppSettings {
  const dir = typeof s.pdfOutputDir === 'string' ? s.pdfOutputDir.trim() : ''
  return { ...s, pdfOutputDir: dir }
}

function normalizeUiTheme(s: AppSettings): AppSettings {
  const t = s.uiTheme
  const uiTheme: UiTheme =
    t === 'minimal' || t === 'dystopian' || t === 'matrix' || t === 'light' || t === 'blood-moon' || t === 'obsidian' || t === 'terminal' ? t : 'minimal'
  return { ...s, uiTheme }
}

function normalizeAgentMode(s: AppSettings): AppSettings {
  const agentMode: AgentChatMode = s.agentMode === 'plan' ? 'plan' : 'agent'
  return { ...s, agentMode }
}

function normalizeRunware(s: AppSettings): AppSettings {
  const width = Number(s.runwareWidth)
  const height = Number(s.runwareHeight)
  const steps = Number(s.runwareSteps)
  const cfg = Number(s.runwareCfgScale)
  const configuredModelIdSet = new Set(RUNWARE_CONFIGURED_MODELS.map((x) => x.id))
  const apiBase = typeof s.runwareApiBaseUrl === 'string'
    ? s.runwareApiBaseUrl.trim()
    : ''
  const apiKey = typeof s.runwareApiKey === 'string' ? s.runwareApiKey.trim() : ''
  const model =
    typeof s.runwareImageModel === 'string' && s.runwareImageModel.trim()
      ? s.runwareImageModel.trim()
      : defaults.runwareImageModel
  const editModel =
    typeof s.runwareEditModel === 'string' && s.runwareEditModel.trim()
      ? s.runwareEditModel.trim()
      : defaults.runwareEditModel
  const negative =
    typeof s.runwareNegativePrompt === 'string' ? s.runwareNegativePrompt : ''
  const outputDir =
    typeof s.runwareImageOutputDir === 'string' ? s.runwareImageOutputDir.trim() : ''
  const musicOutputFormatRaw = typeof s.runwareMusicOutputFormat === 'string'
    ? s.runwareMusicOutputFormat.trim().toUpperCase()
    : ''
  const musicOutputFormat =
    musicOutputFormatRaw === 'WAV' || musicOutputFormatRaw === 'FLAC' || musicOutputFormatRaw === 'OGG'
      ? musicOutputFormatRaw
      : 'MP3'
  const musicDuration = Number(s.runwareMusicDurationSec)
  const musicSteps = Number(s.runwareMusicSteps)
  const musicCfg = Number(s.runwareMusicCfgScale)
  const musicGuidanceRaw = typeof s.runwareMusicGuidanceType === 'string'
    ? s.runwareMusicGuidanceType.trim().toLowerCase()
    : ''
  const musicGuidanceType = musicGuidanceRaw === 'cfg' ? 'cfg' : 'apg'
  const musicVocalLangRaw = typeof s.runwareMusicVocalLanguage === 'string'
    ? s.runwareMusicVocalLanguage.trim().toLowerCase()
    : ''
  const musicVocalLanguage = musicVocalLangRaw || defaults.runwareMusicVocalLanguage
  const musicSeedRaw = Number(s.runwareMusicSeed)
  const musicSeed = Number.isFinite(musicSeedRaw)
    ? clamp(Math.round(musicSeedRaw), 0, 2147483647)
    : null
  const musicOutputDir =
    typeof s.runwareMusicOutputDir === 'string' ? s.runwareMusicOutputDir.trim() : ''

  const legacyMusicProfile: RunwareMusicModelProfile = {
    outputFormat: musicOutputFormat,
    durationSec: Number.isFinite(musicDuration)
      ? clamp(musicDuration, 6, 300)
      : defaults.runwareMusicDurationSec,
    steps: Number.isFinite(musicSteps)
      ? clamp(Math.round(musicSteps), 1, 300)
      : defaults.runwareMusicSteps,
    cfgScale: Number.isFinite(musicCfg)
      ? clamp(musicCfg, 1, 30)
      : defaults.runwareMusicCfgScale,
    seed: musicSeed,
  }
  const parsedMusicProfiles =
    s.runwareMusicModelProfiles && typeof s.runwareMusicModelProfiles === 'object'
      ? (s.runwareMusicModelProfiles as Record<string, Partial<RunwareMusicModelProfile>>)
      : {}
  const normalizedMusicProfiles: Record<string, RunwareMusicModelProfile> = {}
  for (const m of RUNWARE_CONFIGURED_MUSIC_MODELS) {
    const isBase = m.id === RUNWARE_ACE_STEP_V1_5_BASE_MODEL_ID
    // Turbo profile migrates from legacy top-level music fields if no profile is stored yet.
    // Base profile falls back to docs defaults; legacy fields don't apply because they were turbo-shaped.
    const fallback =
      isBase
        ? defaults.runwareMusicModelProfiles[m.id]
        : (parsedMusicProfiles[m.id]
            ? defaults.runwareMusicModelProfiles[m.id]
            : legacyMusicProfile)
    const incoming = parsedMusicProfiles[m.id] ?? {}
    const incomingOutputFormatRaw =
      typeof incoming.outputFormat === 'string' ? incoming.outputFormat.trim().toUpperCase() : ''
    const incomingOutputFormat: 'MP3' | 'WAV' | 'FLAC' | 'OGG' =
      incomingOutputFormatRaw === 'WAV' ||
      incomingOutputFormatRaw === 'FLAC' ||
      incomingOutputFormatRaw === 'OGG' ||
      incomingOutputFormatRaw === 'MP3'
        ? incomingOutputFormatRaw
        : fallback.outputFormat
    const incomingDuration = Number(incoming.durationSec)
    const incomingSteps = Number(incoming.steps)
    const incomingCfg = Number(incoming.cfgScale)
    const incomingSeedRaw = Number(incoming.seed)
    const incomingSeed =
      incoming.seed == null
        ? fallback.seed
        : Number.isFinite(incomingSeedRaw)
          ? clamp(Math.round(incomingSeedRaw), 0, 2147483647)
          : null
    const stepsCap = maxStepsForMusicModelId(m.id)
    normalizedMusicProfiles[m.id] = {
      outputFormat: incomingOutputFormat,
      durationSec: Number.isFinite(incomingDuration)
        ? clamp(incomingDuration, 6, 300)
        : fallback.durationSec,
      steps: Number.isFinite(incomingSteps)
        ? clamp(Math.round(incomingSteps), 1, stepsCap)
        : clamp(Math.round(fallback.steps), 1, stepsCap),
      cfgScale: Number.isFinite(incomingCfg) ? clamp(incomingCfg, 1, 30) : fallback.cfgScale,
      seed: incomingSeed,
    }
  }
  const requestedMusicModelRaw =
    typeof s.runwareMusicModel === 'string' ? s.runwareMusicModel.trim() : ''
  const safeMusicModel = configuredMusicModelIdSet.has(requestedMusicModelRaw)
    ? requestedMusicModelRaw
    : defaults.runwareMusicModel
  const activeMusicProfile =
    normalizedMusicProfiles[safeMusicModel] ??
    defaults.runwareMusicModelProfiles[safeMusicModel] ??
    defaults.runwareMusicModelProfiles[defaults.runwareMusicModel]

  const legacyProfile: RunwareModelProfile = {
    width: Number.isFinite(width) ? clamp(Math.round(width), 256, 2048) : defaults.runwareWidth,
    height: Number.isFinite(height)
      ? clamp(Math.round(height), 256, 2048)
      : defaults.runwareHeight,
    steps: Number.isFinite(steps) ? clamp(Math.round(steps), 1, 80) : defaults.runwareSteps,
    cfgScale: Number.isFinite(cfg) ? clamp(cfg, 0, 30) : defaults.runwareCfgScale,
  }
  const parsedProfiles =
    s.runwareModelProfiles && typeof s.runwareModelProfiles === 'object'
      ? (s.runwareModelProfiles as Record<string, Partial<RunwareModelProfile>>)
      : {}
  const normalizedProfiles: Record<string, RunwareModelProfile> = {}
  for (const m of RUNWARE_CONFIGURED_MODELS) {
    const fallback =
      m.id === RUNWARE_FLUX_9B_MODEL_ID
        ? legacyProfile
        : defaults.runwareModelProfiles[m.id] ?? legacyProfile
    const incoming = parsedProfiles[m.id] ?? {}
    const w = Number(incoming.width)
    const h = Number(incoming.height)
    const st = Number(incoming.steps)
    const cf = Number(incoming.cfgScale)
    const gptQualityRaw = typeof incoming.gptQuality === 'string' ? incoming.gptQuality : ''
    const normalizedGptQuality =
      gptQualityRaw === 'auto' || gptQualityRaw === 'low' || gptQualityRaw === 'medium' || gptQualityRaw === 'high'
        ? gptQualityRaw
        : undefined
    const isGptImage2 = m.id === RUNWARE_GPT_IMAGE_2_MODEL_ID
    const isZImageTurbo = m.id === RUNWARE_Z_IMAGE_TURBO_MODEL_ID
    const minSide = isGptImage2 ? 480 : isZImageTurbo ? 128 : 256
    const maxSide = isGptImage2 ? 3840 : 2048
    normalizedProfiles[m.id] = {
      width: Number.isFinite(w) ? clamp(Math.round(w), minSide, maxSide) : fallback.width,
      height: Number.isFinite(h) ? clamp(Math.round(h), minSide, maxSide) : fallback.height,
      steps: Number.isFinite(st) ? clamp(Math.round(st), 1, 80) : fallback.steps,
      cfgScale: Number.isFinite(cf) ? clamp(cf, 0, 30) : fallback.cfgScale,
      ...(isGptImage2
        ? {
            gptQuality:
              normalizedGptQuality ??
              fallback.gptQuality ??
              defaults.runwareModelProfiles[RUNWARE_GPT_IMAGE_2_MODEL_ID]?.gptQuality ??
              'auto',
          }
        : {}),
    }
  }
  const safeModel = configuredModelIdSet.has(model) ? model : defaults.runwareImageModel
  const safeEditModel = configuredModelIdSet.has(editModel) ? editModel : defaults.runwareEditModel
  const activeProfile =
    normalizedProfiles[safeModel] ??
    defaults.runwareModelProfiles[safeModel] ??
    defaults.runwareModelProfiles[defaults.runwareImageModel]

  const openrouterDefaults = defaultOpenRouterImageProfiles()
  const parsedOpenRouterProfiles =
    s.openrouterImageProfiles && typeof s.openrouterImageProfiles === 'object'
      ? (s.openrouterImageProfiles as Record<string, Partial<RunwareModelProfile>>)
      : {}
  const legacyOpenRouterDims: RunwareModelProfile = {
    width: Number.isFinite(width) ? clamp(Math.round(width), 256, 3840) : defaults.runwareWidth,
    height: Number.isFinite(height)
      ? clamp(Math.round(height), 256, 3840)
      : defaults.runwareHeight,
    steps: 20,
    cfgScale: 7,
  }
  const normalizedOpenRouterProfiles: Record<string, RunwareModelProfile> = {}
  for (const preset of OPENROUTER_IMAGE_MODEL_PRESETS) {
    const fallback =
      openrouterDefaults[preset.id] ??
      legacyOpenRouterDims
    normalizedOpenRouterProfiles[preset.id] = normalizeOpenRouterImageProfile(
      preset.id,
      parsedOpenRouterProfiles[preset.id],
      fallback,
    )
  }
  for (const [modelId, profile] of Object.entries(parsedOpenRouterProfiles)) {
    if (normalizedOpenRouterProfiles[modelId]) continue
    const fallback =
      openrouterDefaults[modelId] ??
      legacyOpenRouterDims
    normalizedOpenRouterProfiles[modelId] = normalizeOpenRouterImageProfile(
      modelId,
      profile,
      fallback,
    )
  }

  return {
    ...s,
    imageProvider: s.imageProvider === 'openrouter' ? 'openrouter' : 'runware',
    openrouterImageModel: normalizeOpenRouterImageModel(s.openrouterImageModel),
    openrouterImageProfiles: normalizedOpenRouterProfiles,
    runwareApiBaseUrl: apiBase || defaults.runwareApiBaseUrl,
    runwareApiKey: apiKey,
    runwareImageModel: safeModel,
    runwareEditModel: safeEditModel,
    runwareWidth: activeProfile.width,
    runwareHeight: activeProfile.height,
    runwareSteps: activeProfile.steps,
    runwareCfgScale: activeProfile.cfgScale,
    runwareModelProfiles: normalizedProfiles,
    runwareNegativePrompt: negative,
    runwareImageOutputDir: outputDir,
    runwareAutoSaveImages:
      typeof s.runwareAutoSaveImages === 'boolean'
        ? s.runwareAutoSaveImages
        : defaults.runwareAutoSaveImages,
    runwareMusicModel: safeMusicModel,
    runwareMusicModelProfiles: normalizedMusicProfiles,
    runwareMusicOutputFormat: activeMusicProfile.outputFormat,
    runwareMusicDurationSec: activeMusicProfile.durationSec,
    runwareMusicSteps: activeMusicProfile.steps,
    runwareMusicCfgScale: activeMusicProfile.cfgScale,
    runwareMusicGuidanceType: musicGuidanceType,
    runwareMusicVocalLanguage: musicVocalLanguage,
    runwareMusicSeed: activeMusicProfile.seed,
    runwareMusicOutputDir: musicOutputDir,
    runwareAutoSaveMusic:
      typeof s.runwareAutoSaveMusic === 'boolean'
        ? s.runwareAutoSaveMusic
        : defaults.runwareAutoSaveMusic,
  }
}

function normalizeNotificationSounds(s: AppSettings): AppSettings {
  const v = Number(s.notificationSoundVolume)
  return {
    ...s,
    notificationSoundsEnabled:
      typeof s.notificationSoundsEnabled === 'boolean'
        ? s.notificationSoundsEnabled
        : defaults.notificationSoundsEnabled,
    notificationSoundVolume: Number.isFinite(v)
      ? clamp(v, 0, 1)
      : defaults.notificationSoundVolume,
  }
}

function normalizeLanWebAccess(s: AppSettings): AppSettings {
  return {
    ...s,
    lanWebAccessEnabled:
      typeof s.lanWebAccessEnabled === 'boolean' ? s.lanWebAccessEnabled : false,
  }
}

function normalizeAll(s: AppSettings): AppSettings {
  return normalizeLanWebAccess(
    normalizeNotificationSounds(
      normalizeRunware(
        normalizeAgentMode(
          normalizeUiTheme(normalizePdfDir(normalizeTools(normalizeTts(normalizeSubAgent(normalizeLlm(s)))))),
        ),
      ),
    ),
  )
}

function stripCloudSecrets(s: AppSettings): AppSettings {
  return {
    ...s,
    openrouterApiKey: '',
    runwareApiKey: '',
    nvidiaApiKey: '',
    deepseekApiKey: '',
    openaiApiKey: '',
    opencodeGoApiKey: '',
  }
}

/** Vite dev / preview ports — must never be persisted as tools or API base URLs in desktop. */
function isViteDevServerUrl(url: string): boolean {
  const raw = url.trim()
  if (!raw) return false
  try {
    const u = new URL(raw.includes('://') ? raw : `http://${raw}`)
    const h = u.hostname.toLowerCase()
    if (h !== 'localhost' && h !== '127.0.0.1') return false
    const port = u.port || (u.protocol === 'https:' ? '443' : '80')
    return port === '5173' || port === '7777' || port === '4173'
  } catch {
    return /localhost:5173|127\.0\.0\.1:5173|localhost:7777|127\.0\.0\.1:7777|localhost:4173|127\.0\.0\.1:4173/.test(
      raw,
    )
  }
}

/** Repair settings saved while preload was not ready (tts/api URLs pointed at Vite). */
function sanitizeDesktopServiceUrls(s: AppSettings): AppSettings {
  if (typeof window === 'undefined' || !isElectron()) return s

  let next = s
  const assign = (patch: Partial<AppSettings>) => {
    next = { ...next, ...patch }
  }

  if (isViteDevServerUrl(next.ttsBaseUrl)) {
    assign({ ttsBaseUrl: defaultTtsBaseUrlForRuntime() })
  }
  if (isViteDevServerUrl(next.ollamaBaseUrl) || next.ollamaBaseUrl.includes('/api/ollama')) {
    assign({ ollamaBaseUrl: defaultOllamaBaseUrlForRuntime() })
  }
  if (isViteDevServerUrl(next.openrouterBaseUrl) || next.openrouterBaseUrl.includes('/api/openrouter')) {
    assign({ openrouterBaseUrl: defaults.openrouterBaseUrl })
  }
  if (isViteDevServerUrl(next.nvidiaBaseUrl) || next.nvidiaBaseUrl.includes('/api/nvidia')) {
    assign({ nvidiaBaseUrl: defaults.nvidiaBaseUrl })
  }
  if (isViteDevServerUrl(next.deepseekBaseUrl) || next.deepseekBaseUrl.includes('/api/deepseek')) {
    assign({ deepseekBaseUrl: defaults.deepseekBaseUrl })
  }
  if (isViteDevServerUrl(next.openaiBaseUrl) || next.openaiBaseUrl.includes('/api/openai')) {
    assign({ openaiBaseUrl: defaults.openaiBaseUrl })
  }
  if (
    isViteDevServerUrl(next.opencodeGoBaseUrl) ||
    next.opencodeGoBaseUrl.includes('/api/opencode-go')
  ) {
    assign({ opencodeGoBaseUrl: defaults.opencodeGoBaseUrl })
  }

  return next
}

function applyWebRuntimeOverrides(s: AppSettings): AppSettings {
  if (typeof window !== 'undefined' && isElectron()) {
    return s
  }
  if (typeof window !== 'undefined' && isLanWebClient()) {
    return stripCloudSecrets({
      ...s,
      ttsBaseUrl: defaultTtsBaseUrlForRuntime(),
      ollamaBaseUrl: ollamaUrlShouldUseDesktopProxy(s.ollamaBaseUrl)
        ? defaultOllamaBaseUrlForRuntime()
        : s.ollamaBaseUrl,
      openrouterBaseUrl: openRouterApiBaseForRuntime(),
      nvidiaBaseUrl: nvidiaApiBaseForRuntime(),
      deepseekBaseUrl: deepseekApiBaseForRuntime(),
      openaiBaseUrl: openaiApiBaseForRuntime(),
      opencodeGoBaseUrl: opencodeGoApiBaseForRuntime(),
      voiceMode: 'design',
      sttProvider: 'none',
    })
  }
  return s
}

export function normalizeSettingsCandidate(candidate: Partial<AppSettings>): AppSettings {
  return applyWebRuntimeOverrides(normalizeAll({ ...defaults, ...candidate }))
}

/** On phone browser, localhost / 127.0.0.1 point at the device — never reach the desktop server. */
function ollamaUrlShouldUseDesktopProxy(url: string): boolean {
  const u = url.trim()
  if (!u) return true
  try {
    const parsed = new URL(u.includes('://') ? u : `http://${u}`)
    const h = parsed.hostname.toLowerCase()
    return h === 'localhost' || h === '127.0.0.1'
  } catch {
    return true
  }
}

export function loadSettings(): AppSettings {
  let merged: AppSettings
  try {
    const rawNew = localStorage.getItem(STORAGE_KEY)
    const rawLegacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    const raw = rawNew ?? rawLegacy
    if (!raw) {
      merged = { ...defaults }
    } else {
      const parsed = JSON.parse(raw) as Partial<AppSettings>
      merged = normalizeAll({ ...defaults, ...parsed })
      if (!rawNew && rawLegacy) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
      }
    }
  } catch {
    merged = { ...defaults }
  }

  return applyWebRuntimeOverrides(sanitizeDesktopServiceUrls(merged))
}

export function saveSettings(s: AppSettings): void {
  const toSave =
    typeof window !== 'undefined' && isLanWebClient() && !isElectron()
      ? stripCloudSecrets(s)
      : s
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
}

export function getAgentVisibleSettings(settings: AppSettings): Partial<AppSettings> {
  const out: Partial<AppSettings> = { ...settings }
  for (const k of AGENT_HIDDEN_SETTINGS_FIELDS) {
    delete out[k]
  }
  return out
}

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

/** Normalize OpenRouter provider slug map: trim keys/values; drop empty entries. */
export function normalizeOpenRouterProviderByModel(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const modelId = typeof k === 'string' ? k.trim() : ''
    const provider = typeof v === 'string' ? v.trim() : ''
    if (!modelId || !provider) continue
    out[modelId] = provider
  }
  return out
}

/** Set OpenRouter provider lock for a sub-agent role model (persisted in shared per-model map). */
export function withSubAgentOpenRouterProvider(
  s: AppSettings,
  role: 'vision' | 'coding',
  providerOnly: string,
): Pick<AppSettings, 'openrouterProviderOnly' | 'openrouterProviderByModel' | 'subAgent'> {
  const modelId = (
    role === 'coding' ? s.subAgent.codingModel || s.subAgent.model : s.subAgent.model
  ).trim()
  const nextProvider = providerOnly.trim()
  const prev = s.openrouterProviderByModel || {}
  const nextMap = { ...prev }
  if (modelId) {
    if (nextProvider) nextMap[modelId] = nextProvider
    else delete nextMap[modelId]
  }
  const subAgent: SubAgentConfig =
    role === 'coding'
      ? { ...s.subAgent, codingOpenrouterProviderOnly: nextProvider }
      : { ...s.subAgent, openrouterProviderOnly: nextProvider }
  const mainOrModel = (s.openrouterModel || '').trim()
  return {
    openrouterProviderByModel: nextMap,
    openrouterProviderOnly:
      modelId && modelId === mainOrModel ? nextProvider : s.openrouterProviderOnly,
    subAgent,
  }
}

/** Provider slug lock for the active OpenRouter model (empty = default routing). */
export function getOpenRouterProviderOnly(
  s: Pick<AppSettings, 'openrouterModel' | 'openrouterProviderByModel' | 'openrouterProviderOnly'>,
): string {
  const modelId = (s.openrouterModel || '').trim()
  if (modelId && s.openrouterProviderByModel && Object.prototype.hasOwnProperty.call(s.openrouterProviderByModel, modelId)) {
    return (s.openrouterProviderByModel[modelId] || '').trim()
  }
  return (s.openrouterProviderOnly || '').trim()
}

/** Switch OpenRouter model and restore the remembered provider for that model. */
export function withOpenRouterModel(
  s: AppSettings,
  modelId: string,
): Pick<AppSettings, 'openrouterModel' | 'openrouterProviderOnly'> {
  const nextModel = modelId.trim()
  const map = s.openrouterProviderByModel || {}
  return {
    openrouterModel: nextModel,
    openrouterProviderOnly: nextModel ? (map[nextModel] || '').trim() : '',
  }
}

/** Set provider lock for the current OpenRouter model (persisted per model). */
export function withOpenRouterProviderOnly(
  s: AppSettings,
  providerOnly: string,
): Pick<AppSettings, 'openrouterProviderOnly' | 'openrouterProviderByModel'> {
  const modelId = (s.openrouterModel || '').trim()
  const nextProvider = providerOnly.trim()
  const prev = s.openrouterProviderByModel || {}
  const nextMap = { ...prev }
  if (!modelId) {
    return { openrouterProviderOnly: nextProvider, openrouterProviderByModel: nextMap }
  }
  if (nextProvider) nextMap[modelId] = nextProvider
  else delete nextMap[modelId]
  return {
    openrouterProviderOnly: nextProvider,
    openrouterProviderByModel: nextMap,
  }
}

export function getOpenRouterImageProfile(
  s: Pick<AppSettings, 'openrouterImageModel' | 'openrouterImageProfiles' | 'runwareWidth' | 'runwareHeight'>,
): RunwareModelProfile {
  const modelId = normalizeOpenRouterImageModel(s.openrouterImageModel)
  const incoming = s.openrouterImageProfiles?.[modelId]
  if (incoming) return incoming
  const fallback = defaultOpenRouterImageProfiles()[modelId]
  if (fallback) return fallback
  return {
    width: s.runwareWidth,
    height: s.runwareHeight,
    steps: 20,
    cfgScale: 7,
  }
}

export function getRunwareProfileForModel(
  s: Pick<AppSettings, 'runwareModelProfiles'>,
  modelId: string,
): RunwareModelProfile {
  const incoming = s.runwareModelProfiles?.[modelId]
  if (incoming) return incoming
  const fallback = defaults.runwareModelProfiles[modelId]
  if (fallback) return fallback
  return defaults.runwareModelProfiles[defaults.runwareImageModel]
}

export function getRunwareMusicProfileForModel(
  s: Pick<AppSettings, 'runwareMusicModelProfiles'>,
  modelId: string,
): RunwareMusicModelProfile {
  const incoming = s.runwareMusicModelProfiles?.[modelId]
  if (incoming) return incoming
  const fallback = defaults.runwareMusicModelProfiles[modelId]
  if (fallback) return fallback
  return defaults.runwareMusicModelProfiles[defaults.runwareMusicModel]
}
