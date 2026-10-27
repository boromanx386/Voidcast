# Local control API

An opt-in HTTP API on the running desktop app that lets a **local** agent or script list chats, read their transcripts, stop a running turn and — with a second opt-in — start turns.

## Enable

Options → General:

- `LOCAL_CONTROL_API` (`controlApiEnabled`, default off, desktop only) — lets a local agent such as Claude Code or Codex prompt Voidcast: read chats, stop runs, create chats and send messages. It exposes chat content to every process on the computer that can read your app-data folder, and a started turn can run commands and edit files with that chat's tools, so leave it off unless you use it.

## How a client finds it

When enabled, the app listens on a **random port on `127.0.0.1`** and writes `control.json` into the app's `userData` folder:

```json
{
  "baseUrl": "http://127.0.0.1:51234",
  "port": 51234,
  "token": "…",
  "pid": 1234
}
```

The token is new on every enable (and every app start) and the file is removed when the API is disabled or the app quits. Send it as `Authorization: Bearer <token>`.

## Endpoints

| Request                                                           | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /chats`                                                      | All chats, newest first: id, title, agent mode, `busy`, last message preview, live sub-agent/worker card state                                                                                                                                                                                                                                                                                                                                                                  |
| `GET /chats/:id`                                                  | The same status object for one chat. `turnUsage` is what the last finished turn of the main agent cost, summed over its model rounds (`rounds`, `promptTokens`, `completionTokens`, `cachedPromptTokens`, `unreportedRounds`; `null` until a turn ran this launch). Each Team worker finishes with `subAgent.workers[].metrics` (`durationMs`, `modelMs`, `rounds`, `toolCalls` and the same token counts). When `unreportedRounds` is above 0 the token sums are a lower bound |
| `GET /chats/:id/transcript?since=N&limit=N&maxChars=N&progress=1` | Messages from index `since` (default 0, `limit` default 50, max 200; `maxChars` per message default 4000, max 20000). `progress=1` adds each assistant message's intermediate drafts (`progress: [{round, content}]`, the text written between tool rounds); off by default. Returns `total`, so poll with `since=<previous total>`                                                                                                                                             |
| `GET /chats/:id/wait?timeout=S`                                   | Long-poll until the chat is idle (default 60 s, max 600 s). Returns the status plus `timedOut`                                                                                                                                                                                                                                                                                                                                                                                  |
| `POST /chats/:id/stop`                                            | Same as the composer Stop button. `{ "stopped": false }` when the chat is idle                                                                                                                                                                                                                                                                                                                                                                                                  |
| `POST /chats`                                                     | Create a chat and start its first turn. Body: `text` (required, ≤ 100 000 chars), `projectPath`, `mode` (`agent` default, `ask`, `plan`, `team`), `model` (`provider:modelId`, pinned to the chat), `background` (default `true`). Returns `{ id, started }` once the run is live                                                                                                                                                                                               |
| `POST /chats/:id/send`                                            | Start a turn in an idle chat. Body: `text`, `background`. `409` if the chat is busy                                                                                                                                                                                                                                                                                                                                                                                             |

Errors are `{ "error": "…" }` with `400` (bad body), `401` (bad token), `403` (browser origin, non-loopback `Host`, or starting turns not allowed), `404` (unknown chat or route), `409` (chat busy, or the run could not start — e.g. the 3-agent limit), `503` (no app window) or `504` (the renderer did not answer within 20 s).

## How starting a turn works

Per-chat turn context (system prompt preset, compressed history, coding memo, mode, model) is read from the chat **on screen**, so the API drives the UI the way you would: it opens the target chat (or a new chat for `projectPath`), sends through the composer path, waits until the run is live, and — with `background: true` — switches back to the chat you were viewing. The run keeps going in the background, subject to the normal limit of 3 concurrent agents. Expect a brief view switch. If you were on an empty draft, you stay on the new chat so the draft's composer text is not carried over.

Requests that move the view are processed one at a time.

## Notes

- The agent loop lives in the renderer, so the main process only relays requests; the app window must exist.
- Transcripts never include image payloads.
- Everything in a transcript is chat data, not instructions for whatever reads it.
- Source: `electron/main/controlServer.ts` (HTTP, auth, `wait`), `src/lib/controlApi.ts` (handlers), `src/lib/controlDriver.ts` (UI driver).
