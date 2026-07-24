import { readAgentSkillBody } from "@/lib/agentSkills";
import { formatPlanProgressToolResult } from "@/lib/planArtifact";
import {
  loadSettings,
  normalizeSettingsCandidate,
  saveSettings,
  type AppSettings,
  type AgentEditableSettingsField,
  type UiTheme,
} from "@/lib/settings";
import { upsertMemories } from "@/lib/longMemoryStorage";
import {
  addReminder,
  listReminders,
  deleteReminder,
  updateReminder,
  searchRemindersByText,
} from "@/lib/reminderStorage";
import { recordReminderDeleted } from "@/lib/userDataSync";
import {
  AGENT_EDITABLE_SETTINGS_FIELD_SET,
  CONFIGURED_RUNWARE_MODEL_IDS,
  UI_THEME_SET,
  parseLongMemoryCandidate,
  parseResolutionPair,
  parseToolValueAsNumber,
  parseToolValueAsString,
} from "@/lib/toolHandlers/helpers";
import type { ToolHandlerFn, ToolHandlerRegistry } from "@/lib/toolExecTypes";

export const handleEnterPlanMode: ToolHandlerFn = async (args, ctx) => {
  return "Switching to Plan mode.";
};

export const handleUpdatePlanProgress: ToolHandlerFn = async (args, ctx) => {
  return formatPlanProgressToolResult(ctx.getActiveBuildPlan?.(), args);
};

export const handleReadSkill: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.skillsEnabled) {
    return "Error: read_skill tool is disabled in settings.";
  }
  const skillName = typeof args.name === "string" ? args.name.trim() : "";
  if (!skillName) return "Error: missing name parameter for read_skill.";
  const res = await readAgentSkillBody(skillName, ctx.codingProjectPath);
  if (!res.ok) return `Error: ${res.error}`;
  return `Skill "${res.name}" instructions:\n\n${res.content}`;
};

