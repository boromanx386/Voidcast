"""In-memory cloud API keys for LAN web proxy (phone never receives them)."""

from __future__ import annotations

import os
import secrets as _secrets
from typing import Any

_registered: dict[str, str] = {}

# None means pairing is off. Reading the token must never enable access.
_lan_access_token: str | None = None


def _env_key(name: str) -> str:
    return os.environ.get(name, "").strip()


def get_lan_access_token() -> str | None:
    return _lan_access_token


def _merged() -> dict[str, str]:
    out = {
        "openrouter": _env_key("OPENROUTER_API_KEY"),
        "runware": _env_key("RUNWARE_API_KEY"),
        "nvidia": _env_key("NVIDIA_API_KEY"),
        "deepseek": _env_key("DEEPSEEK_API_KEY"),
        "openai": _env_key("OPENAI_API_KEY"),
        "opencode_go": _env_key("OPENCODE_GO_API_KEY"),
    }
    for k, v in _registered.items():
        if v:
            out[k] = v
    return out


def register_secrets(payload: dict[str, Any], *, renew_pairing: bool = False) -> str:
    """Refresh desktop keys and issue one pairing token per enabled session."""
    global _lan_access_token
    mapping = {
        "openrouterApiKey": "openrouter",
        "runwareApiKey": "runware",
        "nvidiaApiKey": "nvidia",
        "deepseekApiKey": "deepseek",
        "openaiApiKey": "openai",
        "opencodeGoApiKey": "opencode_go",
    }
    for field, slot in mapping.items():
        raw = payload.get(field)
        if isinstance(raw, str):
            if raw.strip():
                _registered[slot] = raw.strip()
            else:
                _registered.pop(slot, None)
    if renew_pairing or _lan_access_token is None:
        _lan_access_token = _secrets.token_urlsafe(32)
    return _lan_access_token


def clear_registered_secrets() -> None:
    """Drop desktop-pushed keys from memory (env fallbacks still apply if set)."""
    global _lan_access_token
    _lan_access_token = None
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
