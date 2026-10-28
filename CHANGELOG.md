# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Fixed

- **Vision models no longer act blind after `image_recall`** (no vision sub-agent): the pixels are visible for one round only, and the text left behind used to say "no cached analysis". Reasoning models that looked at the image only in their thinking then concluded they could not see, and fell back to measuring pixels with scripts. The `image_recall` result and the image message now say the pixels last one round and ask the model to write down what it needs. When the pixels are dropped, the digest keeps the model's own notes from that round (up to 600 characters of its thinking, or its reply) and says the image was seen. Covered by an `agentToolLoop` unit test.
- **Built-in browser keeps projects apart**: several things leaked between chats in different projects. The agent's `browser_new_page` was treated as a panel action, so a background chat could switch the WEB panel to its own project. HTTP sign-in prompts, denied-permission notes, the last download and the last error were global. One project's panel could show another project's sign-in bar, a profile switch dropped other projects' held sign-ins (their pages hung until the 25s timeout), and a click could report another project's download. These now live per project. `browser_status` reports the calling chat's project instead of the panel's. With a shared or named profile, downloads go to the folder of the project whose page started them, not the first project that opened the profile.
- **`browser_wait_for` with `network_idle` no longer times out after a redirect**: Chromium re-sends `requestWillBeSent` under the same request id for every redirect. That was counted as a second request that never finished, so network idle never settled after an http→https or login redirect. The network log now shows the redirect as `301 old -> new`. Covered by a `browser-cdp-network` unit test.

## [2.12.2] — 2026-10-27

### Added

- **API keys are encrypted with the OS key store**: the six provider keys (OpenRouter, NVIDIA NIM, DeepSeek, OpenAI, OpenCode Go, Runware) used to sit in plaintext in renderer `localStorage`. On desktop they now live in `secrets.json` in `userData`, encrypted with Electron `safeStorage` (DPAPI on Windows, the Secret Service keyring on Linux), behind `electron/main/secretStore.ts` and a sync `voidcast:secrets-*` IPC so `loadSettings` stays synchronous. Keys from older versions are moved there on first start and removed from `localStorage`. If a write to the store fails the keys stay in `localStorage`, so they are never lost; on Linux without a keyring (`basic_text` backend) nothing changes. Covered by `secret-store` and `settings-secrets` unit tests.
- **`SECURITY.md` and `CONTRIBUTING.md`**: how to report a vulnerability privately, what the agent can reach (unsandboxed shell in Agent and Team, read-only Ask and Plan, project-root file tools), where API keys live, and how to set up, test and submit a change. `LICENSE` now names the copyright holder. GitHub issue forms for bug reports (version, OS, provider, mode) and feature requests, with a link to private security reporting.

- **Token and time cost per turn and per Team worker**: every worker now reports wall time, model time, rounds, tool calls and prompt/completion/cached tokens when it finishes (`SubAgentWorkerMetrics`). They show on its card in the Sub-agent panel and in the event log, and persist with the chat. `callNativeSubAgentToolRound` reads usage for all four provider response shapes (Ollama, chat/completions, Anthropic messages, Responses) via `extractNativeRoundUsage`. The main agent loop (`runSharedToolLoop`) now also sums usage over every round (`turnTotals`) instead of keeping only the last one. The control API exposes both: `turnUsage` on the chat status and `subAgent.workers[].metrics`. Rounds whose response carried no usage are counted in `unreportedRounds` so the sums read as a lower bound. Covered by `worker-metrics`, `agentToolLoop`, `subAgentToolLoop` and `control-api` unit tests.
- **`web_search` can read deeper on documentation pages**: each page read in full is cut to its first 4000 characters, which covers news and short answers but not a reference page whose answer sits further down. The tool now exposes `page_chars` (2000–12000, default unchanged at 4000) and tells the model to raise it only for documentation and reference pages, paired with `read_top` 1–2. The read budget grows with the request (`read_top × page_chars`, at least 12000, at most 24000), so a deep read does not crowd out every other page. A default search costs exactly what it did before.

### Fixed

- **`scrape_url` and the Runware proxy can no longer reach the local network** (CodeQL `py/full-ssrf`): the SSRF guard in `tts-server/scrape_tool.py` blocked private, loopback and link-local addresses but let through CGNAT `100.64.0.0/10` (Tailscale addresses), multicast and reserved ranges. It now allows only `is_global` addresses, unwraps IPv4-mapped IPv6, and treats a DNS failure as a refusal. The Runware proxy (`/tools/runware_proxy`) runs the same check (`assert_url_safe_for_fetch`) on its user-editable base URL before it sends the Runware key there.
- **The LAN access token is compared in constant time** (`hmac.compare_digest` in `require_lan_access`), so a client on the network cannot recover it from response timing.
- **MCP OAuth callback page escapes the provider's error text** (CodeQL `js/reflected-xss`): the `error` query parameter was written into the HTML page on the loopback callback server unescaped.
- **Generated audio file names replace every forbidden character**, not only the first (`sanitizeAudioBaseName`; the regex lacked `/g`). Covered by `generated-asset-path.unit.test.ts`.
- **Provider detection compares hostnames exactly** (CodeQL `js/incomplete-url-substring-sanitization`): `openrouter.ts` recognised NVIDIA, OpenAI and DeepSeek by a substring anywhere in the base URL, so a URL like `https://other.host/?api.openai.com` matched. It now parses the URL and compares the hostname (`hasHost`).

- **`search_files` finds a name whatever its casing style**: the query was matched as one literal string, so `coding search` never found `codingSearch` and the ranker's compact-name scoring never saw a match. A plain query of two to four alphanumeric words (split on spaces, `_`, `-` and camelCase boundaries) is now also searched as `snake_case`, `kebab-case` and the compact form, one `-e` per pattern in ripgrep and the same needles in the walk fallback (`buildLiteralSearchPatterns`). The compact form covers camelCase and PascalCase because matching is case-insensitive. Single words, punctuation, long phrases and `regex: true` queries are searched exactly as before. Covered by `coding-search.unit.test.ts`.
- **The coding panel notices commits, stages and checkouts made outside the app**: the project watcher skipped the whole `.git` folder, so a `git commit` from another terminal or agent never refreshed the file colours or the diff until a command ran inside Voidcast. It now also reacts to `.git/HEAD`, `.git/index` and `.git/refs/**` (`isCodingGitStatePath`), and the open file preview reloads when that file's git state changes (not while it is being edited). The panel's `git status` now runs with `--no-optional-locks` so it cannot rewrite the index and re-trigger the watcher. Covered by `coding-project-skip.unit.test.ts`.
- **Team workers no longer typecheck each package twice**: `runWorkerTypeCheck` (`src/lib/codingWorkers.ts`) probes a folder for a check target with a real `check_types` call (the tool has no dry-run), then ran the per-path check on the same package again. A clean probe is now reused as the result, and the per-path re-run happens only when the probe reports errors, to narrow them to the files the worker wrote. Covered by `coding-workers.unit.test.ts`.
- **`web_search` no longer drops its third full-text page**: each read is capped at 4000 characters plus a `[Truncated to 4000 characters]` note, and the 12000-character budget counted the note, so three long pages overshot it and the third — in testing, sqlite.org's own WAL page — was always demoted to a snippet. A page now costs at most its cap.
- **`scrape_url` keeps headings and lists on pages without a content container**: on sites that put their text straight into `<body>` (sqlite.org), trafilatura's precision mode returned no headings and emptied every list ("Advantages include:" followed by nothing). Extraction now runs with `favor_recall`, which restores the lists and returns identical text on pages with a proper container, and retries once with the body wrapped in `<main>` when the page has headings but the result has none.

### Changed

- **Dev dependencies upgraded to clear Dependabot alerts**: Vite 5 → 6.4, Vitest 2 → 4.1, `@vitejs/plugin-react` 4.3 → 4.7 and, at the repo root, `concurrently` 9.2.5 (pulls `shell-quote` 1.12). These are build and test tools only; nothing in them ships in the installers. `npm audit` reports 0 vulnerabilities in both lockfiles.

## [2.12.0] — 2026-10-26

### Added

