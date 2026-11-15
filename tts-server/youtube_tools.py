"""YouTube search + metadata + transcript (yt-dlp + youtube-transcript-api)."""

from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger("tts-server.youtube")

try:
    from yt_dlp import YoutubeDL

    HAS_YTDLP = True
except ImportError:
    YoutubeDL = None  # type: ignore[misc, assignment]
    HAS_YTDLP = False

try:
    from youtube_transcript_api import YouTubeTranscriptApi

    HAS_YOUTUBE_TRANSCRIPT = True
except ImportError:
    YouTubeTranscriptApi = None  # type: ignore[misc, assignment]
    HAS_YOUTUBE_TRANSCRIPT = False

_YT_ID_RE = re.compile(
    r"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/|youtube\.com/shorts/)([a-zA-Z0-9_-]{11})"
)

# Cap transcript size for LLM payloads (chars)
MAX_TRANSCRIPT_CHARS = 120_000

# yt-dlp has no socket timeout by default, so a throttled YouTube connection would
# hold a tools-pool thread indefinitely.
YTDLP_SOCKET_TIMEOUT_S = 10


def extract_youtube_video_id(url: str) -> str | None:
    s = url.strip()
    m = _YT_ID_RE.search(s)
    if m:
        return m.group(1)
    if "watch?v=" in s:
        part = s.split("watch?v=", 1)[1].split("&")[0].strip()
        if len(part) == 11 and re.match(r"^[a-zA-Z0-9_-]+$", part):
            return part
    if "youtu.be/" in s:
        part = s.split("youtu.be/", 1)[1].split("?")[0].strip()
        if len(part) == 11:
            return part
    return None


def _fetched_to_plain_text(data: Any) -> str:
    """Turn FetchedTranscript, iterable of dicts, or snippets into one string."""
    if data is None:
        return ""
    if hasattr(data, "snippets"):
        return " ".join(s.text.strip() for s in data.snippets if getattr(s, "text", None))
    parts: list[str] = []
    for item in data:
        if isinstance(item, dict):
            t = item.get("text")
            if t:
                parts.append(str(t).strip())
        else:
            t = getattr(item, "text", None)
            if t:
                parts.append(str(t).strip())
    return " ".join(parts)


def _fetch_transcript_text(video_id: str) -> tuple[str, str | None]:
    """
    Returns (text, error_message_if_empty).
    Tries English first, then any available transcript.
    """
    if not HAS_YOUTUBE_TRANSCRIPT or YouTubeTranscriptApi is None:
        return (
            "",
            "Transcript requires: pip install youtube-transcript-api",
        )

    api = YouTubeTranscriptApi()
    try:
        fetched = api.fetch(video_id, languages=["en", "en-US", "en-GB"])
        text = _fetched_to_plain_text(fetched).strip()
        if text:
            return _maybe_truncate(text), None
    except Exception as first_err:
        logger.info("youtube transcript fetch(en) failed: %s", first_err)

    try:
        tlist = api.list(video_id)
        tr = None
        for finder in (
            lambda: tlist.find_transcript(["en", "en-US", "en-GB"]),
            lambda: tlist.find_manually_created_transcript(["en"]),
            lambda: tlist.find_generated_transcript(["en"]),
        ):
            try:
                tr = finder()
                break
            except Exception:
                continue
        if tr is not None:
            ft = tr.fetch()
            text = _fetched_to_plain_text(ft).strip()
            if text:
                return _maybe_truncate(text), None
        for transcript in tlist:
            try:
                ft = transcript.fetch()
                text = _fetched_to_plain_text(ft).strip()
                if text:
                    return _maybe_truncate(text), None
            except Exception:
                continue
    except Exception as e:
        return "", f"Transcript not available: {e}"

    return "", "Transcript not available for this video (no captions or blocked)."


