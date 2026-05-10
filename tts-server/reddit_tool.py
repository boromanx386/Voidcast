"""
Reddit read-only tool for the assistant.

Uses Reddit's public JSON endpoints (no API key, no OAuth). A valid
User-Agent header is required — Reddit returns 429/403 to default
clients (`httpx`, `urllib`, `python-requests`).

Endpoints used:
  - Feed:    https://www.reddit.com/r/{sub}/{sort}.json?limit=N&t=time
  - r/all:   https://www.reddit.com/{sort}.json?limit=N&t=time     (when no subreddit)
  - Post:    https://www.reddit.com/r/{sub}/comments/{id}.json
  - Search:  https://www.reddit.com/r/{sub}/search.json?q=Q&restrict_sr=on
             https://www.reddit.com/search.json?q=Q                 (global)
"""

from __future__ import annotations

import re
from typing import Any

import httpx

# Reddit's public JSON endpoints aggressively 403 on app-style User-Agents
# (e.g. "MyApp/1.0", "python:foo:v1") in 2024+. A standard desktop browser UA
# passes the same anti-bot filter. We do not log in, send cookies, or scrape
# at scale — calls are single-shot and rate-limited at the tool layer.
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)
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


class RedditError(ValueError):
    """User-facing reddit tool error."""


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


def _post_json_url_from_user_url(post_url: str) -> str:
    """Convert a public Reddit post URL into its `.json` form."""
    raw = (post_url or "").strip()
    if not raw:
        raise RedditError("post_url is empty")

    short = _SHORT_REDDIT_RE.match(raw)
    if short:
        return f"https://www.reddit.com/comments/{short.group(1)}.json"

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
            "(expected /r/<sub>/comments/<id>/...)",
        )
    sub = m.group(1)
    post_id = m.group(2).lower()
    return f"https://www.reddit.com/r/{sub}/comments/{post_id}.json"


async def _fetch_json(client: httpx.AsyncClient, url: str) -> Any:
    # NOTE: omitting Accept is intentional — Reddit's anti-bot filter rejects
    # `Accept: application/json` and `Accept: */*` while passing requests with
    # no Accept header. The .json URL suffix already forces a JSON response.
    try:
        res = await client.get(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept-Language": "en-US,en;q=0.9",
            },
            timeout=FETCH_TIMEOUT_S,
        )
    except httpx.TimeoutException as e:
        raise RedditError("Reddit request timed out") from e
    except Exception as e:
        raise RedditError(f"Reddit request failed: {e}") from e

    if res.status_code == 404:
        raise RedditError("Reddit returned 404 (subreddit or post not found)")
    if res.status_code in (403, 429):
        raise RedditError(
            f"Reddit refused request (HTTP {res.status_code}); subreddit "
            "may be private/quarantined or rate limited.",
        )
    if not res.is_success:
        raise RedditError(f"Reddit HTTP {res.status_code}")

    if len(res.content) > MAX_BODY_BYTES:
        raise RedditError("Reddit response too large")

    try:
        return res.json()
    except Exception as e:
        raise RedditError("Reddit response was not valid JSON") from e


def _format_post_line(idx: int, data: dict[str, Any]) -> str:
    title = _truncate(str(data.get("title") or "(no title)"), 220)
    sub = str(data.get("subreddit") or "")
    author = str(data.get("author") or "")
    score = int(data.get("score") or 0)
    num_comments = int(data.get("num_comments") or 0)
    permalink = str(data.get("permalink") or "")
    url = str(data.get("url") or "")
    flair = str(data.get("link_flair_text") or "").strip()
    is_self = bool(data.get("is_self"))
    over_18 = bool(data.get("over_18"))
    spoiler = bool(data.get("spoiler"))
    selftext = str(data.get("selftext") or "")

    badges: list[str] = []
    if over_18:
        badges.append("NSFW")
    if spoiler:
        badges.append("SPOILER")
    if flair:
        badges.append(flair)
    badge_str = f" [{' | '.join(badges)}]" if badges else ""

    full_link = (
        f"https://www.reddit.com{permalink}" if permalink.startswith("/") else permalink
    )
    target = url if (url and not is_self and url != full_link) else full_link

    out = (
        f"[{idx}] r/{sub} • {title}{badge_str}\n"
        f"    u/{author} • ↑{score} • 💬{num_comments}\n"
        f"    {target}"
    )
    if is_self and selftext.strip():
        body = _truncate(selftext, 500)
        out += f"\n    {body}"
    return out


