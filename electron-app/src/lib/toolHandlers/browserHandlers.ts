import type { ToolHandlerFn, ToolHandlerRegistry } from "@/lib/toolExecTypes";

/** Resolve the preload browser bridge, or undefined in the standalone web build. */
function browserBridge(): NonNullable<Window["voidcast"]>["browser"] | undefined {
  return typeof window !== "undefined" ? window.voidcast?.browser : undefined;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const handleBrowserNavigatePage: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.browser) {
    return "Error: browser tools are disabled in settings.";
  }
  const bridge = browserBridge();
  if (!bridge) {
    return "Error: the Voidcast browser is only available in the Electron desktop app.";
  }
  const url = typeof args.url === "string" ? args.url.trim() : "";
  if (!url) return "Error: missing url parameter for browser_navigate_page.";
  const wait = typeof args.wait === "boolean" ? args.wait : true;
  try {
    // `wait` is forwarded so the main process can delay its reply until load.
    const payload = { url, projectPath: ctx.codingProjectPath, wait } as {
      url: string;
      projectPath?: string;
    };
    const res = await bridge.navigate(payload);
    if (!res.ok) return `Error: ${res.error ?? "navigation failed"}`;
    return `Navigated to ${res.url}`;
  } catch (e) {
    return errText(e);
  }
};

export const handleBrowserTakeSnapshot: ToolHandlerFn = async (args, _ctx) => {
  if (!_ctx.toolsEnabled.browser) {
    return "Error: browser tools are disabled in settings.";
  }
  const bridge = browserBridge();
  if (!bridge) {
    return "Error: the Voidcast browser is only available in the Electron desktop app.";
  }
  const maxNodes =
    typeof args.max_nodes === "number" && Number.isFinite(args.max_nodes)
      ? Math.max(1, Math.round(args.max_nodes))
      : undefined;
  try {
    const res = await bridge.snapshot(maxNodes !== undefined ? { maxNodes } : undefined);
    if (!res.ok) return `Error: ${res.error ?? "snapshot failed"}`;
    return `${res.text}\n\nUse the uid values above with browser_click / browser_fill.`;
  } catch (e) {
    return errText(e);
  }
};

export const handleBrowserClick: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.browser) {
    return "Error: browser tools are disabled in settings.";
  }
  const bridge = browserBridge();
  if (!bridge) {
    return "Error: the Voidcast browser is only available in the Electron desktop app.";
  }
  const uid = typeof args.uid === "string" ? args.uid.trim() : "";
  if (!uid) return "Error: missing uid parameter for browser_click.";
  try {
    const res = await bridge.click({ uid });
    if (!res.ok) return `Error: ${res.error ?? "click failed"}`;
    return res.text;
  } catch (e) {
    return errText(e);
  }
};

export const handleBrowserFill: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.browser) {
    return "Error: browser tools are disabled in settings.";
  }
  const bridge = browserBridge();
  if (!bridge) {
    return "Error: the Voidcast browser is only available in the Electron desktop app.";
  }
  const uid = typeof args.uid === "string" ? args.uid.trim() : "";
  if (!uid) return "Error: missing uid parameter for browser_fill.";
  if (typeof args.text !== "string") {
    return "Error: missing text parameter for browser_fill.";
  }
  const submit = typeof args.submit === "boolean" ? args.submit : undefined;
  try {
    const res = await bridge.fill({ uid, text: args.text, submit });
    if (!res.ok) return `Error: ${res.error ?? "fill failed"}`;
    return res.text;
  } catch (e) {
    return errText(e);
  }
};

export const handleBrowserPressKey: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.browser) {
    return "Error: browser tools are disabled in settings.";
  }
  const bridge = browserBridge();
  if (!bridge) {
    return "Error: the Voidcast browser is only available in the Electron desktop app.";
  }
  const key = typeof args.key === "string" ? args.key.trim() : "";
  if (!key) return "Error: missing key parameter for browser_press_key.";
  try {
    const res = await bridge.pressKey({ key });
    if (!res.ok) return `Error: ${res.error ?? "press key failed"}`;
    return res.text;
  } catch (e) {
    return errText(e);
  }
};

