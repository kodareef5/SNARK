import { originAllowed } from "./origin.ts";
import { ServerDirectory, listingAddress } from "./directory.ts";
import { ABOUT_MAX, discordOf, plain, tagsOf } from "../shared/listing.ts";
import type { Server, ServerWebSocket } from "bun";
import { SurvivorAccess, entryReply } from "./survivor-access.ts";
// bun server/main.ts [--dev] [--reports folder] [--client-dir folder] [--config dir] [--port 8787] [--host address] [--public-url https://name.example | /path] [--map file.snmap] [--db var/world.db] [--allow-missing-content] [--restore backup-folder] [--no-backups] [--module file.ts] [--no-module name] [--cert cert.pem --key key.pem] [?Key=Value?Key2=Value2] [-Flag[=value]]
// SNARK_ADMIN_PASSWORD sets the `enablecheats` password, and SNARK_CLUSTER_PASSWORD the cluster's, which gives the higher
// rank on every world started with it. In a terminal, typed lines run as console commands with full rights.

import { CORE_CONTENT } from "../content/core.ts";
import { compileContent } from "../shared/content/registry.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { backlog, MESSAGE_BYTES_MAX, VOICE_BACKLOG, type Connection } from "../shared/net/transport.ts";
import { RESTART_GO, stampWire } from "../shared/net/protocol.ts";
import { PROBE_BODY, PROBE_CREATURE } from "../shared/world/proving.ts";
import { createHost, type Host } from "./host.ts";
import { LIVE_FILE, formatReport, loadConfigFolder } from "./settings/config.ts";
import { publicValues, type Rules } from "./settings/rules.ts";
import type { ModuleDef } from "./api/module.ts";
import { restoreBackup } from "./persist/backup.ts";
import { stopOnSignals } from "./signals.ts";
import type { VoicePeer } from "./voice.ts";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { gzip, inflateRawSync } from "node:zlib";
import { parsePack } from "../shared/pack/pack.ts";
import { allClips } from "../shared/pack/clips.ts";
import { parseManifest } from "../shared/pack/manifest.ts";
import { serveFile } from "./files.ts";
import { BODY_BYTES_MAX, clientAddress } from "./front.ts";
import { VideoLibrary } from "./video/library.ts";
import { screensAdmin } from "./video/routes.ts";
import { ScreenFeed, screenWorld } from "./video/screens.ts";
import { boardOwners, soundBoard } from "./sound-board.ts";
import { TitleScenes } from "./admin/title-scenes.ts";
import { actorOf, adminAsked, changedNothing, type AdminGate } from "./admin/gate.ts";
import { staffPasswords } from "./permissions/secrets.ts";
import { PAGE_ACTOR, type Actor } from "./acts.ts";
import { adminSite, oldAdminPage } from "./admin/site.ts";
import { TickMeter } from "./admin/meter.ts";
import { PART, type TickParts } from "./admin/parts.ts";
import { AdminPages, adminTerrain } from "./admin/routes.ts";
import { gaugesOf } from "./admin/stats.ts";
import { debugAnswer, serverState, type DebugServer } from "./debug.ts";
import { ServerLog, teeConsole } from "./log.ts";
import { CUES } from "../shared/sound/cues.ts";
import { partHash, partsFolder, readHead, type MapFile } from "../shared/world/mapfile.ts";
import { mapLabel, type Destination } from "./cluster/cluster.ts";
import { PlayLog, REPORT_BYTES_MAX } from "./playlog.ts";
import { ReportStore } from "./reports.ts";
import { builtWire, serverWire } from "./wire.ts";
import type { Ready } from "../shared/ready.ts";
import type { Client } from "./game.ts";
import { comingSoonPage, htmlResponse, linkOf, pathOf, placeOf, startPage, worldAddress, type SiteLinks, type SiteWorld } from "./site.ts";

