import {
  AGENT_EDITABLE_SETTINGS_FIELDS,
  RUNWARE_CONFIGURED_MODELS,
  type UiTheme,
} from "@/lib/settings";
import type { LongMemoryKind } from "@/types/longMemory";

/** Pick chat images for save_pdf — uses `attached_image_indices` when set; else `embed_attached_images` for all. */
export function resolvePdfAttachedImages(
  args: Record<string, unknown>,
  ctx: { userImages?: string[]; userImageMimes?: string[] },
): { base64: string; mime: string }[] {
  const b64 = ctx.userImages ?? [];
  const mimes = ctx.userImageMimes ?? [];
  const rawIdx = args.attached_image_indices;
  const embedAll = args.embed_attached_images === true;

  const toIndex = (x: unknown): number | null => {
    if (typeof x === "number" && Number.isFinite(x)) return Math.trunc(x);
    if (typeof x === "string" && /^-?\d+$/.test(x.trim()))
      return parseInt(x.trim(), 10);
    return null;
  };

  let idxs: number[] = [];
  if (Array.isArray(rawIdx) && rawIdx.length > 0) {
    for (const x of rawIdx) {
      const n = toIndex(x);
      if (n !== null && n >= 0 && n < b64.length) idxs.push(n);
    }
    idxs = [...new Set(idxs)].sort((a, b) => a - b);
  } else if (embedAll) {
    idxs = b64.map((_, i) => i);
  }

  return idxs.map((i) => ({
    base64: b64[i]!,
    mime:
      typeof mimes[i] === "string" && (mimes[i] as string).trim()
        ? (mimes[i] as string).trim()
        : "image/png",
  }));
}

/**
 * Parse `image_urls` from save_pdf args. Accepts a single string, array of
 * strings, or comma-separated list. Only public http(s) URLs are forwarded —
 * the Python server enforces SSRF + size limits before fetching.
 */
export function resolvePdfImageUrls(args: Record<string, unknown>): string[] {
  const raw = args.image_urls ?? args.imageUrls;
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v !== "string") return;
    const s = v.trim();
    if (/^https?:\/\//i.test(s)) out.push(s);
  };
  if (Array.isArray(raw)) {
    for (const item of raw) push(item);
  } else if (typeof raw === "string") {
    for (const part of raw.split(/[\s,]+/)) push(part);
  }
  return [...new Set(out)];
}

/** Local paths from image_paths, generated_image_indexes, or mistaken image_urls entries. */
export function resolvePdfImagePaths(
  args: Record<string, unknown>,
  ctx: {
    userImages?: string[];
    userImageMimes?: string[];
    userImagePaths?: string[];
  },
): { paths: string[]; extraImages: { base64: string; mime: string }[] } {
  const paths: string[] = [];
  const extraImages: { base64: string; mime: string }[] = [];

  const pushPath = (p: string) => {
    const s = p.trim();
    if (!s || /^https?:\/\//i.test(s)) return;
    paths.push(s);
  };

  for (const p of parseImagePaths(args.image_paths ?? args.imagePaths)) {
    pushPath(p);
  }

  const indexes = parseImageIndexes(
    args.generated_image_indexes ?? args.generatedImageIndexes,
  );
  for (const idx of indexes) {
    const path = (ctx.userImagePaths?.[idx - 1] || "").trim();
    if (path) {
      pushPath(path);
      continue;
    }
    const raw = (ctx.userImages?.[idx - 1] || "").trim();
    if (!raw) continue;
    const mimeRaw = (ctx.userImageMimes?.[idx - 1] || "image/png")
      .trim()
      .toLowerCase();
    const mime = /^image\/[a-z0-9.+-]+$/.test(mimeRaw) ? mimeRaw : "image/png";
    const base64 = raw.startsWith("data:image/")
      ? raw
          .replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "")
          .replace(/\s+/g, "")
      : raw.replace(/\s+/g, "");
    if (base64) extraImages.push({ base64, mime });
  }

  const rawUrls = args.image_urls ?? args.imageUrls;
  const pushMaybePath = (v: unknown) => {
    if (typeof v !== "string") return;
    const s = v.trim();
    if (!s || /^https?:\/\//i.test(s)) return;
    if (/^[a-zA-Z]:\\/.test(s) || s.startsWith("\\\\") || s.startsWith("/")) {
      pushPath(s);
    }
  };
  if (Array.isArray(rawUrls)) {
    for (const item of rawUrls) pushMaybePath(item);
  } else if (typeof rawUrls === "string") {
    for (const part of rawUrls.split(/[\n,]+/)) pushMaybePath(part);
  }

  return {
    paths: [...new Set(paths)],
    extraImages,
  };
}

export const AGENT_EDITABLE_SETTINGS_FIELD_SET = new Set<string>(
  AGENT_EDITABLE_SETTINGS_FIELDS,
);
export const CONFIGURED_RUNWARE_MODEL_IDS = new Set<string>(
  RUNWARE_CONFIGURED_MODELS.map((x) => x.id),
);
export const UI_THEME_SET = new Set<UiTheme>([
  "dystopian",
  "minimal",
  "matrix",
  "light",
  "blood-moon",
  "obsidian",
]);
const LONG_MEMORY_KIND_SET = new Set<LongMemoryKind>([
  "preference",
  "project",
  "fact",
  "constraint",
  "task",
]);

export function parseToolValueAsString(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return "";
}

export function parseToolValueAsNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number(raw.trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function parseResolutionPair(
  raw: unknown,
): { width: number; height: number } | null {
  const s = parseToolValueAsString(raw).trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(\d{2,5})\s*[x,]\s*(\d{2,5})$/);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width: Math.round(width), height: Math.round(height) };
}

