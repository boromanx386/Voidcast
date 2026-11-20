"""
OmniVoice TTS HTTP API for the Electron chat app.

Run:  python -m uvicorn main:app --host 127.0.0.1 --port 8765 --app-dir tts-server

Hugging Face cache (why "Fetching N files" reappears):
  - The first run downloads ~13 files. Afterwards it should use the cache.
  - Every start may briefly contact the Hub (metadata), it does not have to download GBs.
  - On Windows without symlinks (e.g. Q:) the cache runs in "degraded" mode — it can use
    more space or behave oddly; recommendation: `HF_HOME` on an NTFS drive with dev-mode
    symlinks, or `HF_HUB_DISABLE_SYMLINKS_WARNING=1` just to silence the warning.
  - Once everything is cached: `OMNIVOICE_LOCAL_ONLY=1` — local files only, no
    downloads (like `HF_HUB_OFFLINE=1` for the model, but for this load).
  - Faster rate limit: `HF_TOKEN` (or `HUGGING_FACE_HUB_TOKEN`).

The server starts immediately; the model loads in the background (does not block uvicorn).
"""

from __future__ import annotations

import asyncio
import base64
import hmac
import io
import logging
import os
import re
import tempfile
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from scrape_tool import assert_url_safe_for_fetch, scrape_public_url_to_text

from pdf_tool import HAS_REPORTLAB, save_pdf_to_folder

from stt_whistle import transcribe_wav as whistle_transcribe_wav

from youtube_tools import (
    HAS_YOUTUBE_TRANSCRIPT,
    HAS_YTDLP,
    youtube_tool_run,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tts-server")

# Dedicated, bounded pool for blocking web tools (search/yt-dlp). If ddgs stalls on
# DuckDuckGo rate limits, threads pile up here and can never starve the *default*
# executor that serves TTS / proxy / health — so one bad search no longer freezes
# the whole server. The semaphore caps how many searches may run at once.
_TOOLS_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="tools-net")
_SEARCH_SEM = asyncio.Semaphore(2)

# OpenCode Go OpenAI-compatible API (no browser CORS — always proxy from renderer).
OPENCODE_GO_UPSTREAM = os.environ.get(
    "OPENCODE_GO_BASE_URL", "https://opencode.ai/zen/go"
).rstrip("/")


def _env_key(name: str) -> str:
    return os.environ.get(name, "").strip()


# Quietly: symlinks are not supported on some NTFS/mount paths (e.g. Q:)
if os.environ.get("HF_HUB_DISABLE_SYMLINKS_WARNING") is None:
    os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

# Faster fallback to the cache when HF Hub responds slowly (default: 10s → 3s)
if os.environ.get("HF_HUB_ETAG_TIMEOUT") is None:
    os.environ["HF_HUB_ETAG_TIMEOUT"] = "3"

MODEL_ID = os.environ.get("OMNIVOICE_MODEL", "k2-fsa/OmniVoice")
DEVICE = os.environ.get("OMNIVOICE_DEVICE", "cuda:0")
DTYPE_ENV = os.environ.get("OMNIVOICE_DTYPE", "float16")
TTS_ENABLED = os.environ.get("OMNIVOICE_ENABLE_TTS", "0").strip() == "1"

_model: Any = None
_sampling_rate: int = 24000
_load_error: str | None = None
_infer_lock = asyncio.Lock()

# ddgs is NOT imported here. It drives a native client (primp) that can wedge a
# thread inside a GIL-holding call, which froze this whole server; search now runs
# in child processes owned by search_client, and this module only ranks results.
from search_client import SearchError, close_search_pool, search_pool  # noqa: E402
from search_core import HAS_DDGS as _HAS_DDGS  # noqa: E402
from search_core import is_no_read as _is_no_read  # noqa: E402


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    # Unset = server default (8). Ranking happens before this cut.
    max_results: int | None = Field(default=None, ge=1, le=20)
    # Optional freshness window: d/w/m/y. Unset means no time filter at all.
    recency: str | None = Field(default=None, max_length=4)
    # How many top results get read in full (0 = snippets only).
    read_top: int | None = Field(default=None, ge=0, le=5)
    # Per-page character cap for those full reads.
    page_chars: int | None = Field(default=None, ge=2000, le=20_000)


class YoutubeToolRequest(BaseModel):
    """search_youtube: YouTube search via yt-dlp, or metadata/transcript for a URL (yt-dlp + transcript API)."""

    query: str | None = Field(None, max_length=2000)
    video_url: str | None = Field(None, max_length=2048)
    get_transcript: bool = False
    max_results: int = Field(default=5, ge=1, le=20)


class ScrapeRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=2048)
    max_chars: int | None = Field(default=None, ge=2000, le=120_000)


