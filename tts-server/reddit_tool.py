"""
Reddit read-only tool for the assistant.

Reddit blocks unauthenticated `.json` API access (HTTP 403). This module uses
public Atom RSS feeds instead — no Reddit app / OAuth required.

Optional future path: set REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET (+ username/
password for script apps) to use oauth.reddit.com JSON again when Reddit grants
API access (see Responsible Builder Policy).

RSS endpoints:
  - Feed:   https://www.reddit.com/r/{sub}/{sort}.rss?limit=N[&t=time]
  - r/all:  https://www.reddit.com/{sort}.rss?limit=N
  - Search: https://www.reddit.com/search.rss?q=Q  (or /r/{sub}/search.rss)
  - Post:   https://www.reddit.com/r/{sub}/comments/{id}/.rss
"""

from __future__ import annotations

import os
import re
import xml.etree.ElementTree as ET
from html import unescape
from typing import Any

import httpx
from bs4 import BeautifulSoup

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)
ATOM_NS = "http://www.w3.org/2005/Atom"
FETCH_TIMEOUT_S = 20.0
MAX_BODY_BYTES = 4 * 1024 * 1024
MAX_LIMIT = 25
DEFAULT_LIMIT = 10
MAX_COMMENTS = 50
DEFAULT_COMMENTS = 10

VALID_SORTS = {"hot", "new", "top", "rising", "controversial", "best"}
VALID_TIMES = {"hour", "day", "week", "month", "year", "all"}

ALLOWED_HOSTS = {
    "reddit.com",
    "www.reddit.com",
    "old.reddit.com",
    "new.reddit.com",
    "np.reddit.com",
    "redd.it",
}

_SUBREDDIT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_]{1,40}$")
_POST_PATH_RE = re.compile(
    r"/r/([A-Za-z0-9_]+)/comments/([a-z0-9]+)(?:/|$)",
    re.IGNORECASE,
)
_SHORT_REDDIT_RE = re.compile(r"^https?://redd\.it/([a-z0-9]+)/?", re.IGNORECASE)
_BARE_POST_ID_RE = re.compile(r"^(?:t3_)?([a-z0-9]{4,12})$", re.IGNORECASE)
class RedditError(ValueError):
    """User-facing reddit tool error."""


def _oauth_configured() -> bool:
    return bool(
        os.environ.get("REDDIT_CLIENT_ID", "").strip()
        and os.environ.get("REDDIT_CLIENT_SECRET", "").strip()
    )


def _request_headers() -> dict[str, str]:
    return {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
    }


def _clamp(n: Any, lo: int, hi: int, default: int) -> int:
    try:
        v = int(n)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


def _normalize_sub(raw: Any) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    if s.lower().startswith("r/"):
        s = s[2:]
    if s.startswith("/r/"):
        s = s[3:]
    s = s.strip("/")
    if not s:
        return None
    if not _SUBREDDIT_RE.match(s):
        raise RedditError(f"Invalid subreddit name: {raw!r}")
    return s


def _normalize_sort(raw: Any) -> str:
    s = str(raw or "hot").strip().lower()
    if s not in VALID_SORTS:
        raise RedditError(
            f"Invalid sort {s!r}; allowed: {', '.join(sorted(VALID_SORTS))}",
        )
    return s


def _normalize_time(raw: Any) -> str:
    s = str(raw or "day").strip().lower()
    if s not in VALID_TIMES:
        raise RedditError(
            f"Invalid time {s!r}; allowed: {', '.join(sorted(VALID_TIMES))}",
        )
    return s


def _truncate(text: str, n: int) -> str:
    t = (text or "").strip()
    if not t:
        return ""
    if len(t) <= n:
        return t
    return t[: max(0, n - 1)].rstrip() + "…"


def _strip_html(html: str) -> str:
    if not html:
        return ""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style"]):
        tag.decompose()
    text = soup.get_text(separator="\n", strip=True)
    return unescape(re.sub(r"\n{3,}", "\n\n", text)).strip()


def _thing_id(atom_id: str) -> tuple[str, str]:
    """Return (kind, id) from Atom id like t3_abc or t1_xyz."""
    raw = (atom_id or "").strip()
    if "_" in raw:
        kind, rest = raw.split("_", 1)
        return kind.lower(), rest.lower()
    return "", raw.lower()


def _author_name(atom_author: str) -> str:
    s = (atom_author or "").strip()
    if s.startswith("/u/"):
        return s[3:]
    return s


def _sub_from_link(link: str) -> str:
    m = re.search(r"/r/([A-Za-z0-9_]+)/", link or "", re.IGNORECASE)
    return m.group(1) if m else ""


