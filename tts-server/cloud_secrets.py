"""In-memory cloud API keys for LAN web proxy (phone never receives them)."""

from __future__ import annotations

import os
import secrets as _secrets
from typing import Any

_registered: dict[str, str] = {}

# Shared access token required from non-loopback LAN web clients (phones/tablets).
# Priority: VOIDCAST_LAN_ACCESS_TOKEN > VOIDCAST_SECRETS_TOKEN > random per-process.
_lan_access_token: str | None = None


def _env_key(name: str) -> str:
    return os.environ.get(name, "").strip()


def get_lan_access_token() -> str:
    """Return the token LAN web clients must send to use the proxy/data endpoints.

    Loopback (the desktop app) is always allowed and does not need this token; it is
    fetched by the desktop LAN panel and embedded in the phone's QR / connection URL.
    """
    global _lan_access_token
    if _lan_access_token is None:
        _lan_access_token = (
            _env_key("VOIDCAST_LAN_ACCESS_TOKEN")
            or _env_key("VOIDCAST_SECRETS_TOKEN")
            or _secrets.token_urlsafe(24)
        )
    return _lan_access_token


def _merged() -> dict[str, str]:
    out = {
        "openrouter": _env_key("OPENROUTER_API_KEY"),
        "runware": _env_key("RUNWARE_API_KEY"),
        "nvidia": _env_key("NVIDIA_API_KEY"),
        "deepseek": _env_key("DEEPSEEK_API_KEY"),
        "openai": _env_key("OPENAI_API_KEY"),
        "opencode_go": _env_key("OPENCODE_GO_API_KEY"),
        "crofai": _env_key("CROFAI_API_KEY"),
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
        "openaiApiKey": "openai",
        "opencodeGoApiKey": "opencode_go",
        "crofaiApiKey": "crofai",
    }
    for field, slot in mapping.items():
        raw = payload.get(field)
        if isinstance(raw, str) and raw.strip():
            _registered[slot] = raw.strip()


def clear_registered_secrets() -> None:
    """Drop desktop-pushed keys from memory (env fallbacks still apply if set)."""
    _registered.clear()


def get_openrouter_key() -> str:
    return _merged().get("openrouter", "")


def get_runware_key() -> str:
    return _merged().get("runware", "")


def get_nvidia_key() -> str:
    return _merged().get("nvidia", "")


def get_deepseek_key() -> str:
    return _merged().get("deepseek", "")


def get_openai_key() -> str:
    return _merged().get("openai", "")


def get_opencode_go_key() -> str:
    return _merged().get("opencode_go", "")


def get_crofai_key() -> str:
    return _merged().get("crofai", "")


def client_may_register(client_host: str | None, token_header: str | None) -> bool:
    expected = _env_key("VOIDCAST_SECRETS_TOKEN")
    if expected:
        return (token_header or "").strip() == expected
    host = (client_host or "").strip().lower()
    return host in ("127.0.0.1", "::1", "localhost")
