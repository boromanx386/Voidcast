"""
ReportLab-backed Markdown-lite PDF renderer for the `save_pdf` tool.

Replaces the previous pdf-lib implementation in the Electron main process. The
public entry point is :func:`save_pdf_to_folder` which writes the file directly
to ``output_dir`` and returns a small dict describing the result.
"""

from __future__ import annotations

import base64
import binascii
import ipaddress
import logging
import os
import re
import socket
import sys
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any, TypedDict
from urllib.parse import urlparse

try:
    import httpx  # noqa: F401 - imported lazily inside fetch helper

    HAS_HTTPX = True
except ImportError:  # pragma: no cover - tools deps always include httpx
    HAS_HTTPX = False

logger = logging.getLogger("tts-server.pdf")

try:
    from reportlab.lib.colors import Color
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas

    HAS_REPORTLAB = True
except ImportError:  # pragma: no cover - import guard
    HAS_REPORTLAB = False

# ----------------------- Constants (mirror pdf.ts) -----------------------

MAX_CONTENT_CHARS = 400_000
MAX_IMAGES_TOTAL_BYTES = 48 * 1024 * 1024
MAX_URL_IMAGES = 8
URL_FETCH_TIMEOUT_S = 25.0
URL_FETCH_MAX_REDIRECTS = 5
URL_FETCH_USER_AGENT = "Voidcast/1.0 (save_pdf image fetch)"

PAGE_W = 595.28
PAGE_H = 841.89
MARGIN_L = 54.0
MARGIN_R = 54.0
MARGIN_T = 72.0
MARGIN_B = 65.0
CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R

SIZE_TITLE = 18
SIZE_H2 = 13
SIZE_H3 = 11
SIZE_H4 = 10
SIZE_BODY = 10
SIZE_TABLE = 9
SIZE_DATE = 9

PARA_AFTER = 8.0
BLOCK_GAP = 6.0


def _leading(size: float) -> float:
    return size * 1.4


def _color(r: float, g: float, b: float, alpha: float = 1.0) -> "Color":
    return Color(r, g, b, alpha=alpha)


def _palette() -> dict[str, "Color"]:
    return {
        "title": _color(0.10, 0.21, 0.36),
        "h2": _color(0.18, 0.22, 0.28),
        "h34": _color(0.29, 0.33, 0.40),
        "body": _color(0.10, 0.10, 0.10),
        "muted": _color(0.45, 0.51, 0.58),
        "rule": _color(0.63, 0.68, 0.75, alpha=0.9),
        "table_head_bg": _color(0.89, 0.91, 0.94),
        "table_grid": _color(0.80, 0.84, 0.88),
    }


# ----------------------- Fonts -----------------------

FONT_REG = "NotoSans"
FONT_BOLD = "NotoSans-Bold"
_fonts_registered = False


def _resolve_fonts_dir() -> Path:
    """Resolve ``fonts/`` next to this file or in the PyInstaller bundle."""

    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        bundled = Path(meipass) / "fonts"
        if bundled.is_dir():
            return bundled
    return Path(__file__).resolve().parent / "fonts"


def _register_fonts() -> None:
    global _fonts_registered
    if _fonts_registered:
        return
    if not HAS_REPORTLAB:
        raise RuntimeError(
            "reportlab is not installed. Add `reportlab` to requirements-tools.txt."
        )

    fonts_dir = _resolve_fonts_dir()
    reg = fonts_dir / "NotoSans-Regular.ttf"
    bold = fonts_dir / "NotoSans-Bold.ttf"
    if not reg.is_file():
        raise RuntimeError(
            f"Missing PDF font: {reg}. Add NotoSans-Regular.ttf to tts-server/fonts/"
        )
    pdfmetrics.registerFont(TTFont(FONT_REG, str(reg)))
    if bold.is_file():
        pdfmetrics.registerFont(TTFont(FONT_BOLD, str(bold)))
    else:
        # Fallback so bold font name resolves even when bold TTF is absent.
        pdfmetrics.registerFont(TTFont(FONT_BOLD, str(reg)))
    _fonts_registered = True


def _font_for(bold: bool) -> str:
    return FONT_BOLD if bold else FONT_REG


def _string_width(text: str, size: float, bold: bool = False) -> float:
    if not text:
        return 0.0
    return pdfmetrics.stringWidth(text, _font_for(bold), size)


# ----------------------- Text normalization -----------------------

_REPLACEMENTS: dict[str, str] = {
    "\u00A0": " ",
    "\u200B": "",
    "\u200C": "",
    "\u200D": "",
    "\uFEFF": "",
    "\u2018": "'",
    "\u2019": "'",
    "\u201C": '"',
    "\u201D": '"',
    "\u2026": "...",
    "\u2022": "•",
}
_DASH_LIKE = "\u2500\u2501\u2502\u2503\u2550\u2551\u2014\u2015"
_EMOJI_RE = re.compile(
    r"[\U0001F300-\U0001F9FF\u2600-\u27BF]"
)