class PdfImageItem(BaseModel):
    """Single attached image (PNG/JPEG) for `save_pdf`."""

    mime: str | None = Field(default=None, max_length=200)
    # 16 MB of base64 is ~12 MB of pixels: generous for a screenshot or a generated image, and in
    # line with every provider limit (Anthropic 10 MB base64, OpenAI 20 MB). The old 70 MB cap let
    # a single caller pin that much memory per image for no benefit.
    base64: str = Field(..., min_length=1, max_length=16_000_000)


class PdfRequest(BaseModel):
    """Payload for `POST /tools/pdf` (Markdown-lite body + optional images)."""

    content: str = Field(..., min_length=1, max_length=400_000)
    title: str | None = Field(default=None, max_length=300)
    filename: str | None = Field(default=None, max_length=300)
    output_dir: str = Field(..., min_length=1, max_length=4096)
    # Matches the sibling image_urls / image_paths caps, so one call cannot carry an unbounded
    # number of 16 MB payloads.
    images: list[PdfImageItem] | None = Field(default=None, max_length=16)
    # Public http(s) image URLs (PNG/JPEG/WebP). Used to embed AI-generated
    # images (e.g. Runware `image_url` from a prior `generate_image` call).
    image_urls: list[str] | None = Field(default=None, max_length=16)
    # Absolute local paths (generatedImagePaths / session catalog). Read on the tools server host.
    image_paths: list[str] | None = Field(default=None, max_length=16)


class RunwareProxyRequest(BaseModel):
    api_base_url: str = Field(
        default="https://api.runware.ai/v1", min_length=1, max_length=2048
    )
    api_key: str = Field(default="", max_length=2048)
    tasks: list[dict[str, Any]] = Field(..., min_length=1, max_length=8)


class TtsRequest(BaseModel):
    text: str = Field(..., min_length=1)
    instruct: str | None = None
    speed: float = Field(default=1.0, gt=0.0, le=4.0)
    num_step: int = Field(default=32, ge=4, le=128)
    duration: float | None = Field(
        default=None,
        description="Fixed output length in seconds (overrides speed pacing when set).",
        gt=0.0,
        le=600.0,
    )
    ref_audio_base64: str | None = Field(
        default=None,
        description="Voice clone: reference audio as base64 (more reliable than multipart in Electron).",
    )
    ref_text: str | None = Field(
        default=None,
        description="Transcript of the reference clip; optional (Whisper in the model if empty).",
    )


def _load_model() -> None:
    global _model, _sampling_rate, _load_error
    import torch
    import torchaudio
    from omnivoice import OmniVoice

    dtype = torch.float16 if DTYPE_ENV == "float16" else torch.float32
    logger.info(
        "Loading OmniVoice model=%s device=%s dtype=%s", MODEL_ID, DEVICE, dtype
    )
    model = OmniVoice.from_pretrained(
        MODEL_ID,
        device_map=DEVICE,
        dtype=dtype,
    )
    _model = model
    _sampling_rate = int(getattr(model, "sampling_rate", 24000))
    _load_error = None
    _ = torchaudio  # noqa: F841


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _load_error
    if not TTS_ENABLED:
        _load_error = (
            "Local TTS is disabled in this server build. "
            "Set OMNIVOICE_ENABLE_TTS=1 and install TTS dependencies."
        )
        logger.info("TTS disabled (OMNIVOICE_ENABLE_TTS != 1). Running tools-only mode.")
        try:
            yield
        finally:
            await asyncio.to_thread(close_search_pool)
        return
    try:
        await asyncio.to_thread(_load_model)
        logger.info("Model ready. sampling_rate=%s", _sampling_rate)
    except Exception as e:
        _load_error = str(e)
        logger.exception("Failed to load OmniVoice: %s", e)
    try:
        yield
    finally:
        await asyncio.to_thread(close_search_pool)


app = FastAPI(title="OmniVoice TTS", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["null", "file://"],
    allow_origin_regex=r"http://(?:127\.0\.0\.1|localhost|\[::1\]):[0-9]+",
    allow_methods=["GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "User-Agent",
        "X-Voidcast-Desktop-Token",
        "X-API-Key",
        "X-Opencode-Session",
        "Anthropic-Version",
        "Anthropic-Beta",
    ],
)


def _is_loopback_host(host: str | None) -> bool:
    return (host or "").lower() in ("127.0.0.1", "::1", "localhost")


@app.middleware("http")
async def validate_tools_host(request: Request, call_next):
    # A DNS-rebinding page reaches 127.0.0.1 under its own hostname; only loopback names pass.
    authorities = request.headers.getlist("host")
    authority = authorities[0].lower() if len(authorities) == 1 else ""
    match = re.fullmatch(
        r"(?:\[([0-9a-f:]+)\]|([a-z0-9.-]+))(?::[0-9]{1,5})?", authority
    )
    host = (match.group(1) or match.group(2)) if match else None
    if not _is_loopback_host(host):
        return PlainTextResponse("Invalid Host header", status_code=400)
    return await call_next(request)


