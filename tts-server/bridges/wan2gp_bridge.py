"""
Wan2GP bridge — spawn by Voidcast tools server through Wan2GP's venv Python.

Usage:
  <WAN2GP_VENV_PYTHON> wan2gp_bridge.py <WAN2GP_ROOT>

Reads a JSON config from stdin:
  {
    "action": "generate",
    "settings": { ... Wan2GP task dict ... },
    "output_dir": "optional absolute output folder (init output_dir)"
  }

Prints one JSON object to stdout (last line). WanGP may also write banner
lines to stdout before the JSON; the tools server parses the JSON line only.

Diagnostics go to stderr.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


IMG_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}
VID_EXT = {".mp4", ".webm", ".avi", ".mov", ".mkv"}


def _log(msg: str) -> None:
    print(f"[wan2gp-bridge] {msg}", file=sys.stderr, flush=True)


def _resolve_output_dir(raw: str, wan2gp_root: Path) -> Path | None:
    text = (raw or "").strip()
    if text:
        out = Path(text).expanduser().resolve()
        out.mkdir(parents=True, exist_ok=True)
        return out
    default = (wan2gp_root / "outputs").resolve()
    if default.is_dir():
        return default
    return None


def _resolve_file_path(
    raw: str,
    wan2gp_root: Path,
    output_dir: Path | None,
) -> str:
    p = Path(raw)
    if p.is_file():
        return str(p.resolve())
    if p.is_absolute():
        return str(p)
    bases: list[Path] = []
    if output_dir is not None:
        bases.append(output_dir)
    bases.extend([wan2gp_root / "outputs", wan2gp_root])
    for base in bases:
        candidate = (base / p).resolve()
        if candidate.is_file():
            return str(candidate)
    return str((wan2gp_root / p).resolve())


def _newest_image_in_dir(directory: Path) -> str | None:
    if not directory.is_dir():
        return None
    candidates = [
        p.resolve()
        for p in directory.rglob("*")
        if p.is_file() and p.suffix.lower() in IMG_EXT
    ]
    if not candidates:
        return None
    newest = max(candidates, key=lambda p: p.stat().st_mtime)
    return str(newest)


def main() -> None:
    if len(sys.argv) < 2:
        _log("ERROR: missing WAN2GP_ROOT argument")
        print(json.dumps({"ok": False, "errors": ["WAN2GP_ROOT not provided"]}))
        sys.exit(1)

    wan2gp_root = Path(sys.argv[1]).resolve()
    if not wan2gp_root.is_dir():
        _log(f"ERROR: {wan2gp_root} is not a directory")
        print(json.dumps({"ok": False, "errors": [f"WAN2GP_ROOT not found: {wan2gp_root}"]}))
        sys.exit(1)

    sys.path.insert(0, str(wan2gp_root))

    try:
        from shared.api import init  # type: ignore[import-not-found]
    except ImportError as e:
        _log(f"ERROR: cannot import shared.api from {wan2gp_root}: {e}")
        print(json.dumps({"ok": False, "errors": [f"Cannot import Wan2GP API: {e}"]}))
        sys.exit(1)

    try:
        raw = sys.stdin.read()
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        _log(f"ERROR: bad JSON on stdin: {e}")
        print(json.dumps({"ok": False, "errors": [f"Invalid JSON input: {e}"]}))
        sys.exit(1)

    action = payload.get("action", "generate")
    settings = payload.get("settings")
    if not isinstance(settings, dict):
        print(json.dumps({"ok": False, "errors": ["settings must be a dict"]}))
        sys.exit(1)

    output_dir = _resolve_output_dir(str(payload.get("output_dir") or ""), wan2gp_root)
    _log(f"action={action}  root={wan2gp_root}  output_dir={output_dir or '(default)'}")

    init_kwargs: dict = {
        "root": wan2gp_root,
        "console_output": False,
    }
    if output_dir is not None:
        init_kwargs["output_dir"] = output_dir

    try:
        session = init(**init_kwargs)
    except Exception as e:
        _log(f"ERROR: init failed: {e}")
        print(json.dumps({"ok": False, "errors": [f"Wan2GP init failed: {e}"]}))
        sys.exit(1)

    try:
        job = session.submit_task(settings)
        result = job.result()
    except Exception as e:
        _log(f"ERROR: generation failed: {e}")
        print(json.dumps({"ok": False, "errors": [f"Generation failed: {e}"]}))
        sys.exit(1)

    generated = [str(p) for p in result.generated_files] if result.generated_files else []
    errors = [str(e) for e in result.errors] if result.errors else []

    images: list[str] = []
    videos: list[str] = []
    seen: set[str] = set()

    def _add(path: str, bucket: list[str]) -> None:
        resolved = _resolve_file_path(path, wan2gp_root, output_dir)
        if resolved in seen:
            return
        seen.add(resolved)
        bucket.append(resolved)

    artifacts = getattr(result, "artifacts", None) or ()
    for artifact in artifacts:
        path = str(getattr(artifact, "path", "") or "").strip()
        if not path:
            continue
        media = str(getattr(artifact, "media_type", "") or "").lower()
        if media == "image":
            _add(path, images)
        elif media == "video":
            _add(path, videos)

    for f in generated:
        ext = Path(f).suffix.lower()
        if ext in IMG_EXT:
            _add(f, images)
        elif ext in VID_EXT:
            _add(f, videos)

    if not images and output_dir is not None:
        fallback = _newest_image_in_dir(output_dir)
        if fallback:
            _log(f"fallback newest image: {fallback}")
            _add(fallback, images)

    other = [f for f in generated if _resolve_file_path(f, wan2gp_root, output_dir) not in images + videos]
    sorted_files = images + videos + other

    _log(f"done  images={len(images)}  videos={len(videos)}  other={len(other)}  errors={len(errors)}")
    print(json.dumps({
        "ok": bool(result.success) or bool(images) or bool(videos),
        "generated_files": sorted_files,
        "image_files": images,
        "video_files": videos,
        "output_dir": str(output_dir) if output_dir else "",
        "errors": errors,
    }))


if __name__ == "__main__":
    main()
