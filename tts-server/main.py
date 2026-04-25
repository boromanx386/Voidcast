"""
OmniVoice TTS HTTP API for the Electron chat app.

Run:  python -m uvicorn main:app --host 0.0.0.0 --port 8765 --app-dir tts-server

Hugging Face cache (zašto "Fetching N files" ponovo):
  - Prvi put skida ~13 fajlova. Posle bi trebalo da koristi keš.
  - Svako pokretanje može da kratko kontaktira Hub (metadata), ne mora da skida GB.
  - Na Windows bez symlinkova (npr. Q:) keš radi u "degraded" modu — može više mesta
    ili čudno ponašanje; preporuka: `HF_HOME` na NTFS disk sa dev mode symlinkovima,
    ili `HF_HUB_DISABLE_SYMLINKS_WARNING=1` samo da utiša upozorenje.
  - Kad je jednom sve u kešu: `OMNIVOICE_LOCAL_ONLY=1` — samo lokalni fajlovi, bez
    download skidanja (kao `HF_HUB_OFFLINE=1` za model, ali za ovaj load).
  - Brže rate limit: `HF_TOKEN` (ili `HUGGING_FACE_HUB_TOKEN`).

Server se podigne odmah; model se učitava u pozadini (ne blokira uvicorn).
"""

from __future__ import annotations

import asyncio
import base64
import io
import logging
import os
import re
import tempfile
from datetime import datetime
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from scrape_tool import scrape_public_url_to_text

from youtube_tools import (
    HAS_YOUTUBE_TRANSCRIPT,
    HAS_YTDLP,
    youtube_tool_run,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tts-server")

WEB_UI_DIR = Path(__file__).resolve().parent / "web-ui"
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip(
    "/"
)


def _web_index_file() -> Path | None:
    """Vite web build emits `index.web.html` (multi-page) or `index.html`."""
    for name in ("index.html", "index.web.html"):
        p = WEB_UI_DIR / name
        if p.is_file():
            return p
    return None


# Tiho: symlink na nekim NTFS/mount putevima nije podržan (npr. Q:)
if os.environ.get("HF_HUB_DISABLE_SYMLINKS_WARNING") is None:
    os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

# Brži fallback na keš kad HF Hub ne odgovara brzo (default: 10s → 3s)
if os.environ.get("HF_HUB_ETAG_TIMEOUT") is None:
    os.environ["HF_HUB_ETAG_TIMEOUT"] = "3"

MODEL_ID = os.environ.get("OMNIVOICE_MODEL", "k2-fsa/OmniVoice")
DEVICE = os.environ.get("OMNIVOICE_DEVICE", "cuda:0")
DTYPE_ENV = os.environ.get("OMNIVOICE_DTYPE", "float16")

_model: Any = None
_sampling_rate: int = 24000
_load_error: str | None = None
_infer_lock = asyncio.Lock()
_desktop_settings_cache: dict[str, Any] | None = None
_desktop_settings_updated_at: str | None = None

# Prefer `ddgs` — the `duckduckgo_search` package was renamed and its DDGS often returns no results.
try:
    from ddgs import DDGS  # type: ignore
except ImportError:
    try:
        from duckduckgo_search import DDGS  # type: ignore

    except ImportError:
        DDGS = None  # type: ignore
        _HAS_DDGS = False
    else:
        _HAS_DDGS = True
else:
    _HAS_DDGS = True


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)


class YoutubeToolRequest(BaseModel):
    """search_youtube: YouTube search via ddgs, or metadata/transcript for a URL (yt-dlp + transcript API)."""

    query: str | None = Field(None, max_length=2000)
    video_url: str | None = Field(None, max_length=2048)
    get_transcript: bool = False
    max_results: int = Field(default=5, ge=1, le=20)


class ScrapeRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=2048)
    max_chars: int | None = Field(default=None, ge=2000, le=120_000)


class WeatherRequest(BaseModel):
    city: str = Field(..., min_length=1, max_length=200)
    forecast: bool = False


