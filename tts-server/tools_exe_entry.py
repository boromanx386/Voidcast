"""
Executable entrypoint for the bundled tools-only backend.

This file is intended for PyInstaller one-file builds so end users do not need
to install Python manually.
"""

from __future__ import annotations

import os

import uvicorn

os.environ["OMNIVOICE_ENABLE_TTS"] = "0"

from tools_main import app  # noqa: E402


def main() -> None:
    host = os.environ.get("VOIDCAST_TOOLS_HOST", "127.0.0.1")
    port_raw = os.environ.get("VOIDCAST_TOOLS_PORT", "8765")
    try:
        port = int(port_raw)
    except ValueError:
        port = 8765
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
