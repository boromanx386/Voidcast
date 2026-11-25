# Benchmark: cheap models on real tasks

Can a cheap coding model, driven by Voidcast, finish real work? Three small tasks, two
low-cost models, hidden checks the agent never sees.

## Setup

- **Models:** DeepSeek v4.1 Flash and GLM 5.3 Flash, both through an
  [OpenCode Go](https://opencode.ai/docs/go) subscription (from $10/month).
- **Voidcast:** Agent mode, think level "on" (sends `reasoning_effort: medium`), built-in
  browser off, started through the [local control API](control-api.md).
- **Tokens:** prompt tokens summed over every model round, cached tokens included, read from
  Voidcast's turn usage.
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

Rounds / prompt tokens, with the current coding prompt (2026-11-19).

| Task | Model | Rounds / prompt tokens | Result |
|---|---|---|---|
| Cart | DeepSeek | 11 / 186k | 7/7 hidden checks |
| Cart | GLM | 9 / 134k | 7/7 hidden checks |
| Breakout | DeepSeek | 8 / 293k (3 runs: 145k–348k) | game works |
| Breakout | GLM | 4 / 65k | game works |
| Notes | DeepSeek | 7 / 155k | 11/11 hidden checks |
| Notes | GLM | 10 / 185k | 11/11 hidden checks |

- Every task passed its hidden checks, and every game ran.
- All six cells together used about 1M prompt tokens.
- Breakout was run three times on DeepSeek; the other cells are single runs, so read them as
  typical, not exact.
- Wall times are left out: the provider's speed changed a lot during the day.
