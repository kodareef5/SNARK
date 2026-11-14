// bun server/main.ts [--dev] [--config dir] [--port 8787] [--map file.snmap] [--db var/world.db] [--restore backup-folder] [--no-backups] [--module file.ts] [--cert cert.pem --key key.pem] [?Key=Value?Key2=Value2] [-Flag[=value]]
// SNARK_ADMIN_PASSWORD sets the `enablecheats` password. In a terminal, typed lines run as console commands with full rights.

import { CORE_CONTENT } from "../content/core.ts";
import { compileContent } from "../shared/content/registry.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { CH_RELIABLE, type Connection } from "../shared/net/transport.ts";
import { PROBE_BODY, PROBE_CREATURE } from "../shared/world/proving.ts";
import { createHost, type Host } from "./host.ts";
import { LIVE_FILE, formatReport, loadConfigFolder } from "./settings/config.ts";
import type { Rules } from "./settings/rules.ts";
import type { ModuleDef } from "./api/module.ts";
import { restoreBackup } from "./persist/backup.ts";
import { stopOnSignals } from "./signals.ts";
import type { VoicePeer } from "./voice.ts";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parsePack } from "../shared/pack/pack.ts";
import { parseManifest } from "../shared/pack/manifest.ts";
import { serveFile } from "./files.ts";

export interface ServerOptions {
  port?: number;
  /** Enables the self-check report endpoint and cheats without a password. Never set in a public deployment. */
  dev?: boolean;
  /** Password for `enablecheats`. Without it (and without `dev`) cheats are off. */
  adminPassword?: string;
  /** Read console commands from standard input, as the operator. */
  terminal?: boolean;
  /** Path of the map file to run (shared/world/mapfile.ts). Without one, the proving ground. */
  map?: string;
  dbPath?: string;
  /** With a save: skip the backups made beside it at every autosave mark. */
  noBackups?: boolean;
  /** Directory holding the built client. */
  clientDir?: string;
  /** A fixed scene for the boot probe: no wandering herd, nothing woken, and one creature standing at the spot the self-check looks at. */
  probeScene?: boolean;
  /** Paths of a certificate and its private key (PEM). With both, the server speaks TLS, which a browser requires for a microphone off localhost. */
  cert?: string;
  key?: string;
  /** See `HostOptions.modules`. */
  modules?: readonly ModuleDef[];
  /** See `HostOptions.config` and `HostOptions.live`. */
  config?: Rules;
  live?: () => string | null;
}

export interface RunningServer {
  readonly port: number;
  readonly host: Host;
  /** Resolves with the first self-check report the page posts (dev only). */
  readonly selfcheck: Promise<unknown>;
  /** Resolves with the next report not yet taken (dev only), for a probe of more than one page. */
  nextSelfcheck(): Promise<unknown>;
  /** Resolves with the first frame-time report a page opened with ?bench=1 posts (dev only). */
  readonly bench: Promise<unknown>;
  stop(): void;
}

/** Unsent bytes at which a slow client's unreliable traffic is skipped, and at which the client is dropped. */
const SOFT_BACKLOG = 64 * 1024;
const HARD_BACKLOG = 4 * 1024 * 1024;

/** Unsent bytes at which a listener's voice packets are dropped. About a quarter second of everyone it can hear. */
const VOICE_BACKLOG = 16 * 1024;

interface Socket {
  conn: Connection | null;
  /** Set for a voice socket, which carries voice packets and nothing else. */
  voice: VoicePeer | null;
  isVoice: boolean;
}

/** Returns a reader of the live file in a config folder, or undefined for no folder. */
export function liveFileOf(folder: string): (() => string | null) | undefined {
  if (folder === "") return undefined;
  const path = join(folder, LIVE_FILE);
  return () => (existsSync(path) ? readFileSync(path, "utf8") : null);
}

/**
 * Answers the two requests a client makes for the map. `/map.json` names the map and its file. The file's name carries the
 * start of its SHA-256, so whoever fetched it keeps it for good, and it goes out compressed. Null for any other path.
 */
export function mapRoutes(file: Uint8Array<ArrayBuffer>, id: string, hash: number): (path: string, accepts: string) => Response | null {
  const name = `map.${new Bun.CryptoHasher("sha256").update(file).digest("hex").slice(0, 16)}.snmap`;
  const json = JSON.stringify({ id, hash, file: name });
  const packed = Bun.gzipSync(file);
  return (path, accepts) => {
    if (path === "/map.json") return new Response(json, { headers: { "content-type": "application/json", "cache-control": "no-cache" } });
    if (path !== `/${name}`) return null;
    const headers = { "content-type": "application/octet-stream", "cache-control": "public, max-age=31536000, immutable", vary: "accept-encoding" };
    return accepts.includes("gzip") ? new Response(packed, { headers: { ...headers, "content-encoding": "gzip" } }) : new Response(file, { headers });
  };
}

