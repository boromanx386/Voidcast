import { isPlanModeBlockedTool } from "@/lib/toolDefinitions";
import { isMcpToolName } from "@/lib/mcpTools";
import type { ToolsEnabled } from "@/lib/settings";
import { parseToolArguments } from "@/lib/agentToolUtils";
import type { ExecCtx } from "@/lib/toolExecTypes";
import { toolHandlerRegistry } from "@/lib/toolHandlers";
import { handleMcpLegacy } from "@/lib/toolHandlers/mcpHandlers";

export type { ExecCtx } from "@/lib/toolExecTypes";
export { resolveImageRecallRequest } from "@/lib/toolHandlers/imageRecall";

export async function executeToolCall(
  name: string,
  argsJson: string | Record<string, unknown> | undefined,
  toolsEnabled: ToolsEnabled,
  ctx: Omit<ExecCtx, "toolsEnabled">,
): Promise<string> {
  const args =
    typeof argsJson === "string"
      ? parseToolArguments(argsJson)
      : ((argsJson as Record<string, unknown>) ?? {});
  if ((ctx.agentMode === "plan" || ctx.agentMode === "ask") && isPlanModeBlockedTool(name)) {
    return `Error: tool "${name}" is blocked in ${ctx.agentMode === "ask" ? "Ask" : "Plan"} mode (read-only). ${
      ctx.agentMode === "ask"
        ? "Ask is read-only: answer the question without mutating anything."
        : "Propose a plan instead; the user can Approve & Build to implement."
    }`;
  }
  const fullCtx: ExecCtx = { ...ctx, toolsEnabled };
  const handler = toolHandlerRegistry[name];
  if (handler) {
    return handler(args, fullCtx);
  }
  if (isMcpToolName(name)) {
    return handleMcpLegacy(name, args, fullCtx);
  }
  return `Error: unknown tool "${name}".`;
}
