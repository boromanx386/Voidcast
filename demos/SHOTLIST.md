# Voidcast demo screenshots — shot list

New screenshot set for the README and `docs/`. **These filenames are final** — the README and
`docs/options/*.md` already reference them, so drop the files into `demos/` with these exact names.

Everything is captured with the **same theme, same window size, same zoom** so the set looks like
one product, not a patchwork.

---

## Status (updated 2026-10-10)

| Asset | Status | Notes |
|-------|--------|-------|
| `voidcast-options-all.png` | ✅ **done** | 4×2 composite, 2600×889, from the Electron captures |
| `voidcast-options-{general,llm,media,tts,tools,skills,sub}.png` | ✅ **done** | 920×640 auto panel crops, Electron (desktop chrome, `TTS/STT` label) |
| `voidcast-coding-panel.jpg` | ✅ **done** | from the `2_44_09` capture, sidebar cropped out, 1800×1095 |
| `voidcast-chat-image.jpg` | ✅ **done** | from the `2_47_17` capture, sidebar cropped out, 1800×1095 |
| `voidcast-hero.jpg` | ✅ **done** | README hero, **full frame including the sessions sidebar** (deliberately uncropped), 2560×1400 |
| `voidcast-demo-flow.gif` | ⬜ optional | see §5 |

All 13 raw Electron captures (2560×1400) are parked in `.voidcast/tmp/raw-shots/`; the earlier
web-build options set in `.voidcast/tmp/web-backup/`. Re-run `.voidcast/tmp/crop_options.py` after a
re-shoot to regenerate the per-tab crops and the composite.

### How the set was produced

- The Options panel is `max-w-4xl` (896 px) centred in the window, so every capture is **auto-cropped
  to the panel** (920×640) — otherwise the panel floats in a sea of black.
- The sessions sidebar ends at x=255 and is **cropped out** of `voidcast-coding-panel.jpg` and
  `voidcast-chat-image.jpg` — that is what removed the real session titles. The hero is the deliberate
  exception: it keeps the sidebar, so **its session titles are public**.
- The two app shots are **JPEG q90** (PNG would be ~1.3 MB each); UI panels stay PNG.

---

## Global capture rules

| Rule | Value |
|------|-------|
| Theme | **Obsidian** (dark violet accents) for every shot |
| Zoom | 100% (menu default) — note it if you change it |
| Window | Same size for every capture. The current set was captured at **2560×1400** |
| Cursor | Move the pointer out of the frame / hide it |
| Text | Use a normal-looking conversation — no "test test test" |
| Export | PNG, no compression artifacts, no rounded-corner wallpaper behind the window |

### Privacy checklist (before publishing any shot)

- [ ] No real **LAN IPv4** (`192.168.x.x`, Tailscale IPs) — use the docs' `192.168.1.42` style or blur
- [ ] No real **session names** with personal content
- [ ] No **reddit / email / username** handles unless they are already public
- [ ] **API keys** — the secret fields must be masked (they are by default; double-check)
- [ ] No personal **file paths** beyond the project folder

---

## 1. `voidcast-hero.png` — README top (hero)

| | |
|---|---|
| **Size** | 2560×1440 (2× of 1280×720) |
| **Used by** | `README.md` (optional hero, above the fold) |
| **Scene** | Full app in one frame: **chat on the left, coding panel on the right** |
| **Must show** | A live conversation with a visible tool round (tool names / drafts), the coding panel file tree with at least one dirty file, and the status bar |

Goal: one image that says "chat + code + agent" without a word of explanation.

---

## 2. `voidcast-options-all.png` — composite sheet (README + docs/options index)

| | |
|---|---|
| **Size** | Canvas ≈ 2944×1040 (see grid below) |
| **Used by** | `README.md` §The Agent & Tools and `docs/options/README.md` |
| **Scene** | **One composite** with all 7 Options tabs, not 7 separate files |

### Option A — grid composition

- **Grid:** 4 columns × 2 rows of cells.
- **Cell:** 720×450 (16:10), one per Options tab, in this order:
  1. **General** → 2. **LLM** → 3. **Media** → 4. **TTS**
  5. **Tools** → 6. **Skills** → 7. **Sub-Agent** → 8. **logo cell**
- **Cell 8 (logo):** the Voidcast logo (`logo_app_nobg.png`) centered on a flat themed background —
  keeps the grid rectangular instead of leaving a hole.
- **Gutter:** 16 px between cells.
- **Caption:** a small label under each cell (uppercase, muted, e.g. `GENERAL`) — same font/size for all.
- **Canvas:** 4×720 + 5×16 = **2960 px** wide; 2×(450 + ~28 caption) + 3×16 ≈ **1016 px** tall.
- **Crop:** show the **panel body**, not the whole app window — no macOS/Windows chrome, no desktop behind it.
- **Scale:** every cell at the same scale (no tab zoomed differently).

Export at 2× if you can (cells 1440×900) and let the final canvas downscale — crisper on retina.

---

## 3. Per-tab shots for `docs/options/`

One wide screenshot per tab, used at the top of each `docs/options/*.md`.

| File | Size | Tab |
|------|------|-----|
| `voidcast-options-general.png`  | 1440×900 | General |
| `voidcast-options-llm.png`      | 1440×900 | LLM |
| `voidcast-options-media.png`    | 1440×900 | Media (image + music) |
| `voidcast-options-tts.png`      | 1440×900 | TTS / STT |
| `voidcast-options-tools.png`    | 1440×900 | Tools |
| `voidcast-options-skills.png`   | 1440×900 | Skills |
| `voidcast-options-sub.png`      | 1440×900 | Sub-Agent |

Same theme / window / zoom as the rest. These are **wide (16:10)** — deliberately not the old
9:16 portrait crops.

---

## 4. Wide feature shots (README)

| File | Size | Used by | Scene |
|------|------|---------|-------|
| `voidcast-coding-panel.png` | 2560×1440 | `README.md` §Coding Tools | Coding panel: file tree with git status **colors** (`M`/`A`/`D`/`?`), a **diff preview** open, and the terminal with output |
| `voidcast-chat-image.png`   | 2560×1440 | `README.md` §Image-Aware Chat | Chat with an image pasted **and** the agent's transformed result inline in the same thread |

---

## 5. Optional animated demo

| File | Size | Used by |
|------|------|---------|
| `voidcast-demo-flow.gif` | ~1200 px wide, 10–15 s, < 8 MB | `README.md` (optional, below hero) |

Trim from the existing ~39 s promo video (`videos/`): theme switch + voice/TTS + a tool round.
Keep it silent-friendly — GitHub autoplays GIFs muted.

---

## Remaining work

All three images the README needs (`-options-all`, `-coding-panel`, `-chat-image`) are now in place
and wired up. Still open, both optional: `voidcast-hero.png` (§1) and `voidcast-demo-flow.gif` (§5).

**Open nits worth a re-shoot:**

1. The `tools` tab was captured **scrolled down** — its first line is cut mid-sentence.
2. `voidcast-chat-image.jpg` shows images **generated** in chat, while the README section it sits in is
   about **pasting** images in — re-shoot with an uploaded image if you want it exact.
3. `Q:\arhiva\voidcast` is visible in the `media` tab (and the composite), and
   `Q:\coding\arcade madness` in `voidcast-chat-image.jpg` — the last items on the privacy checklist.