class RunwareProxyRequest(BaseModel):
    api_base_url: str = Field(
        default="https://api.runware.ai/v1", min_length=1, max_length=2048
    )
    api_key: str = Field(..., min_length=1, max_length=2048)
    tasks: list[dict[str, Any]] = Field(..., min_length=1, max_length=8)


class DesktopSettingsSyncRequest(BaseModel):
    settings: dict[str, Any] = Field(default_factory=dict)


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
        description="Voice clone: referentni audio kao base64 (pouzdanije od multipart u Electronu).",
    )
    ref_text: str | None = Field(
        default=None,
        description="Transkript referentnog snimka; opciono (Whisper u modelu ako prazno).",
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
    try:
        await asyncio.to_thread(_load_model)
        logger.info("Model ready. sampling_rate=%s", _sampling_rate)
    except Exception as e:
        _load_error = str(e)
        logger.exception("Failed to load OmniVoice: %s", e)
    yield


app = FastAPI(title="OmniVoice TTS", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _generate_wav_bytes(req: TtsRequest) -> bytes:
    import torch
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
    import torch
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
async def health():
    return {
        "ok": _model is not None and _load_error is None,
        "model": MODEL_ID,
        "device": DEVICE,
        "sampling_rate": _sampling_rate,
        "error": _load_error,
        "tools_search": _HAS_DDGS,
        "tools_youtube": {
            "ddgs": _HAS_DDGS,
            "yt_dlp": HAS_YTDLP,
            "youtube_transcript_api": HAS_YOUTUBE_TRANSCRIPT,
        },
        "tools_scrape": True,
        "tools_weather": True,
        "ollama_proxy": OLLAMA_BASE_URL,
        "web_ui": _web_index_file() is not None,
    }


def _ddgs_text_for_youtube(query: str, max_results: int) -> list:
    if not _HAS_DDGS or DDGS is None:
        return []
    with DDGS(timeout=25) as ddgs:  # type: ignore[misc]
        return list(ddgs.text(query, max_results=max_results))


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
        has_ddgs=_HAS_DDGS,
        ddgs_text_fn=_ddgs_text_for_youtube if _HAS_DDGS else None,
    )


def _search_web_ddgs(query: str) -> str:
    """Search web with freshness bias (news + recent text results)."""
    if not _HAS_DDGS or DDGS is None:
        raise RuntimeError("ddgs is not installed (pip install ddgs)")
    q = query.strip()
    if not q:
        return "Empty query."
    current_year = datetime.now().year
    q_norm = re.sub(r"\b(20\d{2})\b", str(current_year), q)
    q_recent = f"{q_norm} {current_year}"
    out: list[str] = []
    seen_links: set[str] = set()

    def _append_result(r: dict[str, Any], source: str) -> None:
        if len(out) >= 8:
            return
        title = str(r.get("title") or "").strip()
        body = str(r.get("body") or "").strip()
        link = str(r.get("href") or r.get("url") or "").strip()
        if not link:
            return
        key = link.lower()
        if key in seen_links:
            return
        if len(body) < 15:
            return
        seen_links.add(key)
        date_raw = str(
            r.get("date")
            or r.get("published")
            or r.get("publishedAt")
            or r.get("source_date")
            or ""
        ).strip()
        stamp = f" [{source}{' | ' + date_raw if date_raw else ''}]"
        out.append(f"{title}{stamp}\n{body[:450]}\n{link}")

    with DDGS(timeout=20) as ddgs:  # type: ignore[misc]
        # 1) News endpoint first (usually fresher).
        try:
            for r in list(ddgs.news(q_norm, max_results=8)):
                if isinstance(r, dict):
                    _append_result(r, "news")
        except Exception:
            pass
        # 2) Recent text results.
        for query_variant in (q_norm, q_recent):
            try:
                for r in list(ddgs.text(query_variant, max_results=10, timelimit="m")):
                    if isinstance(r, dict):
                        _append_result(r, "text:m")
            except Exception:
                continue
            if len(out) >= 8:
                break
        # 3) Fallback broader text if still sparse.
        if len(out) < 4:
            try:
                for r in list(ddgs.text(q_norm, max_results=10)):
                    if isinstance(r, dict):
                        _append_result(r, "text")
            except Exception:
                pass

    if not out:
        return "No usable fresh text snippets in results."
    return "\n\n---\n\n".join(out)


@app.post("/tools/search")
async def tools_search(req: SearchRequest):
    """Web search via ddgs (multiple backends); requires `pip install ddgs`."""
    try:
        text = await asyncio.to_thread(_search_web_ddgs, req.query)
        return {"ok": True, "text": text}
    except Exception as e:
        logger.exception("tools/search failed: %s", e)
        raise HTTPException(
            status_code=503,
            detail=str(e) or "Search failed",
        ) from e


@app.post("/tools/youtube")
async def tools_youtube(req: YoutubeToolRequest):
    """YouTube search (ddgs) and/or video info + optional captions (yt-dlp, youtube-transcript-api)."""
    q = (req.query or "").strip()
    u = (req.video_url or "").strip()
    if not q and not u:
        raise HTTPException(
            status_code=400,
            detail="Provide query (search) or video_url (video details / transcript).",
        )
    try:
        text = await asyncio.to_thread(
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


def _format_wttr_text(data: dict[str, Any], city: str, forecast: bool) -> str:
    curr_list = data.get("current_condition")
    curr = curr_list[0] if isinstance(curr_list, list) and curr_list else None
    if not curr:
        return "No weather data returned for this location."
    desc = ""
    wd = curr.get("weatherDesc")
    if isinstance(wd, list) and wd:
        d0 = wd[0]
        if isinstance(d0, dict):
            desc = str(d0.get("value") or "")
    res = f"Weather for {city}: {curr.get('temp_C', '?')}°C, {desc}\n"
    res += f"Humidity: {curr.get('humidity', '?')}%, Wind: {curr.get('windspeedKmph', '?')} km/h"
    if forecast and data.get("weather"):
        res += "\n\nForecast (3 days):"
        for day in (data.get("weather") or [])[:3]:
            if not isinstance(day, dict):
                continue
            d = day.get("date") or "?"
            mx = day.get("maxtempC") or "?"
            mn = day.get("mintempC") or "?"
            hourly = day.get("hourly") or []
            h0 = hourly[0] if isinstance(hourly, list) and hourly else {}
            hourly_desc = ""
            if isinstance(h0, dict):
                hd = h0.get("weatherDesc")
                if isinstance(hd, list) and hd and isinstance(hd[0], dict):
                    hourly_desc = str(hd[0].get("value") or "")
            res += f"\n- {d}: {mx}°C / {mn}°C — {hourly_desc}"
    return res


def _fetch_wttr_json(city: str) -> dict[str, Any]:
    path = quote(city.strip(), safe="")
    url = f"https://wttr.in/{path}?format=j1"
    r = httpx.get(url, timeout=25.0)
    r.raise_for_status()
    return r.json()


@app.post("/tools/scrape")
async def tools_scrape(req: ScrapeRequest):
    """Fetch public http(s) URL, strip HTML → plain text (SSRF-safe)."""
    try:
        result = await scrape_public_url_to_text(req.url, req.max_chars)
        if result.get("ok"):
            return {"ok": True, "text": result["text"]}
        return {"ok": False, "text": result.get("text", "Scrape failed")}
    except Exception as e:
        logger.exception("tools/scrape failed: %s", e)
        raise HTTPException(
            status_code=503,
            detail=str(e) or "Scrape failed",
        ) from e


@app.post("/tools/weather")
async def tools_weather(req: WeatherRequest):
    """wttr.in JSON → same text format as Electron main."""
    try:
        data = await asyncio.to_thread(_fetch_wttr_json, req.city)
        text = _format_wttr_text(data, req.city.strip(), req.forecast)
        return {"ok": True, "text": text}
    except Exception as e:
        logger.exception("tools/weather failed: %s", e)
        raise HTTPException(
            status_code=503,
            detail=str(e) or "Weather failed",
        ) from e


@app.post("/tools/runware_proxy")
async def tools_runware_proxy(req: RunwareProxyRequest):
    """Proxy Runware tasks through local server to avoid renderer CORS/network issues."""
    base = req.api_base_url.strip().rstrip("/")
    if not base:
        raise HTTPException(status_code=400, detail="api_base_url is required")
    if not base.startswith("https://"):
        raise HTTPException(
            status_code=400, detail="Runware base URL must use https://"
        )
    key = req.api_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="api_key is required")
    if not req.tasks:
        raise HTTPException(status_code=400, detail="tasks must not be empty")
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
                json=req.tasks,
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


@app.post("/tools/desktop-settings-sync")
async def tools_desktop_settings_sync(req: DesktopSettingsSyncRequest):
    """Cache desktop app settings for LAN web clients (phone/browser)."""
    global _desktop_settings_cache, _desktop_settings_updated_at
    incoming = req.settings if isinstance(req.settings, dict) else {}
    if not incoming:
        raise HTTPException(status_code=400, detail="settings payload is required")
    _desktop_settings_cache = incoming
    _desktop_settings_updated_at = datetime.utcnow().isoformat() + "Z"
    return {"ok": True, "updatedAt": _desktop_settings_updated_at}


@app.get("/tools/desktop-settings")
async def tools_desktop_settings():
    """Return last synced desktop settings for web/LAN clients."""
    if _desktop_settings_cache is None:
        return {"ok": True, "hasSettings": False}
    return {
        "ok": True,
        "hasSettings": True,
        "updatedAt": _desktop_settings_updated_at,
        "settings": _desktop_settings_cache,
    }


@app.api_route(
    "/api/ollama/{full_path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS"],
)
async def ollama_proxy(request: Request, full_path: str):
    """Reverse proxy to Ollama (default http://127.0.0.1:11434). Set OLLAMA_BASE_URL."""
    target = f"{OLLAMA_BASE_URL}/{full_path}"
    if request.url.query:
        target = f"{target}?{request.url.query}"

    body = await request.body()
    fwd_headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower()
        not in (
            "host",
            "connection",
            "content-length",
            "transfer-encoding",
        )
    }

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
    except Exception:
        await client.aclose()
        raise

    hop_by_hop = {
        "connection",
        "transfer-encoding",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailers",
        "upgrade",
    }
    out_headers = {
        k: v
        for k, v in upstream.headers.items()
        if k.lower() not in hop_by_hop and k.lower() != "content-length"
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


@app.post("/tts")
async def tts(req: TtsRequest):
    """JSON: auto / design, ili voice clone preko ref_audio_base64 + opciono ref_text."""
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


_assets_dir = WEB_UI_DIR / "assets"
if _assets_dir.is_dir():
    app.mount(
        "/assets",
        StaticFiles(directory=str(_assets_dir)),
        name="web_assets",
    )


@app.get("/favicon.ico", include_in_schema=False)
async def web_favicon():
    p = WEB_UI_DIR / "favicon.ico"
    if p.is_file():
        return FileResponse(p)
    raise HTTPException(status_code=404, detail="Not found")


@app.get("/manifest.webmanifest", include_in_schema=False)
async def web_manifest():
    p = WEB_UI_DIR / "manifest.webmanifest"
    if p.is_file():
        return FileResponse(p, media_type="application/manifest+json")
    raise HTTPException(status_code=404, detail="Not found")


@app.get("/", include_in_schema=False)
async def web_ui_root():
    """Serve the Vite web build (`npm run build:web` in electron-app) for phone / LAN browsers."""
    index = _web_index_file()
    if index is None:
        raise HTTPException(
            status_code=404,
            detail="Web UI not built. Run: cd electron-app && npm run build:web",
        )
    return FileResponse(index)
