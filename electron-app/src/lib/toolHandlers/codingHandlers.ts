import {
  invokeExecuteCodingCommand,
  invokeEditCodingFile,
  invokeCodingGit,
  invokeCheckCodingTypes,
  invokeGlobCodingFiles,
  invokeKillCodingCommand,
  invokeListActiveCodingProcesses,
  invokeListCodingDirectory,
  invokeReadCodingFile,
  invokeReadCodingProcessOutput,
  invokeSearchCodingFiles,
  invokeWriteCodingFile,
} from "@/lib/codingTools";
import { runCodingExplore } from "@/lib/codingSubAgent";
import type { ToolHandlerFn, ToolHandlerRegistry } from "@/lib/toolExecTypes";
import {
  ACTIVE_PROCESS_LAST_MAX_CHARS,
} from "@/lib/codingActiveProcesses";

export const handleListDirectory: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.coding)
    return "Error: list_directory tool is disabled in settings.";
  const projectPath = (ctx.codingProjectPath || "").trim();
  if (!projectPath)
    return "Error: coding project folder is not set in settings.";
  const relativePath = typeof args.path === "string" ? args.path.trim() : "";
  const includeIgnored = args.include_ignored === true;
  try {
    const listed = await invokeListCodingDirectory(projectPath, relativePath, {
      includeIgnored,
    });
    if (!listed.ok) return `Error: ${listed.error}`;
    if (listed.entries.length === 0) return "Directory is empty.";
    return listed.entries
      .map((e) => `${e.type === "directory" ? "[dir]" : "[file]"} ${e.path}`)
      .join("\n");
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

export const handleReadFile: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.coding)
    return "Error: read_file tool is disabled in settings.";
  const projectPath = (ctx.codingProjectPath || "").trim();
  if (!projectPath)
    return "Error: coding project folder is not set in settings.";
  const relativePath = typeof args.path === "string" ? args.path.trim() : "";
  if (!relativePath) return "Error: missing path parameter for read_file.";
  const startLine =
    typeof args.start_line === "number" && Number.isFinite(args.start_line)
      ? Math.floor(args.start_line)
      : undefined;
  const endLine =
    typeof args.end_line === "number" && Number.isFinite(args.end_line)
      ? Math.floor(args.end_line)
      : undefined;
  const maxChars =
    typeof args.max_chars === "number" && Number.isFinite(args.max_chars)
      ? Math.floor(args.max_chars)
      : undefined;
  return (
    await invokeReadCodingFile(projectPath, relativePath, {
      startLine,
      endLine,
      maxChars,
      forToolDisplay: true,
    })
  ).text;
};

export const handleWriteFile: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.coding)
    return "Error: write_file tool is disabled in settings.";
  const projectPath = (ctx.codingProjectPath || "").trim();
  if (!projectPath)
    return "Error: coding project folder is not set in settings.";
  const relativePath = typeof args.path === "string" ? args.path.trim() : "";
  const content = typeof args.content === "string" ? args.content : "";
  if (!relativePath) return "Error: missing path parameter for write_file.";
  return (await invokeWriteCodingFile(projectPath, relativePath, content)).text;
};

export const handleEditCode: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.coding)
    return "Error: edit_code tool is disabled in settings.";
  const projectPath = (ctx.codingProjectPath || "").trim();
  if (!projectPath)
    return "Error: coding project folder is not set in settings.";
  const relativePath = typeof args.path === "string" ? args.path.trim() : "";
  const findText = typeof args.find_text === "string" ? args.find_text : "";
  const replaceText =
    typeof args.replace_text === "string" ? args.replace_text : "";
  const replaceAll = args.replace_all === true;
  const startLine =
    typeof args.start_line === "number" && Number.isFinite(args.start_line)
      ? Math.floor(args.start_line)
      : undefined;
  const endLine =
    typeof args.end_line === "number" && Number.isFinite(args.end_line)
      ? Math.floor(args.end_line)
      : undefined;
  const ignoreWhitespace = args.ignore_whitespace === true;
  if (!relativePath) return "Error: missing path parameter for edit_code.";
  return (
    await invokeEditCodingFile(
      projectPath,
      relativePath,
      findText,
      replaceText,
      replaceAll,
      { startLine, endLine, ignoreWhitespace },
    )
  ).text;
};

export const handleSearchFiles: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.coding)
    return "Error: search_files tool is disabled in settings.";
  const projectPath = (ctx.codingProjectPath || "").trim();
  if (!projectPath)
    return "Error: coding project folder is not set in settings.";
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return "Error: missing query parameter for search_files.";
  const pathPrefix =
    typeof args.path_prefix === "string" ? args.path_prefix.trim() : "";
  return (
    await invokeSearchCodingFiles(projectPath, query, {
      pathPrefix: pathPrefix || undefined,
      recentFiles: ctx.codingRecentFiles,
    })
  ).text;
};

