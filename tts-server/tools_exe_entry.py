"""
Executable entrypoint for the bundled tools-only backend.

This file is intended for PyInstaller one-file builds so end users do not need
to install Python manually.

The same exe also serves as the DuckDuckGo search worker: the server spawns it
with VOIDCAST_SEARCH_WORKER=1, and it then speaks the JSON stdio protocol from
`search_core` instead of starting uvicorn. That keeps the native ddgs/primp code
in a process the server can kill (see search_client.py for why).
"""

from __future__ import annotations

import os
import sys


def _run_search_worker() -> None:
    from search_core import worker_main

    worker_main()


def main() -> None:
    os.environ["OMNIVOICE_ENABLE_TTS"] = "0"

    # Branch BEFORE importing tools_main: the worker has no use for FastAPI/uvicorn
    # and loading the whole app would add seconds to every worker spawn.
    if os.environ.get("VOIDCAST_SEARCH_WORKER") == "1":
        _run_search_worker()
        return

    import uvicorn

    from tools_main import app

    host = os.environ.get("VOIDCAST_TOOLS_HOST", "0.0.0.0")
    port_raw = os.environ.get("VOIDCAST_TOOLS_PORT", "8765")
    try:
        port = int(port_raw)
    except ValueError:
        port = 8765
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    # A killed worker must not print a traceback for the exit code it got.
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