export function parseLongMemoryCandidate(raw: unknown): {
  text: string;
  kind: LongMemoryKind;
  importance?: number;
  confidence?: number;
  tags?: string[];
} | null {
  const textValue = parseToolValueAsString(raw).trim();
  if (!textValue) return null;
  if (textValue.startsWith("{") && textValue.endsWith("}")) {
    try {
      const obj = JSON.parse(textValue) as Record<string, unknown>;
      const text = parseToolValueAsString(obj.text).trim();
      if (!text) return null;
      const kindRaw = parseToolValueAsString(obj.kind)
        .trim()
        .toLowerCase() as LongMemoryKind;
      const kind: LongMemoryKind = LONG_MEMORY_KIND_SET.has(kindRaw)
        ? kindRaw
        : "fact";
      const importance = parseToolValueAsNumber(obj.importance) ?? undefined;
      const confidence = parseToolValueAsNumber(obj.confidence) ?? undefined;
      const tagsRaw = Array.isArray(obj.tags) ? obj.tags : [];
      const tags = tagsRaw
        .map((x) => parseToolValueAsString(x).trim())
        .filter(Boolean);
      return {
        text,
        kind,
        importance,
        confidence,
        tags: tags.length ? tags : undefined,
      };
    } catch {
      return null;
    }
  }
  return { text: textValue, kind: "fact" };
}

export function userRequestedStepsOverride(text: string): boolean {
  const t = (text || "").toLowerCase();
  if (!t.trim()) return false;
  return /\b(step|steps|korak|koraka)\b/.test(t);
}

export function userRequestedCfgOverride(text: string): boolean {
  const t = (text || "").toLowerCase();
  if (!t.trim()) return false;
  return /\b(cfg|cfg[_\s-]?scale|guidance|guidance[_\s-]?scale)\b/.test(t);
}

export function parseImageIndexes(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw
      .map((x) => (typeof x === "number" ? x : Number(String(x).trim())))
      .filter((n) => Number.isFinite(n))
      .map((n) => Math.round(n))
      .filter((n) => n > 0);
  }
  if (typeof raw !== "string") return [];
  return raw
    .split(/[,\s]+/)
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.round(n))
    .filter((n) => n > 0);
}

export function parseImagePaths(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return Array.from(
      new Set(raw.map((x) => String(x ?? "").trim()).filter(Boolean)),
    );
  }
  if (typeof raw !== "string") return [];
  return Array.from(
    new Set(
      raw
        .split(/[\n,]+/)
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  );
}

export function normalizePathForMatch(p: string): string {
  return p.trim().replace(/\\/g, "/").toLowerCase();
}