export const handleBrowserTakeScreenshot: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.browser) {
    return "Error: browser tools are disabled in settings.";
  }
  const bridge = browserBridge();
  if (!bridge) {
    return "Error: the Voidcast browser is only available in the Electron desktop app.";
  }
  try {
    const uid = typeof args.uid === "string" ? args.uid.trim() : "";
    const fullPage = args.full_page === true;
    const res = await bridge.screenshot({
      projectPath: ctx.codingProjectPath,
      uid: uid || undefined,
      fullPage,
    });
    if (!res.ok) return `Error: ${res.error ?? "screenshot failed"}`;
    const rel = res.relativePath ?? res.path;
    return `Screenshot saved: ${res.path} (relative: ${rel}, ${res.bytes} bytes, ${res.width}x${res.height}). Call image_recall with reference_image_paths="${rel}" to view it.`;
  } catch (e) {
    return errText(e);
  }
};

export const handleBrowserListConsoleMessages: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.browser) {
    return "Error: browser tools are disabled in settings.";
  }
  const bridge = browserBridge();
  if (!bridge) {
    return "Error: the Voidcast browser is only available in the Electron desktop app.";
  }
  const limit =
    typeof args.limit === "number" && Number.isFinite(args.limit)
      ? Math.max(1, Math.round(args.limit))
      : undefined;
  try {
    const res = await bridge.consoleLogs(limit !== undefined ? { limit } : undefined);
    if (!res.ok) return `Error: ${res.error ?? "console log read failed"}`;
    return res.text;
  } catch (e) {
    return errText(e);
  }
};

export const handleBrowserListNetworkRequests: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.browser) {
    return "Error: browser tools are disabled in settings.";
  }
  const bridge = browserBridge();
  if (!bridge) {
    return "Error: the Voidcast browser is only available in the Electron desktop app.";
  }
  const limit =
    typeof args.limit === "number" && Number.isFinite(args.limit)
      ? Math.max(1, Math.round(args.limit))
      : undefined;
  try {
    const res = await bridge.networkRequests(limit !== undefined ? { limit } : undefined);
    if (!res.ok) return `Error: ${res.error ?? "network request read failed"}`;
    return res.text;
  } catch (e) {
    return errText(e);
  }
};

export const handleBrowserWaitFor: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.browser) {
    return "Error: browser tools are disabled in settings.";
  }
  const bridge = browserBridge();
  if (!bridge) {
    return "Error: the Voidcast browser is only available in the Electron desktop app.";
  }
  const selector = typeof args.selector === "string" ? args.selector.trim() : "";
  const text = typeof args.text === "string" ? args.text.trim() : "";
  const urlPattern = typeof args.url_pattern === "string" ? args.url_pattern.trim() : "";
  const networkIdle = args.network_idle === true;
  if (!selector && !text && !urlPattern && !networkIdle) {
    return "Error: pass at least one of selector, text, url_pattern or network_idle.";
  }
  const timeoutMs =
    typeof args.timeout_ms === "number" && Number.isFinite(args.timeout_ms)
      ? Math.min(60000, Math.max(250, Math.round(args.timeout_ms)))
      : undefined;
  try {
    const res = await bridge.waitFor({
      selector: selector || undefined,
      text: text || undefined,
      urlPattern: urlPattern || undefined,
      networkIdle: networkIdle || undefined,
      timeoutMs,
    });
    if (!res.ok) return `Error: ${res.error ?? "wait failed"}`;
    return res.text;
  } catch (e) {
    return errText(e);
  }
};

export const handleBrowserHandleDialog: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.browser) {
    return "Error: browser tools are disabled in settings.";
  }
  const bridge = browserBridge();
  if (!bridge) {
    return "Error: the Voidcast browser is only available in the Electron desktop app.";
  }
  const accept = args.accept !== false;
  const promptText = typeof args.prompt_text === "string" ? args.prompt_text : undefined;
  try {
    const res = await bridge.handleDialog({ accept, promptText });
    if (!res.ok) return `Error: ${res.error ?? "dialog policy failed"}`;
    return res.text;
  } catch (e) {
    return errText(e);
  }
};

export const handleBrowserListPages: ToolHandlerFn = async (_args, ctx) => {
  if (!ctx.toolsEnabled.browser) {
    return "Error: browser tools are disabled in settings.";
  }
  const bridge = browserBridge();
  if (!bridge) {
    return "Error: the Voidcast browser is only available in the Electron desktop app.";
  }
  try {
    const res = await bridge.listPages({ projectPath: ctx.codingProjectPath });
    if (!res.ok) return `Error: ${res.error ?? "could not list pages"}`;
    return `${res.text}\n\nOnly the current (*) page is shown in the coding panel — use browser_select_page to switch.`;
  } catch (e) {
    return errText(e);
  }
};

