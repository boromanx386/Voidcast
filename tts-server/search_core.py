"""
DuckDuckGo search core — runs in its own process, never inside the API server.

Protocol (worker mode): one JSON request per line on stdin, one JSON reply line on
stdout. Started by `main.py` as a child process; see `_SearchWorker` there.

Why a separate process at all:
    `ddgs` talks to DuckDuckGo through its native `primp` client. py-spy --native
    caught worker threads stuck inside `primp` while holding the GIL, which froze
    every route of the server: `/health` accepted the TCP connection and never
    answered, so the UI only ever saw "fail to fetch" for search, the OpenCode Go
    proxy and local ASR alike. A thread in that state cannot be interrupted — a
    process can always be killed, and the server survives.

Requests:
    {"op": "search", "query": str, "recency": "d|w|m|y" | None, "max_results": int}
    {"op": "text",   "query": str, "max_results": int}

Replies:
    {"ok": true,  "rows": [...]}
    {"ok": false, "error": "..."}
"""

from __future__ import annotations

import importlib.util
import json
import logging
import re
import sys
import time
from datetime import datetime
from typing import Any

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tts-server.search")
# ddgs/primp log every HTTP response at INFO; that is ~10 lines per search in the
# server log and buries real warnings. Keep their errors, drop the chatter.
logging.getLogger("primp").setLevel(logging.WARNING)
logging.getLogger("ddgs").setLevel(logging.WARNING)

SEARCH_DEFAULT_RESULTS = 8
SEARCH_COLLECT_MAX = 30
SEARCH_TIMEOUT_S = 15
# One ddgs pass can miss every canonical source; below this many distinct
# boosted domains the collector retries across explicit backends.
SEARCH_MIN_BOOSTED = 3

# Prefer `ddgs` — the `duckduckgo_search` package was renamed and its DDGS often
# returns no results. Availability is probed with find_spec instead of an import:
# the API server imports this module for ranking helpers and must NOT drag the
# native `primp` client into its own process (that is exactly what froze it).
HAS_DDGS = (
    importlib.util.find_spec("ddgs") is not None
    or importlib.util.find_spec("duckduckgo_search") is not None
)

_DDGS_CLASS: Any = None


def ddgs_class() -> Any:
    """Import ddgs lazily — only the worker process ever calls a search engine."""
    global _DDGS_CLASS
    if _DDGS_CLASS is not None:
        return _DDGS_CLASS
    try:
        from ddgs import DDGS  # type: ignore
    except ImportError:
        from duckduckgo_search import DDGS  # type: ignore
    _DDGS_CLASS = DDGS
    return DDGS


# Ranking scraped results is a heuristic by construction: the payload carries no
# authority signal, so these lists are short and hand-maintained. Boost = usually
# the canonical answer; block = SEO/monetisation farms that outrank real docs.
SEARCH_DOMAIN_BOOST = (
    # Language / runtime / framework docs
    "docs.python.org",
    "python.org",
    "developer.mozilla.org",
    "nodejs.org",
    "react.dev",
    "fastapi.tiangolo.com",
    "docs.rs",
    "rust-lang.org",
    "go.dev",
    # Data stores. sqlite.org was the measured gap: the canonical WAL answer
    # ranked nowhere while content farms took the top slots.
    "sqlite.org",
    "postgresql.org",
    "mysql.com",
    "mariadb.com",
    "redis.io",
    "mongodb.com",
    "elastic.co",
    # Systems, servers, containers
    "man7.org",
    "kernel.org",
    "nginx.org",
    "apache.org",
    "gnu.org",
    "openssl.org",
    "docker.com",
    "kubernetes.io",
    "learn.microsoft.com",
    # Standards, reference, code hosts
    "ietf.org",
    "rfc-editor.org",
    "w3.org",
    "wikipedia.org",
    "arxiv.org",
    "github.com",
    "stackoverflow.com",
    "europa.eu",
)
SEARCH_DOMAIN_BLOCK = (
    "pinterest.",
    "slideshare.",
    "scribd.com",
    "coursehero.com",
    "chegg.com",
    "brainly.",
    "answers.yahoo.",
)

