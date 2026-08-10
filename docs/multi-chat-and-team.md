# Multi-chat, Team mode, and coding workers

User-facing overview of concurrent chats and parallel coding workers. Implementation detail lives under [architecture.md](architecture.md), [chat.md](chat.md), [coding.md](coding.md), and [options/subagent.md](options/subagent.md).

---

## Multi-chat (several agents at once)

You can open different sessions in the sidebar and **run agents in more than one chat without stopping the previous one**.

| Behavior | Detail |
| --- | --- |
| Isolation | Each session has its own messages, abort controller, tool phase, media state (`sessionAgentStore`) |
| Cap | Up to **3** concurrent agent runs (`MAX_CONCURRENT_AGENT_RUNS`). Starting a 4th fails with an error until one finishes or you Stop |
| Project / shell | Coding tools freeze **project path**, shell owner, and terminal feed per chat so two chats do not share one shell by accident |
| Different projects | Only **one live coding project** across chats: starting a run in project B while another chat is busy in project A **fails** until that agent stops |
| Same project | **Allowed** — multiple chats may code the same folder at once. Use disjoint files; `run_coding_workers` file locks apply **within one batch only**, not across chats. The agent gets a context hint when a peer is busy on the same path |
| Switching | Leave a busy chat; sidebar shows busy/unread. When a **background** run finishes, the session can show a DONE-style affordance until you open it |
| Draft → save | An unsaved draft run can rekey to a real session id mid-turn when the chat is first saved |
| Stop | Stop only cancels the **active** chat’s agent. Other chats keep running |

**How to try it:** start a long Agent turn in chat A → New chat (or open B) → send in B → both run; open A/B from the sidebar freely.

Related: clipboard image paste, type-while-busy + steer mid-turn (see [CHANGELOG](../CHANGELOG.md) Unreleased), sticky unsaved drafts when auto-save is off.

---

## Agent / Team / Plan

Composer mode cycles **Agent → Ask → Plan → Team** (chip or `Shift+Tab`).

| Mode | Use for | Workers (`run_coding_workers`) | Explore (`coding_explore`) |
| --- | --- | --- | --- |
| **Agent** | Implement yourself; tools full | Optional if coding SUB is on | Yes (coding SUB) |
| **Ask** | Read-only Q&A (no plan card, no edits) | **No** | Yes (map only) |
| **Team** | Multi-file / multi-area: main **orchestrates**, workers implement | Preferred / default path | Light map only; do not replace workers |
| **Plan** | Read-only research + plan card | **No** | Read-only map |
| **Approve & Build** | After Plan | Follows composer: **Team** if Team selected, else **Agent** |

Team and **Ask** do **not** offer `enter_plan_mode` (use Plan in the composer for a plan card). Ask is pure Q&A — switch to Agent/Team for edits.

**Team setup**

1. Options → Tools → coding tools on + project folder set  
2. Options → **SUB** → **ENABLE_CODING_SUB_AGENT** + coding model/provider (same keys as main when using OpenCode Go / cloud)  
3. Composer → **Team**  
4. Ask for multi-area work; main should call `run_coding_workers` early with ≤2 path-disjoint tasks  

---

## Coding workers (`run_coding_workers`)

| | |
| --- | --- |
| Count per call | **1–2** tasks (parallel with each other) |
| Model | Coding sub-agent model (`codingProvider` / `codingModel`) |
| Rounds | Default and max **100** tool rounds per worker (ceiling, not a fixed always-use-all budget) |
| Tools | Read stack + **write_file**, **edit_code**, **execute_command** (no nested workers/explore) |
| `path_prefix` | Optional. When set: **writes/edits must stay under** that file/folder. **Reads** can still use the whole project (char budget). Soft scoping injects for search/list when missing |
| Locks | Two workers writing the same path in **one** `run_coding_workers` call: file lock error for the second. Locks do **not** span chats or batches; shell redirects (`>`) that target a locked path are rejected |
| Main while workers run | Main is **blocked** on that tool call until both digests return (by design — not fire-and-forget) |
| Multiple batches | Main can call `run_coding_workers` again later in the same turn after digests |

**Explore** (`coding_explore`) is separate: read-only nested loop, lower round limit (default 8 / max 12), soft path hints only. See [options/subagent.md](options/subagent.md).

### Analysis card in chat

- Live VISION / EXPLORE / WORKERS progress is a **collapsible card on that turn’s assistant message** (not a floating window).  
- Toggle: Options → SUB → **SHOW_ANALYSIS_IN_CHAT**.  
- When the chat is **saved**, the card **survives app restart** (on that message). Dismiss removes it from the message.  

---

## Quick mental model

```
Multi-chat: Chat A agent ║ Chat B agent  (up to 3)     ← parallel sessions
Within one chat, Team:
  Main  →  [Worker1 ║ Worker2]  → digests → Main again  ← workers parallel; main waits
```

Docs map: product behavior here · tools loop/store in [architecture.md](architecture.md) · panel in [coding.md](coding.md) · SUB options in [options/subagent.md](options/subagent.md).