def _post_rss_url_from_user_url(post_url: str) -> str:
    """Convert a Reddit post URL (or bare post id) into its thread `.rss` URL."""
    raw = (post_url or "").strip()
    if not raw:
        raise RedditError("post_url is empty")

    if "/" not in raw and ":" not in raw:
        bare = _BARE_POST_ID_RE.match(raw)
        if bare:
            return f"https://www.reddit.com/comments/{bare.group(1).lower()}/.rss"

    short = _SHORT_REDDIT_RE.match(raw)
    if short:
        return f"https://www.reddit.com/comments/{short.group(1)}/.rss"

    try:
        u = httpx.URL(raw)
    except Exception as e:
        raise RedditError(f"Invalid post_url: {raw!r}") from e

    if u.scheme not in ("http", "https"):
        raise RedditError("Only http(s) Reddit URLs are allowed")
    host = (u.host or "").lower()
    if host not in ALLOWED_HOSTS:
        raise RedditError(f"Host {host!r} is not a Reddit host")

    path = (u.path or "").rstrip("/")
    m = _POST_PATH_RE.search(path)
    if not m:
        raise RedditError(
            "post_url does not look like a Reddit post URL "
            "(expected /r/<sub>/comments/<id>/... or a bare post id)",
        )
    sub = m.group(1)
    post_id = m.group(2).lower()
    return f"https://www.reddit.com/r/{sub}/comments/{post_id}/.rss"


def _parse_atom_entries(body: bytes) -> list[dict[str, Any]]:
    try:
        root = ET.fromstring(body)
    except ET.ParseError as e:
        raise RedditError("Reddit RSS was not valid XML") from e

    entries: list[dict[str, Any]] = []
    for entry in root.findall(f"{{{ATOM_NS}}}entry"):
        title_el = entry.find(f"{{{ATOM_NS}}}title")
        id_el = entry.find(f"{{{ATOM_NS}}}id")
        link_el = entry.find(f"{{{ATOM_NS}}}link")
        content_el = entry.find(f"{{{ATOM_NS}}}content")
        author_parent = entry.find(f"{{{ATOM_NS}}}author")
        author_name_el = (
            author_parent.find(f"{{{ATOM_NS}}}name")
            if author_parent is not None
            else None
        )

        title = (title_el.text or "").strip() if title_el is not None else ""
        atom_id = (id_el.text or "").strip() if id_el is not None else ""
        link = ""
        if link_el is not None:
            link = (link_el.get("href") or link_el.text or "").strip()
        html_body = (content_el.text or "") if content_el is not None else ""
        author = _author_name(
            (author_name_el.text or "").strip() if author_name_el is not None else "",
        )
        kind, thing_id = _thing_id(atom_id)
        entries.append(
            {
                "kind": kind,
                "id": thing_id,
                "title": title,
                "link": link,
                "author": author,
                "body": _strip_html(html_body),
                "subreddit": _sub_from_link(link),
            },
        )
    return entries


async def _fetch_rss(client: httpx.AsyncClient, url: str) -> list[dict[str, Any]]:
    try:
        res = await client.get(url, headers=_request_headers(), timeout=FETCH_TIMEOUT_S)
    except httpx.TimeoutException as e:
        raise RedditError("Reddit request timed out") from e
    except Exception as e:
        raise RedditError(f"Reddit request failed: {e}") from e

    if res.status_code == 404:
        raise RedditError("Reddit returned 404 (subreddit or post not found)")
    if res.status_code in (403, 429):
        raise RedditError(
            f"Reddit refused request (HTTP {res.status_code}). "
            "RSS access may be rate-limited — try again later.",
        )
    if not res.is_success:
        raise RedditError(f"Reddit HTTP {res.status_code}")

    if len(res.content) > MAX_BODY_BYTES:
        raise RedditError("Reddit response too large")

    ct = (res.headers.get("content-type") or "").lower()
    if "html" in ct and b"<feed" not in res.content[:800]:
        raise RedditError(
            "Reddit returned HTML instead of RSS (blocked or wrong URL).",
        )

    return _parse_atom_entries(res.content)


def _format_rss_post_line(idx: int, row: dict[str, Any], *, include_body: bool) -> str:
    title = _truncate(str(row.get("title") or "(no title)"), 220)
    sub = str(row.get("subreddit") or "")
    author = str(row.get("author") or "")
    link = str(row.get("link") or "")
    post_id = str(row.get("id") or "")
    body = str(row.get("body") or "")

    sub_part = f"r/{sub} • " if sub else ""
    id_part = f" • id={post_id}" if post_id else ""
    out = (
        f"[{idx}] {sub_part}{title}\n"
        f"    u/{author}{id_part}\n"
        f"    post: {link}"
    )
    if include_body and body:
        out += f"\n    {_truncate(body, 500)}"
    return out