# Single-asterisk emphasis (`*italic*`). No italic font is bundled, so we strip
# the markers (preserves readability) while still letting `**bold**` survive
# for the rich renderer downstream.
#
# Guards:
#   - Negative lookbehind/lookahead on `\w` and `*` so that `5*4` and `**bold**`
#     are NOT touched.
#   - The match cannot span newlines, so a stray `*` won't eat half a paragraph.
#   - Underscore italics are intentionally NOT supported: too many real-world
#     collisions with `snake_case` and Python dunders like `__name__`.
_ITALIC_STAR_RE = re.compile(r"(?<![\w\*])\*(\S(?:[^\*\n]*?\S)?)\*(?![\w\*])")


def _strip_italic_markers(text: str) -> str:
    """Remove `*x*` italic markers while keeping `**bold**` intact."""

    sentinel = "\x02BOLD\x02"
    s = text.replace("**", sentinel)
    s = _ITALIC_STAR_RE.sub(r"\1", s)
    return s.replace(sentinel, "**")


def _normalize_for_pdf(text: str) -> str:
    t = text.replace("\r\n", "\n").replace("\r", "\n")
    for src, dst in _REPLACEMENTS.items():
        t = t.replace(src, dst)
    for ch in _DASH_LIKE:
        t = t.replace(ch, "-")
    t = _EMOJI_RE.sub("", t)
    t = _strip_italic_markers(t)
    return t


# ----------------------- Markdown-lite parsing -----------------------


def _split_bold_parts(s: str) -> list[tuple[str, bool]]:
    """Split on `**`; even segments are normal, odd segments are bold."""

    parts = s.split("**")
    return [(t, i % 2 == 1) for i, t in enumerate(parts)]


def _words_from_bold_parts(parts: list[tuple[str, bool]]) -> list[tuple[str, bool]]:
    out: list[tuple[str, bool]] = []
    for text, bold in parts:
        if not text:
            continue
        for piece in re.split(r"(\s+)", text):
            if not piece:
                continue
            out.append((piece, bold))
    return out


def _break_long_token(token: str, max_width: float, size: float, bold: bool) -> list[str]:
    chunks: list[str] = []
    chunk = ""
    for ch in token:
        trial = chunk + ch
        if _string_width(trial, size, bold) <= max_width:
            chunk = trial
        else:
            if chunk:
                chunks.append(chunk)
            chunk = ch
    if chunk:
        chunks.append(chunk)
    return chunks


def _wrap_rich_paragraph(
    paragraph: str, max_width: float, size: float
) -> list[list[tuple[str, bool]]]:
    """Word-wrap a paragraph that can contain `**bold**` segments."""

    words = _words_from_bold_parts(_split_bold_parts(paragraph))
    lines: list[list[tuple[str, bool]]] = []
    cur: list[tuple[str, bool]] = []
    cur_w = 0.0

    def flush() -> None:
        nonlocal cur, cur_w
        if cur:
            lines.append(cur)
            cur = []
            cur_w = 0.0

    for word, bold in words:
        is_space = bool(re.fullmatch(r"\s+", word))
        piece_w = _string_width(word, size, bold)

        if not is_space and cur_w + piece_w > max_width and cur:
            flush()

        if not is_space and piece_w > max_width:
            for piece in _break_long_token(word, max_width, size, bold):
                pw = _string_width(piece, size, bold)
                if cur_w + pw > max_width and cur:
                    flush()
                cur.append((piece, bold))
                cur_w += pw
            continue

        cur.append((word, bold))
        cur_w += piece_w
        if is_space and cur_w > max_width:
            flush()

    flush()
    return lines


def _wrap_plain_paragraph(
    paragraph: str, max_width: float, size: float, bold: bool = False
) -> list[str]:
    words = [w for w in re.split(r"\s+", paragraph) if w]
    lines: list[str] = []
    cur = ""
    for word in words:
        trial = f"{cur} {word}" if cur else word
        if _string_width(trial, size, bold) <= max_width:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            if _string_width(word, size, bold) <= max_width:
                cur = word
            else:
                lines.extend(_break_long_token(word, max_width, size, bold))
                cur = ""
    if cur:
        lines.append(cur)
    return lines


def _is_ascii_rule(line: str) -> bool:
    s = line.strip()
    if len(s) < 8:
        return False
    compact = re.sub(r"\s", "", s)
    return bool(compact) and bool(re.fullmatch(r"[=\-_]+", compact))


def _is_md_list_first_line(line: str) -> bool:
    t = line.strip()
    if re.match(r"^[-•]\s+", t):
        return True
    if re.match(r"^\d{1,3}\.\s+", t):
        return True
    if re.match(r"^\*\s+", t) and not t.startswith("**"):
        return True
    return False


