// bun agent/main.ts --url ws://localhost:8787/ws --name Scout [--console]
// Joins a running server as one survivor and serves its tools on standard input and output (agent/mcp.ts). Logs go to standard
// error. SNARK_PASSWORD is the server's join password. The key that owns the name is kept in ~/.snark.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { CLOSED_BAD_CONTENT, ClientSession } from "../client/core/session.ts";
import { CORE_CONTENT } from "../content/core.ts";
import { defaultLook } from "../shared/anim/look.ts";
import { compileContent } from "../shared/content/registry.ts";
import { KEY_BYTES, REJECT_CONTENT, REJECT_DENIED, REJECT_FULL, REJECT_KICKED, REJECT_NAME, REJECT_PASSWORD, REJECT_VERSION } from "../shared/net/protocol.ts";
import { parseManifest } from "../shared/pack/manifest.ts";
import { mapHeightfield, mapNodes, parseMap } from "../shared/world/mapfile.ts";
import { Mcp, type ToolHost } from "./mcp.ts";
import { connect } from "./socket.ts";
import { Agent, INSTRUCTIONS, toolDefs } from "./tools.ts";

export interface Args {
  url: string;
  name: string;
  console: boolean;
}

/** The arguments, or a line saying what is wrong with them. */
export function parseArgs(argv: readonly string[]): Args | string {
  const args: Args = { url: "ws://localhost:8787/ws", name: "", console: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = argv[i + 1];
    if (a === "--console") args.console = true;
    else if ((a === "--url" || a === "--name") && value !== undefined) {
      if (a === "--url") args.url = value;
      else args.name = value;
      i++;
    } else return `${a} is not an argument, or lacks its value`;
  }
  // The server's own rule for a name, which is also what makes it safe in a file name.
  if (!/^[A-Za-z0-9 _-]{1,24}$/.test(args.name)) return "--name is needed: 1 to 24 letters, digits, spaces, _ or -";
  if (!/^wss?:\/\//.test(args.url)) return "--url must begin ws:// or wss://";
  return args;
}

/** The device key that owns `name`, kept in `dir`: 16 random bytes in hex, made on first use and readable by its owner alone. */
export function loadKey(dir: string, name: string): Uint8Array {
  const file = join(dir, `agent-${name}.key`);
  const key = new Uint8Array(KEY_BYTES);
  if (existsSync(file)) {
    const hex = readFileSync(file, "utf8").trim();
    if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error(`${file} does not hold a key`);
    for (let i = 0; i < KEY_BYTES; i++) key[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return key;
  }
  crypto.getRandomValues(key);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(file, Array.from(key, (b) => b.toString(16).padStart(2, "0")).join("") + "\n", { mode: 0o600 });
  return key;
}

/** Where the server whose socket is at `url` serves a file, such as its asset manifest or what names its map. */
export function fileUrl(url: string, file: string): string {
  return new URL(file, url.replace(/^ws/, "http")).href;
}

const RETRY_MS = 5000;
/** Why a session closed. -1 and -2 are ClientSession's own: the link dropped, and the map is not one this client has. */
const CLOSED: Record<number, string> = {
  [-1]: "the connection closed",
  [-2]: "the server runs a map or a protocol this build does not have",
  [CLOSED_BAD_CONTENT]: "this build's content is not the server's",
  [REJECT_VERSION]: "the server speaks another protocol version",
  [REJECT_CONTENT]: "this build's content or clips are not the server's",
  [REJECT_FULL]: "the server is full",
  [REJECT_NAME]: "the name is in use or not allowed",
  [REJECT_DENIED]: "the server refused the login: the name belongs to another key, or it lets nobody in now",
  [REJECT_KICKED]: "kicked",
  [REJECT_PASSWORD]: "the server asks a password, and SNARK_PASSWORD was not it",
};

async function main(): Promise<void> {
  // Standard output carries the protocol and nothing else.
  console.log = console.error;
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === "string") {
    console.error(`${args}\nusage: bun agent/main.ts --url ws://host:8787/ws --name Name [--console]`);
    process.exit(2);
  }
  const key = loadKey(join(homedir(), ".snark"), args.name);
  const reg = compileContent(CORE_CONTENT).registry!;

  let agent: Agent | null = null;
  /** Why there is no agent, for whoever calls a tool meanwhile. */
  let down = "still connecting";
  let joining = false;
  let retryAt = 0;

  const enter = async (): Promise<void> => {
    joining = true;
    try {
      const get = async (file: string): Promise<Response> => {
        const res = await fetch(fileUrl(args.url, file));
        if (!res.ok) throw new Error(`asked for ${file} and got ${res.status}`);
        return res;
      };
      // The server poses bodies with the clips of the pack it serves, and wants the same of whoever joins.
      const clipHash = parseManifest(await (await get("assets/manifest.json")).text()).clipHash;
      // It names its map's file, which holds the ground and where the trees and rocks stand.
      const named = (await (await get("map.json")).json()) as { file: string };
      const map = parseMap(new Uint8Array(await (await get(named.file)).arrayBuffer()));
      const hf = mapHeightfield(map);
      const session = new ClientSession(connect(args.url), {
        name: args.name,
        key,
        registry: reg,
        clipHash,
        look: defaultLook(),
        password: process.env.SNARK_PASSWORD ?? "",
        resolveMap: (id, hash) => (id === map.id && hash === map.hash ? hf : null),
        nodes: (ground, content) => mapNodes(map, ground, content),
      });
      agent = new Agent(session, { console: args.console });
      console.error(`joining ${args.url} as ${args.name}`);
    } catch (err) {
      down = `the server cannot be reached: ${err instanceof Error ? err.message : String(err)}`;
      console.error(down);
      retryAt = performance.now() + RETRY_MS;
    }
    joining = false;
  };

  setInterval(() => {
    const now = performance.now();
    if (!agent) {
      if (now >= retryAt && !joining) void enter();
      return;
    }
    agent.tick(now);
    if (agent.session.state !== "closed") return;
    const reason = agent.session.closeReason;
    down = `not connected: ${CLOSED[reason] ?? `reason ${reason}`}`;
    console.error(down);
    agent = null;
    // A dropped link or a full server may mend. The other reasons will be the same next time.
    retryAt = reason === -1 || reason === REJECT_FULL ? now + RETRY_MS : Infinity;
  }, 1000 / 60);

  const host: ToolHost = {
    list: () => toolDefs(args.console),
    call: (name, a) => (agent ? agent.call(name, a) : toolDefs(args.console).some((d) => d.name === name) ? Promise.resolve({ state: "refused", reason: down }) : null),
  };
  const mcp = new Mcp(host, "snark", INSTRUCTIONS);
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    void mcp.handle(line).then((out) => {
      if (out !== null) process.stdout.write(out + "\n");
    });
  });
  const leave = (): void => {
    agent?.session.close();
    process.exit(0);
  };
  lines.on("close", leave);
  process.on("SIGINT", leave);
  process.on("SIGTERM", leave);
}

if (import.meta.main) await main();
