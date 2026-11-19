# Benchmark: Voidcast vs OpenCode

Same models, same provider, same tasks, two agent harnesses. The question: on cheap coding
models, does the harness change the result or the token bill?

## Setup

- **Models:** DeepSeek v4.1 Flash and GLM 5.3 Flash, both through an
  [OpenCode Go](https://opencode.ai) subscription, so both harnesses hit the same endpoint.
- **Voidcast:** Agent mode, think level "on" (sends `reasoning_effort: medium`), built-in
  browser off, started through the [local control API](control-api.md).
- **OpenCode:** CLI 1.19.6, `opencode run` with no `--variant` (sends no `reasoning_effort`).
- **Tokens:** prompt tokens summed over every model round, cached tokens included. Voidcast
  reads them from its turn usage, OpenCode from the `step-finish` parts in its local database.
- **Checks:** the cart and notes tasks are scored by hidden test scripts the agent never
  sees. Breakout is play-tested in a browser.

## Tasks

1. **Cart** (existing repo): two tests fail. Fix the bugs in the source, add
   `Cart.remove(sku, qty = 1)` with its error cases and tests, run `npm test`. Hidden check:
   7 cases.
2. **Breakout** (empty folder): a neon Breakout game in `index.html` + `game.js` +
   `style.css`, no libraries. Glowing paddle and ball, 5 rows of bricks, particles, score and
   3 lives, keyboard or mouse, space to start.
3. **Notes** (existing repo): add tags and search to a small Node HTTP API, validate tags,
   and harden PATCH (keep `id` and `createdAt`, reject an empty title). Hidden check: 11
   cases; the untouched repo passes 1.

## Results

Rounds / prompt tokens. Voidcast numbers are from the current coding prompt (2026-11-19).

| Task | Model | Voidcast | OpenCode | Both pass |
|---|---|---|---|---|
| Cart | DeepSeek | 11 / 186k | 7 / 132k | 7/7 |
| Cart | GLM | 9 / 134k | 8 / 144k | 7/7 |
| Breakout | DeepSeek | 8 / 293k (median of 3: 145k–348k) | 18 / 576k | game works |
| Breakout | GLM | 4 / 65k | 2 / 36k | game works |
| Notes | DeepSeek | 7 / 155k | 8 / 165k | 11/11 |
| Notes | GLM | 10 / 185k | 13 / 259k | 11/11 |
| **Total** | | **1.02M** | **1.31M** | |

- Both harnesses passed every hidden check, and every game ran.
- Voidcast used about 22% fewer prompt tokens in total. Most of the gap is DeepSeek
  Breakout; on the smaller tasks each harness wins some cells.
- Wall times are left out: the two harnesses did not run at the same hour, and the
  provider's speed changed a lot during the day.

## Limits

- One run per cell, except DeepSeek Breakout on Voidcast (3 runs). Agent runs vary: the
  same task and model ranged from 5 to 10 rounds.
- Two models, three small tasks. This says nothing about large repos or frontier models.
- The think levels differ on paper (medium vs none sent). Measured on DeepSeek v4.1 Flash
  through OpenCode Go, reasoning tokens at low, default, high and max overlapped completely
  over 3 runs each, so the level changes little on this model.
- Voidcast had long-term memory on; OpenCode had two MCP servers configured.