export const handleGlobFiles: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.coding)
    return "Error: glob_files tool is disabled in settings.";
  const projectPath = (ctx.codingProjectPath || "").trim();
  if (!projectPath)
    return "Error: coding project folder is not set in settings.";
  const pathPrefix =
    typeof args.path_prefix === "string" ? args.path_prefix.trim() : "";
  const extensions = Array.isArray(args.extensions)
    ? args.extensions.filter((x): x is string => typeof x === "string")
    : undefined;
  const maxResults =
    typeof args.max_results === "number" && Number.isFinite(args.max_results)
      ? args.max_results
      : undefined;
  return (
    await invokeGlobCodingFiles(projectPath, {
      pathPrefix: pathPrefix || undefined,
      extensions,
      maxResults,
    })
  ).text;
};

export const handleGitStatus: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.coding)
    return "Error: git_status tool is disabled in settings.";
  const projectPath = (ctx.codingProjectPath || "").trim();
  if (!projectPath)
    return "Error: coding project folder is not set in settings.";
  return (await invokeCodingGit(projectPath, { mode: "status" })).text;
};

export const handleGitDiff: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.coding)
    return "Error: git_diff tool is disabled in settings.";
  const projectPath = (ctx.codingProjectPath || "").trim();
  if (!projectPath)
    return "Error: coding project folder is not set in settings.";
  const relPath = typeof args.path === "string" ? args.path.trim() : "";
  const staged = args.staged === true;
  return (
    await invokeCodingGit(projectPath, {
      mode: "diff",
      path: relPath || undefined,
      staged,
    })
  ).text;
};

export const handleGitLog: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.coding)
    return "Error: git_log tool is disabled in settings.";
  const projectPath = (ctx.codingProjectPath || "").trim();
  if (!projectPath)
    return "Error: coding project folder is not set in settings.";
  const maxCommits =
    typeof args.max_commits === "number" && Number.isFinite(args.max_commits)
      ? Math.floor(args.max_commits)
      : undefined;
  const logPath = typeof args.path === "string" ? args.path.trim() : "";
  return (
    await invokeCodingGit(projectPath, {
      mode: "log",
      logMaxCount: maxCommits,
      logPath: logPath || undefined,
    })
  ).text;
};

export const handleGitShow: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.coding)
    return "Error: git_show tool is disabled in settings.";
  const projectPath = (ctx.codingProjectPath || "").trim();
  if (!projectPath)
    return "Error: coding project folder is not set in settings.";
  const ref =
    typeof args.ref === "string" && args.ref.trim()
      ? args.ref.trim()
      : undefined;
  const showPath = typeof args.path === "string" ? args.path.trim() : "";
  return (
    await invokeCodingGit(projectPath, {
      mode: "show",
      showRef: ref,
      showPath: showPath || undefined,
    })
  ).text;
};

export const handleCheckTypes: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.coding)
    return "Error: check_types tool is disabled in settings.";
  const projectPath = (ctx.codingProjectPath || "").trim();
  if (!projectPath)
    return "Error: coding project folder is not set in settings.";
  const pathPrefix =
    typeof args.path_prefix === "string" ? args.path_prefix.trim() : "";
  const paths = Array.isArray(args.paths)
    ? args.paths.filter(
        (p): p is string => typeof p === "string" && p.trim().length > 0,
      )
    : undefined;
  return (
    await invokeCheckCodingTypes(projectPath, {
      pathPrefix: pathPrefix || undefined,
      paths,
    })
  ).text;
};

export const handleExecuteCommand: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.coding)
    return "Error: execute_command tool is disabled in settings.";
  const projectPath = (ctx.codingProjectPath || "").trim();
  if (!projectPath)
    return "Error: coding project folder is not set in settings.";
  const command = typeof args.command === "string" ? args.command.trim() : "";
  const timeoutSec =
    typeof args.timeout_sec === "number" && Number.isFinite(args.timeout_sec)
      ? args.timeout_sec
      : undefined;
  const runInBackground = args.run_in_background === true;
  if (!command) return "Error: missing command parameter for execute_command.";
  return (
    await invokeExecuteCodingCommand(projectPath, command, {
      timeoutSec,
      runInBackground,
    })
  ).text;
};

