import {
  loadProjectImageRecalls,
  resolveInsideCodingProject,
} from "@/lib/imageProjectRecall";
import {
  normalizePathForMatch,
  resolveCatalogImageByOneBasedIndex,
  resolveReferenceImageIndexes,
  type ResolvedRecallImage,
} from "@/lib/toolHandlers/helpers";

export async function resolveImageRecallRequest(
  args: Record<string, unknown>,
  ctx: {
    userImages?: string[];
    userImageMimes?: string[];
    userImagePaths?: string[];
    codingProjectPath?: string;
  },
  options?: { codingEnabled?: boolean },
): Promise<{
  purpose?: "vision" | "edit";
  focus?: string;
  recalled: ResolvedRecallImage[];
  errors: string[];
  maxAvailable: number;
}> {
  const selected = resolveReferenceImageIndexes(args, ctx.userImagePaths);
  const indexes = selected.indexes;
  const purposeRaw =
    typeof args.purpose === "string" ? args.purpose.trim().toLowerCase() : "";
  const purpose: "vision" | "edit" | undefined =
    purposeRaw === "vision"
      ? "vision"
      : purposeRaw === "edit"
        ? "edit"
        : undefined;
  const focusRaw = typeof args.focus === "string" ? args.focus.trim() : "";
  const focus = focusRaw || undefined;
  const recalled: ResolvedRecallImage[] = [];
  const errors: string[] = [];
  for (const p of selected.missingPaths) {
    errors.push(`path not found in catalog: ${p}`);
  }
  for (const idx of indexes) {
    const hit = resolveCatalogImageByOneBasedIndex(
      ctx.userImages,
      ctx.userImageMimes,
      ctx.userImagePaths,
      idx,
    );
    if (!hit) {
      errors.push(`index ${idx}: not found or not convertible to base64`);
      continue;
    }
    recalled.push({ ...hit, recallSource: "catalog" });
  }
  const projectRoot = (ctx.codingProjectPath || "").trim();
  if (
    options?.codingEnabled &&
    projectRoot &&
    selected.missingPaths.length > 0
  ) {
    const project = await loadProjectImageRecalls(
      projectRoot,
      selected.missingPaths,
    );
    const loadedAbs = project.recalled.map((x) =>
      normalizePathForMatch(x.path),
    );
    for (let i = errors.length - 1; i >= 0; i--) {
      const m = errors[i]?.match(/^path not found in catalog: (.+)$/);
      if (!m) continue;
      const req = (m[1] || "").trim();
      const reqNorm = normalizePathForMatch(req);
      const resolved = resolveInsideCodingProject(projectRoot, req);
      const resolvedNorm = resolved ? normalizePathForMatch(resolved) : "";
      if (
        loadedAbs.some(
          (abs) => abs === reqNorm || (resolvedNorm && abs === resolvedNorm),
        )
      ) {
        errors.splice(i, 1);
      }
    }
    for (const err of project.errors) errors.push(err);
    for (const img of project.recalled) {
      recalled.push({
        index: img.index,
        mime: img.mime,
        base64: img.base64,
        path: img.path,
        recallSource: "project_file",
      });
    }
  }
  return {
    purpose,
    focus,
    recalled,
    errors,
    maxAvailable: ctx.userImages?.length ?? 0,
  };
}