export const handleUpdateSettings: ToolHandlerFn = async (args, ctx) => {
  const fieldRaw = parseToolValueAsString(args.field).trim();
  const valueRaw = args.value;
  if (!fieldRaw) return "Error: missing field parameter for update_settings.";
  if (!AGENT_EDITABLE_SETTINGS_FIELD_SET.has(fieldRaw)) {
    return `Error: field "${fieldRaw}" is not editable by update_settings.`;
  }
  const field = fieldRaw as AgentEditableSettingsField;
  const current = loadSettings();
  const candidate: AppSettings = { ...current };
  const updateActiveRunwareProfile = (patch: {
    width?: number;
    height?: number;
  }) => {
    const activeModelId = candidate.runwareImageModel;
    const currentProfile = candidate.runwareModelProfiles[activeModelId] ?? {
      width: candidate.runwareWidth,
      height: candidate.runwareHeight,
      steps: candidate.runwareSteps,
      cfgScale: candidate.runwareCfgScale,
    };
    candidate.runwareModelProfiles = {
      ...candidate.runwareModelProfiles,
      [activeModelId]: {
        ...currentProfile,
        ...(typeof patch.width === "number"
          ? { width: Math.round(patch.width) }
          : {}),
        ...(typeof patch.height === "number"
          ? { height: Math.round(patch.height) }
          : {}),
      },
    };
    if (typeof patch.width === "number")
      candidate.runwareWidth = Math.round(patch.width);
    if (typeof patch.height === "number")
      candidate.runwareHeight = Math.round(patch.height);
  };
  if (field === "llmSystemPrompt") {
    const next = parseToolValueAsString(valueRaw);
    candidate.llmSystemPrompt = next;
  } else if (field === "llmNumCtx") {
    const n = parseToolValueAsNumber(valueRaw);
    if (n === null) return "Error: llmNumCtx expects a numeric value.";
    candidate.llmNumCtx = Math.round(n);
  } else if (field === "llmTemperature") {
    const n = parseToolValueAsNumber(valueRaw);
    if (n === null) return "Error: llmTemperature expects a numeric value.";
    candidate.llmTemperature = n;
  } else if (field === "uiTheme") {
    const next = parseToolValueAsString(valueRaw)
      .trim()
      .toLowerCase() as UiTheme;
    if (!UI_THEME_SET.has(next)) {
      return "Error: uiTheme must be one of: dystopian, minimal, matrix, light, blood-moon, obsidian.";
    }
    candidate.uiTheme = next;
  } else if (field === "longMemoryAdd") {
    const parsed = parseLongMemoryCandidate(valueRaw);
    if (!parsed) {
      return 'Error: longMemoryAdd expects plain text or JSON with at least {"text":"..."}';
    }
    try {
      const saved = await upsertMemories(
        [
          {
            kind: parsed.kind,
            text: parsed.text,
            importance: parsed.importance,
            confidence: parsed.confidence,
            tags: parsed.tags,
          },
        ],
        "agent-tool",
      );
      if (saved.length === 0) {
        return "Error: long memory entry was empty and was not saved.";
      }
      return `OK: added long memory (${saved[0].kind}): ${saved[0].text}`;
    } catch (e) {
      return e instanceof Error
        ? `Error: failed to add long memory: ${e.message}`
        : String(e);
    }
  } else if (field === "autoVoice") {
    const next = parseToolValueAsString(valueRaw).trim().toLowerCase();
    if (next === "true" || next === "1" || next === "yes" || next === "on") {
      candidate.autoVoice = true;
    } else if (
      next === "false" ||
      next === "0" ||
      next === "no" ||
      next === "off"
    ) {
      candidate.autoVoice = false;
    } else {
      return "Error: autoVoice expects a boolean value (true/false, on/off, yes/no, 1/0).";
    }
  } else if (field === "runwareResolution") {
    const pair = parseResolutionPair(valueRaw);
    if (!pair) {
      return 'Error: runwareResolution expects "WIDTHxHEIGHT" (for example 1920x1080).';
    }
    updateActiveRunwareProfile(pair);
  } else if (field === "runwareWidth") {
    const n = parseToolValueAsNumber(valueRaw);
    if (n === null) return "Error: runwareWidth expects a numeric value.";
    updateActiveRunwareProfile({ width: n });
  } else if (field === "runwareHeight") {
    const n = parseToolValueAsNumber(valueRaw);
    if (n === null) return "Error: runwareHeight expects a numeric value.";
    updateActiveRunwareProfile({ height: n });
  } else if (field === "runwareImageModel") {
    const next = parseToolValueAsString(valueRaw).trim();
    if (!next) return "Error: runwareImageModel cannot be empty.";
    if (!CONFIGURED_RUNWARE_MODEL_IDS.has(next)) {
      return `Error: unsupported runwareImageModel "${next}".`;
    }
    candidate.runwareImageModel = next;
  } else if (field === "runwareEditModel") {
    const next = parseToolValueAsString(valueRaw).trim();
    if (!next) return "Error: runwareEditModel cannot be empty.";
    if (!CONFIGURED_RUNWARE_MODEL_IDS.has(next)) {
      return `Error: unsupported runwareEditModel "${next}".`;
    }
    candidate.runwareEditModel = next;
  } else {
    return `Error: unsupported field "${fieldRaw}".`;
  }
  const normalized = normalizeSettingsCandidate(candidate);
  saveSettings(normalized);
  if (field === "runwareResolution") {
    return `OK: updated runwareResolution to ${normalized.runwareWidth}x${normalized.runwareHeight}.`;
  }
  const applied = normalized[field];
  return `OK: updated ${field} to ${String(applied)}.`;
};

export const handleAddReminder: ToolHandlerFn = async (args, ctx) => {
  const text = parseToolValueAsString(args.text).trim();
  if (!text) return "Error: missing text parameter for add_reminder.";
  const whenRaw = parseToolValueAsString(args.when).trim();
  let when: number | null = null;
  if (whenRaw) {
    const parsed = new Date(whenRaw).getTime();
    if (Number.isNaN(parsed)) {
      return "Error: when must be a valid ISO datetime (e.g. 2026-05-10T09:00).";
    }
    when = parsed;
  }
  const tagsRaw = Array.isArray(args.tags) ? args.tags : [];
  const tags = tagsRaw
    .map((x) => parseToolValueAsString(x).trim())
    .filter(Boolean);
  try {
    const item = await addReminder({
      text,
      when: when ?? undefined,
      tags,
      source: "agent-tool",
    });
    if (item.when != null) {
      const dateStr = new Date(item.when).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      return `OK: reminder set for ${dateStr} — "${item.text}".`;
    }
    return `OK: reminder added — "${item.text}".`;
  } catch (e) {
    return e instanceof Error
      ? `Error: failed to add reminder: ${e.message}`
      : String(e);
  }
};

