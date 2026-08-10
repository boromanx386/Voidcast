import {
  invokeExecuteCodingCommand,
  invokeEditCodingFile,
  invokeCodingGit,
  invokeCheckCodingTypes,
  invokeGlobCodingFiles,
  invokeFindSymbols,
  invokeKillCodingCommand,
  invokeListActiveCodingProcesses,
  invokeListCodingDirectory,
  invokeReadCodingFile,
  invokeReadCodingProcessOutput,
  invokeSearchCodingFiles,
  invokeWriteCodingFile,
} from "@/lib/codingTools";
import { runCodingExplore } from "@/lib/codingSubAgent";
import {
  parseCodingWorkerTasks,
  runCodingWorkers,
} from "@/lib/codingWorkers";
import type { ToolHandlerFn, ToolHandlerRegistry } from "@/lib/toolExecTypes";
import {
  ACTIVE_PROCESS_LAST_MAX_CHARS,
  canControlCodingProcess,
  filterProcessesForAgent,
} from "@/lib/codingActiveProcesses";
import {
  formatSoftDeniedReadResult,
  normalizeCodingReadPath,
  shouldSoftDenyFullRead,
} from "@/lib/codingReadGuard";

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
  const force = args.force === true;
  const digests = ctx.codingContextMemoRef?.current.recentFileDigests ?? [];
  const cachedPaths =
    ctx.codingFileCacheRef?.current.entries.map((e) => e.path) ?? [];
  if (
    shouldSoftDenyFullRead({
      path: relativePath,
      startLine,
      endLine,
      force,
      digests,
      cachedPaths,
    })
  ) {
    const norm = normalizeCodingReadPath(relativePath);
    const dig =
      digests.find((d) => normalizeCodingReadPath(d.path) === norm)?.digest ??
      "";
    return formatSoftDeniedReadResult(relativePath, dig);
  }
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

export const handleFindSymbols: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.coding)
    return "Error: find_symbols tool is disabled in settings.";
  const projectPath = (ctx.codingProjectPath || "").trim();
  if (!projectPath)
    return "Error: coding project folder is not set in settings.";
  const path = typeof args.path === "string" ? args.path.trim() : "";
  if (!path) return "Error: find_symbols requires a 'path' argument.";
  const query =
    typeof args.query === "string" && args.query.trim() ? args.query.trim() : undefined;
  const maxSymbols =
    typeof args.max_symbols === "number" && Number.isFinite(args.max_symbols)
      ? args.max_symbols
      : undefined;
  return (
    await invokeFindSymbols(projectPath, {
      path,
      query,
      maxSymbols,
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

export const handleGitRestore: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.coding)
    return "Error: git_restore tool is disabled in settings.";
  const projectPath = (ctx.codingProjectPath || "").trim();
  if (!projectPath)
    return "Error: coding project folder is not set in settings.";
  const relPath = typeof args.path === "string" ? args.path.trim() : "";
  if (!relPath) return "Error: path is required for git_restore.";
  const toHead = args.to_head === true;
  return (
    await invokeCodingGit(projectPath, {
      mode: "discard",
      path: relPath,
      toHead,
    })
  ).text;
};

export const handleGitStash: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.coding)
    return "Error: git_stash tool is disabled in settings.";
  const projectPath = (ctx.codingProjectPath || "").trim();
  if (!projectPath)
    return "Error: coding project folder is not set in settings.";
  const actionRaw =
    typeof args.action === "string" ? args.action.trim().toLowerCase() : "list";
  const action =
    actionRaw === "push" || actionRaw === "pop" || actionRaw === "list"
      ? actionRaw
      : null;
  if (!action) {
    return "Error: git_stash action must be one of: list, push, pop.";
  }
  if (action === "list") {
    return (await invokeCodingGit(projectPath, { mode: "stashList" })).text;
  }
  if (action === "push") {
    const message =
      typeof args.message === "string" ? args.message.trim() : undefined;
    const relPath = typeof args.path === "string" ? args.path.trim() : "";
    const includeUntracked = args.include_untracked === true;
    return (
      await invokeCodingGit(projectPath, {
        mode: "stashPush",
        message,
        path: relPath || undefined,
        includeUntracked,
      })
    ).text;
  }
  const stashRef =
    typeof args.stash_ref === "string" ? args.stash_ref.trim() : undefined;
  return (
    await invokeCodingGit(projectPath, {
      mode: "stashPop",
      stashRef,
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
      ownerId: (ctx.mcpOwnerId || "").trim() || undefined,
    })
  ).text;
};

export const handleListProcesses: ToolHandlerFn = async (_args, ctx) => {
  if (!ctx.toolsEnabled.coding)
    return "Error: list_processes tool is disabled in settings.";
  const all = await invokeListActiveCodingProcesses();
  const procs = filterProcessesForAgent(all, {
    ownerId: ctx.mcpOwnerId,
    projectPath: ctx.codingProjectPath,
  });
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
  const all = await invokeListActiveCodingProcesses();
  const target = all.find((p) => p.runId === runId);
  if (!target) return `Error: no active process for runId ${runId}.`;
  if (
    !canControlCodingProcess(target, {
      ownerId: ctx.mcpOwnerId,
      projectPath: ctx.codingProjectPath,
    })
  ) {
    return `Error: process ${runId} belongs to another chat/project. Stop is not allowed.`;
  }
  const res = await invokeKillCodingCommand(runId);
  if (!res.ok) return `Error: ${res.error}`;
  return `Stopped process ${runId}.`;
};