class _ListItem(TypedDict, total=False):
    kind: str  # "bullet" | "ordered"
    body: str
    n: str


def _parse_md_list_lines(raw_lines: list[str]) -> list[_ListItem]:
    """Merge continuation lines (no marker) into the previous item."""

    items: list[_ListItem] = []
    for raw in raw_lines:
        t = raw.strip()
        if not t:
            continue
        m = re.match(r"^[-•]\s+(.*)$", t)
        if m:
            items.append({"kind": "bullet", "body": m.group(1) or ""})
            continue
        m = re.match(r"^\*\s+(.*)$", t)
        if m and not t.startswith("**"):
            items.append({"kind": "bullet", "body": m.group(1) or ""})
            continue
        m = re.match(r"^(\d{1,3})\.\s+(.*)$", t)
        if m:
            items.append(
                {"kind": "ordered", "n": m.group(1), "body": m.group(2) or ""}
            )
            continue
        if items:
            prev = items[-1]
            prev_body = prev.get("body", "")
            prev["body"] = (prev_body + " " if prev_body else "") + t
    return items


def _parse_md_table(block: str) -> list[list[str]] | None:
    lines = [ln.strip() for ln in block.split("\n") if ln.strip()]
    if not lines or "|" not in lines[0]:
        return None
    rows: list[list[str]] = []
    for line in lines:
        if "|" not in line:
            return None
        raw = [c.strip() for c in line.split("|")]
        if len(raw) >= 2 and raw[0] == "" and raw[-1] == "":
            raw = raw[1:-1]
        if not raw:
            continue
        if all(re.fullmatch(r"[-:\s]+", c or "") for c in raw):
            continue
        rows.append([c if c else " " for c in raw])
    if not rows:
        return None
    max_cols = max(len(r) for r in rows)
    for r in rows:
        while len(r) < max_cols:
            r.append(" ")
    return rows


# ----------------------- Render context -----------------------


class _Ctx:
    """Mutable render state passed between drawing helpers."""

    def __init__(self, c: "canvas.Canvas") -> None:
        self.c = c
        self.y: float = PAGE_H - MARGIN_T
        self.colors = _palette()
        # Image pools and "used inline" tracking for trailing render.
        self.attached_pool: list[dict[str, Any]] = []
        self.url_pool: list[dict[str, Any]] = []
        self.used_attached: set[int] = set()
        self.used_url: set[int] = set()
        self.drawn_images: int = 0
        self.skipped_images: int = 0

    def ensure_space(self, need: float) -> None:
        if self.y - need >= MARGIN_B:
            return
        self.c.showPage()
        self.y = PAGE_H - MARGIN_T

    def hr(self) -> None:
        self.ensure_space(14)
        self.y -= 4
        rule = self.colors["rule"]
        self.c.setStrokeColor(rule)
        self.c.setLineWidth(1)
        self.c.line(MARGIN_L, self.y, PAGE_W - MARGIN_R, self.y)
        self.y -= 10


# ----------------------- Drawing -----------------------


def _draw_text_run(c: "canvas.Canvas", text: str, x: float, y: float, size: float, bold: bool, color: "Color") -> float:
    if not text:
        return x
    c.setFont(_font_for(bold), size)
    c.setFillColor(color)
    c.drawString(x, y, text)
    return x + _string_width(text, size, bold)


def _draw_rich_line(
    c: "canvas.Canvas",
    parts: list[tuple[str, bool]],
    x: float,
    y: float,
    size: float,
    color: "Color",
) -> None:
    cx = x
    for text, bold in parts:
        cx = _draw_text_run(c, text, cx, y, size, bold, color)


def _draw_paragraph_rich(
    ctx: _Ctx,
    paragraph: str,
    size: float,
    color: "Color",
    line_gap: float = 0,
    layout: tuple[float, float] | None = None,
) -> None:
    text_x = layout[0] if layout else MARGIN_L
    max_w = layout[1] if layout else CONTENT_W
    lines = _wrap_rich_paragraph(paragraph, max_w, size)
    lh = _leading(size)
    for line_parts in lines:
        ctx.ensure_space(lh + 2)
        ctx.y -= lh
        _draw_rich_line(ctx.c, line_parts, text_x, ctx.y, size, color)
    ctx.y -= line_gap


def _draw_paragraph_plain(
    ctx: _Ctx,
    paragraph: str,
    size: float,
    color: "Color",
    bold: bool = False,
    line_gap: float = 0,
) -> None:
    lines = _wrap_plain_paragraph(paragraph, CONTENT_W, size, bold)
    lh = _leading(size)
    for line in lines:
        ctx.ensure_space(lh + 2)
        ctx.y -= lh
        _draw_text_run(ctx.c, line, MARGIN_L, ctx.y, size, bold, color)
    ctx.y -= line_gap