export interface ServerOptions {
  port?: number;
  /** The address to listen on. Without one a development server listens on this machine only, and any other on every address. */
  hostname?: string;
  /** Enables the self-check report endpoint and cheats without a password. Never set in a public deployment. */
  dev?: boolean;
  /** Password for `enablecheats`. Without it (and without `dev`) cheats are off. */
  adminPassword?: string;
  /** The cluster's password, which `enablecheats` and the admin pages take at the cluster's rank. */
  clusterPassword?: string;
  /** Read console commands from standard input, as the operator. */
  terminal?: boolean;
  /** Path of the map file to run (shared/world/mapfile.ts). Without one, the proving ground. */
  map?: string;
  /** See `StoreOptions.allowMissingContent`. */
  allowMissingContent?: boolean;
  dbPath?: string;
  /** With a save: skip the backups made beside it at every autosave mark. */
  noBackups?: boolean;
  /**
   * Host a server directory at /directory, which worlds announce themselves to and titles search (server/directory.ts).
   * Off unless the operator asks for it.
   */
  directory?: boolean;
  /**
   * The server directories this world is listed in and its title searches (SNARK_DIRECTORY_URL, any number). It
   * announces its --public-url, which must be HTTPS on port 443, to each every minute, and its entry-world.json says it
   * asks to be listed; each directory reads the rest from there.
   */
  directories?: readonly string[];
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
  /**
   * The folder bug reports are kept in (server/reports.ts), one for the checkout whatever the world. Run from the command
   * line, a development server keeps them in var/reports; any other keeps none unless started with --reports <folder>.
   */
  reports?: string;
  /**
   * The log the console's lines are kept in for the debug bar (server/log.ts), made before the server to keep what came
   * first. Without one the server makes its own.
   */
  log?: ServerLog;
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
  /** The console's recent lines, which `__debug` gives an admin. */
  readonly log: ServerLog;
  stop(): void;
  /**
   * Stops as `stop` does, after telling every page to leave for its waiting page and giving them `graceMs` to go: the
   * waiting page must be fetched while the server still answers. With nobody connected it stops at once.
   */
  stopGently(graceMs?: number): Promise<void>;
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

/** `bytes` gzipped off the request thread. */
const gzipOff = promisify(gzip);

/** The map's routes (mapRoutes), and how to let go of the file they hold. */
export type MapRoute = ((path: string, req: Request) => Response | Promise<Response> | null) & { readonly link: string; readonly version: number; close(): void };

/**
 * Answers a client's requests for the map. `/map.json` names the map and its head, and `/map/<name>` is the head or a part
 * by the name the head gives it (shared/world/mapfile.ts); any other name there is not found, and any other path is null.
 * A name carries its bytes' hash, so whoever fetched it keeps it for good. A map given by its path sends each part from the
 * copies its build wrote beside it (tools/map/pack.ts), Brotli to a browser that takes it and gzip to one that does not (on
 * plain http). The raw bytes, for a client that takes neither and for a range, are always read from the file. The file is
 * held open as it was at the start, and `hash`, the world's, must be its: a build replaces it whole and takes away the
 * copies its new head does not name, so a part this server names and its folder no longer has is cut from the file it
 * holds, and gzipped once off the request thread. That holds the old file's disk until the server stops, and its parts'
 * gzip in memory once asked for. A map made in code is cut likewise. `link` is the header that has a page
 * ask for the head and landmark definitions before JavaScript reads map.json.
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
  const landmarks = head.parts.find(part => part.kind === "land");
  const link = [head.name, ...(landmarks ? [landmarks.name] : [])]
    .map(name => `<map/${name}>; rel=preload; as=fetch; crossorigin`).join(", ");
  const folder = typeof file === "string" ? partsFolder(file) : "";
  const wanted = new Map([{ name: head.name, at: 0, length: head.bytes, hash: "" }, ...head.parts].map((p) => [p.name, p]));
  if (typeof file === "string") {
    const bare = [...wanted.keys()].filter((name) => folder === "" || !existsSync(join(folder, `${name}.br`)) || !existsSync(join(folder, `${name}.gz`))).length;
    if (bare > 0) console.log(`map: ${bare} of the ${wanted.size} parts of ${file} have no Brotli or gzip copy beside it, so those are cut and gzipped as they are asked for: bun tools/map.ts pack ${file} writes them`);
  }
  const zipped = new Map<string, Promise<Uint8Array>>();
  const headers = { "content-type": "application/octet-stream", "cache-control": "public, max-age=31536000, immutable", vary: "accept-encoding" };
  /** A part as the file this server holds has it: never another build's, which a file written over in place would give. */
  const cut = async (name: string, req: Request): Promise<Response> => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get("range") ?? "");
    const gzip = !range && (req.headers.get("accept-encoding") ?? "").includes("gzip");
    const kept = gzip ? zipped.get(name) : undefined;
    if (kept) return new Response(await kept, { headers: { ...headers, "content-encoding": "gzip" } });
    const p = wanted.get(name)!;
    const bytes = name === head.name ? first.subarray(0, head.bytes) : at(p.at, p.length);
    if (name !== head.name && partHash(bytes) !== p.hash) {
      console.log(`map: ${String(file)} was written over in place while the server ran, so its part ${name} is gone: start the server again`);
      return new Response("gone", { status: 410 });
    }
    if (range) {
      const from = Number(range[1]);
      const to = range[2] === "" ? bytes.length - 1 : Math.min(Number(range[2]), bytes.length - 1);
      if (from >= bytes.length || to < from) return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${bytes.length}` } });
      return new Response(bytes.slice(from, to + 1), { status: 206, headers: { ...headers, "accept-ranges": "bytes", "content-range": `bytes ${from}-${to}/${bytes.length}` } });
    }
    if (!gzip) return new Response(bytes, { headers: { ...headers, "accept-ranges": "bytes" } });
    if (!zipped.has(name)) zipped.set(name, gzipOff(bytes));
    return new Response(await zipped.get(name)!, { headers: { ...headers, "content-encoding": "gzip" } });
  };
  /** A part from its own best copy beside the map, Brotli then gzip, else cut from the file this server holds. */
  const send = async (name: string, req: Request): Promise<Response> => {
    if (folder !== "" && !req.headers.has("range")) {
      const accepts = req.headers.get("accept-encoding") ?? "";
      for (const [encoding, end] of [["br", "br"], ["gzip", "gz"]] as const) {
        if (!accepts.includes(encoding)) continue;
        const copy = Bun.file(join(folder, `${name}.${end}`));
        if (await copy.exists()) return new Response(copy, { headers: { ...headers, "content-encoding": encoding } });
      }
    }
    return cut(name, req);
  };
  return Object.assign(
    (path: string, req: Request): Response | Promise<Response> | null => {
      if (path === "/map.json") return new Response(json, { headers: { "content-type": "application/json", "cache-control": "no-cache" } });
      if (!path.startsWith("/map/")) return null;
      const name = path.slice(5);
      if (!wanted.has(name)) return new Response("not found", { status: 404 });
      return send(name, req);
    },
    { link, version: head.version, close },
  );
}

export { originAllowed } from "./origin.ts";

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

/** A page's sign-in is logged again after half an hour. */
const SIGN_IN_TICKS = 30 * 60 * TICK_RATE;
/** Sign-ins remembered; past this the oldest is forgotten. */
const SIGN_INS_KEPT = 1024;

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

/** The game's own modules: each file at the top of this folder is one, named for its file. */
export const OWN_MODULES = resolve(import.meta.dir, "../modules");

/**
 * The modules a server runs: the game's own (modules/*.ts) but those `off` names (ModulesOff) or `--no-module` names,
 * then each `--module <file>`, then every file of the config folder's `modules`, each by name.
 */
export async function loadModules(args: readonly string[], folder: string, off = ""): Promise<ModuleDef[]> {
  const skip = new Set([...off.split(/[\s,]+/), ...args.flatMap((a, i) => (a === "--no-module" && args[i + 1] ? [args[i + 1]!] : []))].filter((n) => n !== ""));
  const files: string[] = [];
  const own = existsSync(OWN_MODULES) ? readdirSync(OWN_MODULES).sort().filter((n) => n.endsWith(".ts")) : [];
  for (const name of own) if (!skip.has(name.slice(0, -3))) files.push(resolve(OWN_MODULES, name));
  files.push(...args.flatMap((a, i) => (a === "--module" && args[i + 1] ? [resolve(args[i + 1]!)] : [])));
  const beside = folder === "" ? "" : join(folder, "modules");
  if (beside !== "" && existsSync(beside)) for (const name of readdirSync(beside).sort()) if (name.endsWith(".ts")) files.push(resolve(beside, name));
  const modules: ModuleDef[] = [];
  for (const file of files) {
    const def = ((await import(file)) as { default?: ModuleDef }).default;
    if (!def || typeof def.setup !== "function") throw new Error(`${file} is not a module: it exports no default with a setup`);
    // One of the game's own is named for its file, so it can be left out by that name before it is read.
    if (file.startsWith(OWN_MODULES) && `${def.name}.ts` !== file.slice(OWN_MODULES.length + 1)) throw new Error(`${file}: the game's own module is named for its file, and this one is called ${def.name}`);
    if (skip.has(def.name)) continue;
    modules.push(def);
  }
  if (modules.length > 0) console.log(`modules: ${modules.map((m) => m.name).join(", ")}${skip.size > 0 ? `; left out: ${[...skip].join(", ")}` : ""}`);
  return modules;
}