def _format_feed(payload: Any, header: str) -> str:
    if not isinstance(payload, dict):
        raise RedditError("Reddit returned unexpected payload (not a listing)")
    data = payload.get("data") or {}
    children = data.get("children") if isinstance(data, dict) else None
    if not isinstance(children, list):
        raise RedditError("Reddit returned unexpected listing structure")

    if not children:
        return f"{header}\n(no posts)"

    lines: list[str] = [header]
    idx = 0
    for child in children:
        if not isinstance(child, dict):
            continue
        kind = child.get("kind")
        cd = child.get("data")
        if kind != "t3" or not isinstance(cd, dict):
            continue
        if cd.get("stickied") and idx >= 1:
            # Keep the first sticky (often relevant), skip later ones to leave room for real posts.
            continue
        idx += 1
        lines.append(_format_post_line(idx, cd))
    if idx == 0:
        return f"{header}\n(no posts)"
    return "\n\n".join(lines)


def _format_comment(idx: int, cd: dict[str, Any], depth: int = 0) -> str:
    author = str(cd.get("author") or "[deleted]")
    score = int(cd.get("score") or 0)
    body = _truncate(str(cd.get("body") or ""), 600)
    indent = "    " * (depth + 1)
    return f"{indent}[{idx}] u/{author} • ↑{score}\n{indent}{body}"


def _format_post_with_comments(payload: Any, max_comments: int) -> str:
    if not isinstance(payload, list) or len(payload) < 1:
        raise RedditError("Reddit returned unexpected post payload")

    post_listing = payload[0] if isinstance(payload[0], dict) else None
    if not post_listing:
        raise RedditError("Reddit post payload missing post listing")
    children = (post_listing.get("data") or {}).get("children") or []
    if not children or not isinstance(children[0], dict):
        raise RedditError("Reddit post payload has no post data")
    post = children[0].get("data") or {}

    lines: list[str] = ["POST"]
    lines.append(_format_post_line(1, post))

    comments_payload = payload[1] if len(payload) > 1 and isinstance(payload[1], dict) else None
    if comments_payload:
        comment_children = (comments_payload.get("data") or {}).get("children") or []
        shown = 0
        comment_lines: list[str] = []
        for ch in comment_children:
            if shown >= max_comments:
                break
            if not isinstance(ch, dict):
                continue
            if ch.get("kind") != "t1":
                continue
            cd = ch.get("data") or {}
            if not isinstance(cd, dict):
                continue
            if not str(cd.get("body") or "").strip():
                continue
            shown += 1
            comment_lines.append(_format_comment(shown, cd, depth=0))
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

    async with httpx.AsyncClient(
        timeout=FETCH_TIMEOUT_S,
        follow_redirects=True,
        limits=httpx.Limits(max_connections=4),
    ) as client:
        # Mode A: post + comments
        if purl:
            json_url = _post_json_url_from_user_url(purl)
            payload = await _fetch_json(client, json_url)
            return _format_post_with_comments(payload, max_c)

        # Mode B: search
        if q:
            params = {
                "q": q,
                "limit": str(limit_v),
                "sort": "relevance",
                "t": time_v,
                "raw_json": "1",
            }
            if sub:
                base = f"https://www.reddit.com/r/{sub}/search.json"
                params["restrict_sr"] = "on"
                header = f"REDDIT SEARCH r/{sub} • q={q!r}"
            else:
                base = "https://www.reddit.com/search.json"
                header = f"REDDIT SEARCH • q={q!r}"
            url = str(httpx.URL(base, params=params))
            payload = await _fetch_json(client, url)
            return _format_feed(payload, header)

        # Mode C: feed
        params = {"limit": str(limit_v), "raw_json": "1"}
        if sort_v in ("top", "controversial"):
            params["t"] = time_v
        if sub:
            base = f"https://www.reddit.com/r/{sub}/{sort_v}.json"
            header = f"REDDIT r/{sub} • {sort_v}"
            if "t" in params:
                header += f" • t={params['t']}"
        else:
            base = f"https://www.reddit.com/{sort_v}.json"
            header = f"REDDIT r/all • {sort_v}"
            if "t" in params:
                header += f" • t={params['t']}"
        url = str(httpx.URL(base, params=params))
        payload = await _fetch_json(client, url)
        return _format_feed(payload, header)