def _draw_list_item(
    ctx: _Ctx,
    marker_display: str,
    body: str,
    marker_bold: bool = False,
) -> None:
    size = SIZE_BODY
    lh = _leading(size)
    marker = marker_display if marker_display.endswith(" ") else f"{marker_display} "
    prefix_w = _string_width(marker, size, marker_bold)
    text_start_x = MARGIN_L + prefix_w
    max_w = PAGE_W - MARGIN_R - text_start_x
    lines = _wrap_rich_paragraph(body.strip(), max_w, size)
    body_color = ctx.colors["body"]

    for i, line_parts in enumerate(lines):
        ctx.ensure_space(lh + 2)
        ctx.y -= lh
        if i == 0:
            _draw_text_run(
                ctx.c, marker, MARGIN_L, ctx.y, size, marker_bold, body_color
            )
            _draw_rich_line(
                ctx.c, line_parts, text_start_x, ctx.y, size, body_color
            )
        else:
            _draw_rich_line(
                ctx.c, line_parts, MARGIN_L + prefix_w, ctx.y, size, body_color
            )
    ctx.y -= 4


def _draw_body_block_rich(ctx: _Ctx, block: str) -> None:
    """Single `\\n` lines inside a block render as separate paragraphs."""

    trimmed = block.strip()
    if not trimmed:
        return
    segments = [s.strip() for s in trimmed.split("\n") if s.strip()]
    body = ctx.colors["body"]
    if len(segments) <= 1:
        _draw_paragraph_rich(ctx, trimmed, SIZE_BODY, body, PARA_AFTER)
        return
    for i, segment in enumerate(segments):
        gap = PARA_AFTER if i == len(segments) - 1 else 8.0
        _draw_paragraph_rich(ctx, segment, SIZE_BODY, body, gap)


def _draw_table(ctx: _Ctx, rows: list[list[str]]) -> None:
    ncols = len(rows[0]) if rows else 0
    if not ncols:
        return
    weights = [2.0 if i == ncols - 1 else 1.0 for i in range(ncols)]
    tw = sum(weights)
    col_widths = [max(50.0, (CONTENT_W * w) / tw) for w in weights]
    cell_size = SIZE_TABLE
    pad = 4.0
    lh = _leading(cell_size)

    head_bg = ctx.colors["table_head_bg"]
    grid = ctx.colors["table_grid"]
    title_col = ctx.colors["title"]
    body_col = ctx.colors["body"]

    for ri, row in enumerate(rows):
        is_header = ri == 0
        cell_lines: list[list[list[tuple[str, bool]]]] = []
        for ci, cell in enumerate(row):
            text = cell.replace("|", " ")
            inner_w = max(20.0, (col_widths[ci] if ci < len(col_widths) else 0) - pad * 2)
            rich = _wrap_rich_paragraph(text, inner_w, cell_size)
            if is_header:
                # Header cells render fully bold regardless of inline markers.
                rich = [[(t, True) for t, _ in parts] for parts in rich]
            cell_lines.append(rich if rich else [[("", False)]])

        rows_max = max((len(cl) for cl in cell_lines), default=1)
        row_height = rows_max * lh + pad * 2

        ctx.ensure_space(row_height + 2)

        x = MARGIN_L
        cell_color = title_col if is_header else body_col
        for ci in range(ncols):
            cw = col_widths[ci] if ci < len(col_widths) else 0
            lines = cell_lines[ci] if ci < len(cell_lines) else [[("", False)]]
            if is_header:
                ctx.c.setFillColor(head_bg)
                ctx.c.rect(
                    x,
                    ctx.y - row_height + pad,
                    cw,
                    row_height,
                    stroke=0,
                    fill=1,
                )
            ctx.c.setStrokeColor(grid)
            ctx.c.setLineWidth(0.5)
            ctx.c.rect(
                x,
                ctx.y - row_height,
                cw,
                row_height,
                stroke=1,
                fill=0,
            )
            ly = ctx.y - pad - cell_size
            for line_parts in lines:
                _draw_rich_line(
                    ctx.c,
                    line_parts,
                    x + pad,
                    ly,
                    cell_size,
                    cell_color,
                )
                ly -= lh
            x += cw
        ctx.y -= row_height


