import type { McpToolInfo } from "@/lib/mcpTools";
import type { RunwareImageConfig } from "@/lib/runware";
import type { ImageVisionCache } from "@/lib/imageVisionCache";
import type { SubAgentConfig, ToolsEnabled } from "@/lib/settings";
import type { SubAgentUiCallbacks } from "@/lib/subAgent";
import type { AgentChatMode, PlanArtifact } from "@/types/chat";

/**
 * Shared execution context passed to every tool handler / executeToolCall.
 */
export interface ExecCtx {
  ttsBaseUrl: string;
  signal?: AbortSignal;
  /** Required for save_pdf when the tool is enabled. */
  pdfOutputDir?: string;
  runware?: RunwareImageConfig;
  userImages?: string[];
  userImageMimes?: string[];
  userImagePaths?: string[];
  /** Coding project path — coding tools + project skill resolution for read_skill. */
  codingProjectPath?: string;
  /** Recently touched files from coding session memo (boosts search ranking). */
  codingRecentFiles?: string[];
  /** Latest user message text for override-policy checks. */
  userText?: string;
  /** When true, read_skill is allowed. */
  skillsEnabled?: boolean;
  /** When true, MCP tools (mcp__*) may be executed. */
  mcpEnabled?: boolean;
  /** Catalog for mcp_list_tools progressive disclosure. */
  mcpTools?: McpToolInfo[];
  /** Per-server enable map (missing id = enabled). */
  mcpServerEnabled?: Record<string, boolean>;
  mcpTrustedProjectPaths?: string[];
  /** Plan mode blocks mutating tools even if registered. */
  agentMode?: AgentChatMode;
  /** Live approved plan during Approve & Build (for update_plan_progress). */
  getActiveBuildPlan?: () => PlanArtifact | undefined;
  /** Sub-agent config for image_recall delegation. */
  subAgent?: SubAgentConfig;
  /** Keys for sub-agent API calls (from main app settings). */
  ollamaBaseUrl?: string;
  openrouterBaseUrl?: string;
  openrouterApiKey?: string;
  deepseekBaseUrl?: string;
  deepseekApiKey?: string;
  openaiBaseUrl?: string;
  openaiApiKey?: string;
  /** UI hooks while sub-agent describes images (header-style panel in App). */
  subAgentUi?: SubAgentUiCallbacks;
  /** Persist sub-agent descriptions onto the session (for later history context). */
  onImageVisionCacheUpdate?: (entries: ImageVisionCache) => void;
  /** Session vision cache — skip sub-agent API when a description already exists. */
  imageVisionCache?: ImageVisionCache;
  /** Tool enable flags — set by executeToolCall before dispatch. */
  toolsEnabled: ToolsEnabled;
}

/** A tool handler: parsed args + execution context → result string. */
export type ToolHandlerFn = (
  args: Record<string, unknown>,
  ctx: ExecCtx,
) => Promise<string>;

/** Registry mapping tool names to their handler functions. */
export type ToolHandlerRegistry = Record<string, ToolHandlerFn>;
