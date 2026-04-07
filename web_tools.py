"""
Web tools for locAI.
Handles internet searches, weather, web scraping, and calculations.
"""

import math
import requests
import re
from datetime import datetime, timedelta
from urllib.parse import quote_plus, urljoin
from typing import Optional, Any, Dict
from .registry import registry

# Try to import simpleeval for safe math evaluation
try:
    from simpleeval import simple_eval, EvalWithCompoundTypes

    HAS_SIMPLEEVAL = True
except ImportError:
    HAS_SIMPLEEVAL = False

# Try to import ddgs for real web search
try:
    from ddgs import DDGS

    HAS_DDGS = True
except ImportError:
    try:
        from duckduckgo_search import DDGS

        HAS_DDGS = True
    except ImportError:
        HAS_DDGS = False

# Try to import BeautifulSoup4 for web scraping
try:
    from bs4 import BeautifulSoup

    HAS_BEAUTIFULSOUP = True
except ImportError:
    HAS_BEAUTIFULSOUP = False

# Try to import deep-translator for translation
try:
    from deep_translator import GoogleTranslator

    HAS_TRANSLATOR = True
except ImportError:
    HAS_TRANSLATOR = False


def _is_private_or_disallowed_url(url: str) -> bool:
    """Security check for URLs (SSRF protection)."""
    from urllib.parse import urlparse
    import socket
    import ipaddress

    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return True
        host = parsed.hostname or ""
        if not host or host.lower() == "localhost":
            return True
        try:
            addr_infos = socket.getaddrinfo(host, None)
            for family, _, _, _, sockaddr in addr_infos:
                ip = ipaddress.ip_address(sockaddr[0])
                if ip.is_loopback or ip.is_private or ip.is_link_local:
                    return True
        except:
            return True
        return False
    except:
        return True


@registry.register(
    "search_web",
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": "Search the internet for current events, news, programming, or any up-to-date information.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query."}
                },
                "required": ["query"],
            },
        },
    },
)
def search_web(query: str, **kwargs) -> str:
    if not HAS_DDGS:
        return "DuckDuckGo search not available."
    print(f"[TOOL] Searching web for: {query}")
    try:
        current_year = datetime.now().year
        query = re.sub(r"\b(20\d{2})\b", str(current_year), query)
        with DDGS(timeout=20) as ddgs:
            results = list(ddgs.text(query, max_results=10))
            if not results:
                return "No results found."
            out = []
            for r in results:
                body = (r.get("body") or "").strip()
                if len(body) < 15:
                    continue
                out.append(
                    f"{r.get('title')}\n{body[:400]}\n{r.get('href') or r.get('url')}"
                )
            return "\n\n---\n\n".join(out[:7])
    except Exception as e:
        return f"Error searching: {e}"


