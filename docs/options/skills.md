# Skills Tab

> Grounded in `electron-app/src/components/options/SkillsOptionsPanel.tsx` and `electron-app/src/lib/settings.ts`.

<p align="center">
  <img src="https://raw.githubusercontent.com/boromanx386/Voidcast/main/demos/voidcast-options-skills.png" width="720" alt="Options → Skills tab"/>
</p>
<p align="center"><em>Options → Skills.</em></p>

## Enable Agent Skills (`skillsEnabled`)

Type: `boolean`, default `true`.

When enabled, the app discovers **Agent Skills** from the standard skill directories and exposes:
- a **skills catalog** (list of discovered skills, their names, descriptions, and readme/usage hint), and
- a **`read_skill` tool** that the chat agent can call to read a skill's content before using it.

## Discovery directories

Global skills are discovered from one per-user directory (desktop app):

- `~/.agents/skills`

The panel lists the skills found there (each skill is typically a folder containing a SKILL.md plus supporting files).

`~/.claude/skills` and `~/.cursor/skills` are **not** scanned. Skill-pack installers write the same folder into every agent root they detect, so reading all three listed one skill three times while only the first copy in scan order (`.agents`) was reachable — and duplicated skills were silently deduplicated by name. Install (or copy) a skill into `~/.agents/skills` to make it visible here.

Project-relative skills, scanned before the global ones so they win on a name clash, live under the chat's coding folder: `.agents/skills`, `.claude/skills`, `.cursor/skills` and `skills/`. They follow the same trust rule as `AGENTS.md` below: for an untrusted project they are listed in the panel as "not loaded — untrusted", left out of the skills catalog, and `read_skill` cannot open them.

## Panel behavior

`SkillsOptionsPanel` receives `settings` and `setSettings`. When the panel mounts (and when `skillsEnabled` is toggled on), it scans the skill directories via the desktop bridge (`async` scan with `force` refresh). The panel shows:
- whether the catalog was loaded successfully,
- the discovered skill entries with descriptions,
- a refresh button to re-scan the directories.

## What the agent sees

The catalog hint gives one line per skill: its scope (`[project]` overrides `[global]`) and its **folder path**, so the agent can say where a skill lives and which file it is following. The agent is **read-only** here — no tool writes a skill. Creating one means writing `~/.agents/skills/<name>/SKILL.md` yourself: YAML frontmatter with `name` and `description`, then the markdown body.

## Project instructions (`AGENTS.md` / `CLAUDE.md`)

With coding tools on and a project folder bound, the project root's `AGENTS.md` / `CLAUDE.md` go into the system prompt's `<project_instructions>` section — **only if the project is trusted**. A cloned repository could otherwise steer an agent that has `execute_command`. Trust uses the same list as project `.mcp.json` (`mcpTrustedProjectPaths`), so trusting a project here also lets its `.mcp.json` load, and the reverse.

For an untrusted project with instruction files or project skills, the panel marks them "not loaded — untrusted" and shows a **TRUST_PROJECT** button. The model gets only the file names and a note that they were skipped, so it can tell you why repository conventions are missing.

Binding a folder never asks about trust. Instead, the coding panel shows a yellow bar under the folder path when an untrusted folder has something that was skipped (`AGENTS.md` / `CLAUDE.md`, project skills, or `.mcp.json` servers while MCP is on). **TRUST** adds the folder to the trust list; **Not now** hides the bar for that folder until the app restarts. Trust is per exact folder: every chat bound to it is trusted, but subfolders and parent folders are not.

## Desktop-only note

Agent Skills discovery and the `read_skill` tool are **desktop-only**. In web/standalone builds the skill directories do not exist, so the catalog and `read_skill` tool are not available; the toggle has no effect there. The underlying implementation lives in `electron-app/src/lib/agentSkills.ts`.

## Related settings

- The `read_skill` tool is only registered when `skillsEnabled` is true (alongside the tools enabled via the [Tools](tools.md) tab).
- Skill content is also surfaced to the agent as context hints so it knows which skills exist and when to invoke them.
