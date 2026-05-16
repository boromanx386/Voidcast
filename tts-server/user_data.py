"""In-memory long memory + reminders sync for LAN web ↔ desktop (no API keys)."""

from __future__ import annotations

import time
from typing import Any

_long_memories: dict[str, dict[str, Any]] = {}
_reminders: dict[str, dict[str, Any]] = {}
_deleted_memory_at: dict[str, int] = {}
_deleted_reminder_at: dict[str, int] = {}
_updated_at: str | None = None


def _now_ms() -> int:
    return int(time.time() * 1000)


def _item_updated_at(item: dict[str, Any]) -> int:
    for key in ("updatedAt", "updated_at", "createdAt", "created_at"):
        raw = item.get(key)
        if isinstance(raw, (int, float)) and raw > 0:
            return int(raw)
    return 0


def _apply_memory_deletes(deleted_ids: list[str] | None, deleted_at: int) -> None:
    if not deleted_ids:
        return
    for raw_id in deleted_ids:
        if not isinstance(raw_id, str) or not raw_id.strip():
            continue
        item_id = raw_id.strip()
        _deleted_memory_at[item_id] = deleted_at
        _long_memories.pop(item_id, None)


def _apply_reminder_deletes(deleted_ids: list[str] | None, deleted_at: int) -> None:
    if not deleted_ids:
        return
    for raw_id in deleted_ids:
        if not isinstance(raw_id, str) or not raw_id.strip():
            continue
        item_id = raw_id.strip()
        _deleted_reminder_at[item_id] = deleted_at
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
    if tomb is not None and tomb > updated:
        return
    if tomb is not None and updated >= tomb:
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
    if tomb is not None and tomb > updated:
        return
    if tomb is not None and updated >= tomb:
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
    _apply_memory_deletes(payload.get("deletedMemoryIds"), deleted_at)
    _apply_reminder_deletes(payload.get("deletedReminderIds"), deleted_at)

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
