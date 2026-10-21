"""
Client for the out-of-process DuckDuckGo worker (`search_core.py`).

The API server never imports `ddgs`. It talks to a small pool of child processes
that speak one JSON line per request/response. Rationale (measured, not theory):
`ddgs` uses the native `primp` client and py-spy --native caught its threads
parked inside `primp` *while holding the GIL* — `/health` accepted TCP and never
answered, so search, the OpenCode Go proxy and local ASR all failed together in
the UI as "fail to fetch".

A stuck thread cannot be interrupted. A process can be killed, so every request
has a hard deadline and a timeout kills the worker instead of the server. The
pool respawns lazily on the next call.

Public surface:
    `search_pool()`            -> module-level pool (2 workers)
    `SearchPool.request(...)`  -> blocking call, thread-safe, raises SearchError
"""

from __future__ import annotations

import json
import logging
import os
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger("tts-server.search")

# The worker imports the ddgs client, which is what used to freeze the server.
# Keep this generous: one search may run three backend passes.
DEFAULT_TIMEOUT_S = 25.0
# A worker failure that returns faster than this was a crash (dead pipe, process
# gone), not a wedge — only then is a transparent retry worth it.
FAST_FAIL_S = 5.0
# In the frozen build a worker is another launch of the same one-file exe, and the
# PyInstaller bootloader unpacks the whole bundle into %TEMP% for it — several
# hundred MB and a second or two. Workers are long-lived and reused, so one is
# enough there; the dev interpreter is cheap, so two searches can overlap.
POOL_SIZE = 1 if getattr(sys, "frozen", False) else 2


class SearchError(RuntimeError):
    """A worker request failed (or the worker had to be killed)."""


class SearchWorkerDown(SearchError):
    """The worker process itself died or was killed, so one retry is worth it."""


