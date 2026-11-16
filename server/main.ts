// bun server/main.ts [--dev] [--config dir] [--port 8787] [--host address] [--public-url https://name.example | /path] [--map file.snmap] [--db var/world.db] [--allow-missing-content] [--restore backup-folder] [--no-backups] [--module file.ts] [--cert cert.pem --key key.pem] [?Key=Value?Key2=Value2] [-Flag[=value]]
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
import { inflateRawSync } from "node:zlib";
import { parsePack } from "../shared/pack/pack.ts";
import { allClips } from "../shared/pack/clips.ts";
import { parseManifest } from "../shared/pack/manifest.ts";
import { serveFile } from "./files.ts";
import { boardOwners, soundBoard, type BoardGate } from "./sound-board.ts";
import { CUES } from "../shared/sound/cues.ts";
import { mapCopy } from "../shared/world/mapfile.ts";
import { mapLabel, type Destination } from "./cluster/cluster.ts";
import { comingSoonPage, htmlResponse, linkOf, pathOf, placeOf, startPage, worldAddress, type SiteLinks, type SiteWorld } from "./site.ts";

export interface ServerOptions {
  port?: number;
  /** The address to listen on. Without one a development server listens on this machine only, and any other on every address. */
  hostname?: string;
  /** Enables the self-check report endpoint and cheats without a password. Never set in a public deployment. */
  dev?: boolean;
  /** Password for `enablecheats`. Without it (and without `dev`) cheats are off. */
  adminPassword?: string;
  /** Read console commands from standard input, as the operator. */
  terminal?: boolean;
  /** Path of the map file to run (shared/world/mapfile.ts). Without one, the proving ground. */
  map?: string;
  /** See `StoreOptions.allowMissingContent`. */
  allowMissingContent?: boolean;
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
  /** Sees every request first, and answers it or returns null to pass it on. Only the device probe's server has one (tools/device.ts). */
  routes?: (req: Request, url: URL) => Response | Promise<Response> | null;
  /**
   * The address pages reach this server at from elsewhere, such as a tunnel's: told to the other servers of its cluster, whose
   * pages send travellers here by it when they themselves were reached by theirs. It may be a path alone, as /miami: the
   * server is then reached at that path of whatever host the page came by, and answers its world under it and the site
   * around it everywhere else (pathOf, placeOf).
   */
  publicUrl?: string;
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
  /** Unreliable messages skipped since the start because too much was waiting to go to their client. The device probe reports it. */
  readonly skipped: number;
  stop(): void;
}

/** Unsent bytes at which a slow client is dropped. */
const HARD_BACKLOG = 4 * 1024 * 1024;

/**
 * What a socket does with a message on `channel` when `buffered` bytes wait unsent: 0 sends it, 1 skips it, 2 drops the
 * client. Unreliable traffic waits behind no more than two snapshots of `snapshotBytes`, so what a stall leaves queued is
 * not seconds of stale snapshots.
 */
export function backlog(channel: number, buffered: number, snapshotBytes: number): number {
  // A datagram that cannot be sent now is dropped, as an unreliable channel would drop it.
  if (channel !== CH_RELIABLE && buffered > 2 * snapshotBytes) return 1;
  return buffered > HARD_BACKLOG ? 2 : 0;
}

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
 * start of its SHA-256, so whoever fetched it keeps it for good, and it goes out as the copies its build made for the wire
 * (tools/map/pack.ts). A map with none, as a test's or the proving ground, is small enough to compress here. Null for any
 * other path. `link` is the header that has a page ask for the file as it is read, before it has read map.json. It names the
 * file relatively, as the page's own fetch does, so it is the same file under whatever path the server is reached at.
 */