def _desktop_authenticated(request: Request) -> bool:
    expected = os.environ.get("VOIDCAST_DESKTOP_TOKEN", "").strip()
    supplied = request.headers.get("x-voidcast-desktop-token", "")
    return bool(
        expected
        and _is_loopback_host(request.client.host if request.client else None)
        and _is_loopback_host(request.url.hostname)
        and hmac.compare_digest(expected.encode(), supplied.encode())
    )


async def require_desktop(request: Request) -> None:
    """Any web page can reach loopback, so every tool route needs the per-run desktop token."""
    if not _desktop_authenticated(request):
        raise HTTPException(status_code=403, detail="Desktop authentication required")


def _generate_wav_bytes(req: TtsRequest) -> bytes:
    import torchaudio

    if _model is None:
        raise RuntimeError("Model not loaded")

    kwargs: dict[str, Any] = {
        "text": req.text.strip(),
        "num_step": req.num_step,
        "speed": req.speed,
    }
    if req.instruct and req.instruct.strip():
        kwargs["instruct"] = req.instruct.strip()
    if req.duration is not None:
        kwargs["duration"] = float(req.duration)

    audios = _model.generate(**kwargs)
    tensor = audios[0]
    buf = io.BytesIO()
    torchaudio.save(buf, tensor, _sampling_rate, format="wav")
    return buf.getvalue()


def _generate_clone_bytes(
    ref_audio_path: str,
    text: str,
    ref_text: str | None,
    speed: float,
    num_step: int,
    duration: float | None,
) -> bytes:
    import torchaudio

    if _model is None:
        raise RuntimeError("Model not loaded")

    kwargs: dict[str, Any] = {
        "text": text.strip(),
        "ref_audio": ref_audio_path,
        "num_step": num_step,
        "speed": speed,
    }
    if ref_text and ref_text.strip():
        kwargs["ref_text"] = ref_text.strip()
    if duration is not None:
        kwargs["duration"] = float(duration)

    audios = _model.generate(**kwargs)
    tensor = audios[0]
    buf = io.BytesIO()
    torchaudio.save(buf, tensor, _sampling_rate, format="wav")
    return buf.getvalue()