# Auto-reading promotes a result to thousands of characters of confident-looking
# context. For a content farm that is WORSE than a snippet, because the model
# cannot tell generated filler from documentation - a measured johal.in page
# carried fabricated statistics and a fake roadmap. These hosts stay ranked and
# visible; they are just never promoted to full text. Deeper results backfill the
# read window. Judgement call: edit the list freely.
SEARCH_NO_READ = (
    "johal.in",
    "geeksforgeeks.org",
    "javatpoint.com",
    "tutorialspoint.com",
    "guru99.com",
    "interviewbit.com",
    "prepbytes.com",
    "simplilearn.com",
    "intellipaat.com",
    "edureka.co",
    "scaler.com",
)

SEARCH_STOPWORDS = frozenset(
    {
        "a",
        "an",
        "the",
        "and",
        "or",
        "not",
        "for",
        "with",
        "from",
        "about",
        "into",
        "how",
        "what",
        "why",
        "when",
        "who",
        "does",
        "do",
        "is",
        "are",
        "was",
        "were",
        "of",
        "to",
        "in",
        "on",
        "at",
        "it",
        "this",
        "that",
        "i",
        "can",
        "you",
        "my",
        "me",
        "use",
        "using",
        "best",
        "vs",
    },
)

# Only these words justify the news pass and a recency filter. Running them on
# every query is what buried evergreen how-to answers under last month's blogs.
SEARCH_RECENT_QUERY_RE = re.compile(
    r"\b(news|today|latest|current|currently|now|this (?:week|month|year)|"
    r"recent|breaking|update[ds]?|release[ds]?|price|stock|score|weather|"
    r"trending|who won|election)\b",
    re.IGNORECASE,
)


def host_of(link: str) -> str:
    m = re.match(r"https?://([^/?#]+)", link or "", re.IGNORECASE)
    if not m:
        return ""
    return m.group(1).split("@")[-1].split(":")[0].lower()


def is_boosted(host: str) -> bool:
    """Canonical-domain check: suffix match, so 'sqlite.org' also covers www."""
    return any(host == d or host.endswith("." + d) for d in SEARCH_DOMAIN_BOOST)


def is_no_read(host: str) -> bool:
    return any(p in host for p in SEARCH_NO_READ)


def boosted_host_count(rows: list[dict[str, Any]]) -> int:
    """Distinct boosted hostnames in the candidate set (www and apex count apart)."""
    return len({r["host"] for r in rows if is_boosted(r["host"])})


def parse_result_date(raw: str) -> datetime | None:
    """ddgs backends report dates in several shapes; normalise to naive local."""
    s = (raw or "").strip()
    if not s:
        return None
    dt: datetime | None = None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
        if m:
            try:
                dt = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except ValueError:
                dt = None
    if dt is None:
        for fmt in ("%d %b %Y", "%b %d, %Y", "%d/%m/%Y", "%m/%d/%Y"):
            try:
                dt = datetime.strptime(s[:20].strip(), fmt)
                break
            except ValueError:
                continue
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone().replace(tzinfo=None)
    return dt


def query_tokens(query: str) -> list[str]:
    return [
        t
        for t in re.findall(r"[a-z0-9]+", query.lower())
        if len(t) > 1 and t not in SEARCH_STOPWORDS
    ]


def norm_query(query: str) -> str:
    return re.sub(r"\s+", " ", (query or "").strip().lower())