export const handleListProcesses: ToolHandlerFn = async (_args, ctx) => {
  if (!ctx.toolsEnabled.coding)
    return "Error: list_processes tool is disabled in settings.";
  const procs = await invokeListActiveCodingProcesses();
  if (procs.length === 0) return "No active coding processes.";
  const now = Date.now();
  return procs
    .map((p) => {
      const kind = p.kind === "background" ? "bg" : "fg";
      const secs = Math.max(0, Math.round((now - p.startedAt) / 1000));
      const last = p.lastLines
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(-2)
        .join(" | ");
      const lastShown = last
        ? last.length > ACTIVE_PROCESS_LAST_MAX_CHARS
          ? `${last.slice(0, ACTIVE_PROCESS_LAST_MAX_CHARS - 1)}…`
          : last
        : "(no output yet)";
      return `- [${kind}] runId=${p.runId} pid=${p.pid || "n/a"} running ${secs}s\n  cmd: ${p.command}\n  last: ${lastShown}`;
    })
    .join("\n");
};

export const handleStopProcess: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.coding)
    return "Error: stop_process tool is disabled in settings.";
  const runId = typeof args.run_id === "string" ? args.run_id.trim() : "";
  if (!runId) return "Error: missing run_id parameter for stop_process.";
  const res = await invokeKillCodingCommand(runId);
  if (!res.ok) return `Error: ${res.error}`;
  return `Stopped process ${runId}.`;
};

export const handleReadProcessOutput: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.coding)
    return "Error: read_process_output tool is disabled in settings.";
  const runId = typeof args.run_id === "string" ? args.run_id.trim() : "";
  if (!runId) return "Error: missing run_id parameter for read_process_output.";
  const offset =
    typeof args.offset === "number" && Number.isFinite(args.offset)
      ? Math.floor(args.offset)
      : undefined;
  return (await invokeReadCodingProcessOutput(runId, offset)).text;
};

export const handleCodingExplore: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.coding)
    return "Error: coding_explore tool is disabled in settings.";
  if (!ctx.subAgent?.codingEnabled) {
    return "Error: coding sub-agent is disabled (Options → SUB → ENABLE_CODING_SUB_AGENT).";
  }
  const projectPath = (ctx.codingProjectPath || "").trim();
  if (!projectPath)
    return "Error: coding project folder is not set in settings.";
  const goal = typeof args.goal === "string" ? args.goal.trim() : "";
  if (!goal) return "Error: missing goal parameter for coding_explore.";
  const pathPrefix =
    typeof args.path_prefix === "string" ? args.path_prefix.trim() : "";
  const maxRounds =
    typeof args.max_rounds === "number" && Number.isFinite(args.max_rounds)
      ? args.max_rounds
      : undefined;
  return runCodingExplore({
    goal,
    pathPrefix: pathPrefix || undefined,
    maxRounds,
    recentFiles: ctx.codingRecentFiles,
    config: ctx.subAgent,
    keys: {
      ollamaBaseUrl: ctx.ollamaBaseUrl || "http://localhost:11434",
      openrouterBaseUrl:
        ctx.openrouterBaseUrl || "https://openrouter.ai/api/v1",
      openrouterApiKey: ctx.openrouterApiKey || "",
      deepseekBaseUrl: ctx.deepseekBaseUrl || "https://api.deepseek.com",
      deepseekApiKey: ctx.deepseekApiKey || "",
    },
    signal: ctx.signal,
    ui: ctx.subAgentUi,
    executeTool: async (toolName, toolArgs) => {
      // Dynamic import avoids circular dependency with agentToolExecutor → registry → here.
      const { executeToolCall } = await import("@/lib/agentToolExecutor");
      const { toolsEnabled, ...rest } = ctx;
      return executeToolCall(toolName, toolArgs, toolsEnabled, {
        ...rest,
        // Nested explore must stay read-only even if main agent is not in plan mode.
        agentMode: "plan",
      });
    },
  });
};

export const codingHandlersRegistry: ToolHandlerRegistry = {
  ["list_directory"]: handleListDirectory,
  ["read_file"]: handleReadFile,
  ["write_file"]: handleWriteFile,
  ["edit_code"]: handleEditCode,
  ["search_files"]: handleSearchFiles,
  ["glob_files"]: handleGlobFiles,
  ["git_status"]: handleGitStatus,
  ["git_diff"]: handleGitDiff,
  ["git_log"]: handleGitLog,
  ["git_show"]: handleGitShow,
  ["check_types"]: handleCheckTypes,
  ["execute_command"]: handleExecuteCommand,
  ["list_processes"]: handleListProcesses,
  ["stop_process"]: handleStopProcess,
  ["read_process_output"]: handleReadProcessOutput,
  ["coding_explore"]: handleCodingExplore,
};
