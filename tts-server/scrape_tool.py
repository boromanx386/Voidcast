"""
Public URL → plain text (HTML stripped), with SSRF protections aligned with Electron `scrape.ts`.
"""

from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

MAX_BODY_BYTES = 2 * 1024 * 1024
MAX_REDIRECTS = 10
FETCH_TIMEOUT_S = 20.0


def _is_private_ipv4(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
        return addr.is_private or addr.is_loopback or addr.is_link_local
    except ValueError:
        return True


def _is_private_host_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
        if addr.version == 4:
            return _is_private_ipv4(ip)
        return addr.is_private or addr.is_loopback or addr.is_link_local
    except ValueError:
        return True


async def _assert_host_is_public(hostname: str) -> None:
    h = hostname.lower()
    if h == "localhost" or h.endswith(".localhost"):
        raise ValueError("Local host is not allowed")
    try:
        ipaddress.ip_address(h)
        if _is_private_host_ip(h):
            raise ValueError("Private IP addresses are not allowed")
        return
    except ValueError:
        pass

    loop = asyncio.get_running_loop()
    infos = await loop.run_in_executor(
        None,
        lambda: socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM),
    )
    if not infos:
        raise ValueError("Could not resolve host")
    for info in infos:
        sockaddr = info[4]
        if not sockaddr:
            continue
        ip = sockaddr[0]
        if _is_private_host_ip(ip):
            raise ValueError("Host resolves to a private address")


async def _assert_url_safe_for_fetch(u: httpx.URL) -> None:
    if u.scheme not in ("http", "https"):
        raise ValueError("Only http(s) URLs are allowed")
    p = urlparse(str(u))
    if p.username or p.password:
        raise ValueError("URL credentials are not allowed")
    host = u.host
    if not host:
        raise ValueError("Invalid host")
    await _assert_host_is_public(host)


def _html_to_plain_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "iframe", "object", "embed"]):
        tag.decompose()
    body = soup.body
    text = body.get_text(separator=" ", strip=True) if body else soup.get_text(separator=" ", strip=True)
    return re.sub(r"\s+", " ", text).strip()


def _html_to_markdown(html: str, base_url: str | None = None) -> str | None:
    """Main-content extraction → Markdown, or None when unavailable or empty.

    Returns None instead of raising so callers fall back to plain text: a broken
    or absent trafilatura must degrade the output, never break scraping.
    """
    try:
        import trafilatura  # lazy: module import must work without the dependency
    except Exception:
        return None
    try:
        out = trafilatura.extract(
            html,
            url=base_url,
            output_format="markdown",
            include_links=True,
            include_tables=True,
            include_images=False,
        )
    except Exception:
        return None
    if not out or not out.strip():
        return None
    return out.strip()


def _html_to_text(html: str, base_url: str | None = None) -> tuple[str, str]:
    """HTML → (text, format). Markdown when trafilatura delivers, else plain."""
    md = _html_to_markdown(html, base_url)
    if md:
        return md, "markdown"
    return _html_to_plain_text(html), "text"


def _looks_like_html(s: str) -> bool:
    t = s[:512].lower()
    return (
        "<html" in t
        or "<!doctype" in t
        or "<head" in t
        or "<body" in t
    )


def _extract_text_from_bytes(
    buf: bytes,
    content_type: str,
    base_url: str | None = None,
) -> tuple[str, str]:
    """Decode the body and convert it to (text, format)."""
    ct = (content_type or "").lower()
    raw = buf.decode("utf-8", errors="replace")

    if "text/html" in ct or "application/xhtml" in ct:
        return _html_to_text(raw, base_url)
    if "text/plain" in ct or (ct.startswith("text/") and "html" not in ct):
        return re.sub(r"\s+", " ", raw).strip(), "plain"
    if "application/json" in ct or "xml" in ct:
        return re.sub(r"\s+", " ", raw).strip(), "json"
    if not ct.strip() or _looks_like_html(raw):
        return _html_to_text(raw, base_url)
    raise ValueError(
        f"Unsupported content type ({content_type or 'unknown'}); only text and HTML are supported",
    )


def _clamp_max_chars(n: Any) -> int:
    d = int(n) if isinstance(n, (int, float)) and float(n) == int(n) else 40_000
    d = max(2000, min(120_000, d))
    return d


async def scrape_public_url_to_text(
    url_str: str,
    max_chars_arg: Any,
) -> dict[str, Any]:
    max_chars = _clamp_max_chars(max_chars_arg)
    trimmed = (url_str or "").strip()
    if not trimmed:
        return {"ok": False, "text": "Empty URL"}

    current = trimmed
    async with httpx.AsyncClient(
        timeout=FETCH_TIMEOUT_S,
        follow_redirects=False,
        limits=httpx.Limits(max_connections=5),
    ) as client:
        for hop in range(MAX_REDIRECTS):
            try:
                u = httpx.URL(current)
            except Exception:
                return {"ok": False, "text": "Invalid URL"}

            try:
                await _assert_url_safe_for_fetch(u)
            except ValueError as e:
                return {"ok": False, "text": str(e)}

            headers = {
                "User-Agent": "Voidcast/1.0 (scrape_url tool)",
                "Accept": (
                    "text/html,application/xhtml+xml,text/plain,"
                    "application/json;q=0.8,*/*;q=0.5"
                ),
            }
            try:
                # Stream the body and abort at the cap: a hostile (or merely huge)
                # page must never be buffered in full before the size check runs.
                async with client.stream("GET", current, headers=headers) as res:
                    if 300 <= res.status_code < 400:
                        loc = res.headers.get("location")
                        if not loc:
                            return {"ok": False, "text": "Redirect without Location header"}
                        current = str(httpx.URL(urljoin(current, loc)))
                        continue

                    if not res.is_success:
                        return {"ok": False, "text": f"HTTP {res.status_code}"}

                    ct = res.headers.get("content-type", "")
                    # An honest server declares the size up front; skip the download.
                    declared = res.headers.get("content-length", "").strip()
                    if declared.isdigit() and int(declared) > MAX_BODY_BYTES:
                        return {
                            "ok": False,
                            "text": f"Page is larger than {MAX_BODY_BYTES} bytes",
                        }

                    buf = bytearray()
                    async for chunk in res.aiter_bytes():
                        buf.extend(chunk)
                        if len(buf) > MAX_BODY_BYTES:
                            return {
                                "ok": False,
                                "text": f"Page is larger than {MAX_BODY_BYTES} bytes",
                            }
            except httpx.TimeoutException:
                return {"ok": False, "text": "Request timed out"}
            except Exception as e:
                return {"ok": False, "text": str(e)}

            try:
                # `current` is the post-redirect URL: links stay absolute.
                text, fmt = _extract_text_from_bytes(buf, ct, current)
            except ValueError as e:
                return {"ok": False, "text": str(e)}

            if len(text) > max_chars:
                text = (
                    f"{text[:max_chars]}\n\n[Truncated to {max_chars} characters]"
                )
            return {"ok": True, "text": text, "format": fmt}

        return {"ok": False, "text": "Too many redirects"}