export function mapRoutes(file: Uint8Array<ArrayBuffer>, id: string, hash: number, copies: { br?: Blob; gz?: Blob } = {}): ((path: string, accepts: string) => Response | null) & { readonly link: string } {
  const name = `map.${new Bun.CryptoHasher("sha256").update(file).digest("hex").slice(0, 16)}.snmap`;
  const json = JSON.stringify({ id, hash, file: name });
  const gz = copies.gz ?? Bun.gzipSync(file);
  return Object.assign((path: string, accepts: string): Response | null => {
    if (path === "/map.json") return new Response(json, { headers: { "content-type": "application/json", "cache-control": "no-cache" } });
    if (path !== `/${name}`) return null;
    const headers = { "content-type": "application/octet-stream", "cache-control": "public, max-age=31536000, immutable", vary: "accept-encoding" };
    if (copies.br && accepts.includes("br")) return new Response(copies.br, { headers: { ...headers, "content-encoding": "br" } });
    return accepts.includes("gzip") ? new Response(gz, { headers: { ...headers, "content-encoding": "gzip" } }) : new Response(file, { headers });
  }, { link: `<${name}>; rel=preload; as=fetch; crossorigin` });
}

/** The copies for the wire the build wrote beside the map file at `path`, if it did. */
export function mapCopies(path: string, hash: number): { br?: Blob; gz?: Blob } {
  const [br, gz] = [mapCopy(path, hash, "br"), mapCopy(path, hash, "gz")];
  if (existsSync(br) && existsSync(gz)) return { br: Bun.file(br), gz: Bun.file(gz) };
  console.log(`map: ${path} has no copies for the wire beside it, so it is compressed now: bun tools/map.ts pack ${path} writes them`);
  return {};
}

/**
 * Whether a web page at `origin` may open a socket to the server it asked for as `host`. A request with no Origin is not
 * from a page, so it is not asked: the agent and other programs send none, and could send any. A page is let in if this
 * server served it, which is when its origin's host is the host it asks for, or if `allowed` names its origin. `allowed`
 * is the AllowedOrigins setting: origins separated by commas or spaces, or * for any.
 */
export function originAllowed(origin: string | null, host: string | null, allowed: string): boolean {
  if (origin === null) return true;
  const page = origin.toLowerCase();
  const scheme = page.indexOf("://");
  if (scheme > 0 && host !== null && page.slice(scheme + 3) === host.toLowerCase()) return true;
  for (const name of allowed.toLowerCase().split(/[\s,]+/)) {
    if (name === "*" || (name !== "" && name.replace(/\/+$/, "") === page)) return true;
  }
  return false;
}

/**
 * What `/cluster.json` answers: this server, and the others of its cluster that are running, with why its survivors cannot go to
 * each now ("" where they can). A page goes to another by its `url` when it was itself reached by this one's, and otherwise by
 * its `port` on the host it reached this one by. Outside a cluster the list is empty.
 */
export function clusterList(host: Host): { world: number; name: string; url: string; port: number; servers: ReturnType<NonNullable<Host["cluster"]>["destinations"]> } {
  const c = host.cluster;
  if (!c) return { world: 0, name: "", url: "", port: 0, servers: [] };
  return { world: c.world, name: c.serverName(c.world), url: c.url, port: c.port, servers: c.destinations() };
}

/** The default settings folder of a development server. It speeds up taming, hatching and growth so raising a creature takes minutes. */
export const DEV_CONFIG = resolve(import.meta.dir, "../config/dev");