def _generate_clone_from_b64(req: TtsRequest) -> bytes:
    if not req.ref_audio_base64 or not str(req.ref_audio_base64).strip():
        raise ValueError("ref_audio_base64 is empty")
    try:
        raw = base64.b64decode(req.ref_audio_base64.strip(), validate=True)
    except Exception as e:
        raise ValueError("ref_audio_base64 is not valid base64") from e
    if not raw:
        raise ValueError("decoded ref audio is empty")

    tmp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
            tmp.write(raw)
            tmp_path = tmp.name
        rt = req.ref_text.strip() if req.ref_text and req.ref_text.strip() else None
        dur = float(req.duration) if req.duration is not None else None
        return _generate_clone_bytes(
            tmp_path,
            req.text,
            rt,
            req.speed,
            req.num_step,
            dur,
        )
    finally:
        if tmp_path and os.path.isfile(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


@app.get("/health")
async def health(request: Request):
    return {
        # Lets Electron tell its own server from a leftover one that holds another token.
        "desktop": _desktop_authenticated(request),
        "ok": _model is not None and _load_error is None,
        "tts_enabled": TTS_ENABLED,
        "model": MODEL_ID,
        "device": DEVICE,
        "sampling_rate": _sampling_rate,
        "error": _load_error,
        "tools_search": _HAS_DDGS,
        "tools_youtube": {
            "yt_dlp": HAS_YTDLP,
            "youtube_transcript_api": HAS_YOUTUBE_TRANSCRIPT,
        },
        "tools_scrape": True,
        "tools_pdf": HAS_REPORTLAB,
    }


def _run_youtube_tool(
    query: str | None,
    video_url: str | None,
    get_transcript: bool,
    max_results: int,
) -> str:
    return youtube_tool_run(
        query=query,
        video_url=video_url,
        get_transcript=get_transcript,
        max_results=max_results,
    )


SEARCH_SNIPPET_CHARS = 1200
SEARCH_DEFAULT_RESULTS = 8
SEARCH_READ_TOP_DEFAULT = 3
SEARCH_READ_CHARS_DEFAULT = 4_000
SEARCH_READ_TOTAL_BUDGET = 12_000
# A deeper page_chars request may spend more, but never past this: a fixed 12k
# budget would let a 12k page crowd out every other read.
SEARCH_READ_TOTAL_BUDGET_MAX = 24_000
SEARCH_READ_TIMEOUT_S = 15
SEARCH_READ_CONCURRENCY = 3
SEARCH_CACHE_TTL_S = 600
SEARCH_CACHE_MAX = 64

# Page reads are network-bound and independent, so they get their own small
# semaphore instead of competing with the search slots.
_READ_SEM = asyncio.Semaphore(SEARCH_READ_CONCURRENCY)
_SEARCH_CACHE: dict[str, tuple[float, str]] = {}
_PAGE_CACHE: dict[str, tuple[float, tuple[str, str]]] = {}

SEARCH_WORKER_TIMEOUT_S = 25
# The worker may run three backend passes; this is a hard deadline backed by a
# process kill, so a wedged search can never take a request hostage again.
SEARCH_TIMEOUT_S = SEARCH_WORKER_TIMEOUT_S + 5


def _clamp_int(value: Any, low: int, high: int, default: int) -> int:
    # bool is an int subclass; True must not read as 1.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    if float(value) != int(value):
        return default
    return max(low, min(high, int(value)))


def _cache_get(cache: dict[str, tuple[float, Any]], key: str) -> Any | None:
    hit = cache.get(key)
    if hit is None:
        return None
    ts, value = hit
    if time.monotonic() - ts > SEARCH_CACHE_TTL_S:
        cache.pop(key, None)
        return None
    return value


def _cache_put(cache: dict[str, tuple[float, Any]], key: str, value: Any) -> None:
    if len(cache) >= SEARCH_CACHE_MAX:
        oldest = min(cache.items(), key=lambda kv: kv[1][0])[0]
        cache.pop(oldest, None)
    cache[key] = (time.monotonic(), value)


def _norm_query(query: str) -> str:
    return re.sub(r"\s+", " ", (query or "").strip().lower())


def _search_candidates(
    query: str,
    recency: str | None,
    max_results: int,
) -> list[dict[str, Any]]:
    """Ask the out-of-process worker for ranked candidates (blocking)."""
    if not _HAS_DDGS:
        raise SearchError("ddgs is not installed (pip install ddgs)")
    rows = search_pool().request(
        {
            "op": "search",
            "query": query,
            "recency": recency,
            "max_results": max_results,
        },
        timeout_s=SEARCH_WORKER_TIMEOUT_S,
    )
    if not isinstance(rows, list):
        raise SearchError("search worker returned a non-list payload")
    return rows


async def _read_top_results(
    rows: list[dict[str, Any]],
    top_n: int,
    per_page_chars: int,
    total_budget: int,
) -> int:
    """Attach full page text to the top ranked rows; return how many landed.

    Low-trust hosts are skipped rather than promoted, and deeper results backfill
    the read window. Never raises: an unreadable page stays snippet-only, which
    the formatter already knows how to render.
    """
    if top_n <= 0 or not rows:
        return 0

    async def read(row: dict[str, Any]) -> None:
        url = row["link"]
        # Keyed with the cap: a page cached at 6k chars must not silently answer
        # a 40k request from somewhere else.
        page_key = f"{url}|{per_page_chars}"
        cached = _cache_get(_PAGE_CACHE, page_key)
        if cached is not None:
            row["full"], row["full_format"] = cached
            return
        try:
            async with _READ_SEM:
                res = await asyncio.wait_for(
                    scrape_public_url_to_text(url, per_page_chars),
                    timeout=SEARCH_READ_TIMEOUT_S,
                )
        except Exception as e:  # noqa: BLE001
            logger.warning("search read failed for %s: %s", url, e)
            row["read_error"] = type(e).__name__
            return
        if not res.get("ok"):
            row["read_error"] = str(res.get("text") or "read failed")[:120]
            return
        text = str(res.get("text") or "")
        if not text.strip():
            row["read_error"] = "empty page"
            return
        row["full"] = text
        row["full_format"] = str(res.get("format") or "text")
        _cache_put(_PAGE_CACHE, page_key, (text, row["full_format"]))

    # Walk ranked order and take the first `top_n` rows worth promoting. Farms are
    # marked and skipped so the window fills with the next real source instead of
    # injecting generated filler as if it were documentation.
    targets: list[dict[str, Any]] = []
    for row in rows:
        if len(targets) >= top_n:
            break
        if _is_no_read(row["host"]):
            row["read_error"] = "skipped (low-trust source)"
            continue
        targets.append(row)
    if not targets:
        return 0
    await asyncio.gather(*(read(r) for r in targets), return_exceptions=True)

    # Deterministic budget: highest-ranked page wins, the tail gets dropped
    # rather than blowing the model's context on lower-value content.
    used = 0
    kept = 0
    for row in targets:
        full = row.get("full")
        if not full:
            continue
        # A capped page carries a "[Truncated to N characters]" note on top of its N
        # characters. Counting the note made three full pages overshoot the default
        # 3 x 4000 budget by a few dozen chars, so the third read was always dropped.
        cost = min(len(full), per_page_chars)
        if used + cost > total_budget:
            row.pop("full", None)
            row.pop("full_format", None)
            row["read_error"] = "dropped (read budget exhausted)"
            continue
        used += cost
        kept += 1
    return kept


def _format_results(
    rows: list[dict[str, Any]],
    read_top: int,
    read_ok: int,
) -> str:
    blocks: list[str] = []
    for n, r in enumerate(rows, start=1):
        date = f" | {r['date']}" if r.get("date") else ""
        block = (
            f"{n}. {r['title']} [{r['source']}{date}]\n"
            f"{r['body'][:SEARCH_SNIPPET_CHARS]}\n"
            f"{r['link']}"
        )
        if r.get("full"):
            fmt = r.get("full_format") or "markdown"
            block += f"\n\n--- FULL TEXT ({fmt}) ---\n{r['full']}\n--- END FULL TEXT ---"
        elif r.get("read_error"):
            block += f"\n\n[full text unavailable: {r['read_error']}]"
        blocks.append(block)
    body = "\n\n---\n\n".join(blocks)
    if read_top > 0 and read_ok > 0:
        # Count-based, not "the first N": low-trust rows are skipped and deeper
        # results backfill, so position no longer implies full text.
        note = (
            f"\n\n---\n\nNote: {read_ok} of the results above include their full page "
            "text (Markdown, marked FULL TEXT). The rest are snippets only (~"
            f"{SEARCH_SNIPPET_CHARS} characters each) - call scrape_url on their "
            "links if you need them before quoting."
        )
    else:
        note = (
            f"\n\n---\n\nNote: snippets are truncated to ~{SEARCH_SNIPPET_CHARS} "
            "characters. Call scrape_url on any result's link to read the full page "
            "before quoting it or answering detailed questions from it."
        )
    return body + note


@app.post("/tools/search", dependencies=[Depends(require_desktop)])
async def tools_search(req: SearchRequest):
    """Ranked web search (ddgs), optionally reading the top hits as full text."""
    max_results = _clamp_int(req.max_results, 1, 20, SEARCH_DEFAULT_RESULTS)
    recency = (req.recency or "").strip().lower()
    recency = recency if recency in ("d", "w", "m", "y") else None
    read_top = _clamp_int(req.read_top, 0, 5, SEARCH_READ_TOP_DEFAULT)
    page_chars = _clamp_int(req.page_chars, 2000, 20_000, SEARCH_READ_CHARS_DEFAULT)

    read_budget = max(
        SEARCH_READ_TOTAL_BUDGET,
        min(read_top * page_chars, SEARCH_READ_TOTAL_BUDGET_MAX),
    )

    cache_key = f"{_norm_query(req.query)}|{max_results}|{recency}|{read_top}|{page_chars}"
    cached = _cache_get(_SEARCH_CACHE, cache_key)
    if isinstance(cached, str):
        return {"ok": True, "text": cached, "cached": True}

    loop = asyncio.get_running_loop()
    try:
        # Searching blocks (ddgs retries internally against rate-limited backends),
        # so it runs on the DEDICATED tools pool, never the default executor that
        # serves TTS/proxy/health. Each stage gets its own cap.
        async with _SEARCH_SEM:
            rows = await asyncio.wait_for(
                loop.run_in_executor(
                    _TOOLS_EXECUTOR,
                    _search_candidates,
                    req.query,
                    recency,
                    max_results,
                ),
                timeout=SEARCH_TIMEOUT_S,
            )
            if not rows:
                return {
                    "ok": True,
                    "text": (
                        "Search returned no results (empty result set or upstream "
                        "rate limiting). Try a shorter or differently-worded query, "
                        "or call scrape_url directly on a known URL."
                    ),
                }
            read_ok = await asyncio.wait_for(
                _read_top_results(rows, read_top, page_chars, read_budget),
                timeout=SEARCH_READ_TIMEOUT_S,
            )
        text = _format_results(rows, read_top, read_ok)
        _cache_put(_SEARCH_CACHE, cache_key, text)
        return {"ok": True, "text": text}
    except (asyncio.TimeoutError, SearchError) as e:
        logger.warning("tools/search failed (%s): %r", e, req.query)
        return {
            "ok": False,
            "text": "Web search is unavailable right now (the search worker "
            "stopped answering and was restarted automatically). Try again in a "
            "few seconds.",
            "detail": str(e) or "Web search timed out",
        }
    except Exception as e:
        logger.exception("tools/search failed: %s", e)
        raise HTTPException(
            status_code=503,
            detail=str(e) or "Search failed",
        ) from e


@app.post("/tools/youtube", dependencies=[Depends(require_desktop)])
async def tools_youtube(req: YoutubeToolRequest):
    """YouTube search (yt-dlp ytsearch) and/or video info + optional captions (yt-dlp, youtube-transcript-api)."""
    q = (req.query or "").strip()
    u = (req.video_url or "").strip()
    if not q and not u:
        raise HTTPException(
            status_code=400,
            detail="Provide query (search) or video_url (video details / transcript).",
        )
    try:
        # yt-dlp talks to YouTube directly and can stall on throttling, so it stays
        # off the default executor that serves TTS/proxy/health.
        text = await asyncio.get_running_loop().run_in_executor(
            _TOOLS_EXECUTOR,
            _run_youtube_tool,
            q or None,
            u or None,
            req.get_transcript,
            req.max_results,
        )
        return {"ok": True, "text": text}
    except Exception as e:
        logger.exception("tools/youtube failed: %s", e)
        raise HTTPException(
            status_code=503,
            detail=str(e) or "YouTube tool failed",
        ) from e


@app.post("/tools/scrape", dependencies=[Depends(require_desktop)])
async def tools_scrape(req: ScrapeRequest):
    """Fetch a public http(s) URL → Markdown (SSRF-safe).

    `format` is "markdown" when main-content extraction ran and "text" when the
    fallback converter produced the body, so callers can tell upgraded output
    from degraded output.
    """
    # Keyed with the cap so a cached 6k excerpt can never answer a 40k request.
    page_chars = _clamp_int(req.max_chars, 2000, 120_000, 40_000)
    page_key = f"{req.url.strip()}|{page_chars}"
    cached_page = _cache_get(_PAGE_CACHE, page_key)
    if cached_page is not None:
        text, fmt = cached_page
        return {"ok": True, "text": text, "format": fmt, "cached": True}
    try:
        result = await scrape_public_url_to_text(req.url, req.max_chars)
        if result.get("ok"):
            # Same cache the search auto-read fills, so asking for a page the
            # search already read is free.
            _cache_put(
                _PAGE_CACHE,
                page_key,
                (str(result["text"]), str(result.get("format", "text"))),
            )
            return {
                "ok": True,
                "text": result["text"],
                "format": result.get("format", "text"),
            }
        return {"ok": False, "text": result.get("text", "Scrape failed")}
    except Exception as e:
        logger.exception("tools/scrape failed: %s", e)
        raise HTTPException(
            status_code=503,
            detail=str(e) or "Scrape failed",
        ) from e


class SttWhistleRequest(BaseModel):
    """Base64-encoded 16 kHz mono WAV audio for local Whistle transcription."""

    audio_base64: str = Field(..., min_length=1)
    format: str = Field(default="wav", max_length=16)


@app.post("/stt/transcribe", dependencies=[Depends(require_desktop)])
async def stt_transcribe(req: SttWhistleRequest):
    """Local speech-to-text via cactus-needle (Whistle). Expects 16 kHz mono WAV.

    The Electron renderer records with MediaRecorder (WebM/Opus), decodes it with
    WebAudio and resamples to 16 kHz mono WAV before POSTing here, so the base
    `cactus-needle` install is enough (no ffmpeg / `[mic]` extra required).
    """
    try:
        raw = base64.b64decode(req.audio_base64, validate=False)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid base64 audio: {e}") from e

    tmp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as fh:
            fh.write(raw)
            tmp_path = fh.name
        result = await asyncio.to_thread(whistle_transcribe_wav, tmp_path)
        return {
            "ok": True,
            "text": result.get("text", ""),
            "language": result.get("language"),
        }
    except RuntimeError as e:
        raise HTTPException(
            status_code=503,
            detail=str(e) or "Whistle not available",
        ) from e
    except Exception as e:
        logger.exception("stt/transcribe failed: %s", e)
        raise HTTPException(
            status_code=503,
            detail=str(e) or "Whistle transcription failed",
        ) from e
    finally:
        if tmp_path:
            try:
                os.remove(tmp_path)
            except OSError:
                pass


@app.post("/tools/pdf", dependencies=[Depends(require_desktop)])
async def tools_pdf(req: PdfRequest):
    """Render Markdown-lite content into a PDF inside `output_dir` (no dialog)."""
    if not HAS_REPORTLAB:
        raise HTTPException(
            status_code=503,
            detail="reportlab is not installed on the tools server.",
        )

    images_payload: list[dict[str, Any]] | None = (
        [item.model_dump() for item in req.images] if req.images else None
    )
    image_urls_payload: list[str] | None = (
        [u for u in req.image_urls if isinstance(u, str) and u.strip()]
        if req.image_urls
        else None
    )
    image_paths_payload: list[str] | None = (
        [p for p in req.image_paths if isinstance(p, str) and p.strip()]
        if req.image_paths
        else None
    )

    try:
        result = await asyncio.to_thread(
            save_pdf_to_folder,
            content=req.content,
            output_dir=req.output_dir,
            title=req.title,
            filename=req.filename,
            images=images_payload,
            image_urls=image_urls_payload,
            image_paths=image_paths_payload,
        )
    except Exception as e:
        logger.exception("tools/pdf failed: %s", e)
        raise HTTPException(
            status_code=503,
            detail=str(e) or "PDF render failed",
        ) from e

    if not result.get("ok"):
        return {"ok": False, "text": result.get("text", "PDF render failed")}
    return {
        "ok": True,
        "text": result.get("text", ""),
        "file_path": result.get("file_path", ""),
    }


_RUNWARE_UUID_V4_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _normalize_runware_tasks(tasks: list[Any]) -> list[Any]:
    """Runware rejects non-UUIDv4 taskUUID values (common on plain-HTTP mobile clients)."""
    out: list[Any] = []
    for item in tasks:
        if not isinstance(item, dict):
            out.append(item)
            continue
        task = dict(item)
        raw = task.get("taskUUID") or task.get("task_uuid")
        if isinstance(raw, str) and _RUNWARE_UUID_V4_RE.match(raw.strip()):
            task["taskUUID"] = raw.strip().lower()
        else:
            task["taskUUID"] = str(uuid.uuid4())
        task.pop("task_uuid", None)
        out.append(task)
    return out


@app.post("/tools/runware_proxy", dependencies=[Depends(require_desktop)])
async def tools_runware_proxy(req: RunwareProxyRequest):
    """Proxy Runware tasks through local server to avoid renderer CORS/network issues."""
    base = req.api_base_url.strip().rstrip("/")
    if not base:
        raise HTTPException(status_code=400, detail="api_base_url is required")
    if not base.startswith("https://"):
        raise HTTPException(
            status_code=400, detail="Runware base URL must use https://"
        )
    # The base URL is user-editable and the request carries the Runware key, so it must
    # not be pointed at this machine or the LAN.
    try:
        await assert_url_safe_for_fetch(httpx.URL(base))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Runware base URL: {e}") from e
    key = req.api_key.strip() or _env_key("RUNWARE_API_KEY")
    if not key:
        raise HTTPException(
            status_code=503,
            detail="Runware API key not configured on server (desktop General or RUNWARE_API_KEY env)",
        )
    if not req.tasks:
        raise HTTPException(status_code=400, detail="tasks must not be empty")
    tasks = _normalize_runware_tasks(list(req.tasks))
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(120.0, connect=20.0)
        ) as client:
            r = await client.post(
                base,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {key}",
                },
                json=tasks,
            )
        data = r.json() if r.content else {}
        if not r.is_success:
            detail = "Runware request failed"
            if isinstance(data, dict):
                errs = data.get("errors")
                if isinstance(errs, list) and errs and isinstance(errs[0], dict):
                    msg = errs[0].get("message")
                    if isinstance(msg, str) and msg.strip():
                        detail = msg.strip()
                else:
                    msg = data.get("message") or data.get("error")
                    if isinstance(msg, str) and msg.strip():
                        detail = msg.strip()
            raise HTTPException(status_code=502, detail=detail)
        return {"ok": True, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("tools/runware_proxy failed: %s", e)
        raise HTTPException(
            status_code=503, detail=str(e) or "Runware proxy failed"
        ) from e


_HOP_BY_HOP = {
    "connection",
    "transfer-encoding",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "upgrade",
}

_STRIP_FWD = frozenset(
    {
        "host",
        "connection",
        "content-length",
        "transfer-encoding",
        "authorization",
        "x-api-key",
        "cookie",
        "referer",
    }
)


async def _reverse_proxy(
    request: Request,
    upstream_base: str,
    full_path: str,
    *,
    bearer_key: str | None = None,
    extra_headers: dict[str, str] | None = None,
) -> StreamingResponse:
    target = f"{upstream_base.rstrip('/')}/{full_path}"
    if request.url.query:
        target = f"{target}?{request.url.query}"

    body = await request.body()
    fwd_headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in _STRIP_FWD and not k.lower().startswith("x-voidcast-")
    }
    if bearer_key:
        fwd_headers["Authorization"] = f"Bearer {bearer_key}"
    if extra_headers:
        fwd_headers.update(extra_headers)

    client = httpx.AsyncClient(
        timeout=httpx.Timeout(600.0, connect=60.0),
        follow_redirects=False,
    )
    try:
        upstream_req = client.build_request(
            request.method,
            target,
            headers=fwd_headers,
            content=body if body else None,
        )
        upstream = await client.send(upstream_req, stream=True)
    except httpx.HTTPError as e:
        await client.aclose()
        # An unhandled exception becomes a 500 without CORS headers, which the renderer
        # can only report as "Failed to fetch". Surface the real upstream error instead.
        logger.warning("proxy %s %s failed: %r", request.method, target, e)
        raise HTTPException(
            status_code=502,
            detail=f"Upstream request failed: {type(e).__name__}: {e}".rstrip(": "),
        ) from e
    except Exception:
        await client.aclose()
        raise

    out_headers = {
        k: v
        for k, v in upstream.headers.items()
        if k.lower() not in _HOP_BY_HOP and k.lower() != "content-length"
    }

    async def body_iter() -> Any:
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        body_iter(),
        status_code=upstream.status_code,
        headers=out_headers,
    )