export function startServer(opts: ServerOptions = {}): RunningServer {
  // First, so that the lines of the start are kept.
  const log = opts.log ?? new ServerLog();
  const untee = teeConsole(log);
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
  const { wire, stale } = serverWire(clientDir);
  stampWire(wire);
  if (stale) console.log(`client: ${clientDir} was built from other source than this server runs, so its page is refused: bun run build`);
  const served = (file: number): Uint8Array => new Uint8Array(readFileSync(join(clientDir, "assets", manifest.files[file]!.name)));
  const pack = parsePack(served(manifest.boot));
  const clips = allClips(manifest, pack, served, (stored) => new Uint8Array(inflateRawSync(stored)));
  let terrain: Uint8Array<ArrayBuffer> | undefined;
  const onMapLoaded = (map: MapFile): void => void (terrain = adminTerrain(map));
  const roles = { onMapLoaded, dev: opts.dev ?? false, clips, rigs: pack.header.rigs, ...(opts.map ? { map: opts.map } : {}), ...(opts.adminPassword ? { adminPassword: opts.adminPassword } : {}), ...(opts.clusterPassword ? { clusterPassword: opts.clusterPassword } : {}), ...(opts.config ? { config: opts.config } : {}), ...(opts.modules ? { modules: opts.modules } : {}), now: () => performance.now(), ...(opts.live ? { live: opts.live } : {}) };
  const host = createHost(registry, opts.probeScene ? { ...roles, startingCreatures: 0, wakeRadius: -1 } : { ...roles, ...(opts.dbPath ? { dbPath: opts.dbPath, keeper: "worker" as const, survivorLog: { mode: "worker" as const }, backups: !opts.noBackups, store: { allowMissingContent: opts.allowMissingContent ?? false } } : {}), wild: true });
  log.tick = () => host.world.tick;
  // Settings problems are logged at startup and do not stop the server.
  for (const m of host.lists.missing) console.log(`settings: ${m.setting} names ${m.name}, which this build does not have`);
  for (const m of host.lists.renamed) console.log(`settings: ${m.setting} names ${m.name}, which is now ${m.to.join(", ")}`);
  for (const m of host.lists.unclear) console.log(`settings: ${m.setting} names ${m.name}, which could be ${m.could.join(" or ")}, so write the one meant in full`);
  for (const line of host.passed) console.log(`settings: passed over: ${line}`);
  if (!opts.probeScene && host.spawner === null && host.world.zones.every((z) => z.spawns === undefined)) console.log(`map: neither the content nor the map file gives ${host.world.mapId} a spawn region, so no wild creature lives on it`);
  const access = new SurvivorAccess(host);
  const entryBuilt = existsSync(join(clientDir,"entry.js"));
  // Directories: the ones this world is listed in, and its own if it hosts one. Its title searches them all.
  const titleScenes = new TitleScenes(
    host.cluster ? join(host.cluster.folder.root, "title-scenes.sqlite") : opts.dbPath ? opts.dbPath + ".title-scenes.sqlite" : ":memory:",
    clientDir,
  );
  // The cluster's clips and what its screens play, which every world reads and the admin pages change.
  const cluster = host.cluster?.folder.root;
  const video = new VideoLibrary({
    db: cluster ? join(cluster, "video.sqlite") : opts.dbPath ? opts.dbPath + ".video.sqlite" : ":memory:",
    ...(cluster ? { media: join(cluster, "media"), tmp: join(cluster, "tmp") } : opts.dbPath ? { media: opts.dbPath + ".media" } : {}),
    starters: join(clientDir, "media", "starter.json"),
  });
  const screens = new ScreenFeed(video, host.world);
  screens.attach(host.game);
  screens.poll();
  const screenTimer = setInterval(() => screens.poll(), 1000);
  const listings = opts.directory ? new ServerDirectory(host.cluster ? join(host.cluster.folder.root,"directory.sqlite") : opts.dbPath ? opts.dbPath+".directory.sqlite" : ":memory:") : null;
  const directories = opts.directories ?? [];
  const directory = [...directories, ...(listings ? ["directory"] : [])].join(" ");
  const listed = directories.length > 0 || !!listings;
  const self = (() => { try { return listed && opts.publicUrl ? listingAddress(opts.publicUrl).href : ""; } catch { return ""; } })();
  if (listed && !self) console.log("directory: this world is listed nowhere until --public-url gives its public HTTPS address on port 443");
  const announce = () => {
    if (!self) return;
    for (const to of directories) void fetch(to,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"announce",address:self}),signal:AbortSignal.timeout(8000)}).catch(()=>{});
    if (listings) void listings.announce(self, "this world").catch(() => {});
  };
  const heartbeat = setInterval(announce,60000); announce();
  const mapRoute = mapRoutes(opts.map ?? host.mapFile!, host.world.mapId, host.world.mapHash);
  // The shared families of sounds are the owners the catalogue's fallbacks name.
  const families = [...new Set(CUES.flatMap((c) => c.falls.map((f) => f.slice(0, f.indexOf("/")))).filter((o) => o !== "{owner}"))];
  // A page brings its password with every request, so its sign-in is logged once in half an hour for each name, rank and address.
  const signIns = new Map<string, number>();
  const signedIn = (by: Actor): void => {
    const key = `${by.name}\n${by.rank}\n${by.from}`;
    const tick = host.world.tick;
    const last = signIns.get(key);
    if (last !== undefined && tick - last < SIGN_IN_TICKS) return;
    signIns.delete(key);
    if (signIns.size >= SIGN_INS_KEPT) signIns.delete(signIns.keys().next().value!);
    signIns.set(key, tick);
    // A copy, so the request's own actor counts as having logged nothing yet (pageChange).
    host.acts.write({ ...by }, "opened the admin pages", "sign-in");
  };
  const board: AdminGate = { dev: opts.dev ?? false, password: host.adminPassword, cluster: host.clusterPassword, guesses: host.game.sessions.cheatGuesses, tick: () => host.world.tick, world: host.cluster?.world, passed: signedIn, staff: staffPasswords(host) };
  /** An admin page's change whose handler logged nothing is logged by its method and path. */
  const pageChange = <T extends Response | Promise<Response> | null>(req: Request, path: string, answer: T): T => {
    if (answer === null || req.method === "GET" || req.method === "HEAD") return answer;
    const log = (res: Response): Response => {
      const by = actorOf(req);
      if (res.ok && by !== PAGE_ACTOR && !host.acts.wroteFor(by) && !changedNothing(req)) host.acts.write(by, `${req.method} ${path}`);
      return res;
    };
    return (answer instanceof Promise ? answer.then(log) : log(answer as Response)) as T;
  };
  const meter = new TickMeter(() => gaugesOf(host));
  const playFile = opts.dev && opts.play ? join(opts.play, `${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.jsonl`) : "";
  const play = playFile ? new PlayLog(host.game, (line) => (mkdirSync(opts.play!, { recursive: true }), appendFileSync(playFile, line + "\n"))) : null;
  const admin = new AdminPages({ host, meter, dir: join(clientDir, "admin"), terrain, start: { tick: host.world.tick, wall: meter.startedAt } });
  const checkout = resolve(import.meta.dir, "..");
  const notes = opts.reports ? new ReportStore({ dir: opts.reports, root: checkout, clientDir, map: { id: host.world.mapId, city: mapLabel(registry, host.world.mapId), ...(opts.map ? { file: relative(checkout, resolve(opts.map)) } : {}), version: mapRoute.version, hash: host.world.mapHash } }) : null;
  /** The session a page's voice token names, which a bug report and the debug bar are sent with. */
  const sender = (slot: number, token: Uint8Array): Client | null => host.voice.sessionOf(slot, token);
  /** What a bug report is told of this server: the session a token names, and the server's state for its server.json. */
  const reportServer = { sender, facts: (c: unknown): Record<string, unknown> => ({ ...serverState(host, meter, c as Client) }) };
  /** What the debug bar is told of this server: its log, the session a token names, and the server's state. */
  const debugServer: DebugServer = { log, sender, state: (c) => serverState(host, meter, c) };
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
  host.game.sessions.listen({
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
    const all: (Omit<Destination, "world" | "why"> & { world: SiteWorld["id"] })[] = c ? [c.here(), ...c.destinations()].sort((a, b) => a.world - b.world) : [{ world: "local", name: host.rules.text("SessionName") || map, map, mapId: host.world.mapId, port: server.port ?? 0, url: base, players: host.game.playerCount, max: host.game.opts.maxClients }];
    const straight = Number(/:(\d+)$/.exec(requestHost)?.[1] ?? 0) === server.port;
    const locks=new Map(access&&c ? c.folder.announcements().map(a=>[a.port,a.password]) : []);
    return all.map(w=>{
      const password=w.port===server.port ? !!host.game.opts.password : locks.get(w.port);
      return {id:w.world,name:w.name,map:w.map,mapId:w.mapId,address:c ? worldAddress(w,requestHost,straight) : base + "/",players:w.players,max:w.max,...(access && password!==undefined ? {password}: {})};
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
    maxRequestBodySize: BODY_BYTES_MAX,
    ...(hostname ? { hostname } : {}),
    ...(opts.cert && opts.key ? { tls: { cert: Bun.file(opts.cert), key: Bun.file(opts.key) }, http2: true } : {}),
    fetch: timed(parts, PART.http, async (req: Request, srv: Server<Socket>) => {
      const url = new URL(req.url);
      const answered = opts.routes?.(req, url);
      if (answered) return answered;
      const clusterPath = url.pathname;
      if (clusterPath === "/cluster/title-scene.json" || clusterPath === "/cluster/title-poster.webp" ||
          clusterPath === "/cluster/loader-scene.json" || clusterPath === "/cluster/loader-poster.webp") {
        if (req.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
        const portrait = url.searchParams.has("portrait");
        switch (clusterPath) {
          case "/cluster/title-poster.webp": return titleScenes.poster(portrait);
          case "/cluster/loader-poster.webp": return titleScenes.loaderPoster(portrait);
          case "/cluster/loader-scene.json": return titleScenes.loader();
          default: return titleScenes.active();
        }
      }
      const who = clientAddress(srv.requestIP(req)?.address ?? "", req.headers.get("x-forwarded-for"));
      const local = !opts.dev || namesThisMachine(req.headers.get("host"), named);
      const gate = local ? board : { ...board, dev: false };
      const id = host.cluster?.world ?? "local";
      const siteAdmin = pageChange(req, url.pathname, adminSite(req, url, {
        dir: clientDir, base, port: srv.port ?? 0, id, who, gate,
        destinations: () => host.cluster?.destinations() ?? [],
        scenes: (call) => originAllowed(call.headers.get("origin"), call.headers.get("host"), "")
          ? titleScenes.admin(call, host.acts, host) : entryReply({ error: "Open the studio on this cluster." }, 403),
        screens: (call, at) => call.method === "POST" && !originAllowed(call.headers.get("origin"), call.headers.get("host"), "")
          ? entryReply({ error: "Open the screens page on this cluster." }, 403) : screensAdmin(call, at, video, () => screenWorld(host), host.acts, host),
      }));
      if (siteAdmin) return siteAdmin;
      const { at, path } = placeOf(base, url.pathname);
      if (at === "slash") return new Response(null, { status: 308, headers: { location: `${base}/${url.search}` } });
      if (path === "/directory") return listings ? listings.answer(req, who) : new Response("this world hosts no server directory", { status: 404 });
      const same = alike(path, req.headers.get("host") ?? "");
      if (same) return same;
      // Uploaded clips and manifests from the library's folder, starters from the built client.
      if (path.startsWith("/media/")) {
        const kept = await serveFile(video.media, req, path.slice("/media".length));
        return kept.status !== 404 ? kept : serveFile(clientDir, req, path);
      }
      if (at === "site") {
        if (path === "/" || path === "/index.html") return htmlResponse(startPage(worlds(req.headers.get("host") ?? ""), links(), entryBuilt ? {world:false,directory} : undefined));
        // The admin pages are a world's, behind its admin password (server/admin/gate.ts), and not the site's to hand out.
        return adminAsked(path) ? new Response("not found", { status: 404 }) : serveFile(clientDir, req, path);
      }
      // A development server's own routes and its sockets are for a browser that asked for this machine (namesThisMachine).
      if (path === "/survivors") {
        if (!local || !originAllowed(req.headers.get("origin"),req.headers.get("host"),"")) return entryReply({error:"Use this world’s own address"},403);
        return access.answer(req,who);
      }
      // What a waiting page asks to know the server is back (client/core/waiting.ts): this start, the version it speaks,
      // and the version of the page on disk now, which is another until the client is built.
      if (path === "/ready.json") return new Response(JSON.stringify({ started: meter.startedAt, wire, page: builtWire(clientDir), map: host.world.mapId } satisfies Ready), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
      if (path === "/entry-world.json") return entryReply({ name:host.rules.text("SessionName") || mapLabel(registry,host.world.mapId), map:mapLabel(registry,host.world.mapId), mapId:host.world.mapId, password:!!host.game.opts.password, players:host.game.playerCount, max:host.game.opts.maxClients, listed, pve:host.rules.on("serverPVE"), about:plain(host.rules.text("ServerDescription")).slice(0,ABOUT_MAX), discord:discordOf(host.rules.text("DiscordUrl")), tags:tagsOf(host.rules.text("ServerTags")), spawns:host.world.spawns.map(p=>({name:p.name,x:p.x,z:p.z})), width:host.world.hf.sizeX,height:host.world.hf.sizeZ });
      if (entryBuilt && (path === "/" || path === "/index.html") && [...url.searchParams.keys()].every(k => ["screen","invite","survivor"].includes(k))) return htmlResponse(startPage(worlds(req.headers.get("host") ?? ""),links(),{world:true,directory}));
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
      // Not for this machine alone either, and taken from an admin's session only (server/reports.ts).
      if (path === "/__report") return notes ? notes.answer(req, reportServer) : new Response("this server keeps no reports: a development server keeps them, and any other only when started with --reports <folder>", { status: 404 });
      // Every server's, for the debug bar: the protocol's names for anyone, the log and the server's state for an admin's session.
      if (path === "/__debug") return debugAnswer(req, debugServer);
      if (path === "/__bench" && req.method === "POST" && opts.dev && local) {
        const result = await req.json();
        console.log(`frame times from a browser:\n${JSON.stringify(result, null, 2)}`);
        measured(result);
        return new Response("ok");
      }
      const old = oldAdminPage(req, path, id, who, gate);
      if (old) return old;
      const sounds = pageChange(req, path, soundBoard(req, who, gate, join(clientDir, "sounds.html"), () => boardOwners(registry, families), undefined, path));
      if (sounds) return sounds;
      const page = pageChange(req, path, admin.answer(req, who, gate, path));
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
        function admit(channel: number): boolean {
          if (!conn.open) return false;
          const rule = backlog(channel, ws.getBufferedAmount(), host.game.opts.snapshotBytesMax);
          if (rule === 1) {
            skipped++;
            conn.skipped++;
          } else if (rule === 2) ws.close(1008, "too slow");
          return rule === 0;
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
          admit,
          send(channel, data) {
            if (!admit(channel)) return;
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
      host.game.replication.behind = behind;
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
      host.game.replication.giveUp(ticks);
      play?.drop(ticks);
    },
  });

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearInterval(heartbeat); listings?.close(); titleScenes.close();
    clearInterval(screenTimer); video.close();
    stopTicks();
    server.stop(true);
    host.shutdown();
    mapRoute.close();
    untee();
  };

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
    log,
    stop,
    async stopGently(graceMs = STOP_GRACE_MS) {
      if (stopped) return;
      const some = host.game.playerCount > 0;
      host.game.sendRestart(RESTART_GO);
      // The ticks go on meanwhile, so each socket that closes is seen to.
      const until = performance.now() + graceMs;
      while (!stopped && host.game.playerCount > 0 && performance.now() < until) await new Promise((r) => setTimeout(r, 25));
      // A page that has just left is still fetching its waiting page's pictures.
      if (some && !stopped) await new Promise((r) => setTimeout(r, STOP_LINGER_MS));
      stop();
    },
  };
}

/** The longest a stop waits for its pages to leave for their waiting page, in milliseconds. */
export const STOP_GRACE_MS = 2000;
/** How long it goes on answering once the last page has left, in milliseconds. */
export const STOP_LINGER_MS = 300;

if (import.meta.main) {
  // Before the settings are read, so that what they say is kept with the rest.
  const log = new ServerLog();
  teeConsole(log);
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
  const modules = await loadModules(args, folder, rules.text("ModulesOff"));
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
    clientDir: value("--client-dir"),
    publicUrl: value("--public-url"),
    dev,
    play: resolve(import.meta.dir, "../var/play"),
    reports: value("--reports") ?? (dev ? resolve(import.meta.dir, "../var/reports") : undefined),
    config: rules,
    ...(live ? { live } : {}),
    map: value("--map"),
    allowMissingContent: args.includes("--allow-missing-content"),
    dbPath: value("--db"),
    noBackups: args.includes("--no-backups"),
    directory: args.includes("--directory"),
    directories: (process.env.SNARK_DIRECTORY_URL ?? "").split(/[\s,]+/).filter(Boolean),
    modules,
    cert: value("--cert"),
    key: value("--key"),
    adminPassword: process.env.SNARK_ADMIN_PASSWORD,
    clusterPassword: process.env.SNARK_CLUSTER_PASSWORD,
    terminal: process.stdin.isTTY,
    log,
  });
  console.log(`SNARK listening on ${value("--cert") && value("--key") ? "https" : "http"}://localhost:${running.port}${pathOf(value("--public-url") ?? "")}/`);
  stopOnSignals((hurry) => (hurry ? running.stop() : running.stopGently()));
  // A stop asked for in the game or on the admin page (doexit): the pages leave, the world is saved, the process ends.
  running.host.onStop = () => void running.stopGently().then(() => process.exit(0), (err) => (console.error(err), process.exit(1)));
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
