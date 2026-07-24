import {
  invokeRunwareEditImage,
  invokeRunwareGenerateImage,
  invokeRunwareGenerateMusic,
} from "@/lib/runware";
import {
  invokeOpenRouterEditImage,
  invokeOpenRouterGenerateImage,
} from "@/lib/openrouterImage";
import { cacheEntriesFromDescribeResults } from "@/lib/imageVisionCache";
import {
  describeImagesWithSubAgent,
  formatSubAgentResultsForAgent,
} from "@/lib/subAgent";
import { resolveImageRecallRequest } from "@/lib/toolHandlers/imageRecall";
import {
  parseImageIndexes,
  parseImagePaths,
  pickImageByOneBasedIndex,
  resolveReferenceImageIndexes,
  userRequestedCfgOverride,
  userRequestedStepsOverride,
  type ImageRecallToolResult,
} from "@/lib/toolHandlers/helpers";
import type { ToolHandlerFn, ToolHandlerRegistry } from "@/lib/toolExecTypes";

export const handleGenerateImage: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.runwareImage) {
    return "Error: generate_image tool is disabled in settings.";
  }
  if (!ctx.runware) {
    return "Error: image settings are missing.";
  }
  const prompt =
    typeof args.prompt === "string"
      ? args.prompt.trim()
      : typeof args.positivePrompt === "string"
        ? args.positivePrompt.trim()
        : "";
  if (!prompt) return "Error: missing prompt parameter for generate_image.";
  const canOverrideSteps = userRequestedStepsOverride(ctx.userText || "");
  const canOverrideCfg = userRequestedCfgOverride(ctx.userText || "");
  try {
    if (ctx.runware.imageProvider === "openrouter") {
      const or = ctx.runware.openrouter;
      if (!or) return "Error: OpenRouter image settings are missing.";
      return await invokeOpenRouterGenerateImage(
        { prompt },
        {
          apiKey: or.apiKey,
          baseUrl: or.baseUrl,
          model: or.model,
          width: ctx.runware.width,
          height: ctx.runware.height,
          gptQuality: ctx.runware.gptQuality,
          proxyBaseUrl: ctx.runware.proxyBaseUrl || ctx.ttsBaseUrl,
        },
        ctx.signal,
      );
    }
    return await invokeRunwareGenerateImage(
      {
        prompt,
        negativePrompt:
          typeof args.negative_prompt === "string"
            ? args.negative_prompt
            : typeof args.negativePrompt === "string"
              ? args.negativePrompt
              : undefined,
        width: typeof args.width === "number" ? args.width : undefined,
        height: typeof args.height === "number" ? args.height : undefined,
        steps:
          canOverrideSteps && typeof args.steps === "number"
            ? args.steps
            : undefined,
        cfgScale:
          canOverrideCfg && typeof args.cfg_scale === "number"
            ? args.cfg_scale
            : canOverrideCfg && typeof args.cfgScale === "number"
              ? args.cfgScale
              : undefined,
        model: typeof args.model === "string" ? args.model : undefined,
      },
      ctx.runware,
      ctx.signal,
    );
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

export const handleEditImageRunware: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.runwareImage) {
    return "Error: edit_image_runware tool is disabled in settings.";
  }
  if (!ctx.runware) {
    return "Error: image settings are missing.";
  }
  const prompt =
    typeof args.prompt === "string"
      ? args.prompt.trim()
      : typeof args.positivePrompt === "string"
        ? args.positivePrompt.trim()
        : "";
  if (!prompt) return "Error: missing prompt parameter for edit_image_runware.";
  const canOverrideSteps = userRequestedStepsOverride(ctx.userText || "");
  const canOverrideCfg = userRequestedCfgOverride(ctx.userText || "");
  const selected = resolveReferenceImageIndexes(args, ctx.userImagePaths);
  const indexes = selected.indexes;
  if (!indexes.length) {
    return 'Error: missing image references for edit_image_runware. Provide reference_image_indexes (e.g. "1" or "1,2") and/or reference_image_paths.';
  }
  const refs = indexes
    .map((i) => pickImageByOneBasedIndex(ctx.userImages, ctx.userImageMimes, i))
    .filter((x): x is string => typeof x === "string" && x.length > 0);
  if (!refs.length) {
    const max = ctx.userImages?.length ?? 0;
    const missing = selected.missingPaths.length
      ? ` Missing paths: ${selected.missingPaths.join(" | ")}.`
      : "";
    return `Error: no valid reference images resolved from provided indexes/paths. Available image count: ${max}.${missing}`;
  }
  try {
    if (ctx.runware.imageProvider === "openrouter") {
      const or = ctx.runware.openrouter;
      if (!or) return "Error: OpenRouter image settings are missing.";
      const editW = ctx.runware.editDefaults?.width ?? ctx.runware.width;
      const editH = ctx.runware.editDefaults?.height ?? ctx.runware.height;
      return await invokeOpenRouterEditImage(
        { prompt, referenceImages: refs },
        {
          apiKey: or.apiKey,
          baseUrl: or.baseUrl,
          model: or.model,
          width: editW,
          height: editH,
          gptQuality:
            ctx.runware.editDefaults?.gptQuality ?? ctx.runware.gptQuality,
          proxyBaseUrl: ctx.runware.proxyBaseUrl || ctx.ttsBaseUrl,
        },
        ctx.signal,
      );
    }
    return await invokeRunwareEditImage(
      {
        prompt,
        referenceImages: refs,
        negativePrompt:
          typeof args.negative_prompt === "string"
            ? args.negative_prompt
            : typeof args.negativePrompt === "string"
              ? args.negativePrompt
              : undefined,
        width: typeof args.width === "number" ? args.width : undefined,
        height: typeof args.height === "number" ? args.height : undefined,
        steps:
          canOverrideSteps && typeof args.steps === "number"
            ? args.steps
            : undefined,
        cfgScale:
          canOverrideCfg && typeof args.cfg_scale === "number"
            ? args.cfg_scale
            : canOverrideCfg && typeof args.cfgScale === "number"
              ? args.cfgScale
              : undefined,
        model: typeof args.model === "string" ? args.model : undefined,
      },
      ctx.runware,
      ctx.signal,
    );
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

export const handleImageRecall: ToolHandlerFn = async (args, ctx) => {
  const selected = resolveReferenceImageIndexes(args, ctx.userImagePaths);
  const requestedPaths = parseImagePaths(args.reference_image_paths);
  if (
    !selected.indexes.length &&
    !requestedPaths.length &&
    !parseImageIndexes(args.reference_image_indexes).length
  ) {
    return "Error: missing image references for image_recall. Provide reference_image_indexes and/or reference_image_paths.";
  }
  const recall = await resolveImageRecallRequest(args, ctx, {
    codingEnabled: ctx.toolsEnabled.coding,
  });
  if (!recall.recalled.length) {
    const max = recall.maxAvailable;
    const detail = recall.errors.length ? ` ${recall.errors.join(" ")}` : "";
    return `Error: image_recall could not resolve any requested images. Available catalog image count: ${max}.${detail}`;
  }

  // ── Sub-agent (Predlog 1): describe images via separate model ──
  const subAgentConfig = ctx.subAgent;
  const useSubAgent =
    subAgentConfig?.enabled &&
    recall.purpose !== "edit" && // edit needs actual base64
    recall.recalled.length > 0;

  if (useSubAgent) {
    const recalledForCache = recall.recalled.map((img) => ({
      base64: img.base64,
      mime: img.mime,
      path: img.path,
      index: img.index,
    }));
    const descriptions = await describeImagesWithSubAgent(
      recalledForCache,
      subAgentConfig,
      {
        ollamaBaseUrl: ctx.ollamaBaseUrl || "http://localhost:11434",
        openrouterBaseUrl:
          ctx.openrouterBaseUrl || "https://openrouter.ai/api/v1",
        openrouterApiKey: ctx.openrouterApiKey || "",
        deepseekBaseUrl: ctx.deepseekBaseUrl || "https://api.deepseek.com",
        deepseekApiKey: ctx.deepseekApiKey || "",
      },
      ctx.userText,
      ctx.signal,
      ctx.subAgentUi,
      ctx.imageVisionCache,
      recall.focus,
    );
    const newEntries = cacheEntriesFromDescribeResults(
      recalledForCache,
      descriptions,
      recall.focus,
    );
    if (Object.keys(newEntries).length > 0) {
      ctx.onImageVisionCacheUpdate?.(newEntries);
    }
    const formatted = formatSubAgentResultsForAgent(descriptions);
    const hasCatalog = recall.recalled.some(
      (x) => x.recallSource === "catalog",
    );
    const hasProject = recall.recalled.some(
      (x) => x.recallSource === "project_file",
    );
    const source: ImageRecallToolResult["source"] =
      hasCatalog && hasProject
        ? "mixed"
        : hasProject
          ? "project_file"
          : "internal_catalog";
    const payload: ImageRecallToolResult = {
      ok: true,
      source,
      purpose: recall.purpose,
      recalled_images: recall.recalled.map((x) => ({
        index: x.index,
        mime: x.mime,
        path: x.path,
        source: x.recallSource,
      })),
      ...(recall.errors.length > 0 ? { errors: recall.errors } : {}),
    };
    const subNote = formatted
      ? `\n\n${formatted}`
      : "\n\n[Sub-agent returned no descriptions.]";
    return JSON.stringify(payload) + subNote;
  }

  // ── Standard path: return metadata (base64 handled by collectRecalledImages) ──
  const hasCatalog = recall.recalled.some((x) => x.recallSource === "catalog");
  const hasProject = recall.recalled.some(
    (x) => x.recallSource === "project_file",
  );
  const source: ImageRecallToolResult["source"] =
    hasCatalog && hasProject
      ? "mixed"
      : hasProject
        ? "project_file"
        : "internal_catalog";
  const payload: ImageRecallToolResult = {
    ok: true,
    source,
    purpose: recall.purpose,
    recalled_images: recall.recalled.map((x) => ({
      index: x.index,
      mime: x.mime,
      path: x.path,
      source: x.recallSource,
    })),
    ...(recall.errors.length > 0 ? { errors: recall.errors } : {}),
  };
  return JSON.stringify(payload);
};

export const handleGenerateMusicRunware: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.runwareMusic) {
    return "Error: generate_music_runware tool is disabled in settings.";
  }
  if (!ctx.runware) {
    return "Error: Runware settings are missing.";
  }
  const prompt =
    typeof args.prompt === "string"
      ? args.prompt.trim()
      : typeof args.positivePrompt === "string"
        ? args.positivePrompt.trim()
        : "";
  if (!prompt)
    return "Error: missing prompt parameter for generate_music_runware.";
  try {
    // Audio engine tuning (steps, cfg_scale, output_format, seed, guidance_type) is intentionally
    // sourced from settings only; any values the model attempts to send in tool args are ignored.
    return await invokeRunwareGenerateMusic(
      {
        prompt,
        negativePrompt:
          typeof args.negative_prompt === "string"
            ? args.negative_prompt
            : typeof args.negativePrompt === "string"
              ? args.negativePrompt
              : undefined,
        lyrics: typeof args.lyrics === "string" ? args.lyrics : undefined,
        durationSec:
          typeof args.duration_sec === "number"
            ? args.duration_sec
            : typeof args.durationSec === "number"
              ? args.durationSec
              : undefined,
        bpm: typeof args.bpm === "number" ? args.bpm : undefined,
        keyScale:
          typeof args.key_scale === "string"
            ? args.key_scale
            : typeof args.keyScale === "string"
              ? args.keyScale
              : undefined,
        vocalLanguage:
          typeof args.vocal_language === "string"
            ? args.vocal_language
            : typeof args.vocalLanguage === "string"
              ? args.vocalLanguage
              : undefined,
      },
      ctx.runware,
      ctx.signal,
    );
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

export const mediaHandlersRegistry: ToolHandlerRegistry = {
  ["generate_image"]: handleGenerateImage,
  ["edit_image_runware"]: handleEditImageRunware,
  ["image_recall"]: handleImageRecall,
  ["generate_music_runware"]: handleGenerateMusicRunware,
};
