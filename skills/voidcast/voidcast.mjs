#!/usr/bin/env node
// Thin CLI over the Voidcast local control API. Reads port + token from
// control.json at call time (both change on every app start), prints JSON.
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const USAGE = `Usage: node voidcast.mjs <command> [args]
  list
  get <id>
  transcript <id> [--since N] [--limit N] [--max-chars N] [--progress]
  wait <id> [seconds]                     long-poll until idle (default 60, max 600)
  stop <id>
  create [--mode agent|ask|plan|team] [--project <dir>] [--model <provider:model>] [--foreground] <text...>
  send <id> [--foreground] <text...>
Text may be "-" to read it from stdin.`;

function controlFile() {
  if (process.env.VOIDCAST_CONTROL_FILE)
    return process.env.VOIDCAST_CONTROL_FILE;
  const base =
    process.platform === "win32"
      ? process.env.APPDATA
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support")
        : (process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"));
  return path.join(base ?? "", "voidcast", "control.json");
}

function die(message, code = 1) {
  console.error(message);
  process.exit(code);
}

let info;
try {
  info = JSON.parse(readFileSync(controlFile(), "utf8"));
} catch {
  die(
    `No control.json at ${controlFile()}. Start Voidcast and enable Options → General → LOCAL_CONTROL_API.`,
  );
}

async function call(method, route, body, timeoutMs = 30_000) {
  let res;
  try {
    res = await fetch(info.baseUrl + route, {
      method,
      headers: {
        authorization: `Bearer ${info.token}`,
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    die(
      `Cannot reach Voidcast at ${info.baseUrl} (${error.cause?.code ?? error.name}). The app may be closed; control.json is stale.`,
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) die(`HTTP ${res.status}: ${data.error ?? "request failed"}`, 2);
  return data;
}

// Tiny flag parser: --name value, boolean flags listed in `bools`.
function parse(args, bools = []) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
      if (bools.includes(name)) flags[name] = true;
      else flags[name] = args[(i += 1)];
    } else rest.push(a);
  }
  return { flags, rest };
}

async function textFrom(parts) {
  if (parts.length === 1 && parts[0] === "-") {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return Buffer.concat(chunks).toString("utf8").trim();
  }
  return parts.join(" ").trim();
}

const [cmd, ...args] = process.argv.slice(2);
const enc = encodeURIComponent;
let out;

switch (cmd) {
  case "list":
    out = await call("GET", "/chats");
    break;
  case "get":
    out = await call("GET", `/chats/${enc(args[0] ?? die(USAGE))}`);
    break;
  case "transcript": {
    const { flags, rest } = parse(args, ["progress"]);
    const q = new URLSearchParams();
    if (flags.since) q.set("since", flags.since);
    if (flags.limit) q.set("limit", flags.limit);
    if (flags["max-chars"]) q.set("maxChars", flags["max-chars"]);
    if (flags.progress) q.set("progress", "1");
    out = await call(
      "GET",
      `/chats/${enc(rest[0] ?? die(USAGE))}/transcript?${q}`,
    );
    break;
  }
  case "wait": {
    const id = enc(args[0] ?? die(USAGE));
    // Node's fetch drops a response whose headers take over 300 s, so long waits go in slices.
    let left = Math.min(Math.max(Number(args[1] ?? 60) || 60, 1), 600);
    do {
      const slice = Math.min(left, 240);
      out = await call(
        "GET",
        `/chats/${id}/wait?timeout=${slice}`,
        undefined,
        (slice + 15) * 1000,
      );
      left -= slice;
    } while (out.timedOut && left > 0);
    break;
  }
  case "stop":
    out = await call("POST", `/chats/${enc(args[0] ?? die(USAGE))}/stop`);
    break;
  case "create": {
    const { flags, rest } = parse(args, ["foreground"]);
    const text = await textFrom(rest);
    if (!text) die(USAGE);
    out = await call(
      "POST",
      "/chats",
      {
        text,
        mode: flags.mode ?? "agent",
        ...(flags.project ? { projectPath: flags.project } : {}),
        ...(flags.model ? { model: flags.model } : {}),
        ...(flags.foreground ? { background: false } : {}),
      },
      60_000,
    );
    break;
  }
  case "send": {
    const { flags, rest } = parse(args, ["foreground"]);
    const id = rest.shift() ?? die(USAGE);
    const text = await textFrom(rest);
    if (!text) die(USAGE);
    out = await call(
      "POST",
      `/chats/${enc(id)}/send`,
      { text, ...(flags.foreground ? { background: false } : {}) },
      60_000,
    );
    break;
  }
  default:
    die(USAGE, cmd ? 1 : 0);
}

console.log(JSON.stringify(out, null, 2));
