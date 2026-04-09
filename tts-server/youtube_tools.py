"""YouTube search + metadata + transcript (yt-dlp + youtube-transcript-api)."""

from __future__ import annotations

import logging
import re
from collections.abc import Callable, Iterable
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
    has_ddgs: bool,
    ddgs_text_fn: Callable[[str, int], Iterable[Any]] | None,
) -> str:
    """
    `ddgs_text_fn(query, max_results)` returns an iterable of result dicts (title, body, href).
    """
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
        }
        try:
            with YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url_in, download=False)
        except Exception as e:
            return f"Error fetching video information: {e}"

        title = info.get("title", "N/A")
        channel = info.get("uploader", "N/A")
        duration = int(info.get("duration") or 0)
        dur_s = ""
        if duration > 0:
            dur_s = f"{duration // 60}:{duration % 60:02d}"
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
        if not has_ddgs or ddgs_text_fn is None:
            return "YouTube search requires ddgs (pip install ddgs)."
        search_query = f"site:youtube.com {q_in}"
        try:
            results = list(ddgs_text_fn(search_query, max_results))
        except Exception as e:
            return f"Error in YouTube search: {e}"

        if not results:
            return f"No YouTube videos found for {q_in!r}."

        lines: list[str] = []
        for r in results:
            href = (r.get("href") or r.get("url") or "").strip()
            if "youtube.com" not in href and "youtu.be" not in href:
                continue
            t = (r.get("title") or "").strip()
            body = (r.get("body") or "")[:220]
            lines.append(f"{t}\n{body}\n{href}")
        if not lines:
            return f"No YouTube URLs in results for {q_in!r}."
        return "YouTube search:\n\n" + "\n\n---\n\n".join(lines)

    return "Error: provide `query` (search) or `video_url` (video details / transcript)."
