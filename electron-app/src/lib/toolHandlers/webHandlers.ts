import { invokeWebSearch } from "@/lib/webSearch";
import { invokeGetWeather } from "@/lib/weather";
import { invokeScrapeUrl } from "@/lib/scrapeUrl";
import { invokeSavePdf } from "@/lib/savePdf";
import { invokeYoutubeTool } from "@/lib/youtubeTool";
import { invokeRedditTool, type RedditToolParams } from "@/lib/redditTool";
import {
  resolvePdfAttachedImages,
  resolvePdfImagePaths,
  resolvePdfImageUrls,
} from "@/lib/toolHandlers/helpers";
import type { ToolHandlerFn, ToolHandlerRegistry } from "@/lib/toolExecTypes";

export const handleWebSearch: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.webSearch) {
    return "Error: web_search tool is disabled in settings.";
  }
  const q = typeof args.query === "string" ? args.query.trim() : "";
  if (!q) return "Error: missing query parameter for web_search.";
  try {
    return await invokeWebSearch(q, ctx.ttsBaseUrl, ctx.signal);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

export const handleSearchYoutube: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.youtube) {
    return "Error: search_youtube tool is disabled in settings.";
  }
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const videoUrl =
    typeof args.video_url === "string" ? args.video_url.trim() : "";
  if (!query && !videoUrl) {
    return "Error: provide query (search) or video_url (video details / transcript).";
  }
  const getTranscript = Boolean(args.get_transcript);
  const maxRaw = args.max_results;
  const maxResults =
    typeof maxRaw === "number" && Number.isFinite(maxRaw)
      ? Math.min(20, Math.max(1, Math.round(maxRaw)))
      : undefined;
  try {
    return await invokeYoutubeTool(
      {
        query: query || undefined,
        video_url: videoUrl || undefined,
        get_transcript: getTranscript,
        max_results: maxResults,
      },
      ctx.ttsBaseUrl,
      ctx.signal,
    );
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

export const handleRedditFeed: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.reddit) {
    return "Error: reddit_feed tool is disabled in settings.";
  }
  const subreddit =
    typeof args.subreddit === "string" ? args.subreddit.trim() : "";
  const sortRaw =
    typeof args.sort === "string" ? args.sort.trim().toLowerCase() : "";
  const timeRaw =
    typeof args.time === "string" ? args.time.trim().toLowerCase() : "";
  const allowedSorts: RedditToolParams["sort"][] = [
    "hot",
    "new",
    "top",
    "rising",
    "controversial",
    "best",
  ];
  const allowedTimes: RedditToolParams["time"][] = [
    "hour",
    "day",
    "week",
    "month",
    "year",
    "all",
  ];
  const sort = allowedSorts.find((s) => s === sortRaw);
  const time = allowedTimes.find((t) => t === timeRaw);
  const limitRaw = args.limit;
  const limit =
    typeof limitRaw === "number" && Number.isFinite(limitRaw)
      ? Math.min(25, Math.max(1, Math.round(limitRaw)))
      : undefined;
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const postUrl = typeof args.post_url === "string" ? args.post_url.trim() : "";
  const maxCommentsRaw = args.max_comments;
  const maxComments =
    typeof maxCommentsRaw === "number" && Number.isFinite(maxCommentsRaw)
      ? Math.min(50, Math.max(1, Math.round(maxCommentsRaw)))
      : undefined;
  try {
    return await invokeRedditTool(
      {
        subreddit: subreddit || undefined,
        sort,
        time,
        limit,
        query: query || undefined,
        post_url: postUrl || undefined,
        max_comments: maxComments,
      },
      ctx.ttsBaseUrl,
      ctx.signal,
    );
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

export const handleGetWeather: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.weather) {
    return "Error: get_weather tool is disabled in settings.";
  }
  const city = typeof args.city === "string" ? args.city.trim() : "";
  if (!city) return "Error: missing city parameter for get_weather.";
  const forecast = Boolean(args.forecast);
  try {
    return await invokeGetWeather(city, forecast, ctx.ttsBaseUrl, ctx.signal);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

export const handleScrapeUrl: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.scrape) {
    return "Error: scrape_url tool is disabled in settings.";
  }
  const url = typeof args.url === "string" ? args.url.trim() : "";
  if (!url) return "Error: missing url parameter for scrape_url.";
  const maxChars =
    typeof args.max_chars === "number" && Number.isFinite(args.max_chars)
      ? args.max_chars
      : undefined;
  try {
    return await invokeScrapeUrl(url, maxChars, ctx.ttsBaseUrl, ctx.signal);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

export const handleSavePdf: ToolHandlerFn = async (args, ctx) => {
  if (!ctx.toolsEnabled.pdf) {
    return "Error: save_pdf tool is disabled in settings.";
  }
  const dir = ctx.pdfOutputDir?.trim() ?? "";
  if (!dir) {
    return "Error: set a PDF output folder in Options → Tools (under Save as PDF).";
  }
  const content = typeof args.content === "string" ? args.content : "";
  if (!content.trim()) return "Error: missing or empty content for save_pdf.";
  const title = typeof args.title === "string" ? args.title : undefined;
  const filename =
    typeof args.filename === "string" ? args.filename : undefined;
  const images = resolvePdfAttachedImages(args as Record<string, unknown>, {
    userImages: ctx.userImages,
    userImageMimes: ctx.userImageMimes,
  });
  const imageUrls = resolvePdfImageUrls(args as Record<string, unknown>);
  const { paths: imagePaths, extraImages } = resolvePdfImagePaths(
    args as Record<string, unknown>,
    {
      userImages: ctx.userImages,
      userImageMimes: ctx.userImageMimes,
      userImagePaths: ctx.userImagePaths,
    },
  );
  const allImages = [...images, ...extraImages];
  try {
    return await invokeSavePdf({
      ttsBaseUrl: ctx.ttsBaseUrl,
      content,
      title,
      filename,
      outputDir: dir,
      images: allImages.length ? allImages : undefined,
      imageUrls: imageUrls.length ? imageUrls : undefined,
      imagePaths: imagePaths.length ? imagePaths : undefined,
      signal: ctx.signal,
    });
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

export const webHandlersRegistry: ToolHandlerRegistry = {
  ["web_search"]: handleWebSearch,
  ["search_youtube"]: handleSearchYoutube,
  ["reddit_feed"]: handleRedditFeed,
  ["get_weather"]: handleGetWeather,
  ["scrape_url"]: handleScrapeUrl,
  ["save_pdf"]: handleSavePdf,
};