@app.api_route(
    "/api/opencode-go/{full_path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS"],
    dependencies=[Depends(require_desktop)],
)
async def opencode_go_proxy(request: Request, full_path: str):
    """Proxy OpenCode Go (no CORS on upstream). The desktop sends its key as Bearer or x-api-key."""
    key = ""
    auth = (request.headers.get("authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        key = auth[7:].strip()
    if not key:
        # Anthropic Messages clients (/messages) send the key as x-api-key.
        key = (request.headers.get("x-api-key") or "").strip()
    if not key:
        key = _env_key("OPENCODE_GO_API_KEY")
    if not key:
        raise HTTPException(
            status_code=503,
            detail=(
                "OpenCode Go API key not configured "
                "(desktop General / OPENCODE_GO_API_KEY env, Authorization Bearer, or x-api-key)"
            ),
        )
    # Only Anthropic Messages endpoints (.../messages) need x-api-key upstream.
    is_messages = full_path.rstrip("/").endswith("messages")
    return await _reverse_proxy(
        request,
        OPENCODE_GO_UPSTREAM,
        full_path,
        bearer_key=key,
        extra_headers={"x-api-key": key} if is_messages else None,
    )


def _custom_llm_upstream(raw: str) -> str:
    """Validate the Custom provider's base URL: an absolute http(s) URL with a host."""
    from urllib.parse import urlsplit

    value = (raw or "").strip().rstrip("/")
    parts = urlsplit(value)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise HTTPException(
            status_code=400,
            detail="Custom provider base URL must be an absolute http(s) URL (x-voidcast-upstream).",
        )
    if parts.query or parts.fragment:
        raise HTTPException(
            status_code=400,
            detail="Custom provider base URL must not carry a query or fragment.",
        )
    return value


@app.api_route(
    "/api/custom-llm/{full_path:path}",
    methods=["GET", "POST"],
    dependencies=[Depends(require_desktop)],
)
async def custom_llm_proxy(request: Request, full_path: str):
    """Proxy the Custom LLM provider, whose endpoint the user typed.

    Such servers rarely send CORS headers, so the renderer cannot call them itself. The base
    URL comes in `x-voidcast-upstream` (stripped like every x-voidcast-* header before
    forwarding), and the key is forwarded in whichever header the renderer chose for the wire
    format: Bearer for OpenAI-style APIs, x-api-key for Anthropic Messages. The route is
    desktop-token only, so it reaches nothing the renderer could not already fetch.
    """
    upstream = _custom_llm_upstream(request.headers.get("x-voidcast-upstream", ""))
    auth = {}
    for name in ("authorization", "x-api-key"):
        value = (request.headers.get(name) or "").strip()
        if value:
            auth[name] = value
    return await _reverse_proxy(request, upstream, full_path, extra_headers=auth or None)


@app.post("/tts", dependencies=[Depends(require_desktop)])
async def tts(req: TtsRequest):
    """JSON: auto / design, or voice clone via ref_audio_base64 + optional ref_text."""
    if not TTS_ENABLED:
        raise HTTPException(
            status_code=503,
            detail=(
                "Local TTS is disabled on this server. "
                "Install external Local TTS package and enable OMNIVOICE_ENABLE_TTS=1."
            ),
        )
    if _model is None:
        raise HTTPException(
            status_code=503,
            detail=_load_error or "Model not loaded",
        )

    async with _infer_lock:
        try:
            if req.ref_audio_base64 and str(req.ref_audio_base64).strip():
                data = await asyncio.to_thread(_generate_clone_from_b64, req)
            else:
                data = await asyncio.to_thread(_generate_wav_bytes, req)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except Exception as e:
            logger.exception("TTS failed: %s", e)
            raise HTTPException(status_code=500, detail=str(e)) from e
    return Response(content=data, media_type="audio/wav")