def collect_candidates(
    ddgs: Any,
    query: str,
    recency: str | None,
    want: int,
) -> list[dict[str, Any]]:
    """Gather raw hits across ddgs backends. No time filter unless asked for."""
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    want_raw = min(SEARCH_COLLECT_MAX, max(want * 3, want))
    deadline = time.monotonic() + SEARCH_TIMEOUT_S
    timelimit = recency if recency in ("d", "w", "m", "y") else None
    time_sensitive = bool(SEARCH_RECENT_QUERY_RE.search(query))

    def add(raw: Any, source: str) -> None:
        if not isinstance(raw, dict):
            return
        title = str(raw.get("title") or "").strip()
        body = str(raw.get("body") or "").strip()
        link = str(raw.get("href") or raw.get("url") or "").strip()
        if not link or link.lower() in seen:
            return
        # Stub rows (nav-only or title-only) never survive ranking anyway.
        if len(title) + len(body) < 40:
            return
        seen.add(link.lower())
        rows.append(
            {
                "title": title or link,
                "body": body,
                "link": link,
                "host": host_of(link),
                "source": source,
                "date": str(
                    raw.get("date")
                    or raw.get("published")
                    or raw.get("publishedAt")
                    or raw.get("source_date")
                    or ""
                ).strip(),
            }
        )

    # The news pass answers time-sensitive asks, and that is independent of which
    # window the caller picked: "latest X" with recency=m still wants news. The
    # first probe run showed recency=m silently skipping it.
    if timelimit in ("d", "w") or time_sensitive:
        try:
            for r in list(ddgs.news(query, max_results=want_raw)):
                add(r, "news")
        except Exception as e:  # noqa: BLE001
            logger.warning("ddgs news backend failed for %r: %s", query, e)

    if time.monotonic() < deadline:
        try:
            for r in list(
                ddgs.text(
                    query,
                    max_results=want_raw,
                    backend="auto",
                    timelimit=timelimit,
                )
            ):
                add(r, "text")
        except Exception as e:  # noqa: BLE001
            logger.warning("ddgs text backend failed for %r: %s", query, e)

    # ddgs answers from a non-deterministic engine mix, so a single pass can look
    # full while carrying no canonical source at all (measured: the same query
    # returned sqlite.org/wal.html in one call and eight farm pages in the next).
    # Retry across explicit backends when the set is thin OR lacks canonical
    # domains - still with no time filter, since the point is to reach the
    # evergreen pages the recency pass cannot see.
    if (
        len(rows) < want or boosted_host_count(rows) < min(want, SEARCH_MIN_BOOSTED)
    ) and time.monotonic() < deadline - 5:
        # Logged on purpose: without this line a widened trigger is silent and the
        # only way to know whether it fires is to read the code.
        logger.info(
            "ddgs multi-backend retry for %r: %d candidates, %d canonical before",
            query,
            len(rows),
            boosted_host_count(rows),
        )
        try:
            for r in list(
                ddgs.text(
                    query,
                    max_results=want_raw,
                    # Engines that actually answer: brave returns 429 and the
                    # duckduckgo html endpoint soft-blocks with 202 on every probe,
                    # which made this retry a no-op right when it was needed.
                    backend="google,yahoo,mojeek,yandex",
                    timelimit=timelimit,
                )
            ):
                add(r, "text")
        except Exception as e:  # noqa: BLE001
            logger.warning("ddgs multi-backend retry failed for %r: %s", query, e)

    return rows


def rank_candidates(rows: list[dict[str, Any]], query: str) -> None:
    """Score rows in place: lexical overlap, curated domains, mild date signal."""
    tokens = query_tokens(query)
    phrase = norm_query(query)
    now = datetime.now()
    for r in rows:
        title = r["title"].lower()
        body = r["body"].lower()
        host = r["host"]
        score = 0.0
        for t in tokens:
            if t in title:
                score += 2.0
            if t in body:
                score += 1.0
        if len(phrase) > 6 and (phrase in title or phrase in body):
            score += 6.0
        if is_boosted(host):
            score += 2.5
        if any(b in host for b in SEARCH_DOMAIN_BLOCK):
            score -= 8.0
        dt = parse_result_date(r["date"])
        if dt is not None:
            age_days = (now - dt).days
            r["age_days"] = age_days
            if age_days <= 30:
                score += 2.0
            elif age_days <= 180:
                score += 1.0
            elif age_days > 1500:
                score -= 1.0
        r["score"] = score
    rows.sort(key=lambda r: r["score"], reverse=True)


