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

Project-relative skills, scanned before the global ones so they win on a name clash, live under the chat's coding folder: `.agents/skills`, `.claude/skills`, `.cursor/skills` and `skills/`.

## Panel behavior

`SkillsOptionsPanel` receives `settings` and `setSettings`. When the panel mounts (and when `skillsEnabled` is toggled on), it scans the skill directories via the desktop bridge (`async` scan with `force` refresh). The panel shows:
- whether the catalog was loaded successfully,
- the discovered skill entries with descriptions,
- a refresh button to re-scan the directories.

## Desktop-only note

Agent Skills discovery and the `read_skill` tool are **desktop-only**. In web/standalone builds the skill directories do not exist, so the catalog and `read_skill` tool are not available; the toggle has no effect there. The underlying implementation lives in `electron-app/src/lib/agentSkills.ts`.

## Related settings

- The `read_skill` tool is only registered when `skillsEnabled` is true (alongside the tools enabled via the [Tools](tools.md) tab).
- Skill content is also surfaced to the agent as context hints so it knows which skills exist and when to invoke them.
