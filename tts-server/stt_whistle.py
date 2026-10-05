"""
Local speech-to-text via cactus-needle (Whistle model).

Whistle is a ~16.9 MB `.cact` model that runs on CPU with no Python ML stack.
It accepts a 16 kHz mono WAV path (or raw samples). The Electron renderer
decodes the microphone WebM recording and resamples it to 16 kHz mono WAV
before POSTing it to `/stt/transcribe`, so this module only needs the base
`cactus-needle` install (no `[mic]` extra required).

Weights resolution order:
  1. `VOIDCAST_WHISTLE_WEIGHTS` env var (explicit override).
  2. `<sys._MEIPASS>/whistle.cact` when frozen (PyInstaller bundle).
  3. `~/.cache/cactus-needle/whistle/2.0.0/whistle.cact` (needle's own cache).

If the resolved weights file does not exist we pass `weights=None` and let
needle fall back to its default cache lookup.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Any

logger = logging.getLogger("stt_whistle")

_import_error: str | None = None

try:  # Optional dependency: server must boot even when cactus-needle is absent.
    import needle as _needle  # type: ignore

    HAS_NEEDLE = True
except Exception as exc:  # pragma: no cover - import guard
    _needle = None  # type: ignore
    HAS_NEEDLE = False
    _import_error = f"{type(exc).__name__}: {exc}"


def _default_cache_weights() -> Path:
    return Path.home() / ".cache" / "cactus-needle" / "whistle" / "2.0.0" / "whistle.cact"


def _resolve_weights() -> str | None:
    """Return an explicit path to whistle.cact, or None to use needle's cache."""
    env_path = (os.environ.get("VOIDCAST_WHISTLE_WEIGHTS") or "").strip()
    if env_path:
        return env_path if Path(env_path).is_file() else None
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        bundled = Path(meipass) / "whistle.cact"
        if bundled.is_file():
            return str(bundled)
    cache = _default_cache_weights()
    if cache.is_file():
        return str(cache)
    return None


def _ensure_library_env() -> None:
    """Point needle at the bundled libneedle engine when frozen (onefile bundle).

    needle resolves its native engine via the `NEEDLE_LIB_PATH` env var
    (fallback `NEEDLE3_LIB_PATH`), so setting it here keeps the bundled DLL
    self-contained without needing the ~/.cache/cactus-needle download on a
    fresh machine.
    """
    if os.environ.get("NEEDLE_LIB_PATH"):
        return
    meipass = getattr(sys, "_MEIPASS", None)
    if not meipass:
        return
    dll = Path(meipass) / "libneedle.dll"
    if dll.is_file():
        os.environ["NEEDLE_LIB_PATH"] = str(dll)


def transcribe_wav(path: str) -> dict[str, Any]:
    """Transcribe a 16 kHz mono WAV path with Whistle.

    Returns `{"text": str, "language": str | None}`.
    Raises RuntimeError when cactus-needle is not installed.
    """
    if not HAS_NEEDLE or _needle is None:
        raise RuntimeError(
            "cactus-needle is not installed in the tools-server interpreter"
            " (pip install cactus-needle)"
            + (f" — import failed: {_import_error}" if _import_error else "")
        )

    _ensure_library_env()
    weights = _resolve_weights()
    kwargs: dict[str, Any] = {}
    if weights:
        kwargs["weights"] = weights
    result = _needle.transcribe(path, **kwargs)  # type: ignore[union-attr]
    if not isinstance(result, dict):
        return {"text": str(result or ""), "language": None}
    return {
        "text": str(result.get("text") or ""),
        "language": result.get("language"),
    }