/** The default settings folder of a development server. It speeds up taming, hatching and growth so raising a creature takes minutes. */
export const DEV_CONFIG = resolve(import.meta.dir, "../config/dev");

export function startServer(opts: ServerOptions = {}): RunningServer {
  const { registry, errors } = compileContent(CORE_CONTENT);
  if (!registry) throw new Error("content errors:\n" + errors.join("\n"));
  const clientDir = resolve(opts.clientDir ?? join(import.meta.dir, "../client/dist"));
  // The server poses and hit-tests bodies with the clips of the boot pack the clients are served. The manifest names it.
  const manifestFile = join(clientDir, "assets/manifest.json");
  if (!existsSync(manifestFile)) throw new Error(`${manifestFile} is missing: build the client first (bun run build)`);
  const manifest = parseManifest(readFileSync(manifestFile, "utf8"));
  const pack = parsePack(new Uint8Array(readFileSync(join(clientDir, "assets", manifest.files[manifest.boot]!.name))));
  const clips = pack.clips;
  const roles = { dev: opts.dev ?? false, clips, rigs: pack.header.rigs, ...(opts.map ? { map: new Uint8Array(readFileSync(opts.map)) } : {}), ...(opts.adminPassword ? { adminPassword: opts.adminPassword } : {}), ...(opts.config ? { config: opts.config } : {}), ...(opts.modules ? { modules: opts.modules } : {}), now: () => performance.now(), ...(opts.live ? { live: opts.live } : {}) };
  const host = createHost(registry, opts.probeScene ? { ...roles, startingCreatures: 0, wakeRadius: -1 } : { ...roles, ...(opts.dbPath ? { dbPath: opts.dbPath, keeper: "worker" as const, backups: !opts.noBackups } : {}), startingCreatures: 24, startingSpecies: "core:parasaur", startingHunters: 4 });
  // Settings problems are logged at startup and do not stop the server.
  for (const m of host.lists.missing) console.log(`settings: ${m.setting} names ${m.name}, which this build does not have`);
  for (const m of host.lists.renamed) console.log(`settings: ${m.setting} names ${m.name}, which is now ${m.to.join(", ")}`);
  for (const m of host.lists.unclear) console.log(`settings: ${m.setting} names ${m.name}, which could be ${m.could.join(" or ")}, so write the one meant in full`);
  for (const line of host.passed) console.log(`settings: passed over: ${line}`);
  if (host.world.zones.length === 0) console.log(`map: the content has no spawn zone for ${host.world.mapId}, so no creature starts on it`);
  const mapRoute = mapRoutes(host.mapFile!, host.world.mapId, host.world.mapHash);
  if (opts.probeScene) {
    const ents = host.world.ents;
    const e = host.spawnCreature("core:grazer", PROBE_CREATURE.x, PROBE_CREATURE.z, 1);
    const genome = host.records.byPid.get(ents.pid[e]!)!.genome!;
    genome.colors.fill(0);
    genome.colors[0] = PROBE_CREATURE.color;
    ents.setLook(e, genome.level, genome.colors, "");
    // One body with bones, in its species' own colour.
    const body = host.spawnCreature("core:survivor", PROBE_BODY.x, PROBE_BODY.z, 1);
    const look = host.records.byPid.get(ents.pid[body]!)!.genome!;
    look.colors.fill(0);
    ents.setLook(body, look.level, look.colors, "");
  }
  let onConnection: ((conn: Connection) => void) | null = null;
  host.game.listen({
    set onConnection(fn: ((conn: Connection) => void) | null) {
      onConnection = fn;
    },
    get onConnection() {
      return onConnection;
    },
  });

  let first: (value: unknown) => void = () => {};
  const selfcheck = new Promise<unknown>((r) => (first = r));
  const reports: unknown[] = [];
  const waiting: ((value: unknown) => void)[] = [];
  const report = (value: unknown): void => {
    first(value);
    const next = waiting.shift();
    if (next) next(value);
    else reports.push(value);
  };
  let measured: (value: unknown) => void = () => {};
  const bench = new Promise<unknown>((r) => (measured = r));

  // Pending voice is flushed once, at the end of the event-loop turn it arrived in.
  let flushing = false;
  const flushVoice = (): void => {
    flushing = false;
    host.voice.flush();
  };

  /** A message is a channel byte and then what the game wrote. The game's writers hold 16 KB, and a welcome a little more. */
  const outgoing = new Uint8Array(65536);
  const server = Bun.serve<Socket>({
    port: opts.port ?? 8787,
    ...(opts.cert && opts.key ? { tls: { cert: Bun.file(opts.cert), key: Bun.file(opts.key) } } : {}),
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/ws" || url.pathname === "/voice") {
        return srv.upgrade(req, { data: { conn: null, voice: null, isVoice: url.pathname === "/voice" } }) ? undefined : new Response("expected a WebSocket", { status: 400 });
      }
      if (url.pathname === "/__selfcheck" && req.method === "POST" && opts.dev) {
        report(await req.json());
        return new Response("ok");
      }
      if (url.pathname === "/__bench" && req.method === "POST" && opts.dev) {
        const result = await req.json();
        console.log(`frame times from a browser:\n${JSON.stringify(result, null, 2)}`);
        measured(result);
        return new Response("ok");
      }
      return mapRoute(url.pathname, req.headers.get("accept-encoding") ?? "") ?? serveFile(clientDir, req);
    },
    websocket: {
      maxPayloadLength: 4096,
      open(ws) {
        if (ws.data.isVoice) {
          ws.data.voice = host.voice.connect({
            send(data) {
              if (ws.getBufferedAmount() > VOICE_BACKLOG) return false;
              ws.send(data);
              return true;
            },
            close() {
              ws.close();
            },
          });
          return;
        }
        const conn: Connection & { open: boolean } = {
          open: true,
          address: ws.remoteAddress,
          onMessage: null,
          onClose: null,
          send(channel, data) {
            if (!conn.open) return;
            const backlog = ws.getBufferedAmount();
            // A datagram that cannot be sent now is dropped, as an unreliable channel would drop it.
            if (channel !== CH_RELIABLE && backlog > SOFT_BACKLOG) return;
            if (backlog > HARD_BACKLOG) return void ws.close(1008, "too slow");
            // Bun copies what it is given before send returns, so every message goes out through one buffer.
            const frame = data.length < outgoing.length ? outgoing.subarray(0, data.length + 1) : new Uint8Array(data.length + 1);
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
        if (ws.data.voice) {
          host.voice.receive(ws.data.voice, message, performance.now());
          if (host.voice.pending && !flushing) {
            flushing = true;
            setImmediate(flushVoice);
          }
          return;
        }
        ws.data.conn?.onMessage?.(message[0]!, message.subarray(1));
      },
      close(ws) {
        if (ws.data.voice) return void host.voice.disconnect(ws.data.voice);
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
    // The checkpoint is the keeper thread's work, so asking for it costs nothing here, late or not.
    host.idle();
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
    nextSelfcheck: () => (reports.length > 0 ? Promise.resolve(reports.shift()) : new Promise<unknown>((r) => waiting.push(r))),
    bench,
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
  const dev = args.includes("--dev");
  const folder = value("--config") ?? (dev ? DEV_CONFIG : "");
  const { rules, report } = loadConfigFolder(folder, args);
  for (const line of formatReport(report, rules)) console.log(line);
  const live = liveFileOf(folder);
  // Modules: each `--module <file>`, then every file of the config folder's `modules`, by name.
  const files = args.flatMap((a, i) => (a === "--module" && args[i + 1] ? [resolve(args[i + 1]!)] : []));
  const beside = folder === "" ? "" : join(folder, "modules");
  if (beside !== "" && existsSync(beside)) for (const name of readdirSync(beside).sort()) if (name.endsWith(".ts")) files.push(resolve(beside, name));
  const modules: ModuleDef[] = [];
  for (const file of files) {
    const def = ((await import(file)) as { default?: ModuleDef }).default;
    if (!def || typeof def.setup !== "function") throw new Error(`${file} is not a module: it exports no default with a setup`);
    modules.push(def);
  }
  const restore = value("--restore");
  if (restore !== undefined) {
    if (!value("--db")) throw new Error("--restore needs --db: the save to put the backup in place of");
    const put = restoreBackup(value("--db")!, restore, new Date());
    console.log(`restored the backup of tick ${put.tick}; what it replaced is in ${put.aside}`);
  }
  // Precedence: --port, then ARK's -port flag, then the Port setting.
  const flagPort = rules.flag("port");
  const running = startServer({
    port: Number(value("--port") ?? (typeof flagPort === "string" && flagPort !== "" ? flagPort : rules.num("Port"))),
    dev,
    config: rules,
    ...(live ? { live } : {}),
    map: value("--map"),
    dbPath: value("--db"),
    noBackups: args.includes("--no-backups"),
    modules,
    cert: value("--cert"),
    key: value("--key"),
    adminPassword: process.env.SNARK_ADMIN_PASSWORD,
    terminal: process.stdin.isTTY,
  });
  console.log(`SNARK listening on ${value("--cert") && value("--key") ? "https" : "http"}://localhost:${running.port}`);
  stopOnSignals(() => running.stop());
  // The tick that threw is torn, so nothing of it is saved. The last commit is whole.
  process.on("uncaughtException", (err) => {
    console.error(err);
    try {
      running.host.persistence?.store.close();
    } catch {
      // The process is ending either way.
    }
    process.exit(1);
  });
}
