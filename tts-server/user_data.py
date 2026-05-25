"""Persistent long memory + reminders sync for LAN web ↔ desktop (no API keys)."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

_long_memories: dict[str, dict[str, Any]] = {}
_reminders: dict[str, dict[str, Any]] = {}
_deleted_memory_at: dict[str, int] = {}
_deleted_reminder_at: dict[str, int] = {}
_updated_at: str | None = None


def _now_ms() -> int:
    return int(time.time() * 1000)


def _default_store_path() -> Path:
    env = os.environ.get("VOIDCAST_USER_DATA_PATH", "").strip()
    if env:
        return Path(env)
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
        return base / "Voidcast" / "user-data-sync.json"
    xdg_state = os.environ.get("XDG_STATE_HOME", "").strip()
    if xdg_state:
        return Path(xdg_state) / "voidcast" / "user-data-sync.json"
    return Path.home() / ".local" / "state" / "voidcast" / "user-data-sync.json"


_STORE_PATH = _default_store_path()


def _item_updated_at(item: dict[str, Any]) -> int:
    for key in ("updatedAt", "updated_at", "createdAt", "created_at"):
        raw = item.get(key)
        if isinstance(raw, (int, float)) and raw > 0:
            return int(raw)
    return 0


def _normalize_deleted_at_map(raw: Any) -> dict[str, int]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, int] = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not key.strip():
            continue
        if isinstance(value, (int, float)) and value > 0:
            out[key.strip()] = int(value)
    return out


def _persist_state() -> None:
    payload = {
        "updatedAt": _updated_at,
        "longMemories": list(_long_memories.values()),
        "reminders": list(_reminders.values()),
        "deletedMemoryAt": dict(_deleted_memory_at),
        "deletedReminderAt": dict(_deleted_reminder_at),
    }
    try:
        _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = _STORE_PATH.with_suffix(f"{_STORE_PATH.suffix}.tmp")
        tmp_path.write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")
        tmp_path.replace(_STORE_PATH)
    except Exception:
        return


def _load_state() -> None:
    global _updated_at
    if not _STORE_PATH.is_file():
        return
    try:
        raw = json.loads(_STORE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return
    if not isinstance(raw, dict):
        return

    long_memories = raw.get("longMemories")
    if isinstance(long_memories, list):
        for item in long_memories:
            if isinstance(item, dict):
                item_id = item.get("id")
                if isinstance(item_id, str) and item_id.strip():
                    _long_memories[item_id.strip()] = item

    reminders = raw.get("reminders")
    if isinstance(reminders, list):
        for item in reminders:
            if isinstance(item, dict):
                item_id = item.get("id")
                if isinstance(item_id, str) and item_id.strip():
                    _reminders[item_id.strip()] = item

    _deleted_memory_at.update(_normalize_deleted_at_map(raw.get("deletedMemoryAt")))
    _deleted_reminder_at.update(_normalize_deleted_at_map(raw.get("deletedReminderAt")))
    updated_at = raw.get("updatedAt")
    if isinstance(updated_at, str) and updated_at.strip():
        _updated_at = updated_at


def _delete_ts_for(item_id: str, deleted_at_map: dict[str, int], fallback_deleted_at: int) -> int:
    ts = deleted_at_map.get(item_id, 0)
    return ts if ts > 0 else fallback_deleted_at


def _apply_memory_deletes(
    deleted_ids: list[str] | None,
    deleted_at_map: dict[str, int],
    fallback_deleted_at: int,
) -> None:
    if not deleted_ids:
        return
    for raw_id in deleted_ids:
        if not isinstance(raw_id, str) or not raw_id.strip():
            continue
        item_id = raw_id.strip()
        tomb = max(
            _deleted_memory_at.get(item_id, 0),
            _delete_ts_for(item_id, deleted_at_map, fallback_deleted_at),
        )
        _deleted_memory_at[item_id] = tomb
        existing = _long_memories.get(item_id)
        if existing is None or _item_updated_at(existing) <= tomb:
            _long_memories.pop(item_id, None)


def _apply_reminder_deletes(
    deleted_ids: list[str] | None,
    deleted_at_map: dict[str, int],
    fallback_deleted_at: int,
) -> None:
    if not deleted_ids:
        return
    for raw_id in deleted_ids:
        if not isinstance(raw_id, str) or not raw_id.strip():
            continue
        item_id = raw_id.strip()
        tomb = max(
            _deleted_reminder_at.get(item_id, 0),
            _delete_ts_for(item_id, deleted_at_map, fallback_deleted_at),
        )
        _deleted_reminder_at[item_id] = tomb
        existing = _reminders.get(item_id)
        if existing is None or _item_updated_at(existing) <= tomb:
            _reminders.pop(item_id, None)


def _merge_memory_item(item: dict[str, Any]) -> None:
    if not isinstance(item, dict):
        return
    raw_id = item.get("id")
    if not isinstance(raw_id, str) or not raw_id.strip():
        return
    item_id = raw_id.strip()
    updated = _item_updated_at(item)
    tomb = _deleted_memory_at.get(item_id)
    if tomb is not None and tomb >= updated:
        return
    if tomb is not None and updated > tomb:
        _deleted_memory_at.pop(item_id, None)
    prev = _long_memories.get(item_id)
    if prev is None or _item_updated_at(prev) <= updated:
        _long_memories[item_id] = item


def _merge_reminder_item(item: dict[str, Any]) -> None:
    if not isinstance(item, dict):
        return
    raw_id = item.get("id")
    if not isinstance(raw_id, str) or not raw_id.strip():
        return
    item_id = raw_id.strip()
    updated = _item_updated_at(item)
    tomb = _deleted_reminder_at.get(item_id)
    if tomb is not None and tomb >= updated:
        return
    if tomb is not None and updated > tomb:
        _deleted_reminder_at.pop(item_id, None)
    prev = _reminders.get(item_id)
    if prev is None:
        merged = dict(item)
    elif _item_updated_at(prev) <= updated:
        merged = dict(item)
    else:
        merged = dict(prev)
    for source in (item, prev) if prev is not None else (item,):
        raw = source.get("notifiedAt")
        if isinstance(raw, (int, float)) and int(raw) > 0:
            existing = merged.get("notifiedAt")
            if not isinstance(existing, (int, float)) or int(raw) > int(existing):
                merged["notifiedAt"] = int(raw)
    _reminders[item_id] = merged


def apply_sync(payload: dict[str, Any]) -> None:
    """Merge client snapshot into server store (bidirectional LAN sync)."""
    global _updated_at
    deleted_at = _now_ms()
    deleted_memory_at = _normalize_deleted_at_map(payload.get("deletedMemoryAt"))
    deleted_reminder_at = _normalize_deleted_at_map(payload.get("deletedReminderAt"))
    _apply_memory_deletes(payload.get("deletedMemoryIds"), deleted_memory_at, deleted_at)
    _apply_reminder_deletes(
        payload.get("deletedReminderIds"), deleted_reminder_at, deleted_at
    )

    memories = payload.get("longMemories")
    if isinstance(memories, list):
        for item in memories:
            if isinstance(item, dict):
                _merge_memory_item(item)

    reminders = payload.get("reminders")
    if isinstance(reminders, list):
        for item in reminders:
            if isinstance(item, dict):
                _merge_reminder_item(item)

    _updated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    _persist_state()


def get_snapshot() -> dict[str, Any]:
    memories = [
        m
        for item_id, m in _long_memories.items()
        if _deleted_memory_at.get(item_id, 0) <= _item_updated_at(m)
    ]
    reminders = [
        r
        for item_id, r in _reminders.items()
        if _deleted_reminder_at.get(item_id, 0) <= _item_updated_at(r)
    ]
    memories.sort(key=_item_updated_at, reverse=True)
    reminders.sort(key=_item_updated_at, reverse=True)
    return {
        "ok": True,
        "updatedAt": _updated_at,
        "longMemories": memories,
        "reminders": reminders,
        "deletedMemoryIds": list(_deleted_memory_at.keys()),
        "deletedReminderIds": list(_deleted_reminder_at.keys()),
        "deletedMemoryAt": dict(_deleted_memory_at),
        "deletedReminderAt": dict(_deleted_reminder_at),
    }


_load_state()
