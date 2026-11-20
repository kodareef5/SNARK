// bun agent/main.ts --url ws://localhost:8787/ws --name Scout [--console]
// Joins a running server as one survivor and serves its tools on standard input and output (agent/mcp.ts). Logs go to standard
// error. SNARK_PASSWORD is the server's join password. The key that owns the name is kept in ~/.snark.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { CLOSED_BAD_CONTENT } from "../client/core/session.ts";
import { CORE_CONTENT } from "../content/core.ts";
import { compileContent } from "../shared/content/registry.ts";
import type { ClusterList } from "../client/core/travel.ts";
import { CMD_RESPAWN, CMD_TRAVEL, KEY_BYTES, SESSION_ALIVE, REJECT_CONTENT, REJECT_DENIED, REJECT_FULL, REJECT_KICKED, REJECT_NAME, REJECT_PASSWORD, REJECT_TRAVEL, REJECT_VERSION } from "../shared/net/protocol.ts";
import { Mcp, type Answer, type ToolHost } from "./mcp.ts";
import { GUIDE } from "./guide.ts";
import { RESOURCES } from "./lookup.ts";
import { joinServer } from "./join.ts";
import { Agent, INSTRUCTIONS, toolDefs } from "./tools.ts";
import { TRAVEL_DEFS, nearestTerminal, riseAt, serverNamed, socketOf } from "./travel.ts";

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
  /** The server the agent is on or on its way to, which travel changes. */
  let url = args.url;
  /** A trip under way: the ticket to say hello with, the server left, and what the one arrived at said if it turned the survivor away. */
  let trip: { ticket: Uint8Array; from: string; to: string; refused: string } | null = null;
  /** The cluster as the server last listed it for a trip. */
  let cluster: ClusterList | null = null;

  const enter = async (): Promise<void> => {
    joining = true;
    try {
      const ticket = trip && trip.refused === "" ? trip.ticket : null;
      const session = await joinServer(url, args.name, key, reg, ticket);
      agent = new Agent(session, { console: args.console });
      console.error(`joining ${url} as ${args.name}${ticket ? " with a travel ticket" : ""}`);
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
    // The server let the survivor leave: the same agent says hello at the other with the ticket.
    const left = agent.session.travelled;
    const to = left && cluster?.servers.find((s) => s.world === left.world);
    if (left && cluster && to && !trip) {
      trip = { ticket: left.ticket, from: url, to: to.name, refused: "" };
      url = socketOf(url, cluster, to);
      down = `travelling to ${to.name}`;
      agent = null;
      retryAt = 0;
      return;
    }
    if (agent.session.state !== "closed") return;
    const reason = agent.session.closeReason;
    // Turned away where it arrived: the survivor is given back by the server it left, so the agent goes back there.
    if (trip && trip.refused === "" && reason === REJECT_TRAVEL) {
      trip.refused = agent.session.closeText || "the server turned the survivor away";
      url = trip.from;
      agent = null;
      retryAt = 0;
      return;
    }
    down = reason === REJECT_TRAVEL ? `turned away: ${agent.session.closeText}` : `not connected: ${CLOSED[reason] ?? `reason ${reason}`}`;
    console.error(down);
    agent = null;
    // A dropped link or a full server may mend. The other reasons will be the same next time.
    retryAt = reason === -1 || reason === REJECT_FULL ? now + RETRY_MS : Infinity;
  }, 1000 / 60);

  const refused = (reason: string): Answer => ({ state: "refused", reason });
  const listed = async (): Promise<ClusterList | string> => {
    try {
      const list = (await (await fetch(fileUrl(url, "cluster.json"))).json()) as ClusterList;
      return list.world === 0 ? "this server is in no cluster" : list;
    } catch (err) {
      return `this server did not say which servers are in its cluster: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
  const servers = async (): Promise<Answer> => {
    const list = await listed();
    if (typeof list === "string") return refused(list);
    return { state: "done", here: list.name, world: list.world, servers: list.servers.map((s) => ({ name: s.name, world: s.world, map: s.map, players: s.players, max: s.max, ...(s.why === "" ? {} : { cannot_go: s.why }) })) };
  };
  /**
   * Walks to the nearest obelisk's terminal, asks there to leave for a server, then waits to arrive on it and rises where it
   * chose, or to be given back where it left from.
   */
  const travel = async (a: Record<string, unknown>): Promise<Answer> => {
    if (a.to === undefined) return servers();
    const leaving = agent;
    if (!leaving || leaving.session.state !== "active") return refused(down);
    const list = await listed();
    if (typeof list === "string") return refused(list);
    const to = serverNamed(list, typeof a.to === "string" ? a.to : "");
    if (!to) return refused(`to must name a server of the cluster: ${list.servers.map((s) => s.name).join(", ") || "there is no other running"}`);
    if (to.why !== "") return refused(to.why);
    const me = leaving.session;
    const at = me.world ? nearestTerminal(me.world.structs, me.registry, me.own.x, me.own.z) : null;
    if (!at) return refused("no obelisk's terminal is in sight: walk toward an obelisk, which stands taller than anything near it");
    // A walk answers within 50 s at most and goes on after, so a longer one is waited for here.
    if (Math.hypot(me.own.x - at.x, me.own.z - at.z) > 1.5) await leaving.call("go_to", { x: at.x, z: at.z, wait_s: 50 });
    for (let i = 0; i < 200 && Math.hypot(me.own.x - at.x, me.own.z - at.z) > 1.5 && agent === leaving; i++) await Bun.sleep(500);
    if (Math.hypot(me.own.x - at.x, me.own.z - at.z) > 3) return { ...((await leaving.call("status", {})) ?? {}), state: "blocked", reason: "could not reach the obelisk's terminal" };
    cluster = list;
    trip = null;
    const want = typeof a.rise_at === "string" ? a.rise_at : "";
    /** The trip as the loop above has it by now. */
    const under = (): typeof trip => trip;
    leaving.session.command(CMD_TRAVEL, (w) => {
      w.u16(to.world);
      w.u32(at.ref >>> 0);
    });
    const asked = performance.now();
    for (;;) {
      await Bun.sleep(100);
      const waited = performance.now() - asked;
      const going = under();
      if (!going) {
        // No ticket: the server refuses with a notice, which status has among what was heard.
        if (waited > 10_000) return { ...((await leaving.call("status", {})) ?? {}), state: "blocked", reason: `${list.name} did not let the survivor leave` };
        continue;
      }
      if (agent && agent !== leaving && agent.session.state === "active") {
        const here = agent;
        // An arrival is shown the spawn screen and rises where it chooses, as a player picks a place on it.
        let rose = "";
        for (let i = 0; i < 50 && going.refused === "" && here.session.sessionState !== SESSION_ALIVE && here.session.respawnPoints.length === 0; i++) await Bun.sleep(100);
        if (going.refused === "" && here.session.arriving) {
          const places = here.session.respawnPoints;
          const tick = here.session.serverTick;
          const named = riseAt(places, tick, want);
          const index = named >= 0 ? named : riseAt(places, tick);
          rose = places[index]?.name ?? "";
          const list = here.session.placesList;
          here.session.command(CMD_RESPAWN, (w) => (w.u8(index), w.u8(list)));
          for (let i = 0; i < 50 && here.session.sessionState !== SESSION_ALIVE; i++) await Bun.sleep(100);
        }
        // What it carries is told just after the welcome; the answer waits for it, a few seconds at most.
        for (let i = 0; i < 30 && !here.session.inventory; i++) await Bun.sleep(100);
        const turned = going.refused;
        trip = null;
        const now = (await here.call("status", {})) ?? {};
        return turned === "" ? { ...now, state: "done", left: list.name, arrived: to.name, map: to.map, rose_at: rose } : { ...now, state: "blocked", reason: `${to.name} turned the survivor away: ${turned}`, back_on: list.name };
      }
      if (waited > 120_000) return { state: "blocked", reason: `left ${list.name} and has not arrived: ${down}` };
    }
  };
  const host: ToolHost = {
    list: () => [...toolDefs(args.console), ...TRAVEL_DEFS],
    call: (name, a, ctx) => (name === "travel" ? travel(a) : agent ? agent.call(name, a, ctx) : toolDefs(args.console).some((d) => d.name === name) ? Promise.resolve(refused(down)) : null),
    resources: () => RESOURCES,
    // The guide needs no survivor; the rest are read from the content the server tuned, once joined.
    read: (uri) => (agent ? agent.read(uri) : uri === "snark://guide" ? GUIDE : null),
  };
  const write = (line: string): void => void process.stdout.write(line + "\n");
  const mcp = new Mcp(host, "snark", INSTRUCTIONS, write);
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    void mcp.handle(line).then((out) => {
      if (out !== null) write(out);
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
