import type { ToolsEnabled, SubAgentConfig, LlmThinkLevel } from '@/lib/settings'
import type { McpToolInfo } from '@/lib/mcpTools'
import type { AgentChatMode, PlanArtifact } from '@/types/chat'
import type { RunwareImageConfig } from '@/lib/runware'
import type { ImageVisionCache } from '@/lib/imageVisionCache'
import type { SubAgentUiCallbacks } from '@/lib/subAgent'
import type { OllamaApiMessage, OllamaModelOptions } from '@/lib/ollama'
import type { AgentToolUiPhase } from '@/lib/agentToolPhase'
import type { ExecCtx } from '@/lib/toolExecTypes'
import type { CodingFileCache } from '@/lib/codingContextMemo'

/**
 * Fields shared by both Ollama and OpenRouter chat-with-tools param types.
 * Each agent extends this with its own provider-specific fields (baseUrl, apiKey, etc.).
 */
export interface ChatWithToolsCommonParams {
  baseUrl: string
  model: string
  initialMessages: OllamaApiMessage[]
  modelOptions?: OllamaModelOptions
  toolsEnabled: ToolsEnabled
  skillsEnabled?: boolean
  mcpTools?: McpToolInfo[]
  mcpEnabled?: boolean
  mcpServerEnabled?: Record<string, boolean>
  mcpTrustedProjectPaths?: string[]
  agentMode?: AgentChatMode
  getActiveBuildPlan?: () => PlanArtifact | undefined
  maxToolRounds?: number
  ttsBaseUrl: string
  signal?: AbortSignal
  onDelta: (fullText: string) => void
  onThinkingDelta?: (fullThinking: string) => void
  onToolPhase?: (phase: AgentToolUiPhase | null) => void
  pdfOutputDir?: string
  onToolResult?: (payload: {
    name: string
    result: string
    args?: Record<string, unknown>
  }) => void
  runware?: RunwareImageConfig
  userImages?: string[]
  userImageMimes?: string[]
  userImagePaths?: string[]
  codingProjectPath?: string
  codingRecentFiles?: string[]
  /** Mutable ref for per-turn working-set file cache (updated on read/write/edit, injected as user msg). */
  codingFileCacheRef?: React.MutableRefObject<CodingFileCache>
  rawUserText?: string
  subAgent?: SubAgentConfig
  ollamaBaseUrlForSubAgent?: string
  openrouterBaseUrlForSubAgent?: string
  openrouterApiKeyForSubAgent?: string
  deepseekBaseUrlForSubAgent?: string
  deepseekApiKeyForSubAgent?: string
  openaiBaseUrlForSubAgent?: string
  openaiApiKeyForSubAgent?: string
  thinkLevel?: LlmThinkLevel
  subAgentUi?: SubAgentUiCallbacks
  onImageVisionCacheUpdate?: (entries: ImageVisionCache) => void
  imageVisionCache?: ImageVisionCache
}

/**
 * Builds the `Omit<ExecCtx, 'toolsEnabled'>` object from shared params.
 * Used by both ollamaAgent and openrouterAgent to avoid duplicating
 * the mapping into executeToolCall's ctx argument.
 */
export function buildToolExecutorOptions(
  params: ChatWithToolsCommonParams,
): Omit<ExecCtx, 'toolsEnabled'> {
  return {
    ttsBaseUrl: params.ttsBaseUrl,
    signal: params.signal,
    pdfOutputDir: params.pdfOutputDir,
    runware: params.runware,
    userImages: params.userImages,
    userImageMimes: params.userImageMimes,
    userImagePaths: params.userImagePaths,
    codingProjectPath: params.codingProjectPath,
    codingRecentFiles: params.codingRecentFiles,
    userText: params.rawUserText,
    skillsEnabled: Boolean(params.skillsEnabled),
    mcpEnabled: Boolean(params.mcpEnabled),
    mcpTools: params.mcpTools,
    mcpServerEnabled: params.mcpServerEnabled,
    mcpTrustedProjectPaths: params.mcpTrustedProjectPaths,
    agentMode: params.agentMode,
    getActiveBuildPlan: params.getActiveBuildPlan,
    subAgent: params.subAgent,
    ollamaBaseUrl: params.ollamaBaseUrlForSubAgent,
    openrouterBaseUrl: params.openrouterBaseUrlForSubAgent,
    openrouterApiKey: params.openrouterApiKeyForSubAgent,
    deepseekBaseUrl: params.deepseekBaseUrlForSubAgent,
    deepseekApiKey: params.deepseekApiKeyForSubAgent,
    openaiBaseUrl: params.openaiBaseUrlForSubAgent,
    openaiApiKey: params.openaiApiKeyForSubAgent,
    subAgentUi: params.subAgentUi,
    onImageVisionCacheUpdate: params.onImageVisionCacheUpdate,
    imageVisionCache: params.imageVisionCache,
  }
}