def _classify_and_render_block(ctx: _Ctx, raw_block: str) -> None:
    block = raw_block.strip()
    if not block:
        return

    if _try_render_inline_image_block(ctx, block):
        return

    if _is_ascii_rule(block):
        ctx.hr()
        return

    lines = [ln.strip() for ln in block.split("\n")]
    if (
        len(lines) >= 3
        and _is_ascii_rule(lines[0] or "")
        and _is_ascii_rule(lines[2] or "")
        and lines[1]
    ):
        ctx.hr()
        _draw_paragraph_plain(
            ctx, lines[1], SIZE_H3, ctx.colors["h2"], bold=True, line_gap=4
        )
        ctx.hr()
        rest = "\n".join(lines[3:]).strip()
        if rest:
            _classify_and_render_block(ctx, rest)
        return

    if re.fullmatch(r"-{2,}", block):
        ctx.y -= 12
        return

    if block.startswith("---"):
        rest = re.sub(r"^---+", "", block).strip()
        ctx.y -= 12
        if rest:
            _classify_and_render_block(ctx, rest)
        return

    first_line = lines[0] if lines else ""
    rest_block = "\n".join(lines[1:]).strip()

    def heading(prefix: str, size: int, color_name: str) -> bool:
        if not first_line.startswith(prefix):
            return False
        title = first_line[len(prefix):].strip()
        ctx.ensure_space(size + 8)
        ctx.y -= size + 4
        _draw_paragraph_plain(
            ctx, title, size, ctx.colors[color_name], bold=True, line_gap=6
        )
        if rest_block:
            _classify_and_render_block(ctx, rest_block)
        return True

    if heading("# ", SIZE_TITLE, "title"):
        return
    if heading("#### ", SIZE_H4, "h34"):
        return
    if heading("### ", SIZE_H3, "h2"):
        return
    if heading("## ", SIZE_H2, "h2"):
        return

    if _is_md_list_first_line(first_line):
        items = _parse_md_list_lines([ln for ln in lines if ln.strip()])
        if items:
            for item in items:
                if item.get("kind") == "bullet":
                    _draw_list_item(ctx, "•", item.get("body", ""))
                else:
                    _draw_list_item(ctx, f"{item.get('n', '')}.", item.get("body", ""))
            ctx.y -= PARA_AFTER
            return

    table = _parse_md_table(block)
    if table:
        _draw_table(ctx, table)
        ctx.y -= BLOCK_GAP
        return

    _draw_body_block_rich(ctx, block)


# ----------------------- Image embedding -----------------------


def _scale_image_to_layout(iw: float, ih: float) -> tuple[float, float]:
    if iw <= 0 or ih <= 0:
        return CONTENT_W, CONTENT_W
    scale = min(1.0, CONTENT_W / iw)
    w = iw * scale
    h = ih * scale
    max_page_h = PAGE_H - MARGIN_T - MARGIN_B - 24
    if h > max_page_h:
        scale = max_page_h / ih
        w = iw * scale
        h = ih * scale
    return w, h


def _draw_one_image(ctx: _Ctx, src: dict[str, Any]) -> bool:
    """Draw a single image at the current cursor; updates ctx counters.

    Returns True on success, False if the image was unreadable or rejected.
    """
    try:
        reader = ImageReader(BytesIO(src["bytes"]))
        iw, ih = reader.getSize()
    except Exception:
        ctx.skipped_images += 1
        return False
    w, h = _scale_image_to_layout(iw, ih)
    ctx.ensure_space(h + 20)
    ctx.y -= 10
    ctx.y -= h
    try:
        ctx.c.drawImage(
            reader,
            MARGIN_L,
            ctx.y,
            width=w,
            height=h,
            preserveAspectRatio=True,
            anchor="nw",
            mask="auto",
        )
        ctx.drawn_images += 1
        ctx.y -= 12
        return True
    except Exception:
        ctx.skipped_images += 1
        ctx.y -= 12
        return False


# Sentinel used to mark "render inline image here" inside the Markdown stream.
# The 0x01 byte cannot legally appear in JSON-decoded user content, so this is
# safe to use as a unique paragraph token after `_preprocess_inline_images`.
_IMG_SENTINEL_PREFIX = "\x01<<VC_IMG:"
_IMG_SENTINEL_SUFFIX = ">>\x01"

# Standalone `![alt](attached:N)` / `![alt](url:N)` on its own line.
_INLINE_IMAGE_LINE_RE = re.compile(
    r"^\s*!\[[^\]]*\]\(\s*(attached|url)\s*:\s*(\d+)\s*\)\s*$",
    re.IGNORECASE,
)