export const handleReadProcessOutput: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.coding)
    return "Error: read_process_output tool is disabled in settings.";
  const runId = typeof args.run_id === "string" ? args.run_id.trim() : "";
  if (!runId) return "Error: missing run_id parameter for read_process_output.";
  const all = await invokeListActiveCodingProcesses();
  const target = all.find((p) => p.runId === runId);
  if (
    target &&
    !canControlCodingProcess(target, {
      ownerId: ctx.mcpOwnerId,
      projectPath: ctx.codingProjectPath,
    })
  ) {
    return `Error: process ${runId} belongs to another chat/project.`;
  }
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
      openaiBaseUrl: ctx.openaiBaseUrl || "https://api.openai.com/v1",
      openaiApiKey: ctx.openaiApiKey || "",
      nvidiaBaseUrl: ctx.nvidiaBaseUrl || "https://integrate.api.nvidia.com/v1",
      nvidiaApiKey: ctx.nvidiaApiKey || "",
      opencodeGoApiKey: ctx.opencodeGoApiKey || "",
      ttsBaseUrl: ctx.ttsBaseUrl,
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
        codingWorkerDepth: (ctx.codingWorkerDepth ?? 0) + 1,
      });
    },
  });
};

export const handleRunCodingWorkers: ToolHandlerFn = async (args, ctx) => {
  if ((ctx.codingWorkerDepth ?? 0) > 0) {
    return "Error: run_coding_workers cannot be nested inside a coding worker.";
  }
  if (ctx.agentMode === "plan" || ctx.agentMode === "ask") {
    return "Error: run_coding_workers is not available in Plan or Ask mode (read-only).";
  }
  if (ctx.agentMode !== "agent" && ctx.agentMode !== "team") {
    return "Error: run_coding_workers requires Agent or Team mode.";
  }
  if (!ctx.toolsEnabled.coding)
    return "Error: coding tools are disabled in settings.";
  if (!ctx.subAgent?.codingEnabled) {
    return "Error: coding sub-agent is disabled (Options → SUB → ENABLE_CODING_SUB_AGENT).";
  }
  const projectPath = (ctx.codingProjectPath || "").trim();
  if (!projectPath)
    return "Error: coding project folder is not set in settings.";

  const parsed = parseCodingWorkerTasks(args);
  if (!parsed.ok) return parsed.error;

  return runCodingWorkers({
    tasks: parsed.tasks,
    recentFiles: ctx.codingRecentFiles,
    config: ctx.subAgent,
    keys: {
      ollamaBaseUrl: ctx.ollamaBaseUrl || "http://localhost:11434",
      openrouterBaseUrl:
        ctx.openrouterBaseUrl || "https://openrouter.ai/api/v1",
      openrouterApiKey: ctx.openrouterApiKey || "",
      deepseekBaseUrl: ctx.deepseekBaseUrl || "https://api.deepseek.com",
      deepseekApiKey: ctx.deepseekApiKey || "",
      openaiBaseUrl: ctx.openaiBaseUrl || "https://api.openai.com/v1",
      openaiApiKey: ctx.openaiApiKey || "",
      nvidiaBaseUrl: ctx.nvidiaBaseUrl || "https://integrate.api.nvidia.com/v1",
      nvidiaApiKey: ctx.nvidiaApiKey || "",
      opencodeGoApiKey: ctx.opencodeGoApiKey || "",
      ttsBaseUrl: ctx.ttsBaseUrl,
    },
    signal: ctx.signal,
    ui: ctx.subAgentUi,
    executeTool: async (toolName, toolArgs) => {
      const { executeToolCall } = await import("@/lib/agentToolExecutor");
      const { toolsEnabled, ...rest } = ctx;
      return executeToolCall(toolName, toolArgs, toolsEnabled, {
        ...rest,
        // Workers run as agent (writable), not plan, at depth ≥ 1.
        agentMode: "agent",
        codingWorkerDepth: (ctx.codingWorkerDepth ?? 0) + 1,
      });
    },
    codingContextMemoRef: ctx.codingContextMemoRef,
    codingFileCacheRef: ctx.codingFileCacheRef,
    codingProjectPath: ctx.codingProjectPath,
  });
};

export const codingHandlersRegistry: ToolHandlerRegistry = {
  ["list_directory"]: handleListDirectory,
  ["read_file"]: handleReadFile,
  ["write_file"]: handleWriteFile,
  ["edit_code"]: handleEditCode,
  ["search_files"]: handleSearchFiles,
  ["glob_files"]: handleGlobFiles,
  ["find_symbols"]: handleFindSymbols,
  ["git_status"]: handleGitStatus,
  ["git_diff"]: handleGitDiff,
  ["git_log"]: handleGitLog,
  ["git_show"]: handleGitShow,
  ["git_restore"]: handleGitRestore,
  ["git_stash"]: handleGitStash,
  ["check_types"]: handleCheckTypes,
  ["execute_command"]: handleExecuteCommand,
  ["list_processes"]: handleListProcesses,
  ["stop_process"]: handleStopProcess,
  ["read_process_output"]: handleReadProcessOutput,
  ["coding_explore"]: handleCodingExplore,
  ["run_coding_workers"]: handleRunCodingWorkers,
};
