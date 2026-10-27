# Security

Voidcast is an AI agent that can run shell commands, edit files, drive a browser and
call external APIs on your behalf. This page explains what it can reach, where your
secrets live, and how to report a vulnerability.

## Supported versions

Only the latest release gets security fixes. The desktop app updates itself on Windows
and on the Linux AppImage; `.deb` installs must be updated by hand.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private
reporting instead: **Security → Report a vulnerability** on
[the repository](https://github.com/boromanx386/Voidcast/security/advisories/new).

Include the version, your OS, steps to reproduce and what an attacker gains. Voidcast is
maintained by one person, so expect a first reply within about a week. Fixes ship as a
new patch release and are credited in the CHANGELOG unless you ask otherwise.

## What the agent can do

The trust model is simple: **the agent acts with your user account's permissions.**

- **Shell.** In **Agent** and **Team** modes, `execute_command` runs commands in the
  open project folder without asking first. It is not sandboxed — a command can reach
  anything your user account can. **Ask** and **Plan** modes are read-only and block
  shell, file writes and mutating MCP calls.
- **Files.** The file tools (`read_file`, `write_file`, `edit_code`, …) refuse paths that
  resolve outside the project root. This guards against mistakes, not against a shell
  command that writes elsewhere.
- **Prompt injection.** Web pages, scraped text, PDFs, YouTube transcripts, MCP results
  and files in a repo all reach the model as input. A hostile page can try to talk the
  agent into running a command. Use Ask or Plan mode when you work with content or
  repositories you do not trust, and read what the agent proposes before you build.
- **Built-in browser.** Site permissions are denied by default (only fullscreen,
  sanitized clipboard writes and pointer lock are allowed) and downloads go to
  `<project>/.voidcast/browser/downloads/`, never your OS downloads folder.
- **MCP servers.** A server you add runs with your permissions. Only add servers you
  trust. OAuth tokens for remote servers are stored under `~/.voidcast/mcp-oauth/`.

## Where secrets live

- **API keys** are encrypted with your operating system's key store (Electron
  `safeStorage`: DPAPI on Windows, the Secret Service keyring such as GNOME Keyring or
  KWallet on Linux) and saved in `secrets.json` in the Electron `userData` folder. Only
  your OS user account can decrypt them; a copied file is useless on another machine or
  account. Malware running as your user can still ask the OS to decrypt them, as with any
  desktop app.
- **Linux without a keyring:** Electron would fall back to a hardcoded password, which is
  not real encryption, so Voidcast keeps the keys in the app's local storage
  unencrypted, as older versions did. Install and unlock a keyring to get encryption.
- **Other settings** stay in the app's local storage, unencrypted. Voidcast has no
  account system and no telemetry; keys are only sent to the provider you configured.
- **LAN web UI** (off by default). When **LAN_WEB_ACCESS** is on, the desktop app
  registers your keys with the local tools server so a phone can use them, and turning it
  off clears them. Phones authenticate with a shared access token that travels over plain
  HTTP on your network. Use it only on a network you trust or over a private VPN such as
  Tailscale, and **never port-forward 8765 to the internet**.
- **Control API** (off by default). It listens on a random port on `127.0.0.1` only,
  requires a bearer token that changes on every start, and rejects browser origins and
  non-loopback `Host` headers. The token is written to `control.json` in `userData`
  and removed when the API is disabled or the app quits.

## Out of scope

- Anything an agent does after you asked it to, in Agent or Team mode, with commands
  your account is allowed to run.
- Attacks that need someone already on your LAN while LAN web access is on, beyond what
  is described above.
- Vulnerabilities in third-party providers, models or MCP servers — report those to
  their maintainers.