def _norm_heading_text(s: str) -> str:
    """Aggressive normalization for comparing heading text against the title.

    Folds whitespace, lowercases, drops trailing punctuation, and removes
    common decorative chars so that small wording drift between title and
    first heading doesn't defeat the duplicate-detection.
    """
    t = s.lower().strip()
    # Drop trailing punctuation we don't care about (`.`, `:`, `…`, etc.).
    t = re.sub(r"[\.\:\;\!\?\u2026]+\s*$", "", t)
    # Strip backticks/quotes around the line.
    t = re.sub(r"[`\"\u2018\u2019\u201C\u201D]", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _titles_overlap(heading: str, title: str) -> bool:
    """Return True when `heading` is effectively the same as `title`.

    Considers exact match, and prefix match in either direction when both
    sides are long enough (≥ 12 normalized chars). The prefix rule handles
    cases like title="X (maj 2026)" vs heading="X" that LLMs commonly emit.
    """
    a = _norm_heading_text(heading)
    b = _norm_heading_text(title)
    if not a or not b:
        return False
    if a == b:
        return True
    if len(a) < 12 or len(b) < 12:
        return False
    return a.startswith(b) or b.startswith(a)


def _strip_duplicate_first_heading(body: str, title: str) -> str:
    """Drop a leading `# Heading` line that mirrors the document title.

    Operates on the already-normalized body so it sees the same characters
    the title block was rendered with. Only the first non-empty line is
    considered — and only when it's a Markdown heading.
    """
    if not body or not title:
        return body
    lines = body.split("\n")
    i = 0
    while i < len(lines) and not lines[i].strip():
        i += 1
    if i >= len(lines):
        return body
    first = lines[i].lstrip()
    if not first.startswith("#"):
        return body
    heading_text = re.sub(r"^#+\s*", "", first).strip()
    if not _titles_overlap(heading_text, title):
        return body
    # Remove the heading line and any blank lines immediately following it so
    # the next block lifts up cleanly.
    del lines[i]
    while i < len(lines) and not lines[i].strip():
        del lines[i]
    return "\n".join(lines)


def _preprocess_inline_images(body: str) -> str:
    """Convert standalone markdown image lines into sentinel paragraphs.

    Recognizes lines of the form `![alt](attached:N)` or `![alt](url:N)` where
    `N` is a 0-based index into the attached images / `image_urls` payload.
    The transformed block is wrapped in blank lines so the existing block
    splitter isolates it as its own block, allowing inline placement.
    """

    if not body:
        return body
    out: list[str] = []
    for raw in body.split("\n"):
        m = _INLINE_IMAGE_LINE_RE.match(raw)
        if not m:
            out.append(raw)
            continue
        kind = m.group(1).lower()
        idx = m.group(2)
        sentinel = f"{_IMG_SENTINEL_PREFIX}{kind}:{idx}{_IMG_SENTINEL_SUFFIX}"
        if out and out[-1].strip() != "":
            out.append("")
        out.append(sentinel)
        out.append("")
    return "\n".join(out)


def _try_render_inline_image_block(ctx: _Ctx, block: str) -> bool:
    """If `block` is a single image sentinel, draw the referenced image.

    Returns True when the block was consumed as an inline image (whether or
    not the image was actually drawable); the caller should then skip normal
    block classification for it.
    """

    s = block.strip()
    if not (s.startswith(_IMG_SENTINEL_PREFIX) and s.endswith(_IMG_SENTINEL_SUFFIX)):
        return False
    inner = s[len(_IMG_SENTINEL_PREFIX) : -len(_IMG_SENTINEL_SUFFIX)]
    kind, _sep, idx_str = inner.partition(":")
    try:
        idx = int(idx_str)
    except ValueError:
        return True
    if kind == "attached":
        if 0 <= idx < len(ctx.attached_pool):
            _draw_one_image(ctx, ctx.attached_pool[idx])
            ctx.used_attached.add(idx)
    elif kind == "url":
        if 0 <= idx < len(ctx.url_pool):
            _draw_one_image(ctx, ctx.url_pool[idx])
            ctx.used_url.add(idx)
    # Unknown/out-of-range references are silently dropped to keep the body
    # render readable even when the agent passes a bad index.
    return True


def _draw_trailing_images(ctx: _Ctx) -> None:
    """Draw any pool images that were not placed inline via sentinels."""
    for i, item in enumerate(ctx.attached_pool):
        if i in ctx.used_attached:
            continue
        _draw_one_image(ctx, item)
    for i, item in enumerate(ctx.url_pool):
        if i in ctx.used_url:
            continue
        _draw_one_image(ctx, item)


# ----------------------- File naming helpers -----------------------


def _safe_default_filename(title: str, suggested: str | None) -> str:
    base = (suggested or title or "voidcast-document").strip()[:120]
    cleaned = re.sub(r"[<>:\"/\\|?*]+", "_", base)
    cleaned = re.sub(r"\s+", "_", cleaned).strip("_")
    if not cleaned:
        cleaned = "voidcast-document"
    return cleaned if cleaned.lower().endswith(".pdf") else f"{cleaned}.pdf"


def _unique_file_path(directory: Path, file_name: str) -> Path:
    fp = directory / file_name
    if not fp.exists():
        return fp
    stem = fp.stem or "document"
    suffix = fp.suffix or ".pdf"
    for i in range(2, 1000):
        candidate = directory / f"{stem}-{i}{suffix}"
        if not candidate.exists():
            return candidate
    return directory / f"{stem}-{int(datetime.now().timestamp())}{suffix}"


def _is_private_or_loopback(host: str) -> bool:
    h = host.strip().lower()
    if not h:
        return True
    if h == "localhost" or h.endswith(".localhost"):
        return True
    try:
        ip = ipaddress.ip_address(h)
        return (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
        )
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(h, None, type=socket.SOCK_STREAM)
    except OSError:
        return True
    for info in infos:
        sockaddr = info[4]
        if not sockaddr:
            continue
        ip_str = sockaddr[0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            return True
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
        ):
            return True
    return False


_CT_TO_MIME: dict[str, str] = {
    "image/png": "image/png",
    "image/jpeg": "image/jpeg",
    "image/jpg": "image/jpeg",
}


def _mime_from_response(content_type: str | None, url: str) -> str | None:
    ct = (content_type or "").split(";", 1)[0].strip().lower()
    if ct in _CT_TO_MIME:
        return _CT_TO_MIME[ct]
    # Fall back to URL path extension when CDN does not set a useful CT.
    path = urlparse(url).path.lower()
    if path.endswith(".png"):
        return "image/png"
    if path.endswith(".jpg") or path.endswith(".jpeg"):
        return "image/jpeg"
    if path.endswith(".webp"):
        return "image/webp"
    return None


def _fetch_url_images(
    urls: list[str],
    running_total: int,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Fetch each URL → bytes (PNG/JPEG/WebP) with SSRF protection.

    Returns (decoded, errors). `errors` is human-readable per-URL skip reasons
    used to inform the agent why an image couldn't be embedded.
    """

    if not urls:
        return [], []
    if not HAS_HTTPX:
        return [], ["httpx not installed; cannot fetch image URLs"]

    import httpx as _httpx  # local import keeps module importable in odd envs

    decoded: list[dict[str, Any]] = []
    errors: list[str] = []
    total = running_total

    with _httpx.Client(
        timeout=URL_FETCH_TIMEOUT_S,
        follow_redirects=True,
        max_redirects=URL_FETCH_MAX_REDIRECTS,
        headers={"User-Agent": URL_FETCH_USER_AGENT},
        limits=_httpx.Limits(max_connections=4),
    ) as client:
        for raw in urls[:MAX_URL_IMAGES]:
            url = (raw or "").strip()
            if not url:
                continue
            try:
                parsed = urlparse(url)
            except Exception as e:  # noqa: BLE001
                errors.append(f"{url!r}: invalid URL ({e})")
                continue
            if parsed.scheme not in ("http", "https"):
                errors.append(f"{url!r}: only http(s) URLs are allowed")
                continue
            host = parsed.hostname or ""
            if not host or _is_private_or_loopback(host):
                errors.append(f"{url!r}: host is local/private/unreachable")
                continue

            try:
                r = client.get(url)
            except _httpx.TimeoutException:
                errors.append(f"{url!r}: timed out")
                continue
            except Exception as e:  # noqa: BLE001 - network errors are user-facing
                errors.append(f"{url!r}: fetch failed ({e})")
                continue

            if not (200 <= r.status_code < 300):
                errors.append(f"{url!r}: HTTP {r.status_code}")
                continue

            mime = _mime_from_response(r.headers.get("content-type"), url)
            if mime is None:
                errors.append(f"{url!r}: unsupported content-type")
                continue

            data = r.content
            if not data:
                errors.append(f"{url!r}: empty response body")
                continue

            total += len(data)
            if total > MAX_IMAGES_TOTAL_BYTES:
                errors.append(
                    f"{url!r}: would exceed image payload limit ({MAX_IMAGES_TOTAL_BYTES} bytes)"
                )
                break

            decoded.append({"bytes": data, "mime": mime})

    if len(urls) > MAX_URL_IMAGES:
        errors.append(
            f"only the first {MAX_URL_IMAGES} URLs were fetched (got {len(urls)})"
        )

    return decoded, errors


def _decode_payload_images(
    incoming: list[dict[str, Any]] | None,
) -> tuple[list[dict[str, Any]], str | None]:
    if not incoming:
        return [], None
    decoded: list[dict[str, Any]] = []
    total = 0
    for item in incoming:
        b64 = str(item.get("base64") or "").strip()
        if not b64:
            continue
        try:
            buf = base64.b64decode(b64, validate=False)
        except (binascii.Error, ValueError):
            return [], "Invalid base64 in attached image data"
        if not buf:
            continue
        total += len(buf)
        if total > MAX_IMAGES_TOTAL_BYTES:
            return (
                [],
                f"Attached images exceed size limit ({MAX_IMAGES_TOTAL_BYTES} bytes total)",
            )
        mime = str(item.get("mime") or "").strip() or "application/octet-stream"
        decoded.append({"bytes": buf, "mime": mime})
    return decoded, None


# ----------------------- Public entry -----------------------


class SavePdfResult(TypedDict, total=False):
    ok: bool
    text: str
    file_path: str


def _draw_title_block(ctx: _Ctx, title_text: str) -> None:
    if not title_text:
        return
    ctx.ensure_space(SIZE_TITLE + 24)
    ctx.y -= SIZE_TITLE
    _draw_text_run(
        ctx.c,
        title_text,
        MARGIN_L,
        ctx.y,
        SIZE_TITLE,
        True,
        ctx.colors["title"],
    )
    ctx.y -= _leading(SIZE_TITLE)

    now = datetime.now()
    # Match `toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })`.
    date_str = f"{now.strftime('%B')} {now.day}, {now.year}"
    ctx.y -= 2
    _draw_text_run(
        ctx.c,
        date_str,
        MARGIN_L,
        ctx.y,
        SIZE_DATE,
        False,
        ctx.colors["muted"],
    )
    ctx.y -= _leading(SIZE_DATE) + 16


def _build_pdf_to_path(
    out_path: Path,
    title: str,
    body: str,
    attached_images: list[dict[str, Any]] | None,
    url_images: list[dict[str, Any]] | None,
) -> tuple[int, int]:
    _register_fonts()
    c = canvas.Canvas(str(out_path), pagesize=(PAGE_W, PAGE_H))
    c.setTitle(title or "Document")
    c.setCreator("Voidcast save_pdf")

    ctx = _Ctx(c)
    ctx.attached_pool = list(attached_images or [])
    ctx.url_pool = list(url_images or [])

    title_text = title.strip()
    if title_text:
        _draw_title_block(ctx, title_text)

    body_norm = _normalize_for_pdf(body)
    body_norm = _strip_duplicate_first_heading(body_norm, title_text)
    body_norm = _preprocess_inline_images(body_norm)
    blocks = [b.strip() for b in re.split(r"\n\n+", body_norm) if b.strip()]
    for block in blocks:
        _classify_and_render_block(ctx, block)

    if ctx.attached_pool or ctx.url_pool:
        _draw_trailing_images(ctx)

    c.save()
    return ctx.drawn_images, ctx.skipped_images


def save_pdf_to_folder(
    *,
    content: str,
    output_dir: str,
    title: str | None = None,
    filename: str | None = None,
    images: list[dict[str, Any]] | None = None,
    image_urls: list[str] | None = None,
) -> SavePdfResult:
    """Render Markdown-lite ``content`` and write a PDF inside ``output_dir``.

    Returns a dict with ``ok``, ``text`` and (on success) ``file_path``.
    """

    if not HAS_REPORTLAB:
        return {
            "ok": False,
            "text": "reportlab is not installed on the tools server.",
        }

    raw = content or ""
    if not raw.strip():
        return {"ok": False, "text": "Empty content"}
    if len(raw) > MAX_CONTENT_CHARS:
        return {
            "ok": False,
            "text": f"Content too long (max {MAX_CONTENT_CHARS} characters)",
        }

    dir_str = (output_dir or "").strip()
    if not dir_str:
        return {
            "ok": False,
            "text": (
                "No PDF folder configured. Set it in Options → Tools → Save as PDF "
                "(folder path)."
            ),
        }

    try:
        directory = Path(dir_str).expanduser().resolve()
        directory.mkdir(parents=True, exist_ok=True)
    except Exception as e:  # noqa: BLE001 - surface filesystem errors
        return {"ok": False, "text": str(e)}

    title_text = (title or "Document").strip() or "Document"
    base_name = _safe_default_filename(title_text, filename)
    out_path = _unique_file_path(directory, base_name)

    decoded, err = _decode_payload_images(images)
    if err is not None:
        return {"ok": False, "text": err}

    url_decoded: list[dict[str, Any]] = []
    url_errors: list[str] = []
    if image_urls:
        running = sum(len(item.get("bytes", b"")) for item in decoded)
        url_decoded, url_errors = _fetch_url_images(image_urls, running)
        if url_errors:
            for msg in url_errors:
                logger.info("save_pdf url skipped: %s", msg)

    try:
        drawn, skipped = _build_pdf_to_path(
            out_path,
            title_text,
            raw,
            decoded or None,
            url_decoded or None,
        )
    except Exception as e:  # noqa: BLE001 - any rendering failure
        # Best-effort: clean up zero-byte file from a failed save.
        try:
            if out_path.exists() and out_path.stat().st_size == 0:
                os.remove(out_path)
        except OSError:
            pass
        return {"ok": False, "text": str(e)}

    extra = ""
    total_requested = len(decoded) + len(url_decoded) + len(url_errors)
    if total_requested > 0:
        extra = f"\nEmbedded {drawn} image(s)"
        if skipped > 0:
            extra += f" ({skipped} skipped as unsupported/corrupt)"
        if url_errors:
            extra += f"; {len(url_errors)} URL(s) failed: " + "; ".join(url_errors[:3])
            if len(url_errors) > 3:
                extra += f" (+{len(url_errors) - 3} more)"
        extra += "."

    return {
        "ok": True,
        "text": f"PDF saved:\n{out_path}{extra}",
        "file_path": str(out_path),
    }
