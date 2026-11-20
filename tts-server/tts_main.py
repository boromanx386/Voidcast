"""
Local TTS-enabled server entrypoint.

Usage:
  python -m uvicorn tts_main:app --host 127.0.0.1 --port 8765 --app-dir tts-server
"""

from __future__ import annotations

import os

os.environ["OMNIVOICE_ENABLE_TTS"] = "1"

from main import app  # noqa: E402,F401