@registry.register(
    "get_weather",
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Gets current weather and optionally a 3-day forecast for a given city.",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string", "description": "City name."},
                    "forecast": {
                        "type": "boolean",
                        "description": "If true, include 3-day forecast. Default: false.",
                    },
                },
                "required": ["city"],
            },
        },
    },
)
def get_weather(city: str, forecast: bool = False, **kwargs) -> str:
    print(f"[TOOL] Getting weather for: {city} (forecast={forecast})")
    try:
        url = f"https://wttr.in/{quote_plus(city)}?format=j1"
        resp = requests.get(url, timeout=10)
        if resp.status_code != 200:
            return f"Error: {resp.status_code}"
        data = resp.json()
        curr = data.get("current_condition", [{}])[0]
        res = f"Weather for {city}: {curr.get('temp_C')}°C, {curr.get('weatherDesc', [{}])[0].get('value')}\n"
        res += f"Humidity: {curr.get('humidity')}%, Wind: {curr.get('windspeedKmph')} km/h"

        if forecast:
            weather_days = data.get("weather", [])
            if weather_days:
                res += "\n\n3-day forecast:"
                for day in weather_days[:3]:
                    date = day.get("date", "?")
                    max_c = day.get("maxtempC", "?")
                    min_c = day.get("mintempC", "?")
                    hourly = day.get("hourly", [])
                    desc = "?"
                    chance_rain = "?"
                    if hourly:
                        mid = hourly[len(hourly) // 2]
                        desc = mid.get("weatherDesc", [{}])[0].get("value", "?")
                        chance_rain = mid.get("chanceofrain", "?")
                    res += f"\n  {date}: {min_c}–{max_c}°C, {desc}, rain {chance_rain}%"

        return res
    except Exception as e:
        return f"Error: {e}"


def _extract_tables_md(soup) -> str:
    """Extract HTML tables from soup and format as Markdown."""
    tables = soup.find_all("table")
    if not tables:
        return "No tables found on page."
    parts = []
    for i, table in enumerate(tables[:10], 1):
        rows = table.find_all("tr")
        if not rows:
            continue
        md_rows = []
        for row in rows[:50]:
            cells = row.find_all(["th", "td"])
            md_rows.append("| " + " | ".join(c.get_text(strip=True).replace("|", "\\|") for c in cells) + " |")
        if len(md_rows) >= 2:
            col_count = md_rows[0].count("|") - 1
            md_rows.insert(1, "| " + " | ".join(["---"] * max(1, col_count)) + " |")
        parts.append(f"Table {i}:\n" + "\n".join(md_rows))
    return "\n\n".join(parts) if parts else "No tables found on page."


@registry.register(
    "scrape_webpage",
    {
        "type": "function",
        "function": {
            "name": "scrape_webpage",
            "description": "Extract content from a webpage URL.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "extract": {
                        "type": "string",
                        "enum": ["text", "links", "tables", "all"],
                    },
                    "limit": {"type": "integer"},
                    "max_chars": {
                        "type": "integer",
                        "description": "Maximum characters to return (default: 8000).",
                    },
                },
                "required": ["url"],
            },
        },
    },
)
def scrape_webpage(url: str, extract: str = "text", limit: int = 50, max_chars: int = 8000, **kwargs) -> str:
    if _is_private_or_disallowed_url(url):
        return "Access denied to URL."
    if not HAS_BEAUTIFULSOUP:
        return "BeautifulSoup4 not installed."
    max_chars = max(500, min(30000, max_chars))
    try:
        resp = requests.get(url, timeout=10, headers={"User-Agent": "Mozilla/5.0"})
        if resp.status_code != 200:
            return f"Error {resp.status_code}"
        soup = BeautifulSoup(resp.text, "html.parser")
        for s in soup(["script", "style"]):
            s.decompose()

        if extract == "links":
            links = [
                f"{l.get_text(strip=True)}: {urljoin(url, l.get('href'))}"
                for l in soup.find_all("a", href=True)[:limit]
            ]
            result = "\n".join(links)
            return result[:max_chars]

        if extract == "tables":
            result = _extract_tables_md(soup)
            return result[:max_chars]

        text = soup.get_text(separator="\n", strip=True)

        if extract == "all":
            parts = [f"--- Text ---\n{text[:max_chars // 2]}"]
            links = [
                f"{l.get_text(strip=True)}: {urljoin(url, l.get('href'))}"
                for l in soup.find_all("a", href=True)[:limit]
            ]
            if links:
                parts.append(f"\n--- Links ---\n" + "\n".join(links))
            tables_md = _extract_tables_md(soup)
            if tables_md and tables_md != "No tables found on page.":
                parts.append(f"\n--- Tables ---\n{tables_md}")
            result = "\n".join(parts)
            return result[:max_chars]

        return text[:max_chars]
    except Exception as e:
        return f"Error: {e}"


@registry.register(
    "translate",
    {
        "type": "function",
        "function": {
            "name": "translate",
            "description": "Translates text between languages.",
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "target_language": {"type": "string"},
                    "source_language": {"type": "string"},
                },
                "required": ["text"],
            },
        },
    },
)
def translate(
    text: str,
    target_language: str = "en",
    source_language: Optional[str] = None,
    **kwargs,
) -> str:
    if not HAS_TRANSLATOR:
        return "Translator not available."
    try:
        translator = GoogleTranslator(
            source=source_language or "auto", target=target_language
        )
        return translator.translate(text)
    except Exception as e:
        return f"Error: {e}"


_CALC_FUNCTIONS = {
    "sqrt": math.sqrt,
    "abs": abs,
    "round": round,
    "ceil": math.ceil,
    "floor": math.floor,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "asin": math.asin,
    "acos": math.acos,
    "atan": math.atan,
    "log": math.log,
    "log10": math.log10,
    "log2": math.log2,
    "exp": math.exp,
    "pow": pow,
    "min": min,
    "max": max,
}

_CALC_NAMES = {
    "pi": math.pi,
    "e": math.e,
    "inf": math.inf,
}


@registry.register(
    "calculate",
    {
        "type": "function",
        "function": {
            "name": "calculate",
            "description": (
                "Evaluate a mathematical expression safely. Use when the user asks to compute, "
                "calculate, or solve a math problem. Supports: +, -, *, /, ** (power), % (modulo), "
                "and functions: sqrt, abs, round, ceil, floor, sin, cos, tan, asin, acos, atan, "
                "log, log10, log2, exp, pow, min, max. Constants: pi, e."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": "Math expression to evaluate (e.g. 'sqrt(144) + 2**10', '15/100 * 3847').",
                    }
                },
                "required": ["expression"],
            },
        },
    },
)
def calculate(expression: str, **kwargs) -> str:
    if not expression or not expression.strip():
        return "Error: expression is required."
    if not HAS_SIMPLEEVAL:
        return "Error: simpleeval not installed. Run: pip install simpleeval"
    print(f"[TOOL] Calculating: {expression}")
    try:
        result = simple_eval(
            expression.strip(),
            functions=_CALC_FUNCTIONS,
            names=_CALC_NAMES,
        )
        if isinstance(result, float) and result.is_integer():
            result = int(result)
        return f"{expression.strip()} = {result}"
    except ZeroDivisionError:
        return "Error: Division by zero."
    except Exception as e:
        return f"Error evaluating '{expression}': {e}"