export function startServer(opts: ServerOptions = {}): RunningServer {
  const base = pathOf(opts.publicUrl ?? "");
  const { registry, errors } = compileContent(CORE_CONTENT);
  if (!registry) throw new Error("content errors:\n" + errors.join("\n"));
  const clientDir = resolve(opts.clientDir ?? join(import.meta.dir, "../client/dist"));
  // The server poses and hit-tests bodies with every clip the clients are served: the boot pack's and each skeleton's
  // from the clip file. The manifest names both.
  const manifestFile = join(clientDir, "assets/manifest.json");
  if (!existsSync(manifestFile)) throw new Error(`${manifestFile} is missing: build the client first (bun run build)`);
  const manifest = parseManifest(readFileSync(manifestFile, "utf8"));
  const served = (file: number): Uint8Array => new Uint8Array(readFileSync(join(clientDir, "assets", manifest.files[file]!.name)));
  const pack = parsePack(served(manifest.boot));
  const clips = allClips(manifest, pack, served, (stored) => new Uint8Array(inflateRawSync(stored)));
  const roles = { dev: opts.dev ?? false, clips, rigs: pack.header.rigs, ...(opts.map ? { map: new Uint8Array(readFileSync(opts.map)) } : {}), ...(opts.adminPassword ? { adminPassword: opts.adminPassword } : {}), ...(opts.config ? { config: opts.config } : {}), ...(opts.modules ? { modules: opts.modules } : {}), now: () => performance.now(), ...(opts.live ? { live: opts.live } : {}) };
  const host = createHost(registry, opts.probeScene ? { ...roles, startingCreatures: 0, wakeRadius: -1 } : { ...roles, ...(opts.dbPath ? { dbPath: opts.dbPath, keeper: "worker" as const, backups: !opts.noBackups, store: { allowMissingContent: opts.allowMissingContent ?? false } } : {}), wild: true });
  // Settings problems are logged at startup and do not stop the server.
  for (const m of host.lists.missing) console.log(`settings: ${m.setting} names ${m.name}, which this build does not have`);
  for (const m of host.lists.renamed) console.log(`settings: ${m.setting} names ${m.name}, which is now ${m.to.join(", ")}`);
  for (const m of host.lists.unclear) console.log(`settings: ${m.setting} names ${m.name}, which could be ${m.could.join(" or ")}, so write the one meant in full`);
  for (const line of host.passed) console.log(`settings: passed over: ${line}`);
  if (!opts.probeScene && host.spawner === null && host.world.zones.every((z) => z.spawns === undefined)) console.log(`map: neither the content nor the map file gives ${host.world.mapId} a spawn region, so no wild creature lives on it`);
  const mapRoute = mapRoutes(host.mapFile!, host.world.mapId, host.world.mapHash, opts.map ? mapCopies(opts.map, host.world.mapHash) : {});
  // The shared families of sounds are the owners the catalogue's fallbacks name.
  const families = [...new Set(CUES.flatMap((c) => c.falls.map((f) => f.slice(0, f.indexOf("/")))).filter((o) => o !== "{owner}"))];
  const board: BoardGate = { dev: opts.dev ?? false, password: host.adminPassword, guesses: host.game.cheatGuesses, tick: () => host.world.tick };
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

  /** Sites whose pages were turned away, so each is logged once. */
  const refused = new Set<string>();

  /** Where the game's links go, read at each request, so the live file changes them. */
  const links = (): SiteLinks => ({ wiki: linkOf(host.rules.text("WikiUrl")), repository: linkOf(host.rules.text("RepositoryUrl")) });
  /** The worlds the start screen lists: the cluster's running, this one among them, or this one alone outside a cluster. */
  const worlds = (requestHost: string): SiteWorld[] => {
    const c = host.cluster;
    const map = mapLabel(registry, host.world.mapId);
    const all: Omit<Destination, "world" | "why">[] = c ? [c.here(), ...c.destinations()].sort((a, b) => a.world - b.world) : [{ name: host.rules.text("SessionName") || map, map, port: server.port ?? 0, url: base, players: host.game.playerCount, max: host.game.opts.maxClients }];
    return all.map((w) => ({ name: w.name, map: w.map, address: worldAddress(w, requestHost), players: w.players, max: w.max }));
  };
  /** The site around a world reached at a path: its start screen, the page the source link goes to, and the client's files. */
  const site = (req: Request, path: string): Response | Promise<Response> => {
    if (path === "/" || path === "/index.html") return htmlResponse(startPage(worlds(req.headers.get("host") ?? ""), links()));
    if (path === "/source" || path === "/source/") return htmlResponse(comingSoonPage());
    // The sound board is a world's, behind its admin password (soundBoard), and not the site's to hand out.
    if (path === "/sounds.html" || path.startsWith("/admin/")) return new Response("not found", { status: 404 });
    return serveFile(clientDir, req, path);
  };

  /** A message is a channel byte and then what the game wrote. The game's writers hold 16 KB, and a welcome a little more. */
  const outgoing = new Uint8Array(65536);
  let skipped = 0;
  // A development server gives cheats without a password, so nothing off this machine reaches it unless it is asked to listen there.
  const hostname = opts.hostname ?? (opts.dev ? "127.0.0.1" : undefined);
  const server = Bun.serve<Socket>({
    port: opts.port ?? 8787,
    ...(hostname ? { hostname } : {}),
    ...(opts.cert && opts.key ? { tls: { cert: Bun.file(opts.cert), key: Bun.file(opts.key) }, http2: true } : {}),
    async fetch(req, srv) {
      const url = new URL(req.url);
      const answered = opts.routes?.(req, url);
      if (answered) return answered;
      const { at, path } = placeOf(base, url.pathname);
      if (at === "slash") return new Response(null, { status: 308, headers: { location: `${base}/${url.search}` } });
      if (at === "site") return site(req, path);
      if (path === "/ws" || path === "/voice") {
        // A page on another site may not use its visitor's browser, and that visitor's address, to reach this server.
        const origin = req.headers.get("origin");
        if (!originAllowed(origin, req.headers.get("host"), host.rules.text("AllowedOrigins"))) {
          const site = origin!.slice(0, 100);
          if (!refused.has(site) && refused.size < 32) {
            refused.add(site);
            console.log(`refused a socket to a page of ${site}: AllowedOrigins in [SnarkSettings] names the sites whose pages may connect`);
          }
          return new Response("pages of this site may not connect to this server", { status: 403 });
        }
        return srv.upgrade(req, { data: { conn: null, voice: null, isVoice: path === "/voice" } }) ? undefined : new Response("expected a WebSocket", { status: 400 });
      }
      if (path === "/cluster.json") return new Response(JSON.stringify(clusterList(host)), { headers: { "content-type": "application/json", "cache-control": "no-cache" } });
      if (path === "/links.json") return new Response(JSON.stringify(links()), { headers: { "content-type": "application/json", "cache-control": "no-cache" } });
      // Where RepositoryUrl goes by default, on a server at the root of its host as on the site around one reached at a path.
      if (path === "/source" || path === "/source/") return htmlResponse(comingSoonPage());
      if (path === "/__selfcheck" && req.method === "POST" && opts.dev) {
        report(await req.json());
        return new Response("ok");
      }
      if (path === "/__bench" && req.method === "POST" && opts.dev) {
        const result = await req.json();
        console.log(`frame times from a browser:\n${JSON.stringify(result, null, 2)}`);
        measured(result);
        return new Response("ok");
      }
      const sounds = soundBoard(req, srv.requestIP(req)?.address ?? "", board, join(clientDir, "sounds.html"), () => boardOwners(registry, families), undefined, path);
      if (sounds) return sounds;
      const map = mapRoute(path, req.headers.get("accept-encoding") ?? "");
      if (map) return map;
      const file = await serveFile(clientDir, req, path);
      // A device probe measures the link quiet before the game's files come, as index.html leaves its own preloads.
      if ((path === "/" || path === "/index.html") && file.ok && !url.searchParams.has("device")) file.headers.set("link", mapRoute.link);
      return file;
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
            const rule = backlog(channel, ws.getBufferedAmount(), host.game.opts.snapshotBytesMax);
            if (rule === 1) return void skipped++;
            if (rule === 2) return void ws.close(1008, "too slow");
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

  host.cluster?.listening(server.port ?? 0, (opts.publicUrl ?? "").replace(/\/+$/, ""));

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
    get skipped() {
      return skipped;
    },
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
    hostname: value("--host"),
    publicUrl: value("--public-url"),
    dev,
    config: rules,
    ...(live ? { live } : {}),
    map: value("--map"),
    allowMissingContent: args.includes("--allow-missing-content"),
    dbPath: value("--db"),
    noBackups: args.includes("--no-backups"),
    modules,
    cert: value("--cert"),
    key: value("--key"),
    adminPassword: process.env.SNARK_ADMIN_PASSWORD,
    terminal: process.stdin.isTTY,
  });
  console.log(`SNARK listening on ${value("--cert") && value("--key") ? "https" : "http"}://localhost:${running.port}${pathOf(value("--public-url") ?? "")}/`);
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