- **Model presets refreshed**: new on OpenRouter — `deepseek/deepseek-v4.1-flash-1017`, `minimax/minimax-m3.1-flash`, `meta/muse-spark-open`, `meta/muse-wonder`; on OpenCode Go — `beam-free`, `kimi-k3.1-pro`, `step-5-preview`, `iceman-contributor-free`, `grok-4.7`; on NVIDIA — `nvidia/nemotron-3.5-super-vl-120b-a12b`. Each has its context size in `MODEL_CONTEXT_OVERRIDES`. Removed: OpenCode Go `gemini-4-argon` / `gemini-4-argon-contributor` (Go serves Gemini only on Google's `generateContent` API, which the app does not speak, so every turn failed with `ModelProtocolUnsupported`; Gemini 4 Argon stays available through OpenRouter), Go `glm-5.1` (superseded by 5.2 / 5.3; a saved `glm-5.1` still works as a custom id), NVIDIA `nemotron-4-340b-instruct`, and five free models that no longer answer: Go `longcat-2.5-preview-free` (410 `ModelDeprecated`), `step-5-preview-free`, `cat-jam-free` and `space-bunny` ("Model is unavailable"), and OpenRouter `nvidia/nemotron-3-super-120b-a12b:free` (404 from its only provider). The OpenRouter alias that sent the paid `nvidia/nemotron-3-super-120b-a12b` to that dead free route is gone. Preset names made by `npm run check:models` no longer lose the dot in version numbers ("GLM 5 3" → "GLM 5.3"), and the checker no longer suggests Go models on an SDK the app has no wire format for. It also catches dead models it used to miss: a Go chat model absent from the live feed counts as removed even while models.dev still lists it, and OpenRouter `:free` presets whose every endpoint is unhealthy are flagged as DOWN to test.
- **Coding panel says when a folder is untrusted**: binding a folder never asked about trust, so an untrusted repo's `AGENTS.md`, project skills and `.mcp.json` were dropped with no sign outside Options. A yellow bar under the folder path now lists what was skipped, with **TRUST** and **Not now** (hidden for that folder until restart). It only appears when something was actually skipped.
- **Bulk chat deletion**: the chat menu (⋯) has a **Select…** entry that starts a mode with checkboxes, shift+click ranges, a per-folder select-all, and shortcuts for all (respecting the filter), empty chats and chats untouched for 30+ days. One confirmation deletes the whole selection; chats with a running agent can't be selected.
- **Local control API can start turns**: `POST /chats` creates a chat and starts its first turn (`text`, `projectPath`, `mode`, `model`, `background`), `POST /chats/:id/send` starts a turn in an idle chat, and `GET /chats/:id/wait?timeout=` long-polls until it is idle. Covered by the same `LOCAL_CONTROL_API` toggle (no separate setting), whose description now says a started turn can run commands and edit files. Turn context is derived from the *viewed* chat, so `src/lib/controlDriver.ts` drives the UI like a user — open the target chat, send through `onSend`, wait until the run is live, switch back when `background` is set — with actions serialised. `handleControlRequest` is now async; the server reads JSON bodies (≤ 256 KB) and answers `wait` itself by polling `chats.get`. `GET /chats/:id/transcript?progress=1` also returns each assistant message's intermediate drafts (`agentProgress`), off by default. Covered by `control-api`, `control-server` and `control-driver` unit tests.

- **Local control API (phase 1: read + stop)**: an opt-in loopback HTTP API so a local agent can inspect the running app without touching its UI — `GET /chats`, `GET /chats/:id`, `GET /chats/:id/transcript?since=` and `POST /chats/:id/stop`. The agent loop lives in the renderer, so `electron/main/controlServer.ts` only authenticates and relays `{ method, params }` over IPC (`voidcast:control-request` / `voidcast:control-response`, 10 s timeout) to `handleControlRequest` in `src/lib/controlApi.ts`, which reads the live `sessionAgentStore` slot and falls back to the persisted session. Listens on a random `127.0.0.1` port, requires a bearer token regenerated on every enable, rejects browser `Origin` headers and non-loopback `Host` headers, and publishes `{ port, token, pid }` to `<userData>/control.json` (removed on disable/quit). New setting `controlApiEnabled` (Options → General → `LOCAL_CONTROL_API`, default off). The composer Stop button and the API share `stopSessionRun` (`src/lib/sessionRunControl.ts`). See `docs/control-api.md`; covered by `control-api.unit.test.ts` and `control-server.unit.test.ts`.

- **`search_files` gains `regex`, `glob` and `files_only`**: the tool was literal-substring only, with no way to narrow by file type or to ask just *which* files match, so "calls of `foo(` outside tests" took several searches. `regex: true` drops ripgrep's `-F` (an invalid pattern returns `Invalid regex: …`; ripgrep-rejected syntax such as lookaround falls back to the walk with a JS `RegExp`). `glob` is passed as `--iglob` and mirrored in the walk by `compileCodingSearchGlob` (`src/lib/codingSearch.ts`): slash-free globs match file names anywhere, globs with a `/` are anchored at the project root, `!` excludes, and a positive glob replaces the source-extension whitelist because ripgrep ORs positive globs. `files_only: true` skips ranking and context blocks and lists matching files by count (cap 200).

- **A wedged `ddgs` call can no longer freeze the whole tools server**: the reported symptom was every server-backed feature failing at once with `fail to fetch` — the OpenCode Go provider and local ASR both died, Go came back after an app restart, ASR did not — which pointed at the providers and then, wrongly, at the network. It was none of them. `py-spy dump --native` on the running `voidcast-tools-server.exe` caught two `tools-net` threads parked inside the native `primp` client (`PyInit_pyo3_async_runtimes`, `_get_engines` in `ddgs.py`) **while holding the GIL**, so the event loop could not run a single line of Python: `GET /health` accepted the TCP connection and never answered, and every route behind it — search, `/tools/youtube`, the OpenCode Go proxy, `/stt/transcribe` — looked like a dead network. A thread stuck in a native call cannot be interrupted, so the fix is process isolation rather than more timeouts. New **`tts-server/search_core.py`** owns the collection/ranking code that used to live in `main.py` (`collect_candidates`, `rank_candidates`, `select_results`, the domain lists, the date/token helpers) and can run as a stdio worker — one JSON request line in, one reply line out — while new **`tts-server/search_client.py`** owns a two-process pool that spawns it, enforces a hard per-request deadline and **kills the worker** on timeout, respawning lazily on the next call. `main.py` keeps only what it needs locally (`_clamp_int`, the caches, `_read_top_results`, `_format_results`) and reaches search through `_search_candidates` → `search_pool().request(...)`; the `ddgs` import is gone from the server process entirely, verified with `import main` → `ddgs`/`primp` not in `sys.modules`, so no future edit can quietly reintroduce the wedge. In the frozen build the exe re-enters itself with `VOIDCAST_SEARCH_WORKER=1` (`tools_exe_entry.py` branches *before* importing `tools_main`, so a worker spawn does not pay for FastAPI), because a PyInstaller binary cannot `python -c ...` a module. `search_core` probes `ddgs` with `find_spec` instead of importing it, and silences the `primp`/`ddgs` INFO chatter that put ~10 HTTP log lines per search into the server log. A worker that dies (crash, killed process, closed pipe) is not shown to the caller at all: `SearchPool.request` retries once on a fresh process when the failure came back in under `FAST_FAIL_S`, so the model still gets results. A genuine wedge already burned the whole 25 s budget, so it surfaces as `ok: false` with a retry hint instead of a 503 carrying a traceback, and the pool is closed in the lifespan shutdown hook. Measured after the change: `/health` 0.02–0.04 s with three searches and eight health probes in flight (previously never answered at all), a hung worker killed in 1.5 s, 6 parallel searches all fine, and `/stt/transcribe` unchanged at 0.20 s — the ASR engine was never the problem. Killing the worker process by hand costs the caller nothing: the next search came back `ok: true` in 1.9 s through the transparent retry.

- **`web_search` ranks results and reads the top ones in full**: `_search_web_ddgs` (`tts-server/main.py`) is gone, replaced by `_collect_candidates` → `_rank_candidates` → `_select_results` → `_read_top_results` → `_format_results`. **(1) The forced `timelimit="m"` is removed** — every query was silently restricted to the last month, which is why how-to and reference questions came back with last month's blog spam instead of the official docs; a time filter is now opt-in via `recency` (`d`/`w`/`m`/`y`), and the news pass only runs for `d`/`w` or a query that actually reads as time-sensitive (`_SEARCH_RECENT_QUERY_RE`). **(2) Results are ranked before the cut** — query-token overlap (title ×2, body ×1), an exact-phrase bonus, a ±2.5 / −8 adjustment from the short hand-maintained `_SEARCH_DOMAIN_BOOST` / `_SEARCH_DOMAIN_BLOCK` lists, a mild recency/dormancy term read from the date fields, then a per-host cap of 2 so one site cannot own all eight slots. The comment says it out loud: scraped payloads carry no authority signal, so this is a heuristic, not a ranking truth. **(3) Snippets went 450 → 1200 characters** (`SEARCH_SNIPPET_CHARS`) and the `len(body) < 15` gate became `len(title) + len(body) >= 40`, on the grounds that the ranker now drops stubs anyway. **(4) The top results are read in full** — `_read_top_results` fetches the top `read_top` hits with the SSRF-safe `scrape_public_url_to_text` from item above (so the model gets main-content **Markdown**, not a 60-word teaser) under its own `_READ_SEM` (3 concurrent), 15 s per page, 4000 chars per page and a 12000-char total budget where the highest-ranked page wins and the tail is dropped; a page that 403s, times out or comes back empty degrades to that one result being snippet-only with `[full text unavailable: …]` rather than failing the search. **(5) Two caches**: `_SEARCH_CACHE` (10 min, 64 entries) keyed by normalised query + params, and `_PAGE_CACHE` keyed by **URL + character cap** so a cached 6k excerpt can never silently answer a 40k request — `/tools/scrape` now fills and reads that same cache, so asking for a page the search already read is free. **(6) New parameters end-to-end** — `SearchRequest` gains `max_results` (1–20), `recency`, `read_top` (0–5) and `page_chars`; `web_search`'s schema and description carry them (the description now tells the model to leave `recency` **unset** for evergreen questions); `handleWebSearch` forwards them, sending `read_top` only when the model asked for it (server default: 3 pages, `0` = snippets only); the client abort moved 25 s → 45 s to cover two capped stages. ddgs is called with `backend="auto"` first, and a retry on `google,yahoo,mojeek,yandex` (the engines that answered on probes; brave returned 429 and the DuckDuckGo HTML endpoint 202) fires when the candidate set is thin **or** carries too few canonical domains — one pass can return 21 usable results and no canonical source at all. **(7) Canonical docs win, content farms stay unread**: `_SEARCH_DOMAIN_BOOST` gains sqlite.org, go.dev, redis.io, mariadb.com, mongodb.com, elastic.co, docker.com, kubernetes.io, nginx.org, apache.org, gnu.org and openssl.org; content farms in the new `_SEARCH_NO_READ` stay ranked as snippets but are never auto-read in full, and the read window backfills from deeper results. The per-stage budget replaced the single 20 s `wait_for`.

- **`scrape_url` returns Markdown instead of one flat line**: `tts-server/scrape_tool.py` converted HTML with BeautifulSoup's `get_text(separator=" ")` followed by `re.sub(r"\s+", " ")`, which collapsed an entire page — headings, lists, tables, paragraph breaks — into a single line and handed the model nav menus, cookie banners and footers along with the article. A new `_html_to_markdown()` runs `trafilatura.extract(..., output_format="markdown", include_links=True, include_tables=True)` behind a **lazy import**, returns `None` on any exception or empty result, and `_extract_text_from_bytes()` falls back to the old `_html_to_plain_text()` in that case — so an absent or broken dependency degrades the output instead of breaking scraping. Relative links are resolved against the *post-redirect* URL (threaded in as `base_url`), so they arrive absolute and the model can act on them with another `scrape_url`. Measured on real pages: `fastapi.tiangolo.com` 10 908 → 7 424 chars (with "Skip to content", the cookie banner and "Back to top" gone), `theguardian.com` 20 154 → 8 002, `docs.python.org` 515 lines / 16 headings / 233 absolute links. New dependency `trafilatura>=2.0.0` in `tts-server/requirements-tools.txt`; because it ships `settings.cfg` and `data/`, **both** freeze invocations grew `--collect-data trafilatura` — `scripts/build-tools-exe.ps1` and `build-linux.sh`, which are the two places that actually define the freeze (`tts-server/voidcast-tools-server.spec` is *generated* output from `--specpath`, untracked per `.gitignore`, and overwritten on every build, so editing it would have changed nothing). `/tools/scrape` also returns a `format` field (`"markdown"` | `"text"` | `"plain"` | `"json"`) so a caller can tell upgraded output from degraded output. `electron-app/electron/main/scrape.ts` deliberately stays plain text and now says why in a header comment.

- **`web_search` tells the model that full pages exist**: `_search_web_ddgs` (`tts-server/main.py`) handed over up to eight results whose bodies are hard-truncated to 450 characters — roughly sixty words — with nothing in the output saying so, so the model answered detailed questions from snippets and never escalated. The joined result now ends with a note that each snippet is truncated and that `scrape_url` on any result's link returns the full page. The empty-result string also stopped lying: it said "No usable fresh text snippets in results.", which read the same whether the topic was obscure or DuckDuckGo was rate-limiting, and now names both causes and points at `scrape_url`. The three swallowed `except Exception: pass` blocks around the `ddgs` news / text / broad-text calls now log (news at debug, the two that matter at warning, since a rate limit there is what silently degrades every search) instead of vanishing.

- **Disable TTS the way STT can be disabled**: `ttsProvider` gains `'none'` (Options → TTS/STT → TTS_PROVIDER → *Disabled*; `normalizeTts` in `electron-app/src/lib/settings.ts` keeps it). With it set, the **SPEAK** button is not rendered on assistant bubbles at all — the bubble footer and the **OPEN IMG** button stay — `useChatAgent` refuses `AUTO_VOICE` before speaking, `onRead` returns early, playback already in flight is aborted (`audioRef.pause()` + run-id bump), the 15 s health poll stops instead of probing a server you told the app to ignore, the footer dot reads "TTS disabled in Options -> TTS", `handleGenerateTts` and `synthesizeSpeech` refuse with `TTS is disabled. Enable it in Options -> TTS.`, and the panel hides the provider fields plus the TTS-shortcut box, `CHECK_TTS_STATUS`, `AUTO_VOICE`, `ENABLE_TTS_TOOL` and `CHUNK_SIZE`. Voice, model and chunk settings are preserved — pick a provider again and everything is back.

- **Prompt hints from the composer**: a new Options → Sub-Agent toggle adds a hint button next to Send. Pressing it sends one tool-free sub-agent call (`callSubAgentChat`, same shape as title generation, on the coding sub-agent model) that rewrites the draft against the whole text conversation — every user message and every agent reply between them, capped at 12k chars, with tool output excluded by construction (tool results live in `subAgentActivity` / `codingTurnEvidence` / `agentProgress`, never in `content`). The result replaces the draft in the composer and nothing is ever auto-sent; while the field still holds exactly that result an undo chip restores the previous draft, and it disappears the moment you type. An empty draft with a conversation behind it flips the button into **suggest mode** — the same model proposes the next prompt to send (second system prompt, `HINT_SUGGEST_SYSTEM_PROMPT`) instead of rewriting — with the decision made by a pure `resolveHintMode` that the engine and the composer's disabled state both read, so the button can never promise a mode the call would refuse. With neither a draft nor a conversation, while a turn is running, or when the model returns the draft unchanged, the composer is left alone. New `electron-app/src/lib/promptHint.ts` and `electron-app/src/lib/subAgentKeys.ts` (one shared sub-agent keys builder for titles + hints, lifted out of `useChatSessions`), covered by `electron-app/test/prompt-hint.unit.test.ts`. Default off.

- **Steer Team-mode workers mid-run, and watch them work**: while a `run_coding_workers` batch is live, a text-only draft in the composer now goes **into the running workers** instead of aborting the turn — `onSteer` (`electron-app/src/hooks/useChatAgent.ts`) pushes it onto a per-turn `WorkerSteerQueue` (`electron-app/src/lib/workerSteer.ts`, max 4 messages / 600 chars each) stored on the chat's session-agent slot, and every worker drains it at the top of its next round via `buildWorkerInjection` and receives it as a course-correction user message ("[Steer — user course correction while you work]"); the panel logs `WORKER n received steer: …`. Steers with images, files, or no live worker batch keep the old abort-and-resend behaviour, and the steer button switches label/colour (cyan) when it will soft-steer. In the other direction, the analysis card is now truthful live: a new `SubAgentUiCallbacks.onCodingEvent` + `applyCodingEvent` reducer stream per-file writes, tool failures, read-budget warnings and the end-of-run `check_types` verdicts into the event log, and each worker's status line now names the file/query its current tool call targets. Covered by `electron-app/test/workerSteer.unit.test.ts` plus new cases in `coding-workers.unit.test.ts` / `subAgentPanelState.unit.test.ts`.

- **`npm run check:themes` guards the theme tokens**: `scripts/check-themes.mjs` reads `electron-app/src/index.css` plus every `theme-*.css` and reports four things. **Parity** — a theme that declares no `--coding-*` token FAILS, because that family exists to be owned outright and silently inheriting `:root` is exactly how the terminal theme shipped with dystopian's neon ramp; a missing base palette token (`--color-*`, `--font-*`) only warns, since `:root` is a complete dystopian palette on purpose and partial overrides are supported by design. Each inherited token is marked `*` (read by a real `var()` in `src`, so the inherited value definitely renders) or `+` (reachable only through `tailwind.config.js`, where a class nobody writes is indistinguishable from one that paints). **Diff colours** — `--coding-diff-add-fg` / `-del-` / `-hunk-` must stay three distinguishable values; the matrix hunk token had been byte-identical to the add green, which is what made `@@` rows read as insertions. **Contrast** — WCAG ratios for body text on the app background and on panels, strong text, dim text, the coding accent and the three diff lines, measured against the backgrounds they actually sit on, with the row wash modelled by reading its alpha out of `App.css` (`.coding-diff-line--*`) so the model cannot drift away from the stylesheet; it is advisory (below the AA floor warns, `--strict` makes it fatal) because the honest fix for a thin pair is a palette decision, not a build break. **Prunable** — tokens declared across the themes but read by nothing. It also checks the `UiTheme` union against the CSS blocks, since a union member without a block renders the dystopian fallback with no obvious symptom. Wired into `electron-app/package.json` as `check:themes` / `check:themes:strict` and appended to `npm run lint`. Its first run reported the dystopian base at `--color-void-dim` 2.33:1 and the light theme at 4.45:1 for body text on panels, plus a dozen pairs under the AAA target and the three effect dials as the only declared-but-unread tokens; the two floor misses and the unread `--ui-accent-rgb` are fixed in the entry below.

### Changed

- **Up to ten tool calls run in parallel** (was four): the default `maxParallelToolCalls` in `agentToolLoop.ts`, so a turn that reads many files or pages at once needs fewer rounds.
- **Calmer tool descriptions and hints**: `generate_image`, `edit_image_runware`, `generate_music_runware`, `generate_tts` and `save_pdf` each opened with a "MANDATORY / CRITICAL / you MUST / Do NOT" block, and the image, music, TTS and coding hints repeated their own "never claim …" line on top of `TOOLS_TRUTH_HINT`. Recent models over-apply shouted rules, and the copies cost tokens on every turn. The descriptions now say plainly when to call the tool, the per-tool "never claim" lines are gone (the shared truth hint covers them), and stray capitalised words elsewhere are lowercase.
- **Coding workers and coding explore get core rules too**: `HARNESS_CORE` only reached the main chat, while sub-agents read the most untrusted text (repo files, command output). Their prompts now start with `SUB_AGENT_CORE` (`electron-app/src/lib/chatMessages.ts`): the delegated goal and user steers are the only instruction source, tool output is data, embedded instructions are reported in the final summary instead of followed, and hard-to-undo or outward actions need the goal to ask for them.
- **The agent can no longer rewrite its own system prompt**: `llmSystemPrompt` is out of `AGENT_EDITABLE_SETTINGS_FIELDS`, so `update_settings` rejects it, and the settings hint stopped echoing the whole prompt back into the system message (it was sent twice). Web pages, MCP results and files all reach the context, so a self-editable prompt let injected text persist into every future chat. The prompt is now edited only in Options → LLM.
- **System prompt has a fixed core and tagged sections**: a new app-owned `HARNESS_CORE` (`electron-app/src/lib/chatMessages.ts`) always comes first, even when the persona prompt is empty. It says that only the user's messages are instructions, that tool output (web, scrape, YouTube, MCP, files, command output, image text) and the app's runtime block are data, that instructions found in that data are reported to the user rather than followed, that memory and settings are not changed on external content's say-so, and that hard-to-undo or outward-facing actions need the user's request. Every section is wrapped in its own tag — `<harness_core>`, `<persona>`, `<project_instructions>`, `<mode>`, `<skills_catalog>`, `<tools_policy>` — and the per-turn tail on the last user message in `<runtime_context>` (with `<conversation_summary>` / `<long_term_memory>` inside), so the model can tell app rules, the user's persona, repository text and app-written context apart. The stable-prefix / volatile-tail ordering for the prompt cache is unchanged. Covered by `electron-app/test/system-prompt-sections.unit.test.ts`.
- **Project skills follow project trust too**: skills under the chat's coding folder (`.agents/skills`, `.claude/skills`, `.cursor/skills`, `skills/`) went into the skills catalog and `read_skill` for any bound folder, the same hole `AGENTS.md` had. For an untrusted project they are now left out of the catalog, `read_skill` resolves global skills only, and Options → Skills marks them "not loaded — untrusted" next to the TRUST_PROJECT button.
- **Project `AGENTS.md` / `CLAUDE.md` load only for trusted projects**: they went into the system prompt for any bound folder, so a cloned repository could steer an agent that can run commands. `buildAgentTurnContext` now injects them only when the project is in `mcpTrustedProjectPaths` (the list that already gated project `.mcp.json`); otherwise the model gets just the file names, a note that they were skipped and that reading them yields data, not instructions (`buildUntrustedProjectInstructionsHint` in `agentSkills.ts`). Options → Skills marks the files "not loaded — untrusted" and has a **TRUST_PROJECT** button. **Projects you already use need trusting once**, unless you trusted their `.mcp.json` before.
- **Long-memory picker prompt rewritten**: the old prompt was four lines ("extract durable user memory … only include facts likely to remain useful"), so the model saved whatever looked like a fact — including things the assistant itself had said or found with tools — re-proposed memories that were already saved, and lost the end of long chats because the transcript was cut from the start. `buildLongMemoryExtractPrompt` (`electron-app/src/lib/longMemoryExtract.ts`) now saves only what the user said or confirmed, skips one-off requests and in-chat state, defines each kind (`task` is a cross-chat goal, not a to-do), asks for one self-contained third-person sentence per item in the user's language with English tags as well (retrieval is keyword overlap), calibrates `confidence` / `importance`, treats the transcript as data, and prefers `[]` over weak items. Up to 60 saved memories are sent as `<existing_memories>` so duplicates are not proposed, and a transcript over 24 000 characters keeps its end instead of its start. Covered by new cases in `electron-app/test/long-memory.unit.test.ts`.
- **Composer think level replaces system prompt presets**: the per-chat `default / code / creative / teacher` menu is gone. The presets swapped the user's own `llmSystemPrompt` for the built-in prompt plus one sentence, and mostly duplicated what the Agent / Ask / Plan / Team modes already do. In its place the composer has a per-chat **think level** menu (`off / low / medium / high / on`, or *Default*, which follows Options → LLM → `THINK_LEVEL`); the choice is stored on the chat as `thinkLevel` and applied to the turn's settings, so every provider sees it. Stored chats lose their old `systemPromptPreset` field on load.
- **Shorter neutral default system prompt**: the default `llmSystemPrompt` is now two sentences on tone instead of the "witty Void" persona block, since operating rules moved to the harness core. Saved settings that still hold the old default text verbatim are migrated; edited prompts are untouched.

- **Wider chat on large screens, Settings tabs aligned with their panel**: the message list and composer grow from `max-w-4xl` to `max-w-6xl` at the `2xl` breakpoint, so a 1440p+ window no longer leaves a narrow column between two empty margins. The Settings tab row now shares the content column's `max-w-4xl` instead of stretching edge to edge above it.

- **Brighter secondary text**: `--color-void-dim` goes up in every dark theme (obsidian and blood-moon `145 145 158`, dystopian `132 132 178`, minimal `140 140 150`, matrix `0 165 55`, terminal `145 130 98`), lifting labels such as `AGENT ROUNDS`, option descriptions and field hints; it still sits below `--color-void-text` in each ramp. The light theme is unchanged.

- **Process stderr is no longer painted as an error in the coding terminal**: live command output on stderr now arrives as a new `stderr-output` stream rendered in the dim colour, because many tools (e.g. `python -m http.server`, most loggers) write normal logs there and a `200` request line looked like a failure. App-side failures pushed as `stderr` (commit, save, stage) stay red, and the `[exit N]` line still says whether the command failed.

- **Coding tool descriptions are shorter and calmer**: `write_file`, `edit_code` and `execute_command` opened with `MANDATORY:` / `CRITICAL:` and several `Do NOT … claim` sentences that repeat the tool-truth rule already in the system hints (`TOOLS_TRUTH_HINT`, the coding hint), sent with every request. They now say what the tool does, what it returns and when to pick another tool. `search_files` no longer explains `VOIDCAST_RG_PATH` and the ripgrep/walk internals to the model, and `edit_code` states the new match-exactly-once rule. Media and settings tools keep their wording.

- **Docs, site and README stop calling Voidcast "local-first" — it is BYOK-first**: Ollama led the README intro, the provider list, the Providers table, the docs quick start and the landing-page meta descriptions, so all of it read as "local Ollama app". Ollama sells hosted models of its own (Ollama Cloud, Pro from $20/mo), so the framing was wrong twice over. The README intro, feature bullet and Providers table now lead with the accounts you already pay for — **OpenRouter** ⭐ first, then OpenAI, NVIDIA NIM, DeepSeek, OpenCode Go — with Ollama listed as one provider of six plus a note that Ollama Cloud is Ollama's own billing. `docs/getting-started.md` gets the same order and a **Using Ollama** heading instead of **Using Local Ollama**, `docs/options/llm.md` now says `ollama` is only the *default* because it needs no API key, and the `site/index.html` descriptions plus the promo-video brief carry the BYOK line. Documentation only — no code, no defaults, no behaviour changed.

- **Providers: NVIDIA NIM and "bring your own endpoint" documented honestly**: NVIDIA was sold as "Enterprise-grade inference for open models / Free credits" — it is a **free developer tier with no subscription at all**, and the slowest cloud in practice because free capacity is shared. The README table, `docs/getting-started.md` and `docs/options/llm.md` now say exactly that. Alongside it, the docs state out loud what the code already allowed: **every provider's base URL is an editable field**, and the `openai` provider is a plain Chat Completions client, so it doubles as the door for a local or self-hosted OpenAI-compatible server — vLLM, llama.cpp `llama-server`, LM Studio, TGI, SGLang, llama-cpp-python, or Ollama's own `/v1` route. `docs/getting-started.md` gains a **Using your own OpenAI-compatible server** section and the README providers table gains a row for it. Documentation only — no code changed.

- **Docs say "three wire formats", not "Chat Completions"**: the README and `docs/getting-started.md` sold the `openai` provider as *the* bring-your-own-endpoint door, which undersold the app — `openrouter.ts` has a real adapter for the OpenAI **Chat Completions**, **Anthropic Messages** (`{base}/messages`) and OpenAI **Responses** (`{base}/responses`) APIs, and the OpenCode Go provider routes each model to the right one, with a runtime re-probe (`openCodeGoApiStyle`, `rememberOpenCodeGoApiStyle`) when Go refuses a format. Both pages now carry the three-format table, and `docs/options/llm.md` states the honest limit: that per-model routing keys off an OpenCode Go URL (`opencode.ai/zen/go` or the local proxy path `/api/opencode-go`), so a custom gateway on another host only gets Chat Completions. Documentation only — no code, no behaviour changed.

- **Stale "not supported yet" hint removed from the LLM options**: `electron-app/src/components/options/LlmOptionsPanel.tsx` told the user that "MiniMax / Qwen on Go use Anthropic Messages — not supported yet". That stopped being true when the Anthropic adapter landed: `anthropicMessages.ts` is a real Messages client and `cloudLlmPresets.ts` routes `minimax-m3`, `minimax-m2.7`, `qwen3.8-max`, `qwen3.8-flash` and `qwen3.7-plus` straight to `{base}/messages`, with the runtime re-probe behind it for what the id table misses. The hint now reads "MiniMax / Qwen on Go use the Anthropic Messages format — routed automatically". Only the string changed — marker, styling and the rest of the hint list are untouched, and no behaviour moved.

- **Team-mode coding workers got leaner and less blind**: four fixes to `run_coding_workers` (`electron-app/src/lib/codingWorkers.ts`). (1) The per-file `check_types` probe after *every* write is gone — a worker now typechecks **once at the end** over the files it actually wrote, grouped by package folder, so a run no longer pays a full `tsc` per edit. (2) Workers may now call **`stop_process`**, so one that starts a dev server or watcher can clean it up instead of leaking the process. (3) The worker report now carries a **structured JSON block** per worker (`changed` / `verified` / `failed` / `blockers`) alongside the prose digest, so the orchestrator consumes deterministic facts instead of parsing model text. (4) A new in-process **blackboard** broadcasts each worker's successful file writes to its siblings before their next round — an interface change in one scope is no longer invisible to the other worker. The main agent's own post-worker `git_status` / `git_diff` / `check_types` pass is unchanged.

- **Contrast pass across the UI themes**: five readability fixes, all of them token-level so no component kept a hardcoded colour. (1) The **light** theme's `--color-void-dim` went from `145 136 123` (~2.9:1 on paper) to `116 106 93` (~4.7:1), which lifts placeholders (`Filter chats…`, `npm test`, `Message · commit all`), the empty states (`No terminal output yet.`), the CLEAR/STOP chips and the status bar out of the wash — and `terminal`'s went to `122 108 80` (~4:1 on its charcoal) while `matrix`'s went from `0 80 26` (~2.2:1) to `0 140 46` (~4.8:1). (2) The **matrix** hunk token `--coding-diff-hunk-fg` was the exact add-green (`0 255 65`), so a `@@ -9,14 +9,15 @@` row read as an insertion — it is now aqua (`0 255 190`), and `.coding-diff-line--hunk` in `electron-app/src/App.css` carries a full-strength label over a `0.12` band instead of a `0.05` whisper. (3) The **terminal** theme never had a `--coding-*` block, so the coding panel inherited dystopian's neon ramp (pure yellow `M`, magenta renamed, cyan untracked, spring-green adds) in an amber shell — `electron-app/src/theme-terminal.css` now maps every status letter onto its own amber tones and keeps only diff add/remove green/red for function. (4) File-tree rows became token-driven: new `.coding-tree-name` / `.coding-tree-ignored` classes in `App.css` (used by `electron-app/src/components/coding/FileTree.tsx`) with `--coding-tree-name-fg` / `--coding-tree-ignored-fg` fallbacks to the theme's own `void-light` / `void-dim`, so `terminal` can dim plain names (`150 140 118`) and let the amber git letters read as signal, and ignored rows are no longer dimmed twice (`opacity-70` on top of a dim colour was why `node_modules` vanished). (5) The **dystopian** scrollbar thumb dropped from full-saturation neon to `0.45` alpha (`0.75` on hover) — at full strength the three scrollers were the brightest objects in the window — and the footer context readout (`ChatSystemStatus.tsx`, `/45`–`/70` → `/70`–`/85`) plus the command `RUN` button (`CodingPanel.tsx`, `disabled:opacity-40` → `disabled:opacity-60`, it is disabled while the field is empty) are legible instead of nearly invisible. `docs/options/general.md` also stopped truncating the `UiTheme` union — `'terminal'` was missing from the list.

- **Ambient effects honour `prefers-reduced-motion`**: `electron-app/src/index.css` gains one media block that stops the decorative layer for anyone whose OS asks for less motion — `.crt-overlay`, `.ambient-particles`, `.matrix-rain` and `.glitch-text`, including both `::before` / `::after` ghost copies, which are hidden rather than frozen in place because static glyphs over the real text read as a rendering bug. Interaction feedback — the plan-step pulse, the done-pop, spinners — is deliberately left running: it carries state, not atmosphere. The three effect dials (`--crt-opacity`, `--digit-rain-opacity`, `--glitch-intensity`) are zeroed in the same block so anything later wired to them starts off too; nothing reads them today, so `animation: none` is what actually does the work. Until now the only guards were `theme-light` and `theme-matrix` disabling their own CRT/particles, which left the dystopian base and `terminal` animating — `index.css` alone carries 23 `animation:` declarations.

- **The two below-floor contrast pairs and the dead accent token are fixed**: `scripts/check-themes.mjs` and `npm run check:themes:strict` both exit 0 now. (1) The dystopian base's `--color-void-dim` was `74 74 106` — 2.33:1 on `void-black`, under the script's own AA floor, and the same defect the light, terminal and matrix themes lost in the pass above while the default theme kept it — now `120 120 168` (~5:1, still clearly below `--color-void-text`), which lifts the placeholders, the ignored-file rows, the empty states and the status bar in the theme most people actually see. (2) The light theme's `--color-void-text` cleared paper at 6.0:1 but measured only 4.45:1 on the `void-mid` panels, a hair under AA for body text; `100 91 79` puts it at ~5.9:1 on paper and ~5.1:1 on panels and restores the ramp order against `--color-void-dim` (`116 106 93`), which it had overtaken. (3) The `.form-select` arrow was a data-URI SVG with `fill='%2328afc3'`, so the dropdown arrow was dystopian cyan in all seven themes — an SVG loaded through `background-image` is its own document, `currentColor` resolves against itself and no CSS variable crosses that boundary, which is why the colour had been baked in. It is now two `5px` gradient tiles clipped into a chevron from `rgb(var(--ui-accent-rgb))` at the same 10x5 footprint, 13-23px from the right edge, so it follows the theme accent — and `minimal` finally gets its indigo (`99 102 241`) instead of the cyan family the other six themes happen to share. The same hook replaces the second stop of the `.form-slider` thumb gradient, which read `--color-neon-cyan-dim`, a token blood-moon, obsidian and terminal never declare, so their slider thumbs faded into dystopian cyan; `rgba(var(--ui-accent-rgb), 0.62)` renders the same in the six themes where the accent already equals `--color-neon-cyan`. `--ui-accent-rgb` is no longer declared-but-unread — only the three effect dials remain in that list — and 13 pairs still sit under the AAA target as advisory.

- **The agent now knows where the MCP config and the app docs live**: the MCP hint in `buildAgentTurnContext` was only emitted while at least one server was already connected, so "add an MCP server" was unanswerable from a clean state. Two static hints now ride along whenever tools are on. `MCP_CONFIG_HINT` names `~/.voidcast/mcp.json` (global) and `<project>/.mcp.json` (project only, behind project trust, project entries winning), gives the `{"mcpServers":{"<id>":{…}}}` shape for both `url` and `command`/`args`, states that the agent may create or merge the project file but has to hand the user the exact JSON for the global one, and points at Options → Tools → **Reload** as the way to re-read it without a restart. `APP_DOCS_HINT` points at the raw `docs/README.md` index to read with `scrape_url`, plus the same docs on the Pages site as the link to give the user — with the honest caveat that the site renders them from a JS bundle and can lag `main`. Both are strings in `chatMessages.ts`: no new tool, no IPC, nothing written outside the project.

### Fixed

- **Dependency security round**: Electron 44.4.5 → 44.9.3 (pointer-lock permission attributed to the wrong frame, distrust of the compromised eMudhra intermediates), plus patched transitive `undici`, `zod`, `body-parser` and `fast-uri` (DoS, SRI bypass, URI spoofing). `npm audit --omit=dev` is now clean. The remaining advisories sit in the dev-only Vite 5 / Vitest 2 toolchain and need a major upgrade.
- **Builds launched from a lowercase path on Windows kept their inline styles**: Vite's inline-CSS cache keys are case-sensitive while Windows paths are not, so a launcher that left the cwd as `q:\…` produced a build whose `index.html` `<style>` lookup missed. Both Vite configs pin `root` to `realpathSync.native(__dirname)`.
- **Long-term memory no longer drops items that only mention a credential word**: the filter matched `token`, `password`, `secret` and `sk-` anywhere, so "builds a tokenizer", "uses a password manager" or even "task-list" were silently discarded. It now matches secret-shaped values (key prefixes, `Bearer <token>`, `password: <value>`, long letter-and-digit strings).
- **Options → Skills described folders it does not scan**: the panel text and the README still listed `~/.claude/skills` and `~/.cursor/skills` as global skill roots, but discovery has only read `~/.agents/skills` since installers started copying each skill into every agent root. Both now name the real roots — `~/.agents/skills` globally, plus `.cursor/skills`, `.claude/skills`, `.agents/skills` and `skills/` in an open project — and the unused renderer copy of the global roots (`AGENT_SKILL_ROOT_SPECS`) matches the main process again.

- **OpenCode Go (and every other server-backed feature) no longer fails with `Failed to fetch` until a restart on a cold first launch**: `ensureToolsServerRunning` (`electron-app/electron/main/index.ts`) gave the spawned tools server about 6 s to answer `/health` and then killed it, and nothing ever started it again. The packaged server is a PyInstaller one-file exe that unpacks itself to `%TEMP%` on every launch while antivirus scans each extracted DLL, so the first start after boot could take longer than that; the app was left with no server at all, and a restart worked only because the second start was warm. The wait is now bounded by `TOOLS_SERVER_READY_TIMEOUT_MS` (90 s) and lasts only while the process is alive, so a candidate that exits still fails over at once. Separately, `_reverse_proxy` (`tts-server/main.py`) turned an upstream connection error into an unhandled 500 without CORS headers, which the renderer can only show as `Failed to fetch`; it now answers `502 Upstream request failed: <error>`.

- **Team workers: steering, truncation and abort fixes**: (1) A duplicate or over-limit steer no longer falls through to the hard abort in `onSteer` and kills the live workers — `pushWorkerSteer` now returns `queued` / `duplicate` / `full` / `empty`, a duplicate is swallowed and a full queue shows an error instead. (2) A steer used to be drained by whichever worker asked first, so its sibling never saw it; the queue is now an append-only log (`entries`, cap 8 per turn) and each worker reads it through its own cursor (`readWorkerSteer`), starting at the log position of its batch so older steers are not replayed. (3) Worker tool results were cut to their first 12 000 characters, which dropped the error summary and exit status that command and typecheck output put at the end, and `read_file` was charged its full length against the read budget for text the model never saw. `clipWorkerToolResult` keeps the head of files and head + tail of everything else, and the budget is charged for the clipped text. (4) The raw `git_diff` / `check_types` appended after a worker batch is capped at 6 000 characters per section (`clipVerificationOutput`), and a stopped turn skips that verification instead of running git and tsc after Stop. (5) A worker that wrote files in a project with no `tsconfig.json` (plain JS) used to report `check_types skipped…` as a failure, so a clean worker finished with a `warn`/`err` status; that is now a separate `skipped` note (`WorkerTypeCheckResult.skipped`) shown as info, not counted in `failed`. Seen live: a Team batch of two path-disjoint workers on DeepSeek Flash finished in ~24 s with both test files passing.

- **`execute_command` tells the model whether the command succeeded**: the result was `$ command` plus the output, while the exit code stayed in a field the model never saw. A failing build or test run looked exactly like a passing one unless the output happened to say so, and the session memo and turn evidence recorded every command that started as `ok`. Finished commands now end with `[exit N]`, `[timed out, exit 124]` or `[stopped, exit 130]` (`formatExecuteCommandStatusLine` in `src/lib/codingCommandStream.ts`). The status goes last so head+tail trimming of noisy output keeps it. `isCodingToolFailure` treats a non-zero exit, timeout or stop as a failure. Background starts and idle-promoted commands are marked `running` and carry no status line.

- **`edit_code` no longer edits the first of several matches**: without `replace_all`, `applySnippetEdit` took `indexOf` and reported success, so a `find_text` that also appeared elsewhere in the file silently changed whichever copy came first. It now rejects any `find_text` that matches more than once — in the exact, CRLF-adjusted, EOL-normalized and `ignore_whitespace` paths alike — with `find_text matches N places (starting at L…); nothing was edited.` and the line of each match, so the agent can widen the snippet or anchor it with `start_line`/`end_line`. A successful single edit now reports `single match` instead of `first match`.

- **`read_file` no longer refuses files from earlier turns**: the re-read guard soft-denied a whole-file read whenever the path was in the session file digests, which survive across turns, and answered `[Already in context: …]` — but only a ~400-character digest crosses the turn boundary, never the file body. Agents had to spend a round on `force:true`, and weaker models believed the message and wrote edits from memory. The guard now denies only paths already read in the current turn (the per-turn working-set cache), the marker reads `[Already read this turn: …]`, and the session memo hint lists earlier files as "read again before edit_code needs exact text" instead of "re-read soft-denied".

- **`search_files` with `path_prefix` found matches but returned zero context**: ripgrep ran with the prefix folder as its working directory and `.` as the search path, so every reported path was *prefix*-relative (`./codingHandlers.ts` instead of `electron-app/src/lib/toolHandlers/codingHandlers.ts`) — while `buildSearchBlocks` and `read_file` resolve paths against the project root. The result looked successful ("N raw matches in 1 file") but every contextual block was silently dropped (`Showing 0 contextual blocks`), the "Top files" list carried paths the model could not open, and the recent-file boost never fired. `searchProjectWithRipgrep` now runs from the project root with the prefix as the search-path argument, so paths come back project-relative (leading `./` stripped). A `path_prefix` pointing at a **file** no longer dies with a raw `ENOTDIR` — it searches that file's folder — and a missing prefix returns `path_prefix not found: …` instead of a scandir error. Ripgrep collection is now bounded (`--max-filesize=2M`, `--max-columns=400`, `-m 50` per file) so one huge or minified file cannot stream unbounded JSON into the main process; the `collection capped` flag is computed before artifact filtering so it can no longer under-report; dependency lock files (`package-lock.json`, `pnpm-lock.yaml`, `Cargo.lock`, …) are filtered as generated noise instead of owning the "Top files" list; and the `.voidcast` scratch dir is skipped like `node_modules`. Cleanup: the dead `ENOENT` branch, the duplicate `filterCodingSearchMatches` call (kept in `processCodingSearch`, removed from `rankSearchMatches`), and the `shouldSkipCodingWalkDir` alias are gone. New cases in `electron-app/test/coding-project-skip.unit.test.ts`.

- **`search_files` queries starting with `-` are searched for instead of parsed as ripgrep flags**: the query was passed as a bare positional argument, so `-m` made ripgrep exit with a flag error (silently falling back to the slow directory walk) and a query that happened to be a valid flag, such as `--files`, made it exit successfully with zero matches and no fallback. `searchProjectWithRipgrep` now passes `--` before the query and search path.

- **`scrape_url` no longer downloads the whole page before enforcing the size cap**: `tts-server/scrape_tool.py` used `client.get(...)`, so `res.content` buffered an unbounded body into RAM and only *then* compared it against `MAX_BODY_BYTES` — a hostile 2 GB page was fully transferred before being rejected. The Python path now matches what `electron/main/scrape.ts` already did: `client.stream()` plus `aiter_bytes()`, extending a `bytearray` and returning as soon as it passes 2 MB, with an early `content-length` check so an honest oversized server is refused without a single body byte. Verified against `example.com`, `python.org`, an `http→https` redirect hop, and two SSRF probes (`127.0.0.1`, `169.254.169.254`) that still answer `Host resolves to a private address`.

- **The DuckDuckGo IPC fallback no longer reports an empty result as success**: `voidcast:web-search` (`electron-app/electron/main/index.ts`) returned `{ ok: true }` with "No instant results from DuckDuckGo. Try rephrasing the query." whenever the Instant Answer API — a topic-summary API, not a search index — had nothing for the query, which is the common case. `invokeWebSearch` prefixed `Search failed:` for `ok: false`, so a `true` here handed the model a placeholder it could answer from, in exactly the situation where the primary `ddgs` backend was already down. It now returns `ok: false` with an honest message naming the degraded path.

- **A worker batch no longer inflates the main agent's context for the rest of the turn**: the `run_coding_workers` result was one uncapped, never-evicted block — model prose, a raw end-of-run `check_types` dump (up to 2 000 chars per package) and a pretty-printed JSON copy of the same facts, re-sent verbatim in every round after the batch. Now (`electron-app/src/lib/codingWorkers.ts`) per-worker prose digests are capped at 1 500 chars (`CODING_WORKER_DIGEST_MAX_CHARS`) with only the one-line typecheck verdicts appended (main re-runs `check_types` itself when it wants diagnostics), blocker notes are clipped to 160 chars, the structured block is assembled by a pure `buildCodingWorkersReport` as **single-line** JSON, and the report joined the old-result clearing set (`CODING_CLEARABLE_TOOLS` in `codingSubAgent.ts`): after a few rounds it is replaced by a placeholder that keeps the deterministic touched-file list and says not to re-run the workers. Covered by new cases in `electron-app/test/coding-workers.unit.test.ts` and `coding-subagent.unit.test.ts`.

- **A finished coding worker no longer closes the analysis card while its sibling still runs**: `runOneCodingWorker` fired `onCodingDone` when the *first* worker of a batch returned, and `applyCodingDone` marked **every** worker slot done and auto-collapsed the card — mid-batch, then the surviving worker's next round re-opened it. Per-worker completion now travels as a status event on `onCodingEvent` (`status: 'done' | 'error'`), flipping only that worker's slot, and `onCodingDone` is once again the single batch verdict; the panel derives its done/partial/error badge from the slots, so one failed worker no longer marks a clean sibling as errored. The collapsed card also drops the separator line under its title.

## [2.11.6] — 2026-10-15

### Added

- **Chat titles are generated, not truncated**: a new chat used to be named after the first 60 characters of the first prompt, verbatim. `electron-app/src/lib/chatTitle.ts` now upgrades that placeholder to a topic title once the first reply has landed — one tool-free sub-agent call (the request carries no tool schema at all) on the model set for the **coding sub-agent** in Options, so a cheap fast model can own the job and there is no second model config to forget. `useChatSessions` runs it once per session, only while the title is still machine-derived: a rename is never overwritten. Only chats created during the current app run qualify, so restarting does not fire one model call per stored chat. 32 output tokens, and a sanitizer that survives quotes, a `Title:` prefix, fenced blocks and non-ASCII titles, capped at 12 words / 60 characters. An empty coding sub-agent model disables it and the derived title stays. Covered by `electron-app/test/chat-title.unit.test.ts`.

- **`npm run check:models` covers DeepSeek**: the preset checker knew OpenRouter, OpenCode Go and NVIDIA but not DeepSeek, so nothing ever flagged a DeepSeek id the API had retired. It now has a DeepSeek section (`scripts/check-models.mjs`, `--deepseek` to run it alone). The catalog is models.dev's `deepseek` provider (no key needed: ctx, pricing, release date); when `DEEPSEEK_API_KEY` is set, the real `GET https://api.deepseek.com/models` feed is queried as well and counts as a second existence source. Ids DeepSeek still *accepts* after retiring them report as a new **LEGACY** line naming the canonical model, instead of being suggested as NEW or deleted — that is what caught `deepseek-v4-flash`. ADD / REMOVE / CONTEXT groups and `--apply` hook into the same interactive flow as the other three providers.

- **OpenCode Go speaks three wire formats, including the Responses API**: models on OpenCode Go are no longer assumed to be OpenAI-compatible. `openCodeGoApiStyle(model)` (`electron-app/src/lib/cloudLlmPresets.ts`) routes each model to `/chat/completions`, `/messages` (`anthropic-messages`: `claude-haiku-5-5`, `minimax-m3` / `minimax-m2.7`, `qwen3.8-max` / `qwen3.8-flash`, `qwen3.7-plus`) or `/responses` (`opencode-responses`: the Contributor tier — `grok-4.6` / `grok-4.7`, `muse-spark-1.2-contributor` / `1.3`, `gpt-5.6-luna` / `gpt-6-luna`), matched by family with per-id pins for anything the families miss. The Responses adapter is a new module (`electron-app/src/lib/openResponses.ts`): it flattens the internal OpenAI-shaped history into Responses `input` items — flat tools (`{type:'function', name, parameters}`), an assistant tool call as its own `function_call` item with a `function_call_output` linked by `call_id` (there is no `role: 'tool'`), and `instructions` + `max_output_tokens` instead of `system` + `max_tokens` — and folds Responses SSE back into the same tool-call and usage shapes the chat-completions parser emits. The output cap defaults to 16 384 tokens with an 8 192 / 4 096 step-down ladder when a model rejects it with a 400. A model the static rules do not know that answers `ModelProtocolUnsupported` on `/chat/completions` is replayed on the format that worked and cached for the rest of the session (`rememberOpenCodeGoApiStyle`, in-memory on purpose). The Contributor slugs are paste-in custom models, not preset entries, because Go publishes no ids for them; preset entries and context limits for the models that *are* published came from `npm run check:models --apply`, which now resolves each model's endpoint from models.dev.

- **The sidebar was reworked**: session rows are one line (~28px, title only — the timestamp moved into the row tooltip) instead of a two-line block, a **filter** narrows the list by chat title and project path, and the panel is **drag-resizable** between 220 and 460 px (default 288, stored under `SIDEBAR_WIDTH_KEY`, double-click resets). The per-row actions moved with it: Fork, Export .md, Rename and Delete now live behind a single `⋯` overflow menu at the row's right edge instead of four inline icons — the icon cluster used to sit mid-label, where a mis-aimed click could fire Fork.

- **Free Fish Audio voices**: `FISH_AUDIO_TTS_VOICES` (`electron-app/src/lib/settings.ts`) adds three free Fish Audio references — Peter Griffin (`FISH_AUDIO_PETER_VOICE`, the default), Rick Sanchez (`FISH_AUDIO_RICK_VOICE`) and a neutral narration voice (`FISH_AUDIO_NEUTRAL_VOICE`) — offered as the voice dropdown for OpenRouter's `fish-audio/s2.1-pro-free:free` and Runware's `fishaudio:s2.1@pro`. `FISH_AUDIO_DEFAULT_VOICE = FISH_AUDIO_PETER_VOICE`, so an empty voice field resolves to a stable known voice instead of letting the provider pick one at random per request.

- **Attachments are materialized to real paths for the agent**: dropped and pasted images/files are written out as actual files, so a turn can hand tool calls a real path instead of only the in-memory `FileAttachmentSnapshot` bytes.

### Changed

- **Model catalogs swept with `npm run check:models --apply`**: NVIDIA dropped `moonshotai/kimi-k3` (its live feed serves `moonshotai/kimi-k2.6`) and gained `stepfun-ai/step-5-preview`; OpenRouter gained `google/gemini-4-argon`; OpenCode Go gained `gemini-4-argon-contributor` and lost `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp`, whose Go successor is `deepseek-v4.1-flash`. Those two were preset entries, so `OPENCODE_GO_MODEL_ALIASES` now redirects both the bare and the `deepseek/…` forms to `deepseek-v4.1-flash` — a saved setting keeps working instead of resolving to a model Go no longer serves. Stale context overrides for the retired ids went with them.

- **DeepSeek's model list follows the V4.1 rename**: DeepSeek retired `deepseek-v4-flash` (and `deepseek-v4-flash-vision-exp`) — the API still accepts both, but serves DeepSeek-V4.1-Flash and bills at the Flash price (https://api-docs.deepseek.com/quick_start/pricing). `DEEPSEEK_LLM_PRESET_MODELS` now offers the canonical `deepseek-flash` ("DeepSeek V4.1 Flash") alongside `deepseek-v4-pro`, and `DEEPSEEK_MODEL_ALIASES` maps every retired name onto it (`deepseek-chat`, `deepseek-reasoner`, `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`, plus the `deepseek/…` routes), so a saved setting keeps working instead of resolving to a name the API no longer serves as its own model. The context limit for the new id (`1 000 000`, `electron-app/src/lib/contextLimit.ts`) and the DeepSeek hint in Options (`LlmOptionsPanel.tsx`) follow. `deepseek-v4-pro` stays the first preset, so the default model is unchanged.

- **Dystopian theme: the accent cyan is toned down**: the bright accent (`--color-neon-cyan`, `0 245 255` — used for every border, focus ring and the stacked `neon-text-*` glow) was glaring on a dark shell. It is now a muted steel-cyan `40 175 195` (`--color-neon-cyan-dim` → `30 128 144`, `--ui-accent-rgb` → `40, 175, 195`), so the halo shadows read as a glow rather than a flashbulb. The coding-panel cyan slots (`--coding-accent-fg`, `--coding-diff-hunk-fg`, `--coding-git-untracked-fg`, `--coding-terminal-system-fg`, `--coding-find-active-fg`) and the two hard-coded `#00f5ff` SVG fills (the `.form-select` arrow in `App.css`, the `.hex-bg` pattern in `index.css`) follow. Every other theme sets its own `--color-neon-cyan`, so this touches the dystopian shell only.

- **The browser is per project too**: `browser/viewManager.ts` kept one active page, one partition and one remembered project for the whole app, so opening or navigating a page in project B closed project A's pages (`applyProfile` → `closeAllPages`) and stole A's active page. State is now a `BrowserBucket` per coding project (keyed by `bucketKey(projectPath)`): each project owns its active page, partition, project path, partition epoch and in-flight page creation, `closePagesIn` closes only that project's pages, the WEB panel's bucket (`panelKey`) is the only one that paints, `MAX_PAGES` applies per project, downloads are routed by partition (`partitionProjects`) to the project that started them, and remembered HTTP sign-ins are stored per partition (`PendingAuth.partition`). `voidcast:browser-status` reports the panel's bucket unless the caller passes its own `projectPath`. No renderer change was needed — every `voidcast:browser-*` payload already carried the project path, and `BrowserPane` re-configures whenever it changes.

- **Two chats can code in two different folders at once**: the run-start guard that refused a second run while another chat was busy in a *different* project is gone (`sessionAgentStore.codingProjectConflict` deleted, `useChatAgent` no longer aborts the send). It blocked the safe case — different roots cannot touch each other's files, since every coding tool call carries its own `projectPath` — while explicitly allowing the risky one (two runs on the same folder). Same-folder peers still get the non-blocking `codingSameProjectBusyAdvisory` hint. The browser panel is per project as well now — see the entry above.
- **The coding folder belongs to the chat, not to `settings`**: the project path was mirrored into one global `settings.coding.projectPath` from five places, and the settings poll re-read and **replaced the whole settings object** every second — so opening a chat could clear another chat's folder, and a background run's memo landed in whoever wrote the folder last. `useChatSessions` now keeps the folder on the session (`codingProjectPath`, plus `draftCodingProjectPath` for a chat that has no id yet) and exposes `activeCodingProjectPath` / `setCodingPathForActiveChat` / `codingProjectPathForRuntimeKey`; hydrating, switching, clearing and saving a chat no longer write settings, and the coding memo saves under its own folder. `useChatAgent` freezes the root of the **sending** chat (`turnCodingProjectPath`) and passes it to `buildAgentTurnContext` and the tool context explicitly — no longer folded into `turnSettings` — and `CodingPanel` / `ChatHeader` render the chat's folder instead of the global one.
- **The `CODING_PROJECT_DIR` field is gone from Options → Tools**: with the folder owned by the chat it was down to two jobs — seeding a new chat, which New chat deliberately does not do (a new chat is General), and telling the MCP / skills tabs which project to read. `settings.coding.projectPath`, the top-level `codingProjectPath` alias and the `defaultCodingProjectPath` / `getCodingProjectPath` / `mergeCodingProjectPathIntoSettings` helpers are deleted, and Options → Tools (MCP) plus Options → Skills now read `activeCodingProjectPath`, the folder of the chat on screen — so the servers and skills shown are the ones that chat's agent actually loads. Stale keys in an existing `settings.json` disappear on the next save because `normalizeSettings()` rebuilds `coding` field by field.
- **The settings poll adopts single fields instead of the whole object**: new `mergeExternalSettings()` in `electron-app/src/lib/externalSettingsSync.ts` mirrors only the fields an agent tool may write straight to disk (`llmSystemPrompt`, `llmNumCtx`, `llmTemperature`, `uiTheme`, runware image/edit settings, `pinnedModels`), so an out-of-band write can no longer resurrect a stale coding folder. Covered by `electron-app/test/coding-chat-path.unit.test.ts`.
- **The padlock is the only per-chat model lock**: the chat-header switcher used to write `ChatSession.model`, and that alone made a chat ignore the model set in Options — so the Options switch looked broken for any chat that had ever picked a model, with no way back. Now the lock is the padlock in the status bar (`LockIcon`, `.status-item .lock`): on, `toggleModelLockForActiveChat` copies the resolved model into the session (glowing cyan `is-locked`, Options no longer reaches that chat); off, it clears the field (muted, back to Options). Picking in `ModelSwitcherPopup` is a normal model change — per-chat on a locked chat, app-level through `applyScopedModelToSettings` on an unlocked one, which is also why the picker now works in a brand-new chat with no session id yet. `activeModelId` = the session's model else `currentPinnedModelId(settings)`; `saveOrUpdateSession` and `forkSession` keep it.

- **Vision payloads are capped and MIME handling is stricter**: image bytes sent to a vision model are bounded before they leave the app, and the declared MIME is normalized/rejected when it does not match the payload, so a large or mislabelled attachment can no longer blow up the request.
- **The composer is locked while context compression runs**: manual **COMPRESS NOW** (and auto-compress) sets `contextCompressBusy` on the session, which now disables the textarea, the send button and the toolbar while the summary is written — a spinner banner sits in the composer — and `onSend` refuses a turn outright while the flag is set. Previously the flag did not gate the composer at all, so a prompt could be sent mid-compression and race the `hiddenContextSummary` / `contextCompressedThroughIndex` write.
- **A collapsed folder no longer hides its agents**: with the chat folder auto-collapsed unless it holds the open chat, a background run in another project was invisible. The folder header now aggregates its rows — a green pulsing dot while any session inside is busy (count in the tooltip), otherwise a cyan dot for an unread completion — while the folder holding the open chat keeps its bold cyan label/edge and active dot. A filter query expands every group.

- **Global skill discovery is limited to `~/.agents/skills`**: `GLOBAL_AGENT_SKILL_ROOTS` (`electron-app/electron/main/index.ts`) also scanned `~/.claude/skills` and `~/.cursor/skills`, and skill-pack installers write the same folder into every agent root they find — so one skill existed as three physical copies while only the first one in scan order (`.agents`) was ever read, because `dedupeSkillsByName` keeps the first name match. The two extra roots are gone; a skill that exists only under `.claude` or `.cursor` is no longer listed. Project-relative roots (`.agents/skills`, `.claude/skills`, `.cursor/skills`, `skills/`) are unchanged.

### Removed

- **The `TOOL_TIMEOUT` banner above the composer is gone**: 2.11.0 pinned a red one-liner above the composer when a tool ran out of time (`ChatToolResultBanner`, `tool-result-banner--timeout`). It was redundant — the per-tool countdown chip already reports the stopped tool, and the timeout still reaches the model through the tool result — so the banner and the whole `toolResultBanner.kind` union went away (`toolResultBanner` is now PDF-export only, `isToolTimeoutResult()` deleted). Turn and tool duration chips are unchanged.

### Fixed

- **Export .md writes the whole conversation, not just the final replies**: `exportSessionToMarkdown` (`electron-app/src/hooks/useChatSessions.ts`) walked `session.messages` and emitted only `content` plus image/file notes, so the streamed reasoning and every intermediate agent round before a tool call were silently dropped from the file. The export now renders through a new `buildSessionMarkdown`: each turn keeps its thinking (Ollama `thinking` / OpenRouter `reasoning`, folded into a `<details>Thinking</details>` block), the `agentProgress` drafts a later tool round would otherwise overwrite (`<details>Agent rounds · N (before tool calls)</details>`), the sub-agent activity card, Plan-mode artifacts as task lists, the coding-turn evidence line ("Tools: …"), the turn duration in the heading, and per-message steer / plan-handoff markers — alongside the images, generated media and file attachments the old code already wrote.
- **A model timeout no longer raises the full-width red `ChatErrorBanner`**: `isTimeoutMessage()` (`electron-app/src/lib/turnTimer.ts`) keeps genuine API/auth/DNS failures on the banner while a timed-out model turn reports through the duration chip and the turn text instead.
- **Agent replies keep their body text monochrome**: bold and headings in an assistant bubble use weight and contrast rather than the accent colour; links and bullets stay accented.
- **TTS skips markdown tables when reading a reply aloud**: `stripMarkdownTables()` in `electron-app/src/lib/chatHints.ts` (inside `sanitizeForTts`) covers SPEAK, auto-voice and `generate_tts`, so pipe rows and separator lines are never spoken.
- **Sidebar row actions no longer linger after a click**: they show on hover and keyboard `:focus-visible` (with a `focus-within` safeguard) instead of staying visible once the mouse has clicked the row.
- Coding edit failures point at the exact first differing character instead of the whole mismatched line.
- Only the `.git` directory is hidden in the file tree; other dot-directories are listed again.
- The skills catalog hint shows each skill's folder path.
- A new chat's first turn runs in the project folder it was created in.

## [2.11.0] — 2026-10-12

### Added

- **Per-turn and per-tool duration timers**: the assistant message now stamps `turnStartedAt` / `turnEndedAt` and renders a live duration chip at the end of the bubble, every tool activity carries `startedAt` / `timeoutSec` and shows a live counter in the busy strip (a countdown when the tool declares a timeout), and a tool that runs out of time surfaces a `TOOL_TIMEOUT` banner above the composer.
- **Frameless custom window chrome on Linux**: the main window now uses `titleBarStyle: 'hidden'` plus the app's own chrome background on Linux, behind a new `usesCustomWindowChrome()` platform helper (`electron-app/src/lib/platform.ts`) that also replaces the two duplicated `isWindowsDesktop()` copies in `WinChromeBoot` and `WindowControls`.
- **Coding: downloads started by a browser click reach the tool result**: a download is still in flight when the click returns, so it never made it into the result and the agent had to poll `browser_status` (or look in the OS Downloads folder). `attachDownload` now records the notice as soon as the download begins and bumps a monotonic `downloadSeq`; the click handler snapshots the mark, waits a short bounded grace (at most 700 ms) for a new download, then appends `Download started: <name> (<state>) — saved to <path>`. The browser pane also gains a toolbar button that opens the downloads folder through `window.voidcast.openPath`.

### Changed

- **`npm run release -- --bump <kind>`** now raises the version in all three files (package.json, package-lock.json, `useAppSettings.ts`) before committing.
- **Release pipeline hardening**: installers are collected from the nested artifact directories, the publish step fails on unmatched files instead of publishing an empty release, artifact retention is 7 days, the dead `electron-app` workflows are gone, and the artifact / pages actions are off Node 20 (upload-artifact v7, download-artifact v8, `softprops/action-gh-release` v3, upload-pages-artifact v5).
- **Docs**: `AGENTS.md` now documents the repo rules (English-only, no generated output in git, the four version spots, release/tag rules), and the bundled-ripgrep note describes the real per-platform resolution instead of claiming Windows-only.

### Fixed

- **Bundled ripgrep never ran in packaged builds**: `@vscode/ripgrep` resolves `rgPath` inside `app.asar` — `existsSync()` is asar-aware so the path looked present, but `spawn()` failed with `ENOTDIR`, so every ripgrep-backed search failed and the system-`rg` fallback was unreachable. The main process now points the bundled path at `app.asar.unpacked` with a separator-anchored match and probes each candidate by actually running `rg --version`, warning about the ones it skips.

## [2.10.0] — 2026-10-11

### Added

- **Linux desktop builds — AppImage + `.deb`**: `electron-builder` now targets Linux alongside Windows (`linux.target: ["AppImage", "deb"]`, category `Utility`, deb maintainer set), and the main process resolves the bundled tools server per platform (`voidcast-tools-server.exe` on Windows, `voidcast-tools-server` on Linux, made executable at build time). **Auto-update on Linux works for the AppImage only** — `electron-updater` has no `.deb` updater, so a `.deb` install must download a new version by hand.
- **`build-linux.sh` — one-command Linux build from source**: installs whatever is missing (apt packages, Node 22 from NodeSource, repo `.venv` + tools-server requirements), builds the LAN web UI, freezes the Linux tools server with PyInstaller, then runs `tsc` + Vite + `electron-builder --linux`. `--dir` gives a fast unpacked build, `--publish never` is what CI uses, `VOIDCAST_SKIP_SYSDEPS=1` skips apt when the environment is already prepared.
- **`start-dev.sh` — one-command Linux dev setup**: same dependency bootstrap, plus the AppArmor/Electron sandbox fix, then starts the tools server (uvicorn, port 8765) and the Electron app with Vite HMR.
- **Cross-platform release pipeline** (`.github/workflows/release.yml`): pushing a `v*` tag runs a matrix build on `windows-latest` and `ubuntu-latest` — PyInstaller cannot cross-compile, so each OS freezes its own tools server — and publishes **one** GitHub Release carrying the Windows installer, the Linux AppImage/`.deb` and both `latest*.yml` update manifests. `workflow_dispatch` builds artifacts only, without publishing, and the run fails if the tag does not match `electron-app/package.json`.
- **`npm run release` helper** (`scripts/release.mjs`): commits pending changes, creates the `vX.Y.Z` tag from `electron-app/package.json` and pushes branch + tag, refusing when the tag already exists locally or on origin. Options: `--dry-run`, `--no-push`, `-m "<message>"`.

### Removed

- **Reddit tool (`reddit_feed`) removed**: Reddit is retiring the unauthenticated endpoints this tool depended on — RSS feeds stop 2026-11-13, new public API access requests closed 2026-10-31, and the remaining public Data API plus access for unregistered apps goes away between 2027-01-12 and March 2027. `web_search`, `scrape_url` and the built-in browser tools cover the use case. Dropped: the `reddit_feed` agent tool, the `toolsEnabled.reddit` setting (option toggle included), the chat tool-activity indicator, `electron-app/src/lib/redditTool.ts`, the tools-server `POST /tools/reddit` endpoint and `tts-server/reddit_tool.py`.
- **False-claim reprompt guards removed**: the image / music / coding hallucination guards are gone — they regex-scanned both the user prompt and the assistant reply for claim wording, which fired on ordinary text (e.g. a Hugging Face roundup that mentioned image models and links) and injected a hidden reprompt, so the model appended a stray "…is unavailable" line. Dropped: `shouldGuardFalseImageClaims` / `shouldGuardFalseMusicClaims` / `shouldGuardFalseCodingClaims`, `assistantClaims*WithoutTool`, their regex sets (`ASSISTANT_IMAGE_*`, `ASSISTANT_MUSIC_*`, `ASSISTANT_CODING_*`, `RUNWARE_IMAGE_CDN_RE`, `MUSIC_USER_REQUEST_RE`, `IMAGE_USER_REQUEST_RE`, `isMusicFocusedUserText` / `isImageFocusedUserText`), the three `FALSE_*_CLAIM_REPROMPT_MESSAGE` strings, the `guardFalse*` loop params / counters / flags, the `CODING_ACTION_TOOLS` alias and `test/false-coding-claim.unit.test.ts`. The model's own text is no longer auto-corrected; the budget wrap-up truth guard (`guardRepoActionTruth`) and the tool-budget / tool-required reprompts are unchanged.

### Changed

- **Coding tools are no longer advertised to a chat with no project folder**: a General chat (no bound folder) used to receive every coding tool while the option was ON — each call only answered "coding project folder is not set in settings", and the system prompt still claimed file / terminal / git access. `buildToolsList` now requires a bound folder (`opts.codingProjectPath`; `undefined` still means "caller did not say", so workers, sub-agents and tests keep the historical behaviour) and `buildAgentTurnContext` swaps the coding prompt for an explicit "enabled in Options but unavailable in this chat" note. The chat header shows a `⚠ coding off · no folder` chip that binds a folder in one click. Implement-mode prompting and the `guardRepoActionTruth` claim guard follow the same gate.
- **File tree: point-at-file + delete replace the per-row git buttons**: the row no longer duplicates stage / unstage / discard (they stay in the PREVIEW header). It offers `＋` — adds the file's project-relative path to the chat composer as a **reference chip** (a `FileAttachmentSnapshot` with `referenceOnly: true` and empty `content`), so the agent can be pointed at a file without typing a path and without dumping file content into the prompt: `buildQueuedFilePathHint` now marks those entries as path references and tells the model to read the file itself instead of claiming it has no local access — and `🗑` — moves the file to the OS Recycle Bin, Shift-click for a permanent delete. New IPC `voidcast:coding-delete-path` (`shell.trashItem` for the Recycle Bin, recursive `rm` for the permanent path, path resolved inside the project root, refuses the project folder itself) with `invokeDeleteCodingPath` and the `window.voidcast.codingDeletePath` typing. Folders are handled the same way — the Recycle Bin receives the whole folder with its contents, Shift-click removes it recursively. Status letters and colors in the tree are unchanged.
- **The model switcher is now per chat**: the header picker pins the model to the chat you are in (`ChatSession.model`, a `provider:modelId` pin in the same format as the pinned list) instead of rewriting the app-level model, so picking a model in one chat no longer retargets another chat's next turn. The model from Options stays the default for chats that never picked one, and the header shows each chat's own model.
- **Line endings pinned to LF for `*.sh` / `*.py`** (`.gitattributes`), so the Linux/macOS scripts still run after a Windows checkout.
- **Dev scripts no longer assume Windows**: `start-dev.sh` / `build-linux.sh` replace the Windows-only root npm scripts on Linux, and the repo root `package.json` is now a workspace shell (`voidcast-workspace`) that only carries the dev/build helper scripts.

### Fixed

- **A plan handoff keeps the model its run started with**: the Plan escalation re-entered `onSend` with fresh settings, so a Plan turn started in a background chat could silently adopt a model picked meanwhile in another chat — and with it that model's context limit. The handoff now carries the run's own `provider:modelId` pin (`forceModel`).

## [2.9.3] — 2026-10-07

### Added

- **Runware music: ACE-Step v1.5 XL presets**: three new 4B DiT variants join the existing Turbo/Base presets — `runware:ace-step@v1.5-xl-turbo` (8-step distilled, steps capped at 20), `runware:ace-step@v1.5-xl-base` (50-step CFG, up to 300 steps) and `runware:ace-step@v1.5-xl-sft` (flagship quality, up to 300 steps). Each keeps its own profile (steps, CFG, duration, format, seed); the XL presets start from docs defaults rather than the legacy turbo-shaped settings.
- **Offline speech-to-text (Whistle)**: new `sttProvider: 'whistle'` runs fully offline via the bundled `cactus-needle` engine and the 16.9 MB Whistle model (Apache-2.0) — no API key or internet. The renderer resamples recordings to 16 kHz mono WAV and POSTs to the tools-server `POST /stt/transcribe`; the native engine (`whistle.cact` + `libneedle.dll`) is embedded into the tools exe by `voidcast-tools-server.spec`, so a fresh machine needs no download. Supports 7 languages (not Serbian — use `openrouter` for that). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **Prompt-cache-friendly request ordering**: the message builder now keeps a byte-stable cacheable prefix — the system prompt and the full history are identical run-to-run, while volatile per-turn context (clock, coding-project memo, live processes, compression summary, long-term memory) is attached to the **final user turn** instead of a trailing system message. This also fixes local llama.cpp/Llama-3 templates that reject a non-leading system message. OpenRouter requests send a stable `session_id` for sticky provider routing; cached-token counts are mapped from the usage block and a `[voidcast] prompt …` cache-hit diagnostic is logged each turn.

### Changed

- **Agent mode is now per chat**: the composer mode (**Agent → Ask → Plan → Team**) belongs to each chat instead of the window, so a chat running in the background can no longer change the mode shown by the chat you are looking at. `settings.agentMode` is now only the seed for new chats, and existing chats are back-filled with their own mode on load.
- **Dev tooling**: Prettier and ESLint are now configured (`electron-app/.prettierrc.json`, `.prettierignore`, `eslint.config.mjs`) with `npm run format` / `format:check` and `npm run lint` / `lint:fix` scripts.

### Fixed

- **Plain-HTTP provider origins are now blocked (CSP)**: the production `connect-src` was narrowed from `http: https: ws: wss:` to `https:`/`wss:` plus loopback `http:`/`ws:` (the tools server and local Ollama). A provider pointed at a plain-HTTP **non-loopback** host — e.g. a LAN Ollama at `http://192.168.x.x:11434` — is now refused by CSP until that origin is added to `index.html`.
- **Browser housekeeping actually ran**: `runBrowserMaintenance` now also fires from the panel (opening/clearing pages), not only `hardenSession`, and the trim decision is measured from each profile's real on-disk size (`dirBytes`) instead of the size recorded in `browser-profiles.json`, so profiles the registry never recorded get their re-downloadable caches dropped too.
- **Plan mode no longer switches the wrong chat**: entering Plan from a background chat used to re-bind the handoff turn to whatever session was on screen, so the plan card, the handoff draft and the follow-up messages landed in the viewed chat instead of the one that started the run. The escalation now binds to the chat that owns the run, so an escalated background chat keeps its Plan state and the chat you are viewing is left untouched.
- **Plan actions no longer write the window-level agent mode**: approving or revising a plan (and an escalation whose session id could not be resolved) wrote `settings.agentMode`, which the composer no longer reads. The mode is now written onto the chat itself, like the mode picker — an unresolvable chat is a no-op instead of a window-wide write.
- **Background chats keep their image-vision analysis**: vision entries produced by a background run were merged only into the on-screen cache and then dropped, so opening that chat re-ran the analysis. They are now persisted onto the owning chat.
- **A chat switch during context compression no longer mixes summaries**: the hidden context summary and compressed-through index are window-level mirrors, so a compression that finished after you switched chats used to slice the newly viewed chat's history with the other chat's summary. The mirror is now written only while the compressing chat is still the one on screen — the owning session is updated either way.
- **App no longer jumps to the front while the agent writes files**: the background-safe focus guards in the coding panel and the file-preview find bar now read the real window state (`win.isFocused()` / `win.isMinimized()` over a new `voidcast:window-focus-state` IPC) instead of `document.hasFocus()`, which stays `true` for a minimized window. A minimized or backgrounded app now stays where it is when the agent edits or writes a file.
- **`check_types` no longer reports a clean typecheck in packaged builds**: `resolveTscCommand` spawned `process.execPath` directly, which in an installed build is `Voidcast.exe`, not node. Packaged Electron ignores the script argument, so the child booted Voidcast itself, hit the single-instance lock and exited `0` with no output — which the report read as “no errors”, hiding real type errors. tsc now runs with `ELECTRON_RUN_AS_NODE=1`, and the `node_modules/.bin/tsc.cmd` fallback (unspawnable with `shell: false` on Node 20+) was replaced with the real `lib/tsc.js` entry point.

## [2.9.1] — 2026-09-27

### Added

- **Gemini 3.8 TTS presets**: OpenRouter TTS now offers `google/gemini-3.8-flash-tts` and `google/gemini-3.8-flash-lite-tts`; every Gemini TTS preset (including the 3.1 default) now shares the full 30-voice catalog (`GEMINI_TTS_VOICES`).
- **Fish Audio TTS**: OpenRouter TTS presets now include `fish-audio/s2.1-pro-free:free`; Fish Audio models use a free-form `reference_id` voice (with a stable default) instead of a fixed voice catalog.
- **Windows toast for finished replies**: when the window is minimized or hidden in the tray, a reply that finishes shows an OS toast titled **Voidcast** with a one-line preview of the answer.
- **Stable image catalog ids**: every catalog image now gets a permanent id like `img_1a2b3c4d` derived from its content/path, so `image_recall` and `edit_image_runware` can reference it via `reference_image_ids` across turns and reloads instead of positions.
- **Agent-rounds label**: intermediate tool-round drafts collapse under a single monochrome label, and the last draft is folded into the reply when the final answer arrives.

### Changed

- **Taskbar and coding preview**: the app stays visible in the taskbar while hidden to the tray, and the coding preview stays pinned while the agent works.
- **Cloud model presets refreshed**: OpenRouter, NVIDIA, and OpenCode Go presets and context metadata were updated against current provider catalogs; the OpenCode Go model checker prunes dead/legacy entries.
- **Plan-mode handoff**: the chat message that switches Plan → Agent/Team is now a single-line notice.

### Fixed

- **OpenCode Go session routing**: chat and sub-agent requests now send a stable `x-opencode-session` header per conversation, as required by the OpenCode Go API.

## [2.8.9] — 2026-09-22

### Added

- **Agent TTS tool**: `generate_tts` synthesizes speech with the active TTS provider and saves the audio either to the generated-audio folder or to a validated project-relative path.
- **Coding turn evidence**: completed coding turns now preserve a verified summary of files changed, commands run, and git mutations for the chat history.
- **Context usage after compression**: the chat shows an estimated context percentage after a compression completes.

### Changed

- **Coding workers**: worker orchestration, sub-agent tool loops, path scoping, and result digests were hardened for multi-area tasks.
- **Coding evidence display**: command previews were removed from the compact evidence summary while the structured evidence remains available.
- **Cloud model presets**: provider presets and context metadata were refreshed, including the latest supported model entries.

### Removed

- **CrofAI provider**: removed from the UI and provider configuration; legacy settings are cleaned up during normalization.

### Fixed

- Auto-save no longer races with chat-title updates while a session is being created or updated.

## [2.8.8] — 2026-08-28

### Added

- **Footer CTX popup**: click the CTX meter for auto-compress (90%) toggle + **COMPRESS NOW** anytime — useful on large-context models before you hit the limit.
- **Parallel tool rounds and live progress**: adjacent read-only tool calls run concurrently (up to 4), while serial/mutating tools remain barriers; the chat shows active tool names and preserves intermediate assistant drafts in collapsible round blocks.
- **OpenRouter provider listing**: Options → LLM can list all providers serving the selected OpenRouter model, including context, pricing, and uptime; clicking a provider applies the per-model routing lock.
- **Folder shortcut for new chats**: the folder button beside **New chat** opens the project folder picker and starts the new chat bound to the selected folder.

### Changed

- **Cloud model catalogs refreshed**: OpenRouter, NVIDIA, and OpenCode Go presets and context-window metadata were updated against current provider catalogs. The model checker supports all three catalogs and an interactive `--apply` workflow.

## [2.8.6] — 2026-08-25

### Added

- **OpenRouter presets**: [Ox Alpha](https://openrouter.ai/stealth/ox-alpha) (`stealth/ox-alpha`, free · 1M · multimodal) and DeepSeek V4 Flash Vision Exp (`deepseek/deepseek-v4-flash-vision-exp`).
- **OpenCode Go presets**: `deepseek-v4-flash-vision-exp`, `ox-alpha-free`, and `longcat-2.0` (all `/v1/chat/completions`).

### Fixed

- **Stale chat images no longer auto-injected into later turns**: keyword matches like “analyze / describe / inspect” no longer re-attach the newest session image as if the user just uploaded it. Vision bytes go only with images attached on the current message; older images stay in the catalog for explicit `image_recall`.

## [2.8.4] — 2026-08-13

### Added

- **Multi-chat concurrent agents**: run agents in several sessions at once (soft cap **3**). Each chat has an isolated runtime slot (`sessionAgentStore`): messages, abort, tool phase, media. Switch sessions while others keep working; busy/unread sidebar indicators; background finish can show a DONE-style affordance. Coding tools isolate by **project path**, shell owner, and terminal feed; draft→session rekey mid-run. Extra starts past the cap are refused until a run finishes or you Stop.
- **Team mode + coding workers**: composer cycles **Agent → Ask → Plan → Team**. Team prefers early **`run_coding_workers`** (up to **2** parallel workers on the coding sub-agent model). Agent may call workers when helpful; Plan and Ask have no workers. Team and Ask drop `enter_plan_mode`. Approve & Build follows the composer (**Team** if selected, else **Agent**).
- **Ask mode**: read-only Q&A (no Plan fence/card). Mutating tools, workers, settings/reminder writes, and `mcp_call` are off; system/tool hints match read-only scope. For a plan card use Plan; for edits use Agent/Team.
- **`run_coding_workers` tool**: 1–2 path-oriented tasks, optional `path_prefix` (hard write/edit scope), file locks between workers, default/max **100** tool rounds per worker, force digest if the model never ends with `done`. Main **awaits** the batch (workers parallel with each other only). No nesting.
- **Coding explore / sub providers**: `coding_explore` read-only nested map; SUB panel providers aligned with main (OpenRouter / NVIDIA / DeepSeek / OpenAI / OpenCode Go + Ollama), openrouter locks, pins; internal CTX/OUTPUT defaults (16k / 2k). OpenCode Go workers use the real API key.
- **In-chat sub-agent analysis card**: VISION / EXPLORE / WORKERS progress on the **assistant message** (collapsible, dismissible); persists with the session when saved. Options → SUB → **SHOW_ANALYSIS_IN_CHAT** (replaces floating panel).
- **Steer mid-turn**: while the agent is working, type a correction and press **Enter** (or the compass Steer button) to abort the live turn and immediately start a new one with a course-correction frame for the model. Plain stop still only cancels. Steered user bubbles show a `STEER` badge.
- **Sticky unsaved drafts** (auto-save off): drafts stay in the sidebar so you can leave and return without losing them until you Save.
- **Clipboard paste images** as pending chat attachments.
- **Product docs**: [docs/multi-chat-and-team.md](docs/multi-chat-and-team.md) plus updates across chat / coding / SUB / architecture.
- **Resizable preview ↔ terminal split** in the coding panel: a draggable horizontal divider between file preview and the terminal (only when both are visible; commit bar sits inside the terminal stack when dirty). Persisted height (`terminalHeightPx`, default 200px, clamped 80–480) with pointer-drag + keyboard support (↑/↓ 16px step, Shift 32px, Home/End for min/max). Terminal-only (or terminal + commit, no preview) fills remaining space with no divider; commit-only uses natural height.
- **Terminal auto-scroll**: streamed output follows to the bottom while you're at the end, but does not yank the scroll position if you've scrolled up to read older output.

### Changed

- Coding worker round budget raised (and documented) to **100** rounds.
- **Save icon only while unsaved** (auto-save off): the SAVE affordance now shows only for sessions that are genuinely still drafts (`unsaved` flag), not whenever any new message arrives. Saving a chat once removes the flag, and from then on the session auto-persists — the save icon no longer reappears for already-saved chats.
- **Ignored/generated dirs shown dimmed** instead of hidden: heavy folders (node_modules, dist, …) stay visible in the coding file tree, rendered dimmed, and a double-click opens the path in the OS app.
- **Agent bubble bold de-accented per theme**: bold formatting in the assistant bubble no longer uses the theme accent on **Minimal zinc** (full-neutral bubble — h1, bullets, links and blockquotes also neutral), **Blood Moon** (neutral ivory bold), and **Terminal** (only bold neutralized, amber accents kept for the rest). **Matrix** bold switched from harsh phosphor green to a softer green.

### Fixed

- **Coding file preview stays scrollable in the split pane**: with a preview ↔ terminal split, the file preview keeps its own independent scroll area instead of losing it when the terminal pane is shown.
- **Coding terminal stays scrollable when the pane is shrunk**: shrinking the terminal no longer clips streamed output — the terminal keeps its scrollback and only follows the end when you're already at the bottom.
- **Multi-chat agent run slot leaks + concurrency race**: fixed runtime-slot leaks and a race where concurrent multi-chat runs could step on each other's tool phase / abort state.
- **Multi-chat project concurrency + worker shell locks**: clarified and enforced per-project concurrency and shell-owner locking so parallel multi-chat or worker runs on the same project path no longer corrupt each other's terminal feed or edits.
- **Worker edits update the parent coding memo (no race)**: a `run_coding_workers` batch now patches the parent session's coding memo after a successful worker `edit_code` instead of racing on stale digests.
- **Terminal resize snap-back + bottom pane sizing**: releasing the preview ↔ terminal drag used to reset height — an effect re-applied stale `terminalHeightPx` as soon as the resize flag cleared, before settings persisted. Drag direction follows the bottom-anchored pane (drag up grows the terminal). Splitter and fixed height apply only with preview + terminal; commit-only stays natural; terminal without preview fills.

## [2.8.2] — 2026-08-07

### Added

- **Soft-deny whole-file re-reads**: `read_file` now refuses a full re-read of a path already in the session digests or this turn's working-set cache, returning a compact digest reminder (with `force:true` / `start_line` / `end_line` guidance) instead of re-dumping the file. New `force` parameter escapes the guard. Soft-deny reminders are not re-added to the cache, so the working set stays stable.
- **Plan handoff lands in the user message**: on `enter_plan_mode`, the prior agent-mode exploration is injected as a real user-lane block (not just a tools hint), so the Plan turn actually starts from that research.
- **Richer plan handoff draft + tool trail**: when escalating to Plan mode, the pre-plan agent reply stays visible as a `→ Plan mode · kept as draft before plan` note (the real reply when substantial, otherwise the explored-file digests), and the Plan context now carries a compact one-line-per-event tool trail with **HARD CONSTRAINT** no-reexplore hints so Plan mode does not redo the research from scratch. Streamed content is no longer cleared between tool rounds.
- **Covered-path memo block**: session covered paths (the soft-deny list) are surfaced in the coding memo above the digests, so the agent sees what is already in context; `read_file` / `find_symbols` results stay pinned longer in long tool loops (read pin 3 → 6, outlines 2 → 4, keep-read rounds 8 → 12).
- **Per-project new-chat button**: project-folder groups in the sessions sidebar get a `+` button (revealed on hover) that starts a brand-new chat already bound to that folder.
- **Type while the agent is busy**: the composer no longer disables input during a running turn; a draft status shows when you've queued text or attachments while the agent runs (see also **Steer mid-turn**).
- **LAN access token for phone/web clients**: the LAN QR/URL now carries a shared access token (`?t=...`), sent as `x-voidcast-access-token` on every same-origin request and stripped from the address bar (session-persisted so refresh keeps working). Server-side CORS relaxed to wildcard origin with `allow_credentials=False`.

### Changed

- **Terminal theme contrast softened**: replaced the pure-black background with a warm dark-charcoal backdrop and dimmed the amber/phosphor accents so the phosphor reads as a quiet glow instead of neon glare. Fixed the `coding-terminal` selector typo and stripped the UTF-8 BOM from the theme file.
- **Matrix theme more black, less green**: background surfaces pulled toward near-black (`1 3 1` / `2 6 2`) and the digital-rain backdrop dropped from 0.42 to 0.18 opacity; message bubbles, header, input and sidebar borders dimmed, and the body green text-glow removed — green now accents rather than floods.
- **Build prompt stays internal**: clicking **Build plan** on a plan card no longer dumps the full `formatPlanForBuildPrompt` (all steps + code) into the chat. The build prompt still goes to the model, but the visible user bubble is a short `Build approved plan: <title>` label.
- **No duplicate plan todo list**: removed `PlanBuildProgress` (a second, redundant step list) — the plan artifact card in the message is the single live view of build steps.
- **Long-memory picker moved to the composer**: the header brain icon is gone; the long-memory extractor now lives next to the system-prompt preset chip as a bare icon (with a busy spinner), smaller than the surrounding toolbar buttons.
- **Coding panel stays collapsed on file reveal**: when the agent edits/reveals a file, the preview and file-tree toggles are no longer force-enabled — the panel only loads the file into preview state if the section is already open, and no longer reflows the layout (which used to scroll the app back to top).
- **Higher default context for cloud providers**: OpenRouter, NVIDIA, OpenAI and OpenCode Go defaults raised from 128k to 256k tokens.
- **OpenRouter LLM presets refreshed**: added Opus 5, Qwen3.8 Max, Muse Spark 1.2, Ling 3.0 Flash, Nemotron Nano, Cohere North Mini Code; dropped outdated models.
- **Sub-agent long-memory toggle removed**: `USE_FOR_LONG_MEMORY` dropped — long-memory extraction now always follows the main LLM (the sub-agent is vision / coding only). The `memoryEnabled` setting is stripped on load.

### Fixed

- **Thinking bubble follow button**: removed the pin emoji (`📌` / `📍`) from the follow toggle — clean text only.
- **Long-memory picker with OpenCode Go / OpenAI sub-provider**: when extraction ran through a sub-agent provider, `opencode-go` / `openai` now route to their own endpoints instead of falling back to OpenRouter.
- **Coding file tree when no folder selected**: the tree now clears stale files/dirs and shows a clear bold **No folder selected** state instead of leftovers from the previous project.

### Security

- **Closed LAN auth and CORS holes for phone/web access**: every tools-server proxy / data / TTS route (`/tools/*`, `/api/*`, `/tts`) is now gated behind `require_lan_access` — loopback (the desktop) is always allowed, non-loopback callers must present the shared access token (`x-voidcast-access-token` or `Authorization: Bearer`). Removed the invalid `allow_credentials=True` + `["*"]` wildcard-CORS combination (`allow_credentials=False` now); a new `/tools/access-token` endpoint lets the desktop LAN panel fetch the token to embed in the phone URL.

## [2.8.0] — 2026-08-03

### Added

- **Shared agent tools architecture**: tool execution moved out of the Ollama-centric path into a shared catalog + domain handlers (`toolHandlers/` for web, media, coding, app, MCP, image recall) and `agentToolExecutor`, so Ollama / OpenRouter / cloud adapters share one executor. Shared `ChatWithToolsCommonParams` + `buildToolExecutorOptions` in `agentParams.ts` remove duplicated tool-loop wiring.
- **OpenCode Go LLM provider**: OpenAI-compatible chat provider preset (`opencode-go`) with settings, model list, and desktop CORS via the local TTS reverse proxy (`/api/opencode-go/...`). Reasoning fields sanitized for Go; `reasoning_content` round-tripped on tool turns (including empty string when tool_calls are present).
- **Pinned model switcher**: status-bar popup to jump between pinned models; pin IDs scoped with a provider prefix so OpenRouter / NVIDIA / DeepSeek / OpenCode Go no longer collide on the same model slug.
- **PDF/DOCX chat attachment text extraction on drag-and-drop**: renderer sends the file buffer over IPC (`parseChatAttachmentBuffer`); main uses the same `extractTextFromBuffer` path as the native picker (`pdf-parse` / mammoth), so DnD and picker stay in sync. Web-standalone without the bridge still attaches metadata only.
- **Plan-mode research persistence**: research/context from Plan mode carries into the Approve & Build phase instead of being dropped on handoff.
- **`find_symbols` coding tool**: read-only symbol outline (functions, classes, methods, interfaces, types, exports, headings) with 1-based line numbers for a single file. Regex-based per-language heuristics (TS/JS, Python, Go, Rust, Markdown) — zero new deps. Output line numbers mirror `read_file`'s `N|` convention and feed straight into `edit_code` `start_line`/`end_line` anchoring. Supports an optional `query` filter on symbol name and a `max_symbols` cap. Wired through the full pipeline (tool definition → handler → IPC bridge → preload → main), plus the `coding_outline` UI phase, a clear-result digest, Plan-mode read-only allowlist, tool-choice hint, and docs. Available in Plan mode (read-only).
- **`check_types` Python support**: auto-detects Python projects (requirements/pyproject/ruff markers or `.py` paths) and runs **ruff check** first, then **pyright** if ruff is missing. TypeScript/`tsc` path unchanged. Same unified `file:line:col — code: message` report format.
- **Terminal theme**: raw retro CLI amber-phosphor on dark-black — terminal-style scrollbar, cyan/amber highlights, CRT scanline texture, `IBM Plex Mono` monospace, amber `#ffb000` accents, phosphor glow on focused inputs and buttons. Added `uiTheme.css` rules and registered `terminal` in settings and the theme picker.
- **Hardened coding tools — structural digests**: cleared tool results (`git_diff`, `search_files`, `list_directory`) now emit a compact digest (line count, file count, summary) instead of raw multi-thousand-char dumps; Plan mode gets the digest without full text. Git `git_show` gains a `path` parameter for single-file diff; `git_diff` accepts a `path` prefix. `check_types` supports optional `paths` to filter after edits.
- **Hardened coding tools — safer edits**: `edit_code` now requires an exact `find_text` match (no model-invented fuzzy diffs). Fallback strategy: tries exact, then CRLF-expanded, then LF-normalized; on mismatch returns the first 200 chars of the actual file content and a `closest_matches` list with 50-char context lines. `write_file` writes to a temp file and renames (atomic), with auto-closing trailing newline and optional `start_line`/`end_line` range for large files (400 lines or ~25k chars per call).
- **Hardened coding tools — process control**: three new tools `list_processes` (active shell processes with runId, command, status), `stop_process` (kill foreground/background by runId), and `read_process_output` (poll last ~64KB of stdout/stderr with an `offset` for incremental reads). Added `run_in_background` flag to `execute_command` for dev servers/watchers that stay running after printing success. Stdout/stderr ring buffer (~256KB per process).
- **Qwen TTS extras**: Top-level Runware `positivePrompt` (style/emotion) for `customvoice` / `voicedesign`, plus `speech.speed` (0.25–4) and `speech.language` for Qwen models. Playback and bake-phrase preview pass the new settings through. New settings: `runwareXaiPositivePrompt` (string) and `runwareTtsSpeed` (default 1.0).
- **Runware TTS voice catalogs**: synced voice presets from current Runware schemas — full xAI (dropped invalid `auto`), Gemini (30), Inworld 1.5 (~73), MiniMax multilingual library, Fish Audio (+Ethan/Hannah/Egirl). Invalid/legacy voice ids reset to the model default on load.
- **OpenAI Chat Completions provider**: first-class `openai` preset wired through settings, model list, sub-agents, and the LAN proxy (like DeepSeek). `reasoning_effort` is forced to `none` whenever tools are active (OpenAI rejects it with tool calling), and stream usage is requested so the CTX meter can show real token counts.
- **Per-chat system prompt presets**: composer preset chip (`default` / `code` / `creative` / `teacher`) — select a persona per chat session, stored with the session. Presets ship in the chip as a dropup menu styled like the pinned-LLM chips.
- **`check_types` Go + Rust support**: auto-detects Go (`go.mod` / `.go` → `go vet`) and Rust (`Cargo.toml` / `.rs` → `cargo check --message-format=json`), parsing `file:line:col` diagnostics into the same unified report format as TS/`tsc` and Python.
- **`git_restore` / `git_stash` coding tools**: undo a bad edit on a tracked path (`git restore` from the index, or to `HEAD` with `to_head`) and checkpoint without committing (`git stash list / push / pop`). Both are blocked in Plan mode.
- **Turn summary + post-edit working-set patch**: a compact last-turn digest is carried into the next prompt so the agent knows what changed; the file cache is patched after a successful `edit_code` instead of being invalidated wholesale.
- **File digests across turns harvested into Plan research**: session-scoped digests from `read_file` / `find_symbols` / edits survive turn boundaries, so the Build phase reuses Plan knowledge without re-reading whole files.
- **Exploration carried into Plan mode**: on `enter_plan_mode` handoff the coding memo is synced via ref and its digests/summary are injected into the Plan turn, softening explore pressure so Plan mode does not re-read everything from scratch.

### Changed

- **Cloud API key fields collapsed into a provider chip selector**: one dynamic key input with per-provider chips (showing whether a key is set), defaulting to the active LLM provider — replaces the long list of separate key inputs in Options → General.

- **Session folders default collapsed**; coding panel width range widened.
- **Coding panel stays collapsed** when the agent edits files (no auto-expand on every write/edit).

### Fixed

- OpenCode Go desktop chat no longer fails with opaque `Failed to fetch` (missing CORS) — requests go through the TTS proxy.
- OpenCode Go multi-turn / tool-loop 400s from incompatible OpenRouter-style `reasoning` payloads — sanitized + `reasoning_content` echoed on tool turns.
- Pinned-model IDs colliding across providers (same slug on OpenRouter vs NVIDIA / DeepSeek / OpenCode Go).
- Gemini image generation no longer snaps dimensions to multiples of 16.
- Command stdout throttle is flushed before the agent snapshot so the final chunk of a long-running command's output is not lost.

## [2.7.9] — 2026-07-24

### Added

- **Chat keyboard shortcuts**: Ctrl+S to save session, Ctrl+N for new chat, Shift+Tab to toggle Plan/Agent mode.
- **Coding process tracking**: The agent sees active shell processes (foreground/background) as a CTX hint — knows about running dev servers, watchers, and agent-browser sessions.
- **Background process promotion**: Long-lived CLI commands auto-promote to background after 2.5s of idle output; stop button targets only foreground runs.
- **MAX_TOOL_ROUNDS setting**: Configurable in Options → Tools (default 50, range 5–120) with soft wrap-up and hard budget-exhausted fallback.
- **Background processes survive chat switches**: Switching sessions no longer kills background processes — only foreground runs are stopped.
- **App quit cleanup**: Active coding processes are killed on app quit.
- **image_recall decoupled from Runware**: Vision recall is always available regardless of Runware image tool toggle.
- **Sub-agent vision/coding split**: Separate endpoints and provider lock for sub-agent vision and coding.
- **Matrix theme overhaul**: Classic green-black palette with digital code rain.
- **Chat sessions grouped by project folder**: General chats + project-specific groups in the sidebar.
- **Custom Windows title bar**: Cyber-btn header controls replace native caption buttons.
- **OpenRouter/NVIDIA LLM presets refresh**: Updated model catalog.
- **False coding claim reprompting**: Agent is reprompted when it claims completion without real tool calls.
- **OpenRouter provider memory**: Provider slug is remembered per model.

### Changed

- **Composer**: Stop button merged into send button (replaces header diamond mark).
- **Chat sessions sidebar**: Sessions grouped by project folder; General chats at the top.
- **Matrix theme**: Classic green-black with digital code rain.
- **Coding sub-agent**: Uses trim + clear-old-results instead of compress for context management.
- **read_file UX**: No longer auto-reveals the coding panel.

### Fixed

- Long-lived shell commands no longer stall the tool budget.
- OpenRouter provider slug is now correctly remembered per model across chat sessions.

## [2.7.7] — 2026-07-18

### Added

- **MCP client (desktop)**: connect stdio and remote HTTP/SSE servers from `~/.voidcast/mcp.json` (optional project `.mcp.json`). Progressive discovery via `mcp_list_tools` → `mcp_get_tool` → `mcp_call` → `mcp_read_result`; large results spill to disk under `~/.voidcast/mcp-results/`. Per-server enable toggles in Options → Tools.
- **MCP OAuth**: remote servers with `"oauth": true` support browser sign-in (PKCE); tokens stored under `~/.voidcast/mcp-oauth/`. SIGN_IN / SIGN_OUT in the MCP panel.
- **MCP project trust**: untrusted project `.mcp.json` is ignored until you approve **TRUST_PROJECT_MCP** (preview of commands/URLs first).
- **MCP reliability**: reconcile servers when project/enabled map changes (no stale cross-project tools), connect/call timeouts, and chat Stop cancels in-flight MCP calls.
- **Model-aware CTX meter**: cloud providers (OpenRouter / DeepSeek / NVIDIA) use per-model context windows instead of Ollama `llmNumCtx`. DeepSeek V4 Pro/Flash use **1M**; OpenRouter presets include `tencent/hy3-preview` (262K).
- **Custom Windows title bar** with native overlay window controls.

### Changed

- **CONTEXT_WINDOW** setting is shown only for Ollama — cloud providers ignore `num_ctx`; the footer CTX bar uses each model’s native limit (tooltip shows the source).

### Fixed

- TypeScript build: import `OAuthDiscoveryState` from the MCP SDK client auth module.

## [2.7.5] — 2026-07-13

### Added

- **`search_files` ranked harness**: collects up to 2000 raw matches, scores by filename/path/definition-like lines and recent session files, returns contextual blocks (±2 lines, `>>>` markers) with a top-files summary instead of a flat line dump.
- **Bundled ripgrep**: desktop builds ship `@vscode/ripgrep` (`VOIDCAST_RG_PATH` override, then system `rg`, then walk fallback). No manual ripgrep install required on Windows.
- **Shared coding skip list** (`codingProjectSkip.ts`): one source for search, glob, and file-tree exclusions (`release/`, `dist-electron/`, minified/hashed bundles, etc.).
- **`check_types` coding tool**: read-only TypeScript typecheck (`tsc --noEmit`) scoped to the coding project. Supports `path_prefix` for monorepo subfolders (e.g. `electron-app`) and optional `paths` to filter errors after edits. Available in Plan mode. Unit tests for `tsc` output parsing.
- **Unit tests** for search ranking/formatting, project skip rules, Vite dev URL detection, and chat-sessions IndexedDB storage.

### Changed

- **Chat sessions storage**: sessions move from a single `localStorage` JSON blob to **IndexedDB** (`voidcast-chat-sessions-v2`, one record per session + meta). First launch migrates existing chats automatically; the legacy `localStorage` key is kept for rollback. Saves are debounced (~400ms) with a flush on tab hide / unload.
- **`search_files` tool copy** and README: document ranked contextual output and bundled ripgrep.
- **Coding tool hints** and Options → Tools copy: document `check_types` alongside git and shell tools.
- **File tree**: hides `release/` and `dist-electron/` like other generated folders.

### Fixed

- **Settings startup race**: first React paint before Electron preload could treat the desktop shell as LAN web, strip cloud API keys from `localStorage`, and point `ttsBaseUrl`/cloud API bases at the Vite dev server (`localhost:5173`). Detection now falls back to the Electron user agent; desktop save/load never strips secrets; Vite URLs are repaired on load; missing cloud keys show a clear error instead of opaque 401s.
- **Search noise**: `release/`, `dist-electron/`, and Vite/Rollup hashed bundles no longer dominate `search_files` results.
- **Chat layout**: wider assistant bubbles and improved word wrapping in chat markdown and composer.

## [2.7.2] — 2026-07-12

### Added

- **LAN web access toggle + QR**: Options → General → **LAN_WEB_ACCESS** (default off). When enabled, cloud API keys are pushed to the local server for phone clients and the panel shows a QR code / LAN URL (multi-IP select, copy, refresh, keys-registered status). When disabled, registered keys are cleared from the server.
- **Plan mode**: composer toggle **AGENT | PLAN**. In Plan mode the agent explores read-only (no write/edit/shell/media/settings mutations), then ends with a structured plan card — editable title/steps, optional approaches when tradeoffs matter, and **Approve & Build**.
- **Something else…**: on a draft plan card, describe your preferred approach and **Revise plan** — the agent stays in Plan mode and returns an updated plan (does not build yet).
- **Approve & Build**: switches to Agent mode, implements the chosen plan, shows a sticky **Building plan** progress panel, and auto-checks steps as `write_file` / `edit_code` / `execute_command` succeed. Stop/error reopens the plan as draft with **Retry Build**; `built` only when real tool progress happened.
- **Plan persistence**: plan artifacts normalize on session load; interrupted mid-build (`approved`) reopens as draft after reload.
- **Plan mode UI polish**: composer banner, calmer plan card labels, theme-aware empty state in Plan mode, and Minimal/Obsidian styling for plan elements.
- **Pinned sessions sidebar**: chat sessions live in a left column (toggle in header); no overlay navigation menu. Mobile defaults to collapsed under 640px width.
- **Coding file preview syntax highlighting**: highlight.js for source files in preview mode (diff and image preview unchanged).
- **Coding preview inline edit**: **✎ Edit** in the preview header — textarea editor with find/replace (match highlights, **Enter** / **↓** navigation, **Ctrl+G** / **Ctrl+Shift+G**), **Save** / **Cancel**, unsaved-change guard, and Electron focus recovery after native confirm dialogs.
- **Markdown preview in coding panel**: `.md` / `.mdx` files render via `ChatMarkdown` by default; **Source** toggle returns to highlighted raw view.
- **Sub-agent long memory toggle**: `USE_FOR_LONG_MEMORY` in Options → SUB — independent from vision; extract uses the sub-agent model only when this is on.
- **Sub-agent default context**: `CONTEXT_TOKENS` default raised to 64K (65536) for new installs.
- **`image_recall` focus**: optional `focus` argument steers sub-agent vision (what the main agent needs from the image). Cache is keyed per image+focus; generic recalls (no focus) stay backward-compatible.
- **OpenRouter provider lock**: Options → LLM optional **OPENROUTER_PROVIDER** slug below the model — when set, requests use `provider.only` with no fallbacks.
- **Agent-initiated Plan mode** (`ENTER_PLAN_MODE` in Options → Tools): the agent can call `enter_plan_mode` on complex/risky tasks; handoff reuses the same user turn (no duplicate bubble) and preserves attachments.
- **Explicit plan progress**: during Approve & Build the agent calls `update_plan_progress` (step id / 1-based index) to check off steps — file edits no longer auto-advance the checklist.

### Changed

- **Cloud API keys copy**: General options no longer repeats “forwarded for LAN web” under every key — one CLOUD_API_KEYS blurb; LAN details live in the access panel when enabled.
- **Media options tab**: IMAGE and MUSIC tabs merged into one **MEDIA** tab (Image tool + Music tool sections). Tool activity chips use `IMAGE_GEN` / `MUSIC_GEN`. Settings keys and tool names unchanged (`runwareApiKey`, `generate_image`, etc.).
- **Image provider**: Media → Image tool can use **Runware** or **OpenRouter** (same key pattern as TTS). OpenRouter presets include Gemini Flash Image and **GPT Image 2**; per-model width/height/quality profiles. Default: [`google/gemini-3.1-flash-lite-image`](https://openrouter.ai/google/gemini-3.1-flash-lite-image). Runware API base URL removed from options UI (hardcoded default).
- **Plan approaches**: default to a single flat plan; offer 2 (rarely 3–4) approaches only when there are real tradeoffs — no filler A/B/C.
- **OpenRouter LLM presets**: refresh catalog (Fusion, Claude Sonnet 5, GPT-5.6 Sol/Terra/Luna, Grok 4.5, GLM 5.2, Tencent Hy3; drop stale free entries).
- **Composer layout**: full-width textarea, Agent/Plan dropdown in toolbar, commit bar collapsed by default, neutral opaque panel splitters (no neon glow under dividers).
- **Coding preview scrolling**: file and diff views use `pre` layout (no line wrap) with horizontal scroll like a code editor.

### Fixed

- **OpenRouter image crash**: OpenRouter `data:image/...` payloads are saved to disk immediately (user cache or auto-save folder) instead of being held in React state / localStorage; preview uses local paths like Runware CDN images.
- **OpenRouter image options**: quality and dimensions always come from the OpenRouter model profile when that provider is selected (not the Runware model profile).
- **Coding panel survives Options**: chat/coding shell stays mounted while Settings is open — selected file, tree expansion, and preview state are preserved.
- **TTS after Options**: single global `<audio>` element in the app shell (was duplicated per screen; ref stayed null after leaving Options).
- **Sub-agent Ollama routing**: namespaced local models like `sorc/qwen…:9b` (both `/` and `:`) no longer route to OpenRouter. Detection treats OpenRouter route variants (`:free`, `:nitro`, …) as cloud; other `ns/name:tag` ids go to Ollama. Selecting from the SUB model list also stores an explicit `provider`.
- **Sub-agent vision cache short-circuit**: repeat `image_recall` on the same image reuses the session `imageVisionCache` instead of calling the sub-agent API again. History replay behavior is unchanged.
- **Coding image preview**: safer `readImageFile` error handling so TypeScript correctly narrows failure vs success payloads.

## [2.7.1] — 2026-07-09

### Added

- **Agent Skills catalog**: progressive-disclosure system — models see a name/description catalog of installed instruction packs in the system prompt; full `SKILL.md` bodies load on demand via `read_skill`. New **SKILLS** tab in Options panel with RESCAN and skill listing (source, description). Skill source labels (`agents` / `claude` / `cursor` / `project`) shown in the UI and catalog. (Initial global-only discovery: `~/.agents/skills`, `~/.claude/skills`, `~/.cursor/skills`.)
- **Project AGENTS.md / CLAUDE.md**: when a coding project is open, Voidcast injects `AGENTS.md` / `CLAUDE.md` from the project root into the system prompt — repo-wide conventions on every turn.
- **Project-local skills**: skills discovered from `.cursor/skills`, `.claude/skills`, `.agents/skills`, and `skills/` relative to the coding project root. Project skills override globals with the same name.
- **Git status colors in the file tree**: dirty files are color-coded (M=yellow, A=green, D=red, ?=gray, R=magenta, U=orange). File tree header shows branch name + ahead/behind counts.
- **Stage / unstage / discard actions**: inline `+` / `−` / `↶` buttons on each dirty file row in the file tree, plus the same actions in the file preview header.
- **Commit bar**: input + **COMMIT** / **COMMIT ALL** / **DISCARD ALL** buttons below the file tree when changes exist. COMMIT commits only staged files; COMMIT ALL stages everything first (`git add -A`) then commits.
- **Diff preview with line numbers**: clicking a dirty file opens a unified diff (staged or unstaged) with line numbers, `@@` hunk headers, `+` green / `-` red highlighting. Staged/unstaged toggled automatically by the status state.
- **Dirty-only toggle**: "DIRTY N" / "ALL · N" button in the file tree header filters the tree to show only changed files and their parent directories.
- **Resizable chat ↔ coding panel split**: draggable vertical divider between chat and the coding panel, with persisted width (`panelWidthPx` in settings, default 416px, clamped 280–720). Keyboard support: ←/→ (16px step, Shift+32px), Home/End for max/min.
- **Resizable file tree ↔ preview/terminal vertical split**: draggable horizontal divider inside the coding panel between the file tree and the lower sections (preview/terminal/commit bar). Persisted height (`fileTreeHeightPx` in settings, default 220px, clamped 100–480). Keyboard support: ↑/↓ (16px step, Shift+32px), Home/End for max/min.

### Changed

- **Chat typography**: body text and composer now use **IBM Plex Sans** at 15px/1.65 leading (was Rajdhani 14px). Heading tracking adjusted (`tracking-tight` instead of `tracking-wide`). Font families moved to CSS custom properties (`--font-body`, `--font-mono`, `--font-display`) so each theme overrides cleanly — Minimal uses sans-serif, Matrix uses monospace, others use IBM Plex Sans. Rajdhani font removed from Google Fonts imports.
- **Skills catalog hint**: project skills are marked `[project]` in the catalog; added override-global disclaimer.
- **Rediscovery path**: `discoverAgentSkills` and `readAgentSkillBody` accept an optional `projectPath` parameter — electron main process scans project roots first for skill resolution.

### Fixed

- `videos/` directory added to `.gitignore`.

## [2.7.0] — 2026-06-16

### Added

- **DeepSeek LLM provider**: direct OpenAI-compatible API at `https://api.deepseek.com` — presets `deepseek-v4-pro` and `deepseek-v4-flash`, API key in General options, THINKING_LEVEL maps to DeepSeek reasoning mode, full agent tool loop (70 rounds), context compress and long-memory extraction. LAN web clients proxy via TTS server at `/api/deepseek/*`.

### Changed

- **Cloud LLM routing**: shared `cloudLlm.ts` resolves OpenRouter, NVIDIA, and DeepSeek chat config from settings (used by chat agent, context compress, long memory).

### Fixed

- **Chat attachments**: strengthen coding tool hints — tool results injected after attachments so the agent sees the full workspace context. Fixed silent `order_tools` collision with attachment message metadata.
- **Reddit RSS retry**: replaced fragile manual retry loop with `tenacity` (exponential backoff + jitter, respects `Retry-After` header). Raised timeouts for Reddit's slow RSS feeds (45 s fetch / 35 s read).

## [2.6.6] — 2026-06-14

### Added

- **OpenRouter LLM presets**: Kimi K2.7 Code, Qwen3.7 Plus, Qwen3.7 Max, GLM 4.7 Flash, Nemotron 3 Ultra (Free).

### Fixed

- **OpenRouter / NVIDIA tool loop**: raised `MAX_TOOL_ROUNDS` from 18 to 70 (same as Ollama) so long agent turns with many tool calls no longer stop silently with an empty reply.

## [2.6.4] — 2026-06-14

### Added

- **Sub-agent vision in history**: after `image_recall` runs the vision sub-agent, descriptions are saved on the chat session and replayed once in prior-turn context next to the matching image (user attachments and saved generated paths). No duplicate injection in the live catalog block or cache-short-circuit on repeat tool calls.
- **Per-theme chat UX**: empty-state copy and composer placeholder text now match the active UI theme (Minimal, Dystopian, Matrix, Light, Blood Moon, Obsidian).
- **Unit tests** for extracted chat helpers: `chatHints`, `chatImageCatalog`, `runwareMessageMeta`.

### Changed

- **Frontend architecture refactor** (no user-facing behavior change): `App.tsx` is a thin orchestrator; chat and options screens compose dedicated components; state lives in hooks (`useVoidcastApp`, `useChatAgent`, `useChatSessions`, `useChatAttachments`, `useTtsPlayback`, `useSttInput`, `useLongMemoryUi`, `useCodingSession`). Agent tool-result side effects moved to `applyAgentToolResult.ts`.
- **Cloud LLM presets**: OpenRouter and NVIDIA model dropdowns and stored model ID migrations centralized in `cloudLlmPresets.ts` (updated preset lists for 2026 models).
- **OpenRouter requests**: removed automatic retry with `openrouter/free` when the selected model fails — the app now retries only the model you chose (429/502/503/504 backoff unchanged).
- **Obsidian theme**: muted functional accent colors on composer mic, TTS/SPEAK, send, and header controls (`theme-obsidian.css`).

### Fixed

- **Sub-agent model list with OpenRouter LLM**: Ollama models are always loaded from the configured Ollama URL for the SUB options tab, even when the main LLM provider is OpenRouter or NVIDIA.

## [2.6.2]

### Added

- **Cloud TTS model presets** for OpenRouter and Runware in TTS options.

## [2.6.1]

### Added

- **Context compression (chat memory)**: long threads summarize into a hidden session buffer (provider-aware) while the full chat stays in the UI; older turns are omitted from the LLM payload via `contextCompressedThroughIndex`. **AUTO_COMPRESS** toggle in Options → LLM (default on at ~90% `num_ctx`); manual **COMPRESS** remains when auto is off.

### Changed

- **Context compression UX**: with auto-compress on, the yellow COMPRESS/IGNORE banner at ~78% is hidden; a short status line appears only while compressing or waiting for an idle turn. Removed **HISTORY_MESSAGES** from LLM options (always full history in UI).

### Fixed

- **Legacy compressed sessions**: chats with a summary but no compress index are migrated on load so the API does not resend the full thread plus the summary.

## [2.5.9]

### Fixed

- **Reminder / long-memory delete sync**: user-data sync now carries delete timestamps end-to-end and the tools server persists tombstones on disk, so deleted reminders / memories no longer reappear from stale LAN snapshots or after a tools-server restart.
- **Packaged tools-server ownership on Windows**: the installed app now starts only the bundled `voidcast-tools-server.exe` when no local server is already running, and kills the full child process tree on tray **Quit**, so packaged builds no longer leave behind orphan Python/tools-server processes without breaking an external `start-tts-local.bat` server on `:8765`.

### Changed

- **`captureSpawnCommand` refactor** (`electron-app/electron/main/index.ts`): extracted shared spawn wrapper with object parameters, replaced ~80 lines of duplicated logic across `runGitCapture`, `runRipgrepCapture`, and `runCommandCapture`.
- **Reverse-proxy dedup** (`tts-server/main.py`): made `bearer_key` optional in `_reverse_proxy` and simplified `ollama_proxy` to delegate instead of duplicating the full reverse-proxy implementation.

## [2.5.7]

### Added

- **Sub-agent vision**: non-vision main agents can now delegate image description to a separate vision-capable model (Ollama multimodal or OpenRouter). When `image_recall` is called with `purpose: vision`, the sub-agent describes the image and the text result is appended to the tool output — the main agent never sees raw base64.
- **Sub-agent `contextTokens`**: configurable `num_ctx` sent to Ollama sub-agent calls (default 8192, max 128K). OpenRouter ignores this parameter.
- **Sub-agent provider auto-detection**: if the sub-agent model name contains `:` (e.g. `llava:13b`) it routes to Ollama; otherwise it routes to OpenRouter.

### Changed

- **`autoSaveChat` now works as intended**: when ON, new chat sessions are auto-created and saved on the first message (previously only already-saved sessions were auto-updated). When OFF, a save button appears for manual saving; once manually saved, the session auto-updates on subsequent messages.
- **Sub-agent output config**: `maxTokensPerImage` renamed to `outputTokens` (default 300 → 1024). Old key is migrated automatically.
- **Sub-agent prompt**: removed the hardcoded "3 to 5 sentences" limit — `max_tokens` is now the only output cap.
- **Sub-agent UI**: `contextTokens` and `outputTokens` sliders side by side in the same row.

## [2.5.5] — 2026-05-20

### Added

- **Coding context memory persistence and modularization**: extracted `CodingContextMemo` logic from `App.tsx` into a dedicated `codingContextMemo.ts` module with full type safety. Introduced per-project `localStorage` persistence (`voidcast-coding-project-memo-v1`) so recent files, directories, searches, git operations, command history, and failures survive app restarts. Session memory (`recentSearches`, `recentGitOps`) is kept in the active chat; project snapshots (`recentFiles`, `recentFailures`, `recentCommands`, `lastDirectory`) hydrate new chats when the same repo is reopened. `resolveMemoForSession` handles the cross-layer merge. `edit_code` and `write_file` now append `(edited)` / `(written)` labels to `recentFiles`. `execute_command` entries store `{ command, ok, snippet }` with a 150-character output preview (`commandResultSnippet`), so the assistant can see whether `npm run build` succeeded without re-running it. Tool failures are tracked with specific error text and tool name (`recentFailures`). `isCodingToolFailure()` validates failure format per-tool to avoid false positives from normal output. Backward-compatible `normalizeCommandEntry` migrates old string-format command entries.
- **Edit line range tracking**: `edit_code` results now include exact start/end line numbers (e.g. `lines 2102-2104`) parsed from the CRLF-aware `applySnippetEdit` in `codingEol.ts`. `formatEditedFileMemoEntry()` extracts this range and stores `App.tsx (edited lines 2102-2104)` in `recentFiles`, so the assistant knows precisely where changes occurred without re-reading the file.
- **Ollama think levels**: boolean thinking toggle replaced with **off / low / medium / high / on** in LLM options (`settings.ts`, `ollama.ts`).

### Fixed

- **Android / web image attachment**: `splitChatAttachmentFiles` + `probeFileAsImage` decode gallery files with empty `type` or no extension (`createImageBitmap` → `readAsDataURL` fallback). File input snapshot clones via `arrayBuffer()` before `input.value = ''` to stop Android from dropping `File` refs. Web standalone uses a visible `<label>` pointing to `sr-only` input instead of hidden `display: none` + programmatic `click()`. Better error messages guide users to JPEG/PNG on phone (`imageAttachment.ts`, `App.tsx`).
- **Music false image claim guard**: `generate_music_runware` turns no longer trigger the image hallucination reprompt. `isMusicFocusedUserText()` detects music requests; `shouldGuardFalseImageClaims()` skips the guard when the user asked for music. `stripMusicUrlArtifacts()` removes `audio_url:` lines before image claim analysis. `RUNWARE_IMAGE_CDN_RE` tightened to `im.runware` only, excluding `api.runware.ai` (`agentToolUtils.ts`, `agentToolLoop.ts`, `ollamaAgent.ts`, `openrouterAgent.ts`).
- **LAN install + phone web UI**: tools server binds **`0.0.0.0`**; web UI resolves from Electron resources and is bundled in the PyInstaller tools exe and Windows installer (`copy-web-ui-to-install.ps1`, `electron-builder.json`).
- **Reminder toast duplicates after sync**: `notifiedAt` is preserved across LAN/user-data merge and `updatedAt` bumps when a toast fires, so the 30s heartbeat does not re-notify the same reminder.
- **`edit_code` on CRLF files (Windows)**: matches `find_text` with exact, CRLF-expanded, or LF-normalized strategies while preserving on-disk line endings; `read_file` exposes `lineEndings` and adds a model-only CRLF hint.
- **Image catalog + attach vision**: catalog index **1 = current attachment**; vision runs on attach; ordering distinguishes attachments vs generated images more reliably.
- **Forced `web_search`**: uses raw user text only, with tighter freshness heuristics (fewer false triggers).
- **Blood Moon theme validation**: `uiTheme` validation message and tool description now include `blood-moon` as a valid option (`ollamaAgent.ts`, `toolDefinitions.ts`, `App.tsx`).

### Changed

- **Tool-round chat stream**: the in-progress assistant reply text is cleared between model rounds (after tools / forced reprompts), so each stream shows only the current round’s answer. **THINKING** still accumulates across rounds in the same bubble (`---` separators). API history still keeps full turns for the model.

## [2.5.3] — 2026-05-15

### Added

- **Blood Moon theme**: new `blood-moon` interface theme (dark monochrome with red accents) selectable in **Options → General**. Registered in `settings.ts`, `main.tsx`, and `theme-blood-moon.css`.
- **Bidirectional long-memory and reminder sync**: desktop and LAN web can merge entries through the TTS server (`POST /tools/user-data`, `tts-server/user_data.py`). New `userDataSync.ts` orchestrates pull/push; storage layers in `longMemoryStorage.ts` and `reminderStorage.ts` gain merge helpers. Context compression (`contextCompress.ts`) now respects the active LLM provider. Plain-HTTP clients use `makeUuidV4` from `runwareUuid.ts` when `crypto.randomUUID` is unavailable. Launcher script renamed `start-tts.bat` → `start-tts-local.bat`.
- **Shared `NumericSettingInput`**: reusable options control for numeric fields with mobile-friendly steppers (used in Runware image/music panels and LLM/TTS options) instead of raw `<input type="number">` rows.

### Fixed

- **Mobile chat URL overflow**: long Reddit/HTTPS links no longer spill past the message bubble on narrow viewports. `ChatMarkdown` now breaks links and list text (`break-all`, `overflow-wrap: anywhere`, `min-w-0` on flex list rows); message bubbles and the mobile messages scroller clip horizontal overflow.
- **Runware image hallucination guard**: assistant turns that claim an `image_url` without a matching `generate_image` / `edit_image_runware` tool result trigger an automatic reprompt (`agentToolLoop.ts`, `agentToolUtils.ts`). The chat UI only renders Runware images from confirmed tool metadata, not URLs pasted in assistant prose.
- **Chronological image catalog for edit/recall**: tool hints and catalog indexing now follow chat order (1 = newest, including generated images). Generated CDN URLs are fetched into the catalog when not auto-saved; per-turn catalog hints steer the model on which attachment index to pass to `edit_image_runware`.
- **LAN web without local API keys**: phone/tablet web UI strips local secrets from settings and syncs cloud keys (OpenRouter, Runware, etc.) through `tts-server/cloud_secrets.py` so generation still works on the LAN build without embedding keys in the browser bundle.
- **STT disabled on mobile web**: microphone / OpenRouter transcription controls are hidden on phone layouts where recording is unreliable (`platform.ts`).

### Changed

- **Desktop window title**: cleared the Electron `BrowserWindow` title and `index.html` `<title>` so the Windows title bar no longer shows "Voidcast" (the taskbar may still use the executable name from the installer).
- **Header label**: AI panel title renamed to **Void Agent** (was generic "AI").
- **Blood Moon theme polish**: second pass replaced the initial crimson-void palette (heavy gradients, glitch RGB, display fonts) with calmer monochrome (`10 10 12` background) and red reserved for accents only; body uses JetBrains Mono / Inter.
- **Agent tool-call decision making**: removed `shouldRequireToolCall` keyword-matching heuristic from `agentToolUtils.ts`, `ollamaAgent.ts`, and `openrouterAgent.ts`. Both Ollama and OpenRouter agents now pass `mustCallTool: false` to the shared tool loop, letting the model decide autonomously whether to invoke a tool based on the tool descriptions in the system prompt instead of being forced by regex keywords.
- **`TOOLS_TRUTH_HINT` placement and wording**: moved from the end to the **beginning** of the tools hint block in `App.tsx` so it stays in the high-attention region of the system prompt across long sessions. Text tightened to an explicit mandatory rule starting with `Tool-call truth (highest priority):`. Side-effect tool hints (`save_pdf`, music, etc.) gained stronger **MANDATORY** / **CRITICAL** phrasing in the same pass.

## [2.5.2] — 2026-05-14

### Fixed

- **Runware audio `unsupportedParameter` on `settings.guidanceType`**: Runware tightened the allow-list for `audioInference` (2026-05-14) and now rejects requests that include `settings.guidanceType` with `{"code":"unsupportedParameter","allowedValues":"'lyrics','bpm','keyScale','timeSignature','vocalLanguage','coverConditioningScale','repaintingStart','repaintingEnd'"}`. The renderer no longer forwards `guidanceType` in the audio payload (`invokeRunwareGenerateMusic` in `lib/runware.ts`), and the short-lived `GUIDANCE_TYPE` dropdown in `RunwareMusicOptionsPanel` has been removed since it can no longer affect the API. The `runwareMusicGuidanceType` setting is still parsed/normalized so older stored configs continue to load without errors; the value is just dropped at send time.
- **Runware audio `unsupportedCFGScaleForModel` on `CFGScale`**: same 2026-05-14 audio-API rebalance also stripped the top-level `CFGScale` parameter (`{"code":"unsupportedCFGScaleForModel","parameter":"CFGScale"}`), even though their docs still link to a `#request-cfgscale` anchor. `invokeRunwareGenerateMusic` no longer sends `CFGScale`, and the `CFG_SCALE` numeric input in `RunwareMusicOptionsPanel` has been removed (the per-model profile field is kept on disk for back-compat in case Runware reverts).
- **Chat scroll position when returning from Options**: previously the chat `<main>` was unmounted while the Options screen was rendered (`if (screen === 'options') return ...` returns a parallel JSX tree), and the existing save/restore `useLayoutEffect` only captured `scrollTop` *after* the unmount — `chatMessagesRef.current` was already `null`, so it always saved `0` and the next return scrolled to the top. Now the scroll position is tracked continuously via an `onScroll` handler on the chat `<main>` and stored in `savedChatScrollRef`; the `useLayoutEffect` on `screen` change still restores it after the `<main>` re-mounts. Auto-scroll effects on `[messages.length]` and `[busy]` don't refire on screen toggles because their dependencies don't change, so the restored position sticks.

### Changed

- **Ollama transient-error retries**: `streamOllamaChat`, `streamOllamaChatOnce` (agent tool loop), and `fetchOllamaModels` now retry on `408`, `425`, `429`, `500`, `502`, `503`, `504` (e.g. hosted Ollama returning `503 model is temporarily overloaded`). Up to 4 attempts with exponential backoff + small jitter, and honors the `Retry-After` header when the server sends one. Each tool round is wrapped — a transient 503 after a tool call no longer aborts the conversation, the same backoff applies on every model round. Cancellation via the existing `AbortSignal` interrupts both the in-flight request and the backoff sleep, so user stop/regenerate still feels instant. The shared retry helper `fetchOllamaWithRetry` is exported from `ollama.ts` so other call sites can reuse the same policy.
- **`save_pdf` rendering polish (`tts-server/pdf_tool.py`)**:
  - Table cells now parse `**bold**` markers via the rich-text wrapper (bold-aware width metrics), so model names like `**OpenAI GPT-5.5 Pro**` render as bold instead of leaking literal `**` characters into the PDF. Header rows are still forced bold regardless of inline markers.
  - Single-asterisk italics (`*caption*`) are stripped during normalization since no italic font is bundled; `**bold**`, `_snake_case_`, and Python dunders like `__name__` are intentionally left alone (guarded against `\w` neighbors to avoid eating math like `5*4`).
  - Duplicate first-heading suppression: when `content` begins with a markdown heading whose text matches the `title` argument (exact match after whitespace/punctuation folding, or prefix-match in either direction for titles ≥ 12 chars), that heading is dropped so the title-block + body don't show the same line twice.

### Added

- **`save_pdf` image embedding for AI-generated images**: new `image_urls` argument lets the agent pass public http(s) URLs (e.g. the `image_url:` value from a prior `generate_image` / `edit_image_runware` turn) into the same call. The tools server fetches each URL with SSRF protection (http(s) only, blocks loopback/private/link-local/multicast hosts), enforces the shared 48 MB total-image cap, supports PNG/JPEG/WebP, and reports per-URL failures back to the model so it can explain skips. `POST /tools/pdf` endpoint and `PdfRequest` model gain the matching `image_urls` field; `savePdf.ts` forwards it; `TOOLS_PDF_HINT` instructs the agent to copy the URL string from the prior tool turn into this array instead of pasting it into the markdown body.
- **`save_pdf` inline image placement**: standalone markdown image lines inside `content` now position images at that exact spot in the PDF. Use `![caption](attached:N)` for the N-th attached image (0-based, same index space as `attached_image_indices`) or `![caption](url:N)` for the N-th entry of `image_urls`. Any image whose marker isn't written inline still falls back to a trailing gallery so existing callers keep working unchanged.
- **Runware music: ACE-Step v1.5 Base preset** alongside the existing Turbo variant. New `runwareMusicModel` setting plus per-model profile map `runwareMusicModelProfiles` (mirrors how image models are configured): each variant remembers its own `outputFormat`, `durationSec`, `steps`, `cfgScale`, and `seed`. Defaults: Turbo `steps=10` / Base `steps=100` (with `steps` cap raised to 300 for Base). New model dropdown in **Options → Runware Music**; switching variants restores its saved values without touching the other. `invokeRunwareGenerateMusic` now picks the model id from `musicDefaults.model` (validated against the allow-list) and applies the per-model `steps` clamp (20 for Turbo, 300 for Base). Migration: on first load, the Turbo profile inherits the old top-level music fields; the Base profile seeds from Runware docs defaults.
- **Drag-and-drop chat attachments**: drop images (PNG / JPEG / WebP / GIF / BMP / AVIF / TIFF / ICO / HEIC / SVG) and supported files (TXT, MD, PDF, DOCX, CSV, JSON, JS, TS, PY, JAVA, CS, HTML, CSS) directly onto the chat screen. Reuses the same limits as the file picker (4 MB / image, max 4 images per message; max 8 files). Drop overlay with hint, gated while a turn is busy or a message is being edited, and a global `dragover`/`drop` guard so a missed drop never navigates the renderer.
- **Reminder desktop notifications**: scheduled reminders fire a native Windows toast (browser `Notification` API forwarded by Electron) when due. New `Reminder.notifiedAt` field plus `listDueUnnotifiedReminders` / `markReminderNotified` helpers in `reminderStorage.ts`. Renderer ticks every 30 s, deduplicates by `tag = reminder.id`, persists `notifiedAt` so it never refires after a refresh. Clicking the toast focuses the window and opens **Options → General**. New `settings.reminderNotificationsEnabled` (default `true`). General panel exposes the toggle plus a `REQUEST PERMISSION` button when the OS state is `default`, with a help line pointing to Windows Settings when permission is `denied`.
- **Chat notification sounds**: choose local audio files for two events — assistant reply done (`ON_REPLY_DONE`) and chat error (`ON_CHAT_ERROR`). New `lib/notificationSoundStorage.ts` (IndexedDB `voidcast-notification-sounds-v1` keyed by kind, stores `{ blob, fileName, mime }`) and `lib/notificationSounds.ts` (blob-URL cache, `playNotificationSound(kind, { volume })`, `looksLikeAudioFile`, accept list). Settings `notificationSoundsEnabled` (default `true`) and `notificationSoundVolume` (0–1, default `0.8`, clamped in normalizer). `CHAT_SOUNDS` section in General options (placed directly under `INTERFACE_THEME`): master toggle, volume slider, two slots with **PICK FILE / CHANGE**, **▶ PREVIEW**, **CLEAR**, error banner, 2 MB cap, accepted formats MP3 / WAV / OGG / M4A / AAC / FLAC / WebM. The reply sound is suppressed when **Auto-voice** is on and the TTS server is reachable so it does not collide with the spoken reply.

## [2.5.0] — 2026-05-12

### Added

- **Reddit tool**: read-only `reddit_feed` agent tool via the TTS server (`POST /tools/reddit`) using Reddit's public JSON endpoints (no API key, no OAuth).
  - Three modes in one tool: subreddit feed (`subreddit` + `sort` hot/new/top/rising/controversial/best, with `time` window for top/controversial), search (`query`, optionally restricted to a subreddit), and post fetch (`post_url` returns post + top comments).
  - New backend module `tts-server/reddit_tool.py` (httpx + JSON parsing, validates host against an allowlist of `reddit.com` / `redd.it`).
  - New TS client `electron-app/src/lib/redditTool.ts`.
  - Tool definition added to `toolDefinitions.ts` and gated by a new `toolsEnabled.reddit` toggle in `ToolsOptionsPanel`.
  - System hint `TOOLS_REDDIT_HINT` registered in `chatMessages.ts` and applied in `App.tsx` when the toggle is on.
  - New tool phase `reddit` (⬢ icon, Reddit orange `text-orange-400`) wired through `agentToolPhase.ts` and `App.tsx` `TOOL_PHASE_UI`.
- **OpenRouter voice input (STT)**: optional speech-to-text in the chat composer via OpenRouter Whisper (`POST https://openrouter.ai/api/v1/audio/transcriptions`). Enable **STT_PROVIDER** in TTS options (`none` or `openrouter`), set **OPENROUTER_STT_MODEL** (default `openai/whisper-large-v3-turbo`), reuse **OPENROUTER_API_KEY** from General settings, then use the microphone control next to the composer to record (WebM) and append the transcript to the input. New helper module `electron-app/src/lib/stt.ts`; settings fields `sttProvider` and `openrouterSttModel` in `settings.ts`.
- **Fork chat session**: **FORK** on a session row duplicates that session (same messages and hidden context summary), opens the copy with title suffix `(fork)`, clears per-session UI state (images/audio tool metadata), and persists via existing session storage.
- **Export chat to Markdown**: **EXP** button on every session row exports the full conversation as a `.md` file. Includes title, export timestamp, role headers, message content, image/file attachment notes. Sanitizes the filename from the session title.

### Changed

- `reddit_feed` feed/search output now always emits the canonical `post: https://www.reddit.com/r/<sub>/comments/<id>/...` permalink as the primary URL plus a `id=<base36>` field, with external media moved to a secondary `media:` line only when it differs. Previously, video/image posts surfaced only the `v.redd.it` / `i.redd.it` URL, which the agent could not pass back into `post_url` for a deep dive.
- `reddit_feed` `post_url` argument now also accepts a bare base36 post id (e.g. `1t8kumi`) or thing-id form (`t3_1t8kumi`), not just full URLs. Tool description and `TOOLS_REDDIT_HINT` updated to steer the agent toward the `post:`/`id=` values and away from `media:` URLs.
- `reddit_feed` feed/search output now appends a machine-readable `POST_INDEX` recap at the bottom (`[N] id=<base36> — <short title>`). LLMs hallucinate short alphanumeric ids when reasoning over long tool blocks; the recap gives one canonical, easy-to-copy mapping per call so the agent does not need to re-scan the formatted post list.
- `TOOLS_REDDIT_HINT` rewritten with hard rules: never guess/reconstruct an id from memory, never use a `media:` URL as `post_url`, and fall back to `query` search instead of relying on ids from earlier turns once the conversation has moved on.

## [2.4.1] - 2026-05-10

### Added

- **Edit message**: click any user message to edit its text inline; Save truncates history after that message and regenerates the assistant reply from the edited text. Cancel reverts to the original. Edit mode supports Enter (save) and Escape (cancel) shortcuts.
- **Reminder tools**: full CRUD reminder system for agent-driven notes and scheduled reminders.
  - `add_reminder` — create general or scheduled reminders (ISO datetime)
  - `list_reminders` — filter by today, tomorrow, or date ranges
  - `delete_reminder` — remove by ID or search text
  - `update_reminder` — reschedule or edit text/tags by search text
  - New IndexedDB storage layer: `reminderStorage.ts`
  - Tool definitions in `toolDefinitions.ts`, always available (no toggle)
  - Tool execution handlers in `ollamaAgent.ts` `executeToolCall`
  - UI integrated into `GeneralOptionsPanel` with orange accent (same styling as long memory)
  - New `ClockIcon` component in Lucide outline style
  - Tool phase: `reminder` with ⧗ icon and orange styling
  - Agent hints for reminder usage in `App.tsx`
- `update_settings` tool now supports `autoVoice` (boolean) for agent-driven toggling of automatic TTS speech.
- **Native context menu** (Electron): right-click on any page element shows copy/paste/select-all menu. Editable fields get Undo/Redo/Cut/Copy/Paste/Delete/Select All; non-editable text gets Copy/Select All; links get Open Link.
- Shared agent tool-round engine (`agentToolLoop.ts`) with provider adapters for Ollama and OpenRouter/NVIDIA; neutral tool executor entry (`agentToolExecutor.ts`) and shared helpers (`agentToolUtils.ts`).
- System hint `TOOLS_CODING_CHAT_IMAGE_ASSETS_HINT`: explains chat-stored absolute paths for attachments (`imagePaths`) and saved generations (`generatedImagePaths`), and that coding tools can copy those files into the project via `execute_command` when paths lie outside the project root.

### Changed

- Refactored `runOllamaChatWithTools` and `runOpenRouterChatWithTools` to use the shared loop while preserving behavior (forced first-round scrape/web on Ollama, tool reprompts, image recall flows).
- Chat history for prior user turns with images: text now includes index/path hints for `image_recall` instead of resending raw image bytes in every history message (reduces context bloat; aligns with recall-based vision workflow).
- Extended `TOOLS_RUNWARE_IMAGE_HINT` to document text-only older turns and reliance on `image_recall` for pixels from past messages.
- Tool UI: `image_recall` maps to tool phase `vision` with a distinct indicator style (`tool-indicator.vision`); Runware generate/edit remain under `image`.

### Fixed

- **Auto-scroll behavior**: stops forcing scroll-to-bottom during agent streaming; now scrolls only when a new message is added or when the agent finishes (`busy → false`). Users can freely scroll while the assistant is generating.
- **Reminders not loading in General options**: `refreshReminders()` is now called in the same `useEffect` that loads long memories when opening the General tab.
- `update_settings` changes now immediately refresh the React UI state (previously only `localStorage` was updated, so the UI reflected the change only on the next message).
- TTS playback for the current assistant reply now respects an `autoVoice` change made by the agent within the same turn (reads the latest setting from storage instead of a stale closure).
- Added missing `--color-neon-orange` CSS variable across all themes (fixes `.tool-indicator.reminder` Tailwind error).

### Security

- Hardened Electron renderer bridge by removing globally exposed raw `ipcRenderer` access from preload.
- Added explicit, allowlisted `window.voidcast` methods/events for updater and clipboard-TTS flows, and migrated renderer callers to the allowlisted API.
- Removed unused insecure `open-win` IPC handler that created a `BrowserWindow` with `nodeIntegration: true` and `contextIsolation: false`.

## [2.4.0] - 2026-05-08

### Added

- **Thinking / reasoning stream in chat**: assistant messages can show a collapsible **THINKING** block above the reply when the model streams a trace. Ollama uses `think: true` and `message.thinking` chunks (toggle **THINKING_STREAM (Ollama)** in LLM options). OpenRouter/NVIDIA surfaces `reasoning` / `reasoning_content` deltas when the upstream model sends them. History replays `thinking` on Ollama and `reasoning` on OpenRouter for multi-turn agent loops.
- NVIDIA cloud LLM provider support (`integrate.api.nvidia.com`) across settings, UI, and chat execution paths.
- NVIDIA-specific model presets in LLM options (including Z.AI, MiniMax, DeepSeek, Mistral, Moonshot, and Qwen variants) with manual model override support.
- Desktop Electron `llm-chat-proxy` IPC bridge for NVIDIA fallback requests and richer upstream error details.
- OpenRouter LLM presets: `inclusionai/ring-2.6-1t:free`, `baidu/cobuddy:free`, `openrouter/owl-alpha`, `poolside/laguna-m.1:free`.

### Changed

- Agent tool loops (`runOpenRouterChatWithTools`, `runOllamaChatWithTools`): when the user clearly expects a tool-backed action, the assistant cannot finish with plain text alone until at least one tool has actually run; optional short reprompt rounds apply only **before** any tool executes. After a real tool run in the turn, a final text-only reply is allowed (no false “tool not invoked” error).

### Fixed

- NVIDIA base URL normalization now auto-corrects common misconfigurations (missing `/v1` or accidental `/chat/completions` suffix).
- Retry/backoff now also handles transient upstream `502` and `504` failures.
- Post-abort NVIDIA/OpenAI-compatible requests no longer fail from empty assistant turns in history (`Invalid assistant message`).
- Abort flow no longer allows stale in-flight updates to overwrite current chat state (`runId` guard on stream/tool callbacks).

### Repository

- Ignore local `modal-test/` experiment folder via `.gitignore` so scratch Modal/harness files stay out of version control.

## [2.3.9] - 2026-05-04

### Added

- New `agentToolPhase.ts` module with granular UI tool phases for coding operations: `coding_list`, `coding_read`, `coding_write`, `coding_edit`, `coding_search`, `coding_glob`, `coding_git`, `coding_shell`, plus `settings` and `other` phases.
- Tool indicator CSS styles for image, music, coding, settings, and other phase types.
- **Desktop coding tools** (Electron): optional coding project folder, **Tools** toggle + folder picker, and agent-side tools when coding is enabled:
  - **Panel**: right-side coding panel with expandable file tree, read-only file preview, and terminal; tool calls can append to the panel terminal; **Code** icon toggles the panel.
  - **Main-process IPC** (path-confined to the project): `list_directory`, `read_file` (optional `start_line` / `end_line` / `max_chars`, soft whole-file size limit, internal large read for `edit_code`, skips likely binary files), `write_file`, `edit_code`, `search_files` (optional `path_prefix`; **ripgrep** `rg` on PATH for speed, else built-in walk; shared source extension list with `glob_files`), `glob_files` (extension filter), `execute_command` (timeout, optional background), `git_status`, `git_diff` (optional path, optional staged diff), `git_log`, `git_show`.
  - **Agents**: Ollama and OpenRouter `executeToolCall` wiring plus tool definitions for the above; `list_directory` errors surface to the model instead of returning an empty list.
  - **Note:** For fast `search_files` on large trees, install [ripgrep](https://github.com/BurntSushi/ripgrep) and ensure `rg` is on the system `PATH` (optional; the app falls back automatically).

### Changed

- **`save_pdf` PDF rendering moved to the Python tools server** (`POST /tools/pdf`, ReportLab in `tts-server/pdf_tool.py`). Electron no longer uses `pdf-lib`; the desktop/mobile renderer calls the same HTTP endpoint as other tools. PDF output path is resolved on the host running the tools server. Bundled `voidcast-tools-server.exe` PyInstaller build includes `tts-server/fonts` (Noto Sans). Removed npm deps: `pdf-lib`, `@pdf-lib/fontkit`, `@fontsource/noto-sans`.
- **Coding panel UX**: layout and flex behavior, terminal chunking and row cap with autoscroll, file tree refresh after agent file changes and after **RUN**, panel hidden when coding tools are disabled.
- Chat header **long-memory** and **save session** actions are icon-only buttons (shared brain + save-disk SVGs) with tooltips and `aria-label`s instead of `SAVE_MEM` / `SAVE_CHAT` text.
- **General → LONG_MEMORY** and **LLM → NEW_CHATS_USE_LONG_MEMORY** use the same brain icon next to their headings (`BrainIcon` component).
- Composer hint row below the input no longer shows Ollama model count (`NO_MODELS` / `X MODELS`); the row appears only when there are pending attachments or an unsaved session.

## [2.3.7] - 2026-05-01

### Added

- Long-memory MVP for cross-chat personalization:
  - global `Use long memory` control in `General` options,
  - manual `SAVE_MEM` action in chat header to extract and store durable user memory,
  - memory preview with per-item remove before save,
  - basic long-memory manager in `General` options (list + delete).
- IndexedDB-backed long-memory store with relevance-based retrieval (token overlap + recency + importance/confidence weighting).
- Extraction pipeline that asks the model for strict JSON memory candidates and filters low-confidence/sensitive entries.
- New `update_settings` tool for agent-driven config updates of selected fields (system prompt, context window, temperature, theme, Runware image/edit models, image resolution, and `longMemoryAdd` entry writes).

### Changed

- Long-memory enablement now uses a single global setting (`longMemoryDefaultEnabled`) as source of truth across all chats.
- Chat header save label updated from `SAVE` to `SAVE_CHAT` for clarity.
- Strengthened Runware image/music tool descriptions with explicit mandatory-call wording so the assistant is less likely to claim generation without actually invoking `generate_image` / `generate_music_runware`.
- `update_settings` now updates the active Runware model profile resolution (instead of only legacy width/height fields), and accepts `runwareResolution` in `WIDTHxHEIGHT` format.

## [2.3.6] - 2026-04-29

### Added

- Bundled tools-only backend executable in the Windows installer so web search / scrape / YouTube tools work out-of-the-box without requiring a separate Python installation or manual venv setup.
- OpenRouter GPT-4o Mini TTS provider (`openrouter-tts`) using `openai/gpt-4o-mini-tts-2025-12-15` for cloud-based text-to-speech.
- OpenRouter TTS voice selection presets in options (`alloy`, `ash`, `ballad`, `coral`, `echo`, `fable`, `onyx`, `nova`, `sage`, `shimmer`, `verse`, `marin`, `cedar`).

### Fixed

- OpenRouter TTS now correctly forwards API key/model/voice from app settings into synthesis requests.
- OpenRouter TTS requests now enforce `response_format: mp3` and normalize playback blob type to `audio/mpeg` to prevent playback failures.

## [2.3.5] - 2026-04-28

### Added

- OpenRouter provider support for chat streaming and tool-calling flows (parallel to existing Ollama path).
- OpenRouter settings in LLM options: provider switch, base URL, model selection, and preset model profiles with manual override.
- OpenRouter API key field in General options (local-device storage wording + direct key link).
- Automatic retry/backoff handling for OpenRouter `429` and `503` responses, plus fallback to `openrouter/free` after repeated upstream failures.

### Fixed

- Desktop CSP `connect-src` now allows external HTTPS/WSS endpoints, preventing immediate `Failed to fetch` errors for OpenRouter calls.
- OpenRouter renderer request headers trimmed to avoid blocked/forbidden header issues in desktop runtime.

### Changed

- Increased file attachment snapshot truncation limit from `200KB` to `400KB` for chat attachment ingestion, desktop extraction, and persisted session storage.
- Updated General options copy to clarify desktop-local Runware API key storage wording.
- Added direct link in General options to [Runware](https://runware.ai/) for API key setup.
- Tool-round streaming now preserves assistant text in the same chat bubble instead of clearing content between rounds, so post-tool output appends rather than replacing prior analysis.
- Version bump to `2.3.5`.

## [2.3.4] - 2026-04-28

### Added

- Unified `+` attach flow in chat composer that opens a single picker for both images and supported files.
- File attachment snapshots in chat context/history for: `txt`, `md`, `pdf`, `docx`, `csv`, `json`, `js`, `ts`, `py`, `java`, `cs`, `html`, `css`.
- Desktop extraction of `pdf`/`docx` text into attachment snapshot content (with truncation safeguards).

### Fixed

- TTS health status now refreshes correctly when switching provider/API-key so Runware xAI mode no longer shows false OFFLINE.
- Removed repeated file snapshot replay in follow-up turns; snapshots now stay bound to the original attachment message.

### Changed

- Reduced header height and hamburger button size for a tighter chat top bar.
- Set minimal as default UI theme and fallback for unknown theme values.
- Footer system area now prioritizes context usage readout and now shows `CTX` (prompt tokens / context window) plus `OUT` (generated tokens) separately.
- Removed runtime clock display from chat UI.

## [2.3.3] - 2026-04-27

### Added

- `save_pdf` can embed images from the current user message (PNG/JPEG) after the text body, using `embed_attached_images` and/or `attached_image_indices` in the tool call.

## [2.3.2] - 2026-04-27

### Added

- Save PDF formatter now preserves explicit single-line breaks inside blocks.
- Save PDF list parsing now supports:
  - `-`, `*`, and `•` unordered list markers
  - ordered list markers like `1.`, `2.`, ...
  - continuation lines merged into the previous list item

### Changed

- Save PDF list rendering now uses hanging indents for wrapped list content.
- Tool guidance text updated so agents can format PDF content more consistently.

## [2.3.1] - 2026-04-27

### Added

- MIT licensing package for public release prep:
  - root `LICENSE`
  - `THIRD_PARTY_NOTICES.md`
- Expanded `README.md` with:
  - features overview
  - cloud-first usage note
  - roadmap section
  - screenshots section with labeled UI previews
- General settings update controls:
  - `AUTO_UPDATE` toggle
  - manual `CHECK FOR UPDATE` flow when auto-update is off

### Changed

- Options tab labels renamed:
  - `RUNWARE` -> `IMAGE`
  - `RUNWARE_MUSIC` -> `MUSIC`
- Removed mobile QR/LAN block from General options UI (temporarily hidden).
- Footer build label now shows runtime app version via Electron IPC.

### Fixed

- Auto-update toggle now controls actionable update behavior:
  - syncs toggle state to updater runtime
  - supports startup checks when enabled
  - prompts user to install after update download

## [2.2.3] - 2026-04-27

### Changed

- Version bump to `2.2.3`.
- Runtime build version display replaced hardcoded footer text.

## [2.2.2] - 2026-04-27

### Added

- GitHub release publish flow for updater:
  - `electron-builder` GitHub publish config
  - `build:publish` script

### Fixed

- Runware request reliability in desktop app via Electron/main-proxy routing.
- Improved Local TTS guidance and external setup UX messaging.

### Packaging

- Main installer kept lean:
  - includes Electron app + tools-server resources
  - excludes heavy local TTS dependencies/models
- Added split Python entrypoints/dependency profiles for tools-only vs local TTS mode.
