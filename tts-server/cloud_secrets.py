"""In-memory cloud API keys for LAN web proxy (phone never receives them)."""

from __future__ import annotations

import os
from typing import Any

_registered: dict[str, str] = {}


def _env_key(name: str) -> str:
    return os.environ.get(name, "").strip()


def _merged() -> dict[str, str]:
    out = {
        "openrouter": _env_key("OPENROUTER_API_KEY"),
        "runware": _env_key("RUNWARE_API_KEY"),
        "nvidia": _env_key("NVIDIA_API_KEY"),
        "deepseek": _env_key("DEEPSEEK_API_KEY"),
    }
    for k, v in _registered.items():
        if v:
            out[k] = v
    return out


def register_secrets(payload: dict[str, Any]) -> None:
    """Desktop-only registration; overwrites in-memory keys until process exit."""
    mapping = {
        "openrouterApiKey": "openrouter",
        "runwareApiKey": "runware",
        "nvidiaApiKey": "nvidia",
        "deepseekApiKey": "deepseek",
    }
    for field, slot in mapping.items():
        raw = payload.get(field)
        if isinstance(raw, str) and raw.strip():
            _registered[slot] = raw.strip()


def get_openrouter_key() -> str:
    return _merged().get("openrouter", "")


def get_runware_key() -> str:
    return _merged().get("runware", "")


def get_nvidia_key() -> str:
    return _merged().get("nvidia", "")


def get_deepseek_key() -> str:
    return _merged().get("deepseek", "")


def client_may_register(client_host: str | None, token_header: str | None) -> bool:
    expected = _env_key("VOIDCAST_SECRETS_TOKEN")
    if expected:
        return (token_header or "").strip() == expected
    host = (client_host or "").strip().lower()
    return host in ("127.0.0.1", "::1", "localhost")