def _format_rss_feed(entries: list[dict[str, Any]], header: str, limit: int) -> str:
    posts = [e for e in entries if e.get("kind") == "t3"]
    if not posts:
        return f"{header}\n(no posts)"

    lines: list[str] = [f"{header} (via RSS)"]
    index_rows: list[tuple[int, str, str]] = []
    for idx, row in enumerate(posts[:limit], start=1):
        lines.append(_format_rss_post_line(idx, row, include_body=True))
        index_rows.append(
            (idx, str(row.get("id") or ""), _truncate(str(row.get("title") or ""), 80)),
        )

    recap = ["POST_INDEX (copy these ids verbatim into reddit_feed post_url):"]
    for n, pid, title in index_rows:
        if pid:
            recap.append(f"  [{n}] id={pid} — {title}")
        else:
            recap.append(f"  [{n}] (no id) — {title}")
    lines.append("\n".join(recap))
    return "\n\n".join(lines)


def _format_rss_post_with_comments(
    entries: list[dict[str, Any]],
    max_comments: int,
) -> str:
    posts = [e for e in entries if e.get("kind") == "t3"]
    comments = [e for e in entries if e.get("kind") == "t1"]
    if not posts:
        raise RedditError("Reddit RSS thread has no post entry")

    lines: list[str] = ["POST (via RSS)"]
    lines.append(_format_rss_post_line(1, posts[0], include_body=True))

    shown = 0
    comment_lines: list[str] = []
    for row in comments:
        if shown >= max_comments:
            break
        body = str(row.get("body") or "").strip()
        if not body:
            continue
        shown += 1
        author = str(row.get("author") or "[deleted]")
        comment_lines.append(
            f"    [{shown}] u/{author}\n    {_truncate(body, 600)}",
        )

    if comment_lines:
        lines.append(f"\nTOP COMMENTS ({shown})")
        lines.extend(comment_lines)
    else:
        lines.append("\nTOP COMMENTS\n    (no comments)")
    return "\n\n".join(lines)


async def reddit_tool_run(
    *,
    subreddit: Any = None,
    sort: Any = None,
    time: Any = None,
    limit: Any = None,
    query: Any = None,
    post_url: Any = None,
    max_comments: Any = None,
) -> str:
    """Single tool entry — chooses mode based on which arguments are present."""
    sub = _normalize_sub(subreddit)
    sort_v = _normalize_sort(sort) if sort is not None else "hot"
    time_v = _normalize_time(time) if time is not None else "day"
    limit_v = _clamp(limit, 1, MAX_LIMIT, DEFAULT_LIMIT)
    q = str(query or "").strip()
    purl = str(post_url or "").strip()
    max_c = _clamp(max_comments, 1, MAX_COMMENTS, DEFAULT_COMMENTS)

    if _oauth_configured():
        # OAuth JSON path can be wired here when credentials are available.
        pass

    async with httpx.AsyncClient(
        timeout=FETCH_TIMEOUT_S,
        follow_redirects=True,
        limits=httpx.Limits(max_connections=4),
    ) as client:
        if purl:
            rss_url = _post_rss_url_from_user_url(purl)
            entries = await _fetch_rss(client, rss_url)
            return _format_rss_post_with_comments(entries, max_c)

        if q:
            params: dict[str, str] = {
                "q": q,
                "limit": str(limit_v),
                "sort": "relevance",
                "t": time_v,
            }
            if sub:
                base = f"https://www.reddit.com/r/{sub}/search.rss"
                params["restrict_sr"] = "on"
                header = f"REDDIT SEARCH r/{sub} • q={q!r}"
            else:
                base = "https://www.reddit.com/search.rss"
                header = f"REDDIT SEARCH • q={q!r}"
            url = str(httpx.URL(base, params=params))
            entries = await _fetch_rss(client, url)
            return _format_rss_feed(entries, header, limit_v)

        params = {"limit": str(limit_v)}
        if sort_v in ("top", "controversial"):
            params["t"] = time_v
        if sub:
            base = f"https://www.reddit.com/r/{sub}/{sort_v}.rss"
            header = f"REDDIT r/{sub} • {sort_v}"
        else:
            base = f"https://www.reddit.com/{sort_v}.rss"
            header = f"REDDIT r/all • {sort_v}"
        if "t" in params:
            header += f" • t={params['t']}"
        url = str(httpx.URL(base, params=params))
        entries = await _fetch_rss(client, url)
        return _format_rss_feed(entries, header, limit_v)
