"""Host-side tool paths pushed from desktop Voidcast (LAN web clients read them)."""

from __future__ import annotations

from typing import Any

_registered: dict[str, str] = {}


def register_host_tool_config(payload: dict[str, Any]) -> None:
    """Desktop-only registration; survives until tools server process exits."""
    raw = payload.get("pdfOutputDir")
    if isinstance(raw, str) and raw.strip():
        _registered["pdf_output_dir"] = raw.strip()


def clear_host_tool_config() -> None:
    """Drop desktop-pushed host paths from memory."""
    _registered.clear()


def get_pdf_output_dir() -> str:
    return _registered.get("pdf_output_dir", "").strip()


def get_snapshot() -> dict[str, Any]:
    return {"ok": True, "pdf_output_dir": get_pdf_output_dir()}