class _Worker:
    """One child process speaking JSON lines over stdin/stdout."""

    def __init__(self, cmd: list[str], cwd: str, env: dict[str, str]) -> None:
        self._cmd = cmd
        self._cwd = cwd
        self._env = env
        self._proc: subprocess.Popen[str] | None = None
        self._lines: queue.Queue[str | None] = queue.Queue()
        self._lock = threading.Lock()

    # -- lifecycle ---------------------------------------------------------
    def _spawn(self) -> subprocess.Popen[str]:
        proc = subprocess.Popen(  # noqa: S603 - fixed argv, no shell
            self._cmd,
            cwd=self._cwd,
            env=self._env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=None,  # inherit: worker logs land in the server log
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        reader = threading.Thread(
            target=self._pump, args=(proc,), daemon=True, name="search-worker-out"
        )
        reader.start()
        self._proc = proc
        return proc

    def _pump(self, proc: subprocess.Popen[str]) -> None:
        assert proc.stdout is not None
        try:
            for line in proc.stdout:
                self._lines.put(line)
        except Exception:  # noqa: BLE001 - stream dies with the process
            pass
        finally:
            self._lines.put(None)

    def _kill(self) -> None:
        proc = self._proc
        self._proc = None
        if proc is None:
            return
        try:
            if proc.poll() is None:
                proc.kill()
                proc.wait(timeout=5)
        except Exception:  # noqa: BLE001
            logger.warning("search worker: kill failed", exc_info=True)
        # Drop stale replies so the next request cannot read one.
        while True:
            try:
                self._lines.get_nowait()
            except queue.Empty:
                break

    def close(self) -> None:
        with self._lock:
            proc = self._proc
            self._proc = None
            if proc is None:
                return
            try:
                if proc.stdin is not None and proc.poll() is None:
                    proc.stdin.close()
                proc.wait(timeout=3)
            except Exception:  # noqa: BLE001
                try:
                    proc.kill()
                except Exception:  # noqa: BLE001
                    pass

    # -- request/response --------------------------------------------------
    def request(self, payload: dict[str, Any], timeout_s: float) -> Any:
        """Send one request and wait for its reply. Kills the worker on timeout."""
        with self._lock:
            proc = self._proc
            if proc is None or proc.poll() is not None:
                if proc is not None:
                    self._kill()
                proc = self._spawn()
            if proc.stdin is None:
                self._kill()
                raise SearchWorkerDown("search worker has no stdin")
            try:
                proc.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
                proc.stdin.flush()
            except Exception as e:  # noqa: BLE001
                self._kill()
                raise SearchWorkerDown(f"search worker pipe closed: {e}") from e

            deadline = time.monotonic() + timeout_s
            reply: dict[str, Any] | None = None
            while reply is None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    # This is the whole point of the design: a wedged native call
                    # dies with its process, the API server keeps serving.
                    logger.error(
                        "search worker did not answer in %.0fs — killing it", timeout_s
                    )
                    self._kill()
                    raise SearchWorkerDown(
                        f"search worker timed out after {timeout_s:.0f}s"
                    )
                try:
                    line = self._lines.get(timeout=remaining)
                except queue.Empty:
                    continue
                if line is None:
                    self._kill()
                    raise SearchWorkerDown("search worker exited")
                line = line.strip()
                if not line:
                    continue
                try:
                    parsed = json.loads(line)
                except json.JSONDecodeError:
                    # The frozen build prints bootloader/warning noise on stdout
                    # before the first reply; the protocol has to survive that.
                    logger.debug("search worker noise: %s", line[:200])
                    continue
                if not isinstance(parsed, dict):
                    continue
                reply = parsed
            if not reply.get("ok"):
                raise SearchError(str(reply.get("error") or "search failed"))
            return reply.get("rows") or []


class SearchPool:
    """A tiny pool of `_Worker` processes, thread-safe and self-healing."""

    def __init__(self, size: int = POOL_SIZE) -> None:
        self._free: queue.Queue[_Worker | None] = queue.Queue()
        self._size = size
        self._lock = threading.Lock()
        self._cmd, self._cwd, self._env = self._worker_invocation()
        for _ in range(size):
            self._free.put(None)  # spawned on first use

    @staticmethod
    def _worker_invocation() -> tuple[list[str], str, dict[str, str]]:
        env = dict(os.environ)
        env["VOIDCAST_SEARCH_WORKER"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"
        env["PYTHONUNBUFFERED"] = "1"
        if getattr(sys, "frozen", False):
            # Bundled build: the exe re-enters itself as the worker (see
            # tools_exe_entry.py) instead of starting uvicorn.
            return [sys.executable], str(Path(sys.executable).parent), env
        mod_dir = Path(__file__).resolve().parent
        return (
            [
                sys.executable,
                "-u",
                "-c",
                "import search_core; search_core.worker_main()",
            ],
            str(mod_dir),
            env,
        )

    def request(
        self,
        payload: dict[str, Any],
        timeout_s: float = DEFAULT_TIMEOUT_S,
    ) -> Any:
        started = time.monotonic()
        try:
            return self._attempt(payload, timeout_s)
        except SearchWorkerDown as e:
            # A crashed or killed worker must not reach the caller as a failed
            # search: the dead process is already gone, so one retry gets a fresh
            # one. A wedged worker already burned the whole budget, so it is not
            # retried here — the next call gets a fresh process.
            if time.monotonic() - started > FAST_FAIL_S:
                raise
            logger.warning("search worker failed (%s) — retrying once", e)
            return self._attempt(payload, timeout_s)

    def _attempt(self, payload: dict[str, Any], timeout_s: float) -> Any:
        try:
            slot = self._free.get(timeout=timeout_s)
        except queue.Empty:
            raise SearchError("all search workers are busy") from None
        worker = slot
        try:
            if worker is None:
                worker = _Worker(self._cmd, self._cwd, self._env)
            return worker.request(payload, timeout_s)
        except SearchError:
            # A worker that timed out was killed inside request(); drop it so the
            # next attempt spawns a fresh one instead of reusing a dead pipe.
            worker = None
            raise
        finally:
            self._free.put(worker)

    def close(self) -> None:
        while True:
            try:
                slot = self._free.get_nowait()
            except queue.Empty:
                return
            if slot is not None:
                slot.close()


_POOL: SearchPool | None = None
_POOL_LOCK = threading.Lock()


def search_pool() -> SearchPool:
    global _POOL
    with _POOL_LOCK:
        if _POOL is None:
            _POOL = SearchPool()
        return _POOL


def close_search_pool() -> None:
    global _POOL
    with _POOL_LOCK:
        pool, _POOL = _POOL, None
    if pool is not None:
        pool.close()