def _format_duration(seconds: Any) -> str:
    """`m:ss`, or `h:mm:ss` past an hour; empty when unknown."""
    if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or seconds <= 0:
        return ""
    total = int(seconds)
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def _maybe_truncate(text: str) -> str:
    if len(text) <= MAX_TRANSCRIPT_CHARS:
        return text
    return text[: MAX_TRANSCRIPT_CHARS - 40] + "\n\n… [truncated for length]"


def youtube_tool_run(
    *,
    query: str | None,
    video_url: str | None,
    get_transcript: bool,
    max_results: int,
) -> str:
    q_in = (query or "").strip()
    url_in = (video_url or "").strip()

    if url_in:
        if not HAS_YTDLP or YoutubeDL is None:
            return (
                "YouTube metadata requires yt-dlp. Install: pip install yt-dlp"
            )
        ydl_opts: dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "socket_timeout": YTDLP_SOCKET_TIMEOUT_S,
        }
        try:
            with YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url_in, download=False)
        except Exception as e:
            return f"Error fetching video information: {e}"

        title = info.get("title", "N/A")
        channel = info.get("uploader", "N/A")
        dur_s = _format_duration(info.get("duration"))
        views = info.get("view_count")
        views_s = f"{int(views):,}" if isinstance(views, int) else str(views or "N/A")
        upload = info.get("upload_date", "N/A")
        desc = (info.get("description") or "").strip()
        if len(desc) > 500:
            desc = desc[:500] + "…"

        result = (
            f"YouTube Video:\n"
            f"Title: {title}\n"
            f"Channel: {channel}\n"
        )
        if dur_s:
            result += f"Duration: {dur_s}\n"
        result += f"Views: {views_s}\nUpload date: {upload}\n"
        if desc:
            result += f"\nDescription:\n{desc}\n"
        result += f"\nURL: {url_in}\n"

        if get_transcript:
            vid = extract_youtube_video_id(url_in)
            if not vid:
                result += "\n\n[Transcript] Could not extract video ID from URL."
            else:
                text, err = _fetch_transcript_text(vid)
                if text:
                    result += f"\n\n--- Transcript ---\n{text}\n"
                else:
                    result += f"\n\n[Transcript] {err or 'Unavailable.'}"

        return result

    if q_in:
        if not HAS_YTDLP or YoutubeDL is None:
            return "YouTube search requires yt-dlp. Install: pip install yt-dlp"

        n = max(1, min(20, max_results))
        ydl_opts: dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "extract_flat": True,
            "socket_timeout": YTDLP_SOCKET_TIMEOUT_S,
        }
        # A `site:youtube.com` web query returns channel and playlist pages whose
        # descriptions mash several video titles together, so result titles never
        # line up with their URLs. `ytsearch` asks YouTube itself.
        try:
            with YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f"ytsearch{n}:{q_in}", download=False)
        except Exception as e:
            return f"Error in YouTube search: {e}"

        entries = [
            e
            for e in ((info or {}).get("entries") or [])
            if isinstance(e, dict) and e.get("id")
        ]
        if not entries:
            return f"No YouTube videos found for {q_in!r}."

        blocks: list[str] = []
        for e in entries:
            lines = [f"Title: {e.get('title') or 'N/A'}"]
            channel = e.get("uploader") or e.get("channel")
            if channel:
                lines.append(f"Channel: {channel}")
            lines.append(f"ID: {e['id']}")
            dur_s = _format_duration(e.get("duration"))
            if dur_s:
                lines.append(f"Duration: {dur_s}")
            views = e.get("view_count")
            if isinstance(views, int):
                lines.append(f"Views: {views:,}")
            if e.get("upload_date"):
                lines.append(f"Upload date: {e['upload_date']}")
            lines.append(f"URL: https://www.youtube.com/watch?v={e['id']}")
            blocks.append("\n".join(lines))
        return "YouTube search:\n\n" + "\n\n---\n\n".join(blocks)

    return "Error: provide `query` (search) or `video_url` (video details / transcript)."
