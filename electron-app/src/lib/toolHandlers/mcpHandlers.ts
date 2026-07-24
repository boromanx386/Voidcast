import {
  executeMcpReadResult,
  executeMcpToolCall,
  formatMcpGetToolResult,
  formatMcpToolsListResult,
  isMcpToolName,
  MCP_CALL_NAME,
  MCP_GET_TOOL_NAME,
  MCP_LIST_TOOLS_NAME,
  MCP_READ_RESULT_NAME,
} from "@/lib/mcpTools";
import type {
  ExecCtx,
  ToolHandlerFn,
  ToolHandlerRegistry,
} from "@/lib/toolExecTypes";

export const handleMcpListTools: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.mcpEnabled) {
    return "Error: MCP tools are disabled in settings.";
  }
  const catalog = ctx.mcpTools ?? [];
  const query = typeof args.query === "string" ? args.query : undefined;
  const limit =
    typeof args.limit === "number" && Number.isFinite(args.limit)
      ? args.limit
      : undefined;
  // If catalog is large and no query, force a short server overview instead of dumping everything.
  if (!query?.trim() && catalog.length > 20) {
    const servers = [...new Set(catalog.map((t) => t.serverId))].sort();
    const counts = servers.map((id) => {
      const n = catalog.filter((t) => t.serverId === id).length;
      return `- ${id}: ${n} tool(s)`;
    });
    return [
      `MCP has ${catalog.length} tools across ${servers.length} server(s). Pass query to mcp_list_tools (e.g. a server name or capability).`,
      ...counts,
      'Example: mcp_list_tools with query="runware" or query="image". Then mcp_get_tool for ONE name, then mcp_call.',
    ].join("\n");
  }
  return formatMcpToolsListResult(catalog, { query, limit });
};

export const handleMcpGetTool: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.mcpEnabled) {
    return "Error: MCP tools are disabled in settings.";
  }
  const toolName = typeof args.name === "string" ? args.name.trim() : "";
  if (!toolName)
    return "Error: missing name for mcp_get_tool (use one mcp__server__tool).";
  return formatMcpGetToolResult(ctx.mcpTools ?? [], toolName);
};

export const handleMcpReadResult: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.mcpEnabled) {
    return "Error: MCP tools are disabled in settings.";
  }
  const filePath = typeof args.path === "string" ? args.path.trim() : "";
  if (!filePath)
    return "Error: missing path for mcp_read_result (use the path from <persisted-output>).";
  return await executeMcpReadResult({
    path: filePath,
    startLine:
      typeof args.start_line === "number" && Number.isFinite(args.start_line)
        ? args.start_line
        : undefined,
    endLine:
      typeof args.end_line === "number" && Number.isFinite(args.end_line)
        ? args.end_line
        : undefined,
    offset:
      typeof args.offset === "number" && Number.isFinite(args.offset)
        ? args.offset
        : undefined,
    maxChars:
      typeof args.max_chars === "number" && Number.isFinite(args.max_chars)
        ? args.max_chars
        : undefined,
    itemOffset:
      typeof args.item_offset === "number" && Number.isFinite(args.item_offset)
        ? args.item_offset
        : undefined,
    itemLimit:
      typeof args.item_limit === "number" && Number.isFinite(args.item_limit)
        ? args.item_limit
        : undefined,
    query: typeof args.query === "string" ? args.query : undefined,
  });
};

export const handleMcpCall: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.mcpEnabled) {
    return "Error: MCP tools are disabled in settings.";
  }
  const toolName = typeof args.name === "string" ? args.name.trim() : "";
  if (!toolName)
    return "Error: missing name parameter for mcp_call (use mcp__server__tool).";
  if (!isMcpToolName(toolName)) {
    return `Error: mcp_call name must be a qualified MCP tool like mcp__server__tool (got "${toolName}").`;
  }
  const callArgs =
    args.arguments &&
    typeof args.arguments === "object" &&
    !Array.isArray(args.arguments)
      ? (args.arguments as Record<string, unknown>)
      : {};
  try {
    return await executeMcpToolCall(toolName, callArgs, {
      projectPath: ctx.codingProjectPath,
      enabledServers: ctx.mcpServerEnabled,
      trustedProjectPaths: ctx.mcpTrustedProjectPaths,
    });
  } catch (e) {
    return `Error: MCP tool execution failed: ${e instanceof Error ? e.message : String(e)}`;
  }
};

export async function handleMcpLegacy(
  name: string,
  args: Record<string, unknown>,
  ctx: ExecCtx,
): Promise<string> {
  // Legacy/direct mcp__* calls still work if a model emits them.
  if (!ctx.mcpEnabled) {
    return "Error: MCP tools are disabled in settings.";
  }
  try {
    return await executeMcpToolCall(name, args, {
      projectPath: ctx.codingProjectPath,
      enabledServers: ctx.mcpServerEnabled,
      trustedProjectPaths: ctx.mcpTrustedProjectPaths,
    });
  } catch (e) {
    return `Error: MCP tool execution failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export const mcpHandlersRegistry: ToolHandlerRegistry = {
  [MCP_LIST_TOOLS_NAME]: handleMcpListTools,
  [MCP_GET_TOOL_NAME]: handleMcpGetTool,
  [MCP_READ_RESULT_NAME]: handleMcpReadResult,
  [MCP_CALL_NAME]: handleMcpCall,
};
