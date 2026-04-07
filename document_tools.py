"""
Document tools for locAI.
Creates PDFs from text (ReportLab).
"""

import re
from datetime import datetime
from typing import Optional, Any, Dict, List
from pathlib import Path

from .registry import registry


@registry.register(
    "create_pdf",
    {
        "type": "function",
        "function": {
            "name": "create_pdf",
            "description": "Create a PDF document from text. Use when the user asks to save, export, or create a PDF of content, summary, report, or response. IMPORTANT: Always include the exact file path from the tool result in your response (e.g. C:\\Users\\...\\file.pdf) so the user can click it to open the PDF.",
            "parameters": {
                "type": "object",
                "properties": {
                    "content": {
                        "type": "string",
                        "description": "Text content to put in the PDF",
                    },
                    "title": {
                        "type": "string",
                        "description": "Optional title for the document (used as filename if provided)",
                    },
                },
                "required": ["content"],
            },
        },
    },
)
def create_pdf(
    content: str,
    title: Optional[str] = None,
    config_manager: Optional[Any] = None,
    **kwargs: Any,
) -> str:
    """Create a PDF from text content. Returns path or error message."""
    if not content or not content.strip():
        return "Error: content is required and cannot be empty."
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.colors import HexColor
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.platypus import (
            SimpleDocTemplate,
            Paragraph,
            Spacer,
            Table,
            TableStyle,
            HRFlowable,
        )
        from reportlab.lib.units import inch
    except ImportError:
        return "ReportLab not installed. Run: pip install reportlab"
    if not config_manager:
        return "PDF creation requires config_manager."
    try:
        from core.paths import get_document_output_dir

        out_dir = get_document_output_dir(config_manager)
        safe_title = (
            re.sub(r"[^\w\s-]", "", (title or "document")[:50]).strip() or "document"
        )
        safe_title = re.sub(r"\s+", "-", safe_title)
        base_name = f"{safe_title}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        filename = f"{base_name}.pdf"
        path = out_dir / filename

        doc = SimpleDocTemplate(
            str(path),
            pagesize=A4,
            rightMargin=0.75 * inch,
            leftMargin=0.75 * inch,
            topMargin=1.0 * inch,
            bottomMargin=0.9 * inch,
        )
        styles = getSampleStyleSheet()
        # Prefer a Unicode-capable font to avoid "square boxes" for non-ASCII text.
        font_name = "Helvetica"
        font_name_bold = "Helvetica-Bold"
        font_candidates = [
            ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf"),
            ("C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/segoeuib.ttf"),
            (
                "C:/Windows/Fonts/DejaVuSans.ttf",
                "C:/Windows/Fonts/DejaVuSans-Bold.ttf",
            ),
        ]
        for regular_path, bold_path in font_candidates:
            if Path(regular_path).exists():
                try:
                    pdfmetrics.registerFont(TTFont("LocAIPDF", regular_path))
                    font_name = "LocAIPDF"
                    if Path(bold_path).exists():
                        pdfmetrics.registerFont(TTFont("LocAIPDFBold", bold_path))
                        font_name_bold = "LocAIPDFBold"
                    else:
                        font_name_bold = font_name
                    break
                except Exception:
                    continue
        doc_title_style = ParagraphStyle(
            "DocTitle",
            parent=styles["Heading1"],
            fontName=font_name_bold,
            fontSize=18,
            spaceAfter=6,
            textColor=HexColor("#1a365d"),
        )
        h2_style = ParagraphStyle(
            "H2",
            parent=styles["Heading2"],
            fontName=font_name_bold,
            fontSize=13,
            spaceBefore=14,
            spaceAfter=6,
            textColor=HexColor("#2d3748"),
        )
        h3_style = ParagraphStyle(
            "H3",
            parent=styles["Heading3"],
            fontName=font_name_bold,
            fontSize=11,
            spaceBefore=10,
            spaceAfter=4,
            textColor=HexColor("#2d3748"),
        )
        h4_style = ParagraphStyle(
            "H4",
            parent=styles["Heading3"],
            fontName=font_name_bold,
            fontSize=10,
            spaceBefore=8,
            spaceAfter=2,
            textColor=HexColor("#4a5568"),
        )
        body_style = ParagraphStyle(
            "Body",
            parent=styles["Normal"],
            fontName=font_name,
            fontSize=10,
            leading=14,
            spaceAfter=8,
        )
        bullet_style = ParagraphStyle(
            "Bullet",
            parent=body_style,
            leftIndent=18,
            spaceAfter=4,
        )

        def _normalize_for_pdf(text: str) -> str:
            # Normalize punctuation/spacing to avoid missing glyphs in fallback fonts.
            replacements = {
                "\u00A0": " ",   # non-breaking space
                "\u200B": "",    # zero-width space
                "\u200C": "",
                "\u200D": "",
                "\uFEFF": "",
                "\u2018": "'",
                "\u2019": "'",
                "\u201C": '"',
                "\u201D": '"',
                "\u2026": "...",
                "\u2022": "•",
                "\u25E6": "•",
                "\u25CF": "•",
            }
            for src, dst in replacements.items():
                text = text.replace(src, dst)
            for c in "\u2500\u2501\u2502\u2503\u2550\u2551\u2014\u2015":
                text = text.replace(c, "-")
            text = re.sub(r"[\U0001F300-\U0001F9FF\U00002600-\U000027BF]", "", text)
            return text

        def _html_escape(s: str) -> str:
            return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

        def _bold_md(text: str) -> str:
            return re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)

        def _parse_md_table(para: str) -> Optional[List[List[str]]]:
            lines = [ln.strip() for ln in para.split("\n") if ln.strip()]
            if len(lines) < 2 or "|" not in lines[0]:
                return None
            rows: List[List[str]] = []
            for line in lines:
                if "|" not in line:
                    return None
                raw = [c.strip() for c in line.split("|")]
                if len(raw) >= 2 and raw[0] == "" and raw[-1] == "":
                    raw = raw[1:-1]
                cells = [c or " " for c in raw if raw]
                if not cells:
                    continue
                if all(re.match(r"^[-:]+$", c) for c in cells):
                    continue
                rows.append(cells)
            if not rows:
                return None
            max_cols = max(len(r) for r in rows)
            for r in rows:
                while len(r) < max_cols:
                    r.append(" ")
            return rows

        def _is_ascii_rule(line: str) -> bool:
            line = (line or "").strip()
            if len(line) < 8:
                return False
            compact = line.replace(" ", "")
            return bool(compact) and all(ch in "=-_" for ch in compact)

        def _para_to_flow(para: str) -> list:
            out = []
            para = para.strip()
            if not para:
                return out
            # Convert ASCII "borders" (====, ----, ____) into real PDF horizontal rules.
            if _is_ascii_rule(para):
                out.append(
                    HRFlowable(
                        width="100%",
                        thickness=1.0,
                        color=HexColor("#A0AEC0"),
                        spaceBefore=4,
                        spaceAfter=6,
                    )
                )
                return out
            # Common block style:
            # ========
            # TITLE
            # ========
            lines = [ln.strip() for ln in para.split("\n")]
            if (
                len(lines) >= 3
                and _is_ascii_rule(lines[0])
                and _is_ascii_rule(lines[2])
                and lines[1]
            ):
                out.append(
                    HRFlowable(
                        width="100%",
                        thickness=1.0,
                        color=HexColor("#A0AEC0"),
                        spaceBefore=4,
                        spaceAfter=6,
                    )
                )
                out.append(Paragraph(_bold_md(_html_escape(lines[1])), h3_style))
                out.append(
                    HRFlowable(
                        width="100%",
                        thickness=1.0,
                        color=HexColor("#A0AEC0"),
                        spaceBefore=2,
                        spaceAfter=8,
                    )
                )
                rest = "\n".join(lines[3:]).strip()
                if rest:
                    for flow in _para_to_flow(rest):
                        out.append(flow)
                return out
            if re.match(r"^-{2,}$", para):
                out.append(Spacer(1, 12))
                return out
            if para.startswith("---"):
                rest = para.lstrip("-").lstrip("\n").strip()
                if rest:
                    out.append(Spacer(1, 12))
                    for flow in _para_to_flow(rest):
                        out.append(flow)
                    return out
            if para.startswith("# ") and not para.startswith("## "):
                first, _, rest = para.partition("\n")
                text = _bold_md(_html_escape(first[2:].strip()))
                out.append(Paragraph(text, doc_title_style))
                if rest.strip():
                    for flow in _para_to_flow(rest):
                        out.append(flow)
                return out
            if para.startswith("#### "):
                first, _, rest = para.partition("\n")
                text = _bold_md(_html_escape(first[5:].strip()))
                out.append(Paragraph(text, h4_style))
                if rest.strip():
                    for flow in _para_to_flow(rest):
                        out.append(flow)
                return out
            if para.startswith("### "):
                first, _, rest = para.partition("\n")
                text = _bold_md(_html_escape(first[4:].strip()))
                out.append(Paragraph(text, h3_style))
                if rest.strip():
                    for flow in _para_to_flow(rest):
                        out.append(flow)
                return out
            if para.startswith("## "):
                first, _, rest = para.partition("\n")
                text = _bold_md(_html_escape(first[3:].strip()))
                out.append(Paragraph(text, h2_style))
                if rest.strip():
                    for flow in _para_to_flow(rest):
                        out.append(flow)
                return out
            if para.startswith("- ") or para.startswith("• "):
                items = [line.strip() for line in para.split("\n") if line.strip()]
                for item in items:
                    clean = item.lstrip("-• ").strip()
                    if clean:
                        text = _bold_md(_html_escape(clean))
                        out.append(Paragraph(f"• {text}", bullet_style))
                return out
            table_data = _parse_md_table(para)
            if table_data:
                try:
                    cell_style = ParagraphStyle(
                        "TableCell", parent=body_style, fontSize=9, spaceAfter=0
                    )
                    table_flow = [
                        [
                            Paragraph(_bold_md(_html_escape(str(c))), cell_style)
                            for c in row
                        ]
                        for row in table_data
                    ]
                    ncols = len(table_data[0])
                    avail = doc.width
                    weights = [1] * (ncols - 1) + [2]
                    total = sum(weights)
                    col_widths = [max(0.8 * inch, avail * w / total) for w in weights]
                    tbl = Table(
                        table_flow,
                        repeatRows=1,
                        colWidths=col_widths,
                    )
                    tbl.setStyle(
                        TableStyle(
                            [
                                ("BACKGROUND", (0, 0), (-1, 0), HexColor("#e2e8f0")),
                                ("TEXTCOLOR", (0, 0), (-1, 0), HexColor("#1a365d")),
                                ("FONTNAME", (0, 0), (-1, 0), font_name_bold),
                                ("FONTNAME", (0, 1), (-1, -1), font_name),
                                ("FONTSIZE", (0, 0), (-1, -1), 9),
                                ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
                                ("TOPPADDING", (0, 0), (-1, -1), 4),
                                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                                ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#cbd5e0")),
                                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                            ]
                        )
                    )
                    out.append(Spacer(1, 6))
                    out.append(tbl)
                    out.append(Spacer(1, 8))
                except Exception:
                    pass
                if out:
                    return out
            text = _bold_md(_html_escape(para))
            text = text.replace("\n", "<br/>")
            out.append(Paragraph(text, body_style))
            return out

        story = []
        if title:
            story.append(Paragraph(_html_escape(title), doc_title_style))
            story.append(
                Paragraph(
                    f'<font size="9" color="#718096">{datetime.now().strftime("%B %d, %Y")}</font>',
                    body_style,
                )
            )
            story.append(Spacer(1, 16))

        content = _normalize_for_pdf(content.replace("\r\n", "\n").replace("\r", "\n"))
        lines = content.split("\n\n")
        for para in lines:
            for flow in _para_to_flow(para):
                story.append(flow)

        doc.build(story)
        return f"PDF created: {path}"
    except Exception as e:
        print(f"[TOOL] create_pdf error: {e}")
        return f"Error creating PDF: {str(e)}"
