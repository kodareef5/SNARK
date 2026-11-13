// Process entry point: serves the built client, accepts WebSocket connections,
// and ticks the world on the wall clock.
//
//   bun server/main.ts [--dev] [--port 8787] [--db var/world.db]
//
// SNARK_ADMIN_PASSWORD sets the password for `enablecheats`. When started from
// a terminal, lines typed there run as console commands with full rights.

import { CORE_CONTENT } from "../content/core.ts";
import { compileContent } from "../shared/content/registry.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { CH_RELIABLE, type Connection } from "../shared/net/transport.ts";
import { PROBE_CREATURE } from "../shared/world/proving.ts";
import { createHost, type Host } from "./host.ts";
import { join, normalize, resolve } from "node:path";

export interface ServerOptions {
  port?: number;
  /** Enables the self-check report endpoint and cheats without a password. Never set in a public deployment. */
  dev?: boolean;
  /** Password for `enablecheats`. Without it (and without `dev`) cheats are off. */
  adminPassword?: string;
  /** Read console commands from standard input, as the operator. */
  terminal?: boolean;
  dbPath?: string;
  /** Directory holding the built client. */
  clientDir?: string;
  /**
   * A fixed scene for the boot probe: no wandering herd, nothing woken, and one
   * creature standing at the spot the self-check looks at.
   */
  probeScene?: boolean;
}

export interface RunningServer {
  readonly port: number;
  readonly host: Host;
  /** Resolves with the first self-check report the page posts (dev only). */
  readonly selfcheck: Promise<unknown>;
  stop(): void;
}

/** Bytes a slow client may leave unsent before unreliable traffic is skipped, then before it is dropped. */
const SOFT_BACKLOG = 64 * 1024;
const HARD_BACKLOG = 4 * 1024 * 1024;
const TYPES: Record<string, string> = { html: "text/html; charset=utf-8", js: "text/javascript", snpk: "application/octet-stream", json: "application/json" };

interface Socket {
  conn: Connection | null;
}

export function startServer(opts: ServerOptions = {}): RunningServer {
  const { registry, errors } = compileContent(CORE_CONTENT);
  if (!registry) throw new Error("content errors:\n" + errors.join("\n"));
  const roles = { dev: opts.dev ?? false, ...(opts.adminPassword ? { adminPassword: opts.adminPassword } : {}) };
  const host = createHost(registry, opts.probeScene ? { ...roles, startingCreatures: 0, wakeRadius: -1 } : { ...roles, ...(opts.dbPath ? { dbPath: opts.dbPath } : {}), startingCreatures: 40 });
  if (opts.probeScene) host.spawnCreature("core:grazer", PROBE_CREATURE.x, PROBE_CREATURE.z, 1);
  const clientDir = resolve(opts.clientDir ?? join(import.meta.dir, "../client/dist"));
  let onConnection: ((conn: Connection) => void) | null = null;
  host.game.listen({
    set onConnection(fn: ((conn: Connection) => void) | null) {
      onConnection = fn;
    },
    get onConnection() {
      return onConnection;
    },
  });

  let report: (value: unknown) => void = () => {};
  const selfcheck = new Promise<unknown>((r) => (report = r));

  const server = Bun.serve<Socket>({
    port: opts.port ?? 8787,
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") return srv.upgrade(req, { data: { conn: null } }) ? undefined : new Response("expected a WebSocket", { status: 400 });
      if (url.pathname === "/__selfcheck" && req.method === "POST" && opts.dev) {
        report(await req.json());
        return new Response("ok");
      }
      const path = normalize(join(clientDir, url.pathname === "/" ? "index.html" : url.pathname));
      if (!path.startsWith(clientDir)) return new Response("not found", { status: 404 });
      const file = Bun.file(path);
      if (!(await file.exists())) return new Response("not found", { status: 404 });
      return new Response(file, { headers: { "content-type": TYPES[path.split(".").pop() ?? ""] ?? "application/octet-stream", "cache-control": "no-store" } });
    },
    websocket: {
      maxPayloadLength: 4096,
      open(ws) {
        const conn: Connection & { open: boolean } = {
          open: true,
          onMessage: null,
          onClose: null,
          send(channel, data) {
            if (!conn.open) return;
            const backlog = ws.getBufferedAmount();
            // A datagram that cannot be sent now is dropped, as an unreliable channel would.
            if (channel !== CH_RELIABLE && backlog > SOFT_BACKLOG) return;
            if (backlog > HARD_BACKLOG) return void ws.close(1008, "too slow");
            const frame = new Uint8Array(data.length + 1);
            frame[0] = channel;
            frame.set(data, 1);
            ws.send(frame);
          },
          close() {
            if (conn.open) ws.close();
          },
        };
        ws.data.conn = conn;
        onConnection?.(conn);
      },
      message(ws, message) {
        if (typeof message === "string" || message.length === 0) return;
        ws.data.conn?.onMessage?.(message[0]!, message.subarray(1));
      },
      close(ws) {
        const conn = ws.data.conn as (Connection & { open: boolean }) | null;
        if (!conn) return;
        conn.open = false;
        conn.onClose?.();
      },
    },
  });

  // Fixed-rate loop on the wall clock, with bounded catch-up after a stall.
  const tickMs = 1000 / TICK_RATE;
  let next = performance.now() + tickMs;
  let timer: ReturnType<typeof setTimeout>;
  const loop = (): void => {
    const now = performance.now();
    let steps = 0;
    while (now >= next && steps < 5) {
      host.game.tick();
      next += tickMs;
      steps++;
    }
    if (now - next > 250) next = now + tickMs;
    timer = setTimeout(loop, Math.max(0, next - performance.now()));
  };
  timer = setTimeout(loop, tickMs);

  if (opts.terminal) {
    void (async () => {
      for await (const line of console) {
        const out = host.exec(line);
        if (out) console.log(out);
      }
    })();
  }

  return {
    port: server.port ?? 0,
    host,
    selfcheck,
    stop() {
      clearTimeout(timer);
      server.stop(true);
      host.shutdown();
    },
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const value = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const running = startServer({
    port: Number(value("--port") ?? 8787),
    dev: args.includes("--dev"),
    dbPath: value("--db"),
    adminPassword: process.env.SNARK_ADMIN_PASSWORD,
    terminal: process.stdin.isTTY,
  });
  console.log(`SNARK listening on http://localhost:${running.port}`);
  process.on("SIGINT", () => {
    running.stop();
    process.exit(0);
  });
}
