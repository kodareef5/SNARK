import { ServerDirectory } from "./directory.ts";
import type { Server, ServerWebSocket } from "bun";
import { SurvivorAccess, entryReply } from "./survivor-access.ts";
// bun server/main.ts [--dev] [--config dir] [--port 8787] [--host address] [--public-url https://name.example | /path] [--map file.snmap] [--db var/world.db] [--allow-missing-content] [--restore backup-folder] [--no-backups] [--module file.ts] [--cert cert.pem --key key.pem] [?Key=Value?Key2=Value2] [-Flag[=value]]
// SNARK_ADMIN_PASSWORD sets the `enablecheats` password. In a terminal, typed lines run as console commands with full rights.

import { CORE_CONTENT } from "../content/core.ts";
import { compileContent } from "../shared/content/registry.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { backlog, MESSAGE_BYTES_MAX, VOICE_BACKLOG, type Connection } from "../shared/net/transport.ts";
import { PROBE_BODY, PROBE_CREATURE } from "../shared/world/proving.ts";
import { createHost, type Host } from "./host.ts";
import { LIVE_FILE, formatReport, loadConfigFolder } from "./settings/config.ts";
import { publicValues, type Rules } from "./settings/rules.ts";
import type { ModuleDef } from "./api/module.ts";
import { restoreBackup } from "./persist/backup.ts";
import { stopOnSignals } from "./signals.ts";
import type { VoicePeer } from "./voice.ts";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import { parsePack } from "../shared/pack/pack.ts";
import { allClips } from "../shared/pack/clips.ts";
import { parseManifest } from "../shared/pack/manifest.ts";
import { serveFile } from "./files.ts";
import { clientAddress } from "./front.ts";
import { boardOwners, soundBoard } from "./sound-board.ts";
import { adminAsked, type AdminGate } from "./admin/gate.ts";
import { TickMeter } from "./admin/meter.ts";
import { PART, type TickParts } from "./admin/parts.ts";
import { AdminPages } from "./admin/routes.ts";
import { gaugesOf } from "./admin/stats.ts";
import { CUES } from "../shared/sound/cues.ts";
import { partHash, partsFolder, readHead } from "../shared/world/mapfile.ts";
import { mapLabel, type Destination } from "./cluster/cluster.ts";
import { PlayLog, REPORT_BYTES_MAX } from "./playlog.ts";
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
  /** Sees every request first, and answers it or returns null to pass it on. Only the device probe's and the map trip's servers have one (tools/device.ts, tools/map/trip.ts). */
  routes?: (req: Request, url: URL) => Response | Promise<Response> | null;
  /**
   * The address pages reach this server at from elsewhere, such as a tunnel's: told to the other servers of its cluster, whose
   * pages send travellers here by it when they themselves were reached by theirs. It may be a path alone, as /miami: the
   * server is then reached at that path of whatever host the page came by, and answers its world under it and the site
   * around it everywhere else (pathOf, placeOf).
   */
  publicUrl?: string;
  /**
   * A development server's folder for the record of play (server/playlog.ts): its pages are told to keep one and send it,
   * and each run writes its reports in a file of its own there. Without it, or without `dev`, no page keeps one.
   */
  play?: string;
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

interface Socket {
  conn: Connection | null;
  /** Set for a voice socket, which carries voice packets and nothing else. */
  voice: VoicePeer | null;
  isVoice: boolean;
  /** Who it came from (clientAddress). */
  address: string;
}

/** Returns a reader of the live file in a config folder, or undefined for no folder. */
export function liveFileOf(folder: string): (() => string | null) | undefined {
  if (folder === "") return undefined;
  const path = join(folder, LIVE_FILE);
  return () => (existsSync(path) ? readFileSync(path, "utf8") : null);
}

/** `length` bytes of the open file `fd` from `at`. */
function readAt(fd: number, at: number, length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  for (let n = 0; n < length; ) {
    const got = readSync(fd, bytes, n, length - n, at + n);
    if (got === 0) break;
    n += got;
  }
  return bytes;
}

/** The map's routes (mapRoutes), and how to let go of the file they hold. */
export type MapRoute = ((path: string, req: Request) => Response | Promise<Response> | null) & { readonly link: string; close(): void };