def select_results(
    rows: list[dict[str, Any]],
    limit: int,
    per_host_cap: int = 2,
) -> list[dict[str, Any]]:
    """Keep ranked order, but no single host may own more than `per_host_cap`."""
    picked: list[dict[str, Any]] = []
    taken: set[int] = set()
    per_host: dict[str, int] = {}
    for i, r in enumerate(rows):
        if len(picked) >= limit:
            break
        host = r["host"]
        if per_host.get(host, 0) >= per_host_cap:
            continue
        picked.append(r)
        taken.add(i)
        per_host[host] = per_host.get(host, 0) + 1
    for i, r in enumerate(rows):  # backfill if the diversity cap starved us
        if len(picked) >= limit:
            break
        if i not in taken:
            picked.append(r)
    return picked


def search_candidates(
    query: str,
    recency: str | None,
    max_results: int,
) -> list[dict[str, Any]]:
    """Blocking collect+rank. Runs in the worker process."""
    q = (query or "").strip()
    if not q:
        return []
    DDGS = ddgs_class()
    # A stale year in the query (the model writing 2024 in 2026) poisons results.
    q_norm = re.sub(r"\b(20\d{2})\b", str(datetime.now().year), q)
    with DDGS(timeout=10) as ddgs:  # type: ignore[misc]
        rows = collect_candidates(ddgs, q_norm, recency, max_results)
    rank_candidates(rows, q_norm)
    return select_results(rows, max_results)


def text_results(query: str, max_results: int) -> list[dict[str, Any]]:
    """Plain ddgs text search (used for YouTube site: lookups)."""
    q = (query or "").strip()
    if not q:
        return []
    DDGS = ddgs_class()
    with DDGS(timeout=25) as ddgs:  # type: ignore[misc]
        return [r for r in ddgs.text(q, max_results=max_results) if isinstance(r, dict)]


def handle(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Dispatch one worker request. Raises on failure; the caller serialises it."""
    op = str(payload.get("op") or "search")
    query = str(payload.get("query") or "")
    try:
        max_results = int(payload.get("max_results") or SEARCH_DEFAULT_RESULTS)
    except (TypeError, ValueError):
        max_results = SEARCH_DEFAULT_RESULTS
    max_results = max(1, min(20, max_results))
    if op == "text":
        return text_results(query, max_results)
    recency = payload.get("recency")
    return search_candidates(
        query,
        recency if isinstance(recency, str) and recency else None,
        max_results,
    )


def worker_main() -> None:
    """stdio loop: JSON request line in, JSON reply line out."""
    # The frozen build's stdout is not guaranteed to be UTF-8 on Windows (the
    # locale code page decides), and a reply carrying a non-ASCII title would then
    # die mid-write. Pin both streams explicitly.
    for stream in (sys.stdin, sys.stdout):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
            if not isinstance(payload, dict):
                raise ValueError("request must be a JSON object")
            reply: dict[str, Any] = {"ok": True, "rows": handle(payload)}
        except Exception as e:  # noqa: BLE001
            logger.exception("search worker request failed")
            reply = {"ok": False, "error": f"{type(e).__name__}: {e}"}
        # ensure_ascii: the reply must be pure ASCII. The frozen build's stdout uses
        # the Windows code page, and a "·" or a Cyrillic title written as UTF-8
        # bytes there arrives mangled (measured: 0xb7 broke a UTF-8 reader).
        # JSON escapes keep every character intact across any codec on either end.
        sys.stdout.write(json.dumps(reply) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    worker_main()
