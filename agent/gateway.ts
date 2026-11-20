// bun agent/gateway.ts --url ws://localhost:8787/ws [--port 8771] [--host 127.0.0.1]
// The grunt protocol (grunt/protocol.md) for a SNARK server, at ws://host:port/grunt. Each client that says hello joins
// the server as the survivor it names (the key that owns the name kept in ~/.snark, as the agent's), and plays it
// through the headless client a browser's inputs drive (agent/grunt.ts): one connection, one survivor; as many as the
// server lets in. SNARK_PASSWORD is the server's join password. Logs go to standard error.

import { join } from "node:path";
import { homedir } from "node:os";
import { Endpoint } from "../grunt/endpoint.ts";
import type { Capabilities, Limits } from "../grunt/protocol.ts";
import { CORE_CONTENT } from "../content/core.ts";
import { compileContent } from "../shared/content/registry.ts";
import { SESSION_ALIVE } from "../shared/net/protocol.ts";
import { SnarkWorld } from "./grunt.ts";
import { joinServer } from "./join.ts";
import { loadKey } from "./main.ts";
import { Agent } from "./tools.ts";

export const SNARK_LIMITS: Limits = { max_duration_ms: 2000, leash_ms: 3000, max_rate_hz: 20, act_per_s: 20, command_memory_s: 600 };
export const SNARK_CAPABILITIES: Capabilities = {
  channels: ["self", "entities", "terrain", "inventory", "chat"],
  controls: ["move", "look", "jump", "crouch", "stop", "interact", "use", "select", "items", "craft", "chat", "assist"],
  events: ["hurt", "died", "chat", "notice", "struck"],
  verbs: ["open", "close", "harvest", "mount", "dismount"],
  // The agent's own tasks, worked with a player's inputs a tick at a time: its turning and its aim are its controller's.
  assists: { kinds: ["attack", "harvest", "follow"], reaction_ms: 100, spread_deg: 2 },
};

interface Args {
  url: string;
  port: number;
  host: string;
}

function args(argv: readonly string[]): Args | string {
  const a: Args = { url: "", port: 8771, host: "127.0.0.1" };
  for (let i = 0; i < argv.length; i += 2) {
    const [k, v] = [argv[i], argv[i + 1]];
    if (v === undefined) return `${k} wants a value`;
    if (k === "--url") a.url = v;
    else if (k === "--port") a.port = Number(v);
    else if (k === "--host") a.host = v;
    else return `unknown ${k}`;
  }
  return a.url ? a : "--url is needed";
}

interface Link {
  send: (m: unknown) => void;
  world: SnarkWorld | null;
  conn: { receive(raw: unknown): void; close(): void } | null;
  endpoint: Endpoint | null;
  /** What came while joining: given to the endpoint once the survivor is in. */
  waiting: string[];
  joining: boolean;
}

const VALID_NAME = /^[A-Za-z0-9 _-]{1,24}$/;

/** Joins the server as `name` and waits until the survivor has a body (rising at the first place offered if it has none). */
async function survivor(url: string, name: string): Promise<SnarkWorld> {
  const reg = compileContent(CORE_CONTENT).registry!;
  const session = await joinServer(url, name, loadKey(join(homedir(), ".snark"), name), reg);
  const agent = new Agent(session);
  const world = new SnarkWorld(agent, name);
  const t0 = performance.now();
  // Stepped here until in: the session needs ticking to say hello and hear the welcome.
  await new Promise<void>((done, fail) => {
    const timer = setInterval(() => {
      world.step(performance.now());
      if (session.state === "closed") return clearInterval(timer), fail(new Error(`the server closed the session (${session.closeReason}${session.closeText ? `: ${session.closeText}` : ""})`));
      if (session.state === "active" && session.world) {
        if (session.sessionState === SESSION_ALIVE) return clearInterval(timer), done();
        // No body yet (new, or dead): rise at the first place offered, as a new player picks one.
        if (performance.now() - t0 > 1500 && !(world as unknown as { rising?: boolean }).rising) {
          (world as unknown as { rising?: boolean }).rising = true;
          void agent.call("rise", { place: 0 });
        }
      }
      if (performance.now() - t0 > 30_000) clearInterval(timer), fail(new Error("no body after 30 s"));
    }, 1000 / 60);
  });
  return world;
}

async function main(): Promise<void> {
  console.log = console.error;
  const a = args(process.argv.slice(2));
  if (typeof a === "string") {
    console.error(`${a}\nusage: bun agent/gateway.ts --url ws://host:8787/ws [--port 8771] [--host 127.0.0.1]`);
    process.exit(2);
  }
  const links = new Set<Link>();
  const server = Bun.serve<Link>({
    hostname: a.host, port: a.port,
    fetch: (req, srv) => (new URL(req.url).pathname === "/grunt" && srv.upgrade(req, { data: { send: () => {}, world: null, conn: null, endpoint: null, waiting: [], joining: false } }) ? undefined : new Response("grunt gateway: connect a WebSocket at /grunt", { status: 426 })),
    websocket: {
      open(ws) {
        ws.data.send = (m) => ws.send(JSON.stringify(m));
        links.add(ws.data);
      },
      message(ws, raw) {
        const l = ws.data, text = String(raw);
        if (l.conn) return l.conn.receive(text);
        l.waiting.push(text);
        if (l.joining) return;
        let hello: { type?: string; id?: string; auth?: { name?: string } };
        try {
          hello = JSON.parse(text);
        } catch {
          return l.send({ grunt: 0, type: "error", code: "malformed", message: "not JSON" });
        }
        if (hello.type !== "hello") return l.send({ grunt: 0, type: "error", code: "unknown_type", message: "say hello first" }), void l.waiting.pop();
        const name = String(hello.auth?.name ?? "");
        if (!VALID_NAME.test(name)) return l.send({ grunt: 0, type: "refused", ...(hello.id ? { re: hello.id } : {}), code: "auth", reason: "a name of 1 to 24 letters, digits, spaces, _ or -", retry: false });
        l.joining = true;
        console.error(`grunt: ${name} joins ${a.url}`);
        survivor(a.url, name).then(
          (world) => {
            if (!links.has(l)) return world.agent.session.close();
            l.world = world;
            l.endpoint = new Endpoint(world, { capabilities: () => SNARK_CAPABILITIES, limits: SNARK_LIMITS, game: { name: "SNARK", version: "0" }, tickMs: 1000 / 60 });
            l.conn = l.endpoint.connect((m) => l.send(m));
            for (const m of l.waiting.splice(0)) l.conn.receive(m);
          },
          (err: unknown) => {
            l.joining = false;
            l.waiting.length = 0;
            l.send({ grunt: 0, type: "refused", ...(hello.id ? { re: hello.id } : {}), code: "unavailable", reason: err instanceof Error ? err.message : String(err), retry: true });
          },
        );
      },
      close(ws) {
        const l = ws.data;
        links.delete(l);
        l.conn?.close();
        if (l.world) {
          l.world.releaseAll("disconnected");
          l.world.agent.session.close();
        }
      },
    },
  });
  setInterval(() => {
    const now = performance.now();
    for (const l of links) {
      if (!l.world || !l.endpoint) continue;
      l.world.step(now);
      l.endpoint.afterStep();
    }
  }, 1000 / 60);
  console.error(`grunt gateway on ws://${a.host}:${server.port}/grunt, for ${a.url}`);
}

if (import.meta.main) await main();