/**
 * Answers a client's requests for the map. `/map.json` names the map and its head, and `/map/<name>` is the head or a part
 * by the name the head gives it (shared/world/mapfile.ts); any other name there is not found, and any other path is null.
 * A name carries its bytes' hash, so whoever fetched it keeps it for good. A map given by its path goes out from the folder
 * its build wrote beside it (tools/map/pack.ts), Brotli to a browser that takes it and gzip to one that does not (on plain
 * http). The file is held open as it was at the start, and `hash`, the world's, must be its: a build replaces it whole and
 * takes away the parts its new head does not name, so a part this server names and its folder no longer has is cut from
 * the file it holds, and gzipped once. That holds the old file's disk until the server stops, and its parts' gzip in memory
 * once asked for. A map made in code, or given with no such folder, is cut likewise. `link` is the header that has a page
 * ask for the head as it is read, before it has read map.json, named relatively as the page's own fetch does.
 */
export function mapRoutes(file: Uint8Array<ArrayBuffer> | string, id: string, hash?: number): MapRoute {
  const fd = typeof file === "string" ? openSync(file, "r") : -1;
  const at = (from: number, length: number): Uint8Array<ArrayBuffer> => (fd < 0 ? (file as Uint8Array<ArrayBuffer>).slice(from, from + length) : readAt(fd, from, length));
  let open = fd >= 0;
  const close = (): void => void (open && ((open = false), closeSync(fd)));
  const start = at(0, 16);
  // The head as it was at the start, which this server names; a part is checked against it as it is cut.
  const first = at(0, Math.max(16, new DataView(start.buffer).getUint32(12, true)));
  const head = readHead(fd < 0 ? (file as Uint8Array) : first, false);
  if (hash !== undefined && head.hash !== hash) {
    close();
    throw new Error(`map: ${String(file)} was built again as the server started: start it again`);
  }
  const json = JSON.stringify({ id, hash: head.hash, head: `map/${head.name}` });
  const folder = typeof file === "string" ? partsFolder(file) : "";
  const wanted = new Map([{ name: head.name, at: 0, length: head.bytes, hash: "" }, ...head.parts].map((p) => [p.name, p]));
  const onDisk = folder !== "" && [...wanted.values()].every((p) => existsSync(join(folder, `${p.name}.br`)) && existsSync(join(folder, `${p.name}.gz`)) && existsSync(join(folder, p.name)) && statSync(join(folder, p.name)).size === p.length);
  if (typeof file === "string" && !onDisk) console.log(`map: ${file} has no files of its parts beside it, so they are cut and gzipped as they are asked for: bun tools/map.ts pack ${file} writes them`);
  const zipped = new Map<string, Uint8Array>();
  const headers = { "content-type": "application/octet-stream", "cache-control": "public, max-age=31536000, immutable", vary: "accept-encoding" };
  /** A part as the file this server holds has it: never another build's, which a file written over in place would give. */
  const cut = (name: string, req: Request): Response => {
    const p = wanted.get(name)!;
    const bytes = name === head.name ? first.subarray(0, head.bytes) : at(p.at, p.length);
    if (name !== head.name && partHash(bytes) !== p.hash) {
      console.log(`map: ${String(file)} was written over in place while the server ran, so its part ${name} is gone: start the server again`);
      return new Response("gone", { status: 410 });
    }
    if (!(req.headers.get("accept-encoding") ?? "").includes("gzip")) return new Response(bytes, { headers });
    if (!zipped.has(name)) zipped.set(name, Bun.gzipSync(bytes));
    return new Response(zipped.get(name)!, { headers: { ...headers, "content-encoding": "gzip" } });
  };
  return Object.assign(
    (path: string, req: Request): Response | Promise<Response> | null => {
      if (path === "/map.json") return new Response(json, { headers: { "content-type": "application/json", "cache-control": "no-cache" } });
      if (!path.startsWith("/map/")) return null;
      const name = path.slice(5);
      if (!wanted.has(name)) return new Response("not found", { status: 404 });
      if (!onDisk) return cut(name, req);
      return serveFile(folder, req, `/${name}`).then((res) => (res.status === 404 ? cut(name, req) : res));
    },
    { link: `<map/${head.name}>; rel=preload; as=fetch; crossorigin`, close },
  );
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
 * Whether a browser that sent `host` asked for this machine by a name only this machine can have: localhost, an address
 * itself (127.0.0.1, [::1], or this machine's on a network, which no other site's name makes a browser send), or `named`, the
 * host of the server's public address. Any other name is a site that may have pointed its name at this machine after its
 * page was opened (DNS rebinding), so a development server, whose cheats need no password, takes no socket for it.
 */
export function namesThisMachine(host: string | null, named: string): boolean {
  if (host === null) return false;
  const name = host.toLowerCase().replace(/:\d+$/, "");
  return name === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(name) || /^\[[0-9a-f:.]+\]$/.test(name) || (named !== "" && name === named);
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

/**
 * What `settings.json` answers beside `links.json`, which the wiki's pages apply to their figures for a visitor who came
 * from this world (client/core/wiki/rates.ts): its name, its map, and its public settings not at their default.
 */
export function worldSettings(host: Host): { name: string; map: string; settings: Record<string, number | boolean | string> } {
  return { name: host.rules.text("SessionName") || mapLabel(host.world.reg, host.world.mapId), map: host.world.mapId, settings: publicValues(host.rules) };
}

/** The default settings folder of a development server. It speeds up taming, hatching and growth so raising a creature takes minutes. */
export const DEV_CONFIG = resolve(import.meta.dir, "../config/dev");

/**
 * Milliseconds behind its clock past which the loop gives ticks up instead of catching them up. While it is behind, a
 * page's snapshots are that much older, and a page replays at most 128 ticks past one (client/core/session.ts HISTORY).
 */
export const CATCH_UP_MS = 2000;

/**
 * Runs `loop.tick` TICK_RATE times a second of `now`'s clock, given when each was due and how many more were due by the
 * time it began, and `loop.idle` after each call: one tick a call, each call made by `later` after the given milliseconds,
 * so that requests and sockets are served between ticks that run late and never wait behind a run of them. A loop behind
 * catches up so; past CATCH_UP_MS behind it gives up the ticks beyond that, and tells `loop.drop` how many. Returns what
 * stops it.
 */
export function tickLoop(loop: { tick(due: number, behind: number): void; idle(): void; drop(ticks: number, at: number): void }, now = (): number => performance.now(), later = (go: () => void, ms: number): (() => void) => {
  const timer = setTimeout(go, ms);
  return () => clearTimeout(timer);
}): () => void {
  const tickMs = 1000 / TICK_RATE;
  let next = now() + tickMs;
  const turn = (): void => {
    const at = now();
    if (at >= next) {
      loop.tick(next, Math.floor((at - next) / tickMs));
      next += tickMs;
    }
    loop.idle();
    if (at - next > CATCH_UP_MS) {
      const ticks = Math.ceil((at - next - CATCH_UP_MS) / tickMs);
      loop.drop(ticks, at);
      next += ticks * tickMs;
    }
    stop = later(turn, Math.max(0, next - now()));
  };
  let stop = later(turn, tickMs);
  return () => stop();
}

/** `fn`, its time counted as the loop's work between ticks under `part` (server/admin/parts.ts). */
function timed<A extends unknown[], R>(parts: TickParts, part: number, fn: (...a: A) => R): (...a: A) => R {
  return (...a) => {
    const began = performance.now();
    try {
      return fn(...a);
    } finally {
      parts.between(part, performance.now() - began);
    }
  };
}

export function startServer(opts: ServerOptions = {}): RunningServer {
  const base = pathOf(opts.publicUrl ?? "");
  const named = /^https?:\/\//i.test(opts.publicUrl ?? "") ? new URL(opts.publicUrl!).hostname.toLowerCase() : "";
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
  const roles = { dev: opts.dev ?? false, clips, rigs: pack.header.rigs, ...(opts.map ? { map: opts.map } : {}), ...(opts.adminPassword ? { adminPassword: opts.adminPassword } : {}), ...(opts.config ? { config: opts.config } : {}), ...(opts.modules ? { modules: opts.modules } : {}), now: () => performance.now(), ...(opts.live ? { live: opts.live } : {}) };
  const host = createHost(registry, opts.probeScene ? { ...roles, startingCreatures: 0, wakeRadius: -1 } : { ...roles, ...(opts.dbPath ? { dbPath: opts.dbPath, keeper: "worker" as const, survivorLog: { mode: "worker" as const }, backups: !opts.noBackups, store: { allowMissingContent: opts.allowMissingContent ?? false } } : {}), wild: true });
  // Settings problems are logged at startup and do not stop the server.
  for (const m of host.lists.missing) console.log(`settings: ${m.setting} names ${m.name}, which this build does not have`);
  for (const m of host.lists.renamed) console.log(`settings: ${m.setting} names ${m.name}, which is now ${m.to.join(", ")}`);
  for (const m of host.lists.unclear) console.log(`settings: ${m.setting} names ${m.name}, which could be ${m.could.join(" or ")}, so write the one meant in full`);
  for (const line of host.passed) console.log(`settings: passed over: ${line}`);
  if (!opts.probeScene && host.spawner === null && host.world.zones.every((z) => z.spawns === undefined)) console.log(`map: neither the content nor the map file gives ${host.world.mapId} a spawn region, so no wild creature lives on it`);
  const access = new SurvivorAccess(host);
  const entryBuilt = existsSync(join(clientDir,"entry.js"));
  const directory = process.env.SNARK_DIRECTORY_URL ?? "";
  const listings = new ServerDirectory(host.cluster ? join(host.cluster.folder.root,"directory.sqlite") : opts.dbPath ? opts.dbPath+".directory.sqlite" : ":memory:");
  const announce = () => {
    if (!directory || !process.env.SNARK_LISTING_TOKEN || !opts.publicUrl) return;
    void fetch(directory,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"heartbeat",address:opts.publicUrl,token:process.env.SNARK_LISTING_TOKEN,players:host.game.playerCount,max:host.game.opts.maxClients}),signal:AbortSignal.timeout(8000)}).catch(()=>{});
  };
  const heartbeat = setInterval(announce,60000); announce();
  const mapRoute = mapRoutes(opts.map ?? host.mapFile!, host.world.mapId, host.world.mapHash);
  // The shared families of sounds are the owners the catalogue's fallbacks name.
  const families = [...new Set(CUES.flatMap((c) => c.falls.map((f) => f.slice(0, f.indexOf("/")))).filter((o) => o !== "{owner}"))];
  const board: AdminGate = { dev: opts.dev ?? false, password: host.adminPassword, guesses: host.game.cheatGuesses, tick: () => host.world.tick };
  const meter = new TickMeter(() => gaugesOf(host));
  const playFile = opts.dev && opts.play ? join(opts.play, `${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.jsonl`) : "";
  const play = playFile ? new PlayLog(host.game, (line) => (mkdirSync(opts.play!, { recursive: true }), appendFileSync(playFile, line + "\n"))) : null;
  const admin = new AdminPages({ host, meter, dir: join(clientDir, "admin"), start: { tick: host.world.tick, wall: meter.startedAt } });
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
  /** The worlds the start screen and the wiki's maps list: the cluster's running, this one among them, or this one alone outside a cluster. */
  const worlds = (requestHost: string, access=false): SiteWorld[] => {
    const c = host.cluster;
    const map = mapLabel(registry, host.world.mapId);
    const all: Omit<Destination, "world" | "why">[] = c ? [c.here(), ...c.destinations()].sort((a, b) => a.world - b.world) : [{ name: host.rules.text("SessionName") || map, map, mapId: host.world.mapId, port: server.port ?? 0, url: base, players: host.game.playerCount, max: host.game.opts.maxClients }];
    const straight = Number(/:(\d+)$/.exec(requestHost)?.[1] ?? 0) === server.port;
    const locks=new Map(access&&c ? c.folder.announcements().map(a=>[a.port,a.password]) : []);
    return all.map(w=>{
      const password=w.port===server.port ? !!host.game.opts.password : locks.get(w.port);
      return {name:w.name,map:w.map,mapId:w.mapId,address:c ? worldAddress(w,requestHost,straight) : base + "/",players:w.players,max:w.max,...(access && password!==undefined ? {password}: {})};
    });
  };
  /**
   * What every server answers alike, under its world's path and on the site around it: where the game's links go, what the
   * world runs for the wiki's figures (the site's is that of whichever world answers it, which the page names), the worlds
   * running as the start screen lists them, and the page the source link goes to.
   */
  const alike = (path: string, requestHost: string): Response | null => {
    if (path === "/links.json") return new Response(JSON.stringify(links()), { headers: { "content-type": "application/json", "cache-control": "no-cache" } });
    if (path === "/settings.json") return new Response(JSON.stringify(worldSettings(host)), { headers: { "content-type": "application/json", "cache-control": "no-cache" } });
    if (path === "/worlds.json" || path === "/entry-worlds.json") return new Response(JSON.stringify(worlds(requestHost,path==="/entry-worlds.json")), { headers: { "content-type": "application/json", "cache-control": "no-cache" } });
    if (path === "/source" || path === "/source/") return htmlResponse(comingSoonPage());
    return null;
  };

  /** A message is a channel byte and then what the game wrote. The game's writers hold 16 KB, and a welcome a little more. */
  const outgoing = new Uint8Array(65536);
  let skipped = 0;
  // A development server gives cheats without a password, so nothing off this machine reaches it unless it is asked to listen there.
  const hostname = opts.hostname ?? (opts.dev ? "127.0.0.1" : undefined);
  const parts = host.game.parts;
  const server = Bun.serve<Socket>({
    port: opts.port ?? 8787,
    ...(hostname ? { hostname } : {}),
    ...(opts.cert && opts.key ? { tls: { cert: Bun.file(opts.cert), key: Bun.file(opts.key) }, http2: true } : {}),
    fetch: timed(parts, PART.http, async (req: Request, srv: Server<Socket>) => {
      const url = new URL(req.url);
      const answered = opts.routes?.(req, url);
      if (answered) return answered;
      const { at, path } = placeOf(base, url.pathname);
      if (at === "slash") return new Response(null, { status: 308, headers: { location: `${base}/${url.search}` } });
      const who = clientAddress(srv.requestIP(req)?.address ?? "", req.headers.get("x-forwarded-for"));
      if (path === "/directory") return listings.answer(req, who);
      const same = alike(path, req.headers.get("host") ?? "");
      if (same) return same;
      if (at === "site") {
        if (path === "/" || path === "/index.html") return htmlResponse(startPage(worlds(req.headers.get("host") ?? ""), links(), entryBuilt ? {world:false,directory} : undefined));
        // The admin pages are a world's, behind its admin password (server/admin/gate.ts), and not the site's to hand out.
        return adminAsked(path) ? new Response("not found", { status: 404 }) : serveFile(clientDir, req, path);
      }
      // A development server's own routes and its sockets are for a browser that asked for this machine (namesThisMachine).
      const local = !opts.dev || namesThisMachine(req.headers.get("host"), named);
      if (path === "/survivors") {
        if (!local || !originAllowed(req.headers.get("origin"),req.headers.get("host"),"")) return entryReply({error:"Use this world’s own address"},403);
        return access.answer(req,who);
      }
      if (path === "/entry-world.json") return entryReply({ name:host.rules.text("SessionName") || mapLabel(registry,host.world.mapId), map:mapLabel(registry,host.world.mapId), mapId:host.world.mapId, password:!!host.game.opts.password, players:host.game.playerCount, max:host.game.opts.maxClients, spawns:host.world.spawns.map(p=>({name:p.name,x:p.x,z:p.z})), width:host.world.hf.sizeX,height:host.world.hf.sizeZ });
      if (entryBuilt && (path === "/" || path === "/index.html") && [...url.searchParams.keys()].every(k => ["screen","invite"].includes(k))) return htmlResponse(startPage(worlds(req.headers.get("host") ?? ""),links(),{world:true,directory}));
      if (path === "/ws" || path === "/voice") {
        if (!local) {
          const asked = (req.headers.get("host") ?? "").slice(0, 100);
          if (!refused.has(asked) && refused.size < 32) {
            refused.add(asked);
            console.log(`refused a socket asked for as ${asked}: a development server takes one for localhost, an address, or the host of --public-url`);
          }
          return new Response("a development server takes a socket only for localhost, an address, or the host of its --public-url", { status: 403 });
        }
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
        return srv.upgrade(req, { data: { conn: null, voice: null, isVoice: path === "/voice", address: who } }) ? undefined : new Response("expected a WebSocket", { status: 400 });
      }
      if (path === "/cluster.json") return new Response(JSON.stringify(clusterList(host)), { headers: { "content-type": "application/json", "cache-control": "no-cache" } });
      if (path === "/__selfcheck" && req.method === "POST" && opts.dev && local) {
        report(await req.json());
        return new Response("ok");
      }
      // Not for this machine alone: the owner plays a development world from elsewhere, through a tunnel and the front.
      if (path === "/__play" && play) {
        if (req.method === "GET") return new Response(null, { status: 204 });
        if (req.method !== "POST") return new Response("POST a report", { status: 405 });
        if (Number(req.headers.get("content-length") ?? 0) > REPORT_BYTES_MAX) return new Response("too long", { status: 413 });
        const why = play.report(await req.text());
        return why === "" ? new Response(null, { status: 204 }) : new Response(why, { status: 422 });
      }
      if (path === "/__bench" && req.method === "POST" && opts.dev && local) {
        const result = await req.json();
        console.log(`frame times from a browser:\n${JSON.stringify(result, null, 2)}`);
        measured(result);
        return new Response("ok");
      }
      const gate = local ? board : { ...board, dev: false };
      const sounds = soundBoard(req, who, gate, join(clientDir, "sounds.html"), () => boardOwners(registry, families), undefined, path);
      if (sounds) return sounds;
      const page = admin.answer(req, who, gate, path);
      if (page) return page;
      const map = mapRoute(path, req);
      if (map) return map;
      const file = await serveFile(clientDir, req, path === "/play.html" ? "/index.html" : path);
      // A device probe measures the link quiet before the game's files come, as index.html leaves its own preloads.
      if ((path === "/" || path === "/index.html" || path === "/play.html") && file.ok && !url.searchParams.has("device")) file.headers.set("link", mapRoute.link);
      return file;
    }),
    websocket: {
      maxPayloadLength: MESSAGE_BYTES_MAX,
      open: timed(parts, PART.sockets, (ws: ServerWebSocket<Socket>) => {
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
        // What it sent and skipped, and what waits, are read for the record of play (server/playlog.ts).
        const conn: Connection & { open: boolean; bytesSent: number; skipped: number; readonly buffered: number } = {
          open: true,
          bytesSent: 0,
          skipped: 0,
          get buffered() {
            return ws.getBufferedAmount();
          },
          address: ws.data.address,
          onMessage: null,
          onClose: null,
          send(channel, data) {
            if (!conn.open) return;
            const rule = backlog(channel, ws.getBufferedAmount(), host.game.opts.snapshotBytesMax);
            if (rule === 1) return void (skipped++, conn.skipped++);
            if (rule === 2) return void ws.close(1008, "too slow");
            // Bun copies what it is given before send returns, so every message goes out through one buffer.
            const frame = data.length < outgoing.length ? outgoing.subarray(0, data.length + 1) : new Uint8Array(data.length + 1);
            frame[0] = channel;
            frame.set(data, 1);
            ws.send(frame);
            conn.bytesSent += frame.length;
          },
          close() {
            if (conn.open) ws.close();
          },
        };
        ws.data.conn = conn;
        onConnection?.(conn);
      }),
      message: timed(parts, PART.sockets, (ws: ServerWebSocket<Socket>, message: string | Buffer) => {
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
      }),
      close: timed(parts, PART.sockets, (ws: ServerWebSocket<Socket>) => {
        if (ws.data.voice) return void host.voice.disconnect(ws.data.voice);
        const conn = ws.data.conn as (Connection & { open: boolean }) | null;
        if (!conn) return;
        conn.open = false;
        conn.onClose?.();
      }),
    },
  });

  host.cluster?.listening(server.port ?? 0, (opts.publicUrl ?? "").replace(/\/+$/, ""), { client: clientDir, parts: opts.map ? resolve(partsFolder(opts.map)) : "" });

  // Each tick is timed for the admin page. The checkpoint is the keeper thread's work, so asking for it costs nothing
  // here, late or not.
  const stopTicks = tickLoop({
    tick: (due, behind) => {
      const began = performance.now();
      parts.due = due;
      host.game.behind = behind;
      host.game.tick();
      const ended = performance.now();
      meter.tick(due, began, ended);
      play?.ticked(due, began, ended, behind);
    },
    idle: () => {
      const began = performance.now();
      host.idle();
      parts.between(PART.idle, performance.now() - began);
    },
    drop: (ticks, at) => {
      meter.drop(ticks, at);
      host.game.giveUp(ticks);
      play?.drop(ticks);
    },
  });

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
      clearInterval(heartbeat); listings.close();
      stopTicks();
      server.stop(true);
      host.shutdown();
      mapRoute.close();
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
    play: resolve(import.meta.dir, "../var/play"),
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
