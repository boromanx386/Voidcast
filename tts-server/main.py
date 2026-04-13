"""
OmniVoice TTS HTTP API for the Electron chat app.

Run:  python -m uvicorn main:app --host 127.0.0.1 --port 8765 --app-dir tts-server

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
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from youtube_tools import (
    HAS_YOUTUBE_TRANSCRIPT,
    HAS_YTDLP,
    youtube_tool_run,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tts-server")

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
    """Same idea as locAI search_web: text search via ddgs (metasearch)."""
    if not _HAS_DDGS or DDGS is None:
        raise RuntimeError("ddgs is not installed (pip install ddgs)")
    q = query.strip()
    if not q:
        return "Empty query."
    current_year = datetime.now().year
    q = re.sub(r"\b(20\d{2})\b", str(current_year), q)
    with DDGS(timeout=20) as ddgs:  # type: ignore[misc]
        results = list(ddgs.text(q, max_results=10))
    if not results:
        return "No results found."
    out: list[str] = []
    for r in results:
        body = (r.get("body") or "").strip()
        if len(body) < 15:
            continue
        title = r.get("title") or ""
        link = r.get("href") or r.get("url") or ""
        out.append(f"{title}\n{body[:400]}\n{link}")
        if len(out) >= 7:
            break
    if not out:
        return "No usable text snippets in results."
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