export const handleBrowserNewPage: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.browser) {
    return "Error: browser tools are disabled in settings.";
  }
  const bridge = browserBridge();
  if (!bridge) {
    return "Error: the Voidcast browser is only available in the Electron desktop app.";
  }
  const url = typeof args.url === "string" ? args.url.trim() : "";
  if (!url) return "Error: missing url parameter for browser_new_page.";
  const background = args.background === true;
  try {
    const res = await bridge.newPage({ url, background, projectPath: ctx.codingProjectPath });
    if (!res.ok) return `Error: ${res.error ?? "could not open a new page"}`;
    return res.text;
  } catch (e) {
    return errText(e);
  }
};

export const handleBrowserSelectPage: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.browser) {
    return "Error: browser tools are disabled in settings.";
  }
  const bridge = browserBridge();
  if (!bridge) {
    return "Error: the Voidcast browser is only available in the Electron desktop app.";
  }
  const pageId = typeof args.page_id === "string" ? args.page_id.trim() : "";
  if (!pageId) return "Error: missing page_id parameter for browser_select_page.";
  try {
    const res = await bridge.selectPage({ pageId });
    if (!res.ok) return `Error: ${res.error ?? "could not select that page"}`;
    return res.text;
  } catch (e) {
    return errText(e);
  }
};

export const handleBrowserClosePage: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.browser) {
    return "Error: browser tools are disabled in settings.";
  }
  const bridge = browserBridge();
  if (!bridge) {
    return "Error: the Voidcast browser is only available in the Electron desktop app.";
  }
  const pageId = typeof args.page_id === "string" ? args.page_id.trim() : "";
  if (!pageId) return "Error: missing page_id parameter for browser_close_page.";
  try {
    const res = await bridge.closePage({ pageId });
    if (!res.ok) return `Error: ${res.error ?? "could not close that page"}`;
    return res.text;
  } catch (e) {
    return errText(e);
  }
};

export const handleBrowserEmulate: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.browser) {
    return "Error: browser tools are disabled in settings.";
  }
  const bridge = browserBridge();
  if (!bridge) {
    return "Error: the Voidcast browser is only available in the Electron desktop app.";
  }
  const num = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;
  const width = num(args.width);
  const height = num(args.height);
  const deviceScaleFactor = num(args.device_scale_factor);
  const mobile = typeof args.mobile === "boolean" ? args.mobile : undefined;
  const darkMode = typeof args.dark_mode === "boolean" ? args.dark_mode : undefined;
  const reset = args.reset === true;
  if (!reset && width === undefined && height === undefined && darkMode === undefined) {
    return "Error: pass width/height, dark_mode, or reset.";
  }
  try {
    const res = await bridge.emulate({ width, height, deviceScaleFactor, mobile, darkMode, reset });
    if (!res.ok) return `Error: ${res.error ?? "emulation failed"}`;
    return res.text;
  } catch (e) {
    return errText(e);
  }
};

export const browserHandlersRegistry: ToolHandlerRegistry = {
  ["browser_navigate_page"]: handleBrowserNavigatePage,
  ["browser_list_pages"]: handleBrowserListPages,
  ["browser_new_page"]: handleBrowserNewPage,
  ["browser_select_page"]: handleBrowserSelectPage,
  ["browser_close_page"]: handleBrowserClosePage,
  ["browser_take_snapshot"]: handleBrowserTakeSnapshot,
  ["browser_click"]: handleBrowserClick,
  ["browser_fill"]: handleBrowserFill,
  ["browser_press_key"]: handleBrowserPressKey,
  ["browser_take_screenshot"]: handleBrowserTakeScreenshot,
  ["browser_emulate"]: handleBrowserEmulate,
  ["browser_list_console_messages"]: handleBrowserListConsoleMessages,
  ["browser_list_network_requests"]: handleBrowserListNetworkRequests,
  ["browser_wait_for"]: handleBrowserWaitFor,
  ["browser_handle_dialog"]: handleBrowserHandleDialog,
};