export const handleListReminders: ToolHandlerFn = async (args, ctx) => {
  const fromRaw = parseToolValueAsString(args.from).trim();
  const toRaw = parseToolValueAsString(args.to).trim();
  const includeGeneral = args.include_general !== false;
  let fromMs: number | undefined;
  let toMs: number | undefined;
  if (fromRaw) {
    const d = new Date(fromRaw);
    if (Number.isNaN(d.getTime())) {
      return "Error: from must be a valid date (e.g. 2026-05-10 or today).";
    }
    fromMs = d.setHours(0, 0, 0, 0);
  }
  if (toRaw) {
    const d = new Date(toRaw);
    if (Number.isNaN(d.getTime())) {
      return "Error: to must be a valid date (e.g. 2026-05-10 or tomorrow).";
    }
    toMs = d.setHours(23, 59, 59, 999);
  } else if (fromMs != null) {
    toMs = new Date(fromMs).setHours(23, 59, 59, 999);
  }
  try {
    const items = await listReminders({
      from: fromMs,
      to: toMs,
      includeGeneral,
    });
    if (items.length === 0) {
      return "No reminders found for that period.";
    }
    const lines = items.map((r) => {
      const time =
        r.when != null
          ? new Date(r.when).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "General";
      const tags = r.tags.length ? ` [${r.tags.join(", ")}]` : "";
      return `• ${time} — "${r.text}"${tags}`;
    });
    return `Reminders:\n${lines.join("\n")}`;
  } catch (e) {
    return e instanceof Error
      ? `Error: failed to list reminders: ${e.message}`
      : String(e);
  }
};

export const handleDeleteReminder: ToolHandlerFn = async (args, ctx) => {
  const searchText = parseToolValueAsString(args.search_text).trim();
  if (!searchText)
    return "Error: missing search_text parameter for delete_reminder.";
  try {
    const matches = await searchRemindersByText(searchText);
    if (matches.length === 0) {
      return `Error: no reminder found matching "${searchText}".`;
    }
    const target = matches[0];
    await deleteReminder(target.id);
    recordReminderDeleted(target.id);
    return `OK: deleted reminder — "${target.text}".`;
  } catch (e) {
    return e instanceof Error
      ? `Error: failed to delete reminder: ${e.message}`
      : String(e);
  }
};

export const handleUpdateReminder: ToolHandlerFn = async (args, ctx) => {
  const searchText = parseToolValueAsString(args.search_text).trim();
  if (!searchText)
    return "Error: missing search_text parameter for update_reminder.";
  const newTextRaw = parseToolValueAsString(args.text).trim();
  const whenRaw = parseToolValueAsString(args.when).trim();
  const tagsRaw = Array.isArray(args.tags) ? args.tags : [];
  try {
    const matches = await searchRemindersByText(searchText);
    if (matches.length === 0) {
      return `Error: no reminder found matching "${searchText}".`;
    }
    const target = matches[0];
    const patch: Parameters<typeof updateReminder>[1] = {};
    if (newTextRaw) patch.text = newTextRaw;
    if (whenRaw === "") {
      patch.when = null;
    } else if (whenRaw) {
      const parsed = new Date(whenRaw).getTime();
      if (Number.isNaN(parsed)) {
        return "Error: when must be a valid ISO datetime (e.g. 2026-05-10T09:00) or empty string to remove time.";
      }
      patch.when = parsed;
    }
    if (tagsRaw.length > 0) {
      patch.tags = tagsRaw
        .map((x) => parseToolValueAsString(x).trim())
        .filter(Boolean);
    }
    const updated = await updateReminder(target.id, patch);
    if (!updated) return "Error: reminder was not found during update.";
    const timeStr =
      updated.when != null
        ? new Date(updated.when).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "General";
    return `OK: updated reminder — "${updated.text}" (${timeStr}).`;
  } catch (e) {
    return e instanceof Error
      ? `Error: failed to update reminder: ${e.message}`
      : String(e);
  }
};

export const appHandlersRegistry: ToolHandlerRegistry = {
  ["enter_plan_mode"]: handleEnterPlanMode,
  ["update_plan_progress"]: handleUpdatePlanProgress,
  ["read_skill"]: handleReadSkill,
  ["update_settings"]: handleUpdateSettings,
  ["add_reminder"]: handleAddReminder,
  ["list_reminders"]: handleListReminders,
  ["delete_reminder"]: handleDeleteReminder,
  ["update_reminder"]: handleUpdateReminder,
};
