import type { ToolHandlerRegistry } from "@/lib/toolExecTypes";
import { mcpHandlersRegistry } from "@/lib/toolHandlers/mcpHandlers";
import { webHandlersRegistry } from "@/lib/toolHandlers/webHandlers";
import { mediaHandlersRegistry } from "@/lib/toolHandlers/mediaHandlers";
import { appHandlersRegistry } from "@/lib/toolHandlers/appHandlers";
import { codingHandlersRegistry } from "@/lib/toolHandlers/codingHandlers";

export const toolHandlerRegistry: ToolHandlerRegistry = {
  ...mcpHandlersRegistry,
  ...webHandlersRegistry,
  ...mediaHandlersRegistry,
  ...appHandlersRegistry,
  ...codingHandlersRegistry,
};