export function indexesFromReferencePaths(
  catalogPaths: string[] | undefined,
  requestedPaths: string[],
): { indexes: number[]; missingPaths: string[] } {
  if (!catalogPaths?.length || !requestedPaths.length) {
    return { indexes: [], missingPaths: requestedPaths };
  }
  const indexByPath = new Map<string, number>();
  for (let i = 0; i < catalogPaths.length; i++) {
    const raw = (catalogPaths[i] || "").trim();
    if (!raw) continue;
    const key = normalizePathForMatch(raw);
    if (!key || indexByPath.has(key)) continue;
    indexByPath.set(key, i + 1);
  }
  const indexes: number[] = [];
  const missingPaths: string[] = [];
  for (const p of requestedPaths) {
    const hit = indexByPath.get(normalizePathForMatch(p));
    if (!hit) {
      missingPaths.push(p);
      continue;
    }
    indexes.push(hit);
  }
  return { indexes, missingPaths };
}

export function resolveReferenceImageIndexes(
  args: Record<string, unknown>,
  catalogPaths: string[] | undefined,
): { indexes: number[]; missingPaths: string[] } {
  const fromIndexes = parseImageIndexes(args.reference_image_indexes);
  const requestedPaths = parseImagePaths(args.reference_image_paths);
  const fromPaths = indexesFromReferencePaths(catalogPaths, requestedPaths);
  return {
    indexes: Array.from(new Set([...fromIndexes, ...fromPaths.indexes])),
    missingPaths: fromPaths.missingPaths,
  };
}

export function pickImageByOneBasedIndex(
  images: string[] | undefined,
  imageMimes: string[] | undefined,
  idx: number | null,
): string | undefined {
  if (!images || images.length === 0 || idx == null || !Number.isFinite(idx))
    return undefined;
  const i = Math.round(idx) - 1;
  if (i < 0 || i >= images.length) return undefined;
  const raw = (images[i] || "").trim();
  if (!raw) return undefined;
  if (raw.startsWith("data:image/")) return raw;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  const mimeRaw = (imageMimes?.[i] || "image/png").trim().toLowerCase();
  const mime = /^image\/[a-z0-9.+-]+$/.test(mimeRaw) ? mimeRaw : "image/png";
  return `data:${mime};base64,${raw.replace(/\s+/g, "")}`;
}

export type ResolvedRecallImage = {
  index: number;
  mime: string;
  base64: string;
  path?: string;
  recallSource?: "catalog" | "project_file";
};

export function parseDataImageUri(
  value: string,
): { mime: string; base64: string } | null {
  const raw = value.trim();
  const m = raw.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const base64 = m[2].replace(/\s+/g, "");
  if (!base64) return null;
  return { mime, base64 };
}

export function resolveCatalogImageByOneBasedIndex(
  images: string[] | undefined,
  imageMimes: string[] | undefined,
  imagePaths: string[] | undefined,
  idx: number | null,
): ResolvedRecallImage | undefined {
  if (!images || images.length === 0 || idx == null || !Number.isFinite(idx))
    return undefined;
  const i = Math.round(idx) - 1;
  if (i < 0 || i >= images.length) return undefined;
  const raw = (images[i] || "").trim();
  if (!raw) return undefined;
  const parsed = parseDataImageUri(raw);
  if (parsed) {
    return {
      index: Math.round(idx),
      mime: parsed.mime,
      base64: parsed.base64,
      path: (imagePaths?.[i] || "").trim() || undefined,
    };
  }
  if (raw.startsWith("http://") || raw.startsWith("https://")) return undefined;
  const mimeRaw = (imageMimes?.[i] || "image/png").trim().toLowerCase();
  const mime = /^image\/[a-z0-9.+-]+$/.test(mimeRaw) ? mimeRaw : "image/png";
  return {
    index: Math.round(idx),
    mime,
    base64: raw.replace(/\s+/g, ""),
    path: (imagePaths?.[i] || "").trim() || undefined,
  };
}

export type ImageRecallToolResult = {
  ok: boolean;
  source: "internal_catalog" | "mixed" | "project_file";
  purpose?: "vision" | "edit";
  recalled_images: Array<{
    index: number;
    mime: string;
    path?: string;
    source?: string;
  }>;
  errors?: string[];
};
