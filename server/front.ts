// One address for every world of a cluster, for whatever reaches only one place: a quick tunnel, a single forwarded port.
// Each world is reached at its own path (--public-url /miami), and the site around them, which every one of them answers
// alike (server/site.ts), at any. This passes each request and socket on to the world whose path it falls under, and the
// rest to the lowest world running. It finds them in the cluster's folder, as they find each other, and keeps nothing.
//
//   bun server/front.ts --cluster var/cluster/clusters/<id> [--port 8787] [--host address]
//
// A world's built files and its map's parts it answers from disk itself, where the world says they are, so that they never
// wait behind the world's tick.
//
// A tunnel or proxy that routes by path itself, as a named Cloudflare tunnel's ingress rules do, needs none of this: it sends
// each world's path to that world's port and every other path to any of them.

import type { ServerWebSocket } from "bun";
import { resolve } from "node:path";
import { backlog, MESSAGE_BYTES_MAX, VOICE_BACKLOG } from "../shared/net/transport.ts";
import { worldAdminPage } from "./admin/site.ts";
import { ClusterFolder, LIVE_MS, type Announcement } from "./cluster/folder.ts";
import { serveFile } from "./files.ts";
import { pathOf, placeOf } from "./site.ts";

const WORLD_POSTS = new Set([
  "/survivors", "/directory", "/__play", "/__report", "/__debug",
  "/admin/cast", "/admin/settings", "/admin/stop",
  "/admin/loadouts/book", "/admin/loadouts/reset", "/admin/loadouts/apply",
  "/admin/supply/book", "/admin/supply/reset", "/admin/supply/restore", "/admin/supply/call",
  "/admin/supply/land", "/admin/supply/cancel", "/admin/supply/ark",
]);

/** The front passes reads, registered writes at a world's path, and the site's scene editor. */
export function frontPasses(method: string, path: string): boolean {
  if (method === "GET" || method === "HEAD") return true;
  return method === "OPTIONS" ? path === "/directory" : method === "POST" && WORLD_POSTS.has(path);
}

function sitePost(path: string): boolean {
  return path === "/admin/scenes/api" || path === "/cluster/admin/scenes/api";
}

/** A world's mount, port and where to read its built files. */
export interface FrontWorld {
  world: number;
  path: string;
  port: number;
  authority?: string;
  files?: Announcement["files"];
}

/**
 * The worlds of a folder's announcements that are running and listening, lowest world first. A world whose public address
 * has no path a world may be reached at (pathOf) is left out.
 */
export function frontWorlds(all: readonly Announcement[], now: number): FrontWorld[] {
  const out: FrontWorld[] = [];
  for (const a of all) {
    if (a.at <= now - LIVE_MS || a.port === 0) continue;
    try {
      const path = pathOf(a.url);
      const authority = /^https?:\/\//i.test(a.url) ? new URL(a.url).host : undefined;
      out.push({ world: a.world, path, port: a.port, ...(authority ? { authority } : {}), ...(a.files ? { files: a.files } : {}) });
    } catch {
      // Its own server refused that address as it started, so it is not running with it.
    }
  }
  return out.sort((a, b) => a.world - b.world);
}

/**
 * World admin pages go by id. Other routes go to the longest matching mount, then the lowest mounted world or first world.
 */
export function frontRoute(worlds: readonly FrontWorld[], pathname: string, authority?: string): FrontWorld | null {
  const admin = worldAdminPage(pathname);
  if (admin) {
    const host = authority?.toLowerCase();
    const reachable = host ? worlds.filter((w) => !w.authority || w.authority === host) : worlds;
    return reachable.find((w) => w.world === admin.id) ?? reachable.find((w) => w.path !== "") ?? reachable[0] ?? null;
  }
  let best: FrontWorld | null = null;
  for (const w of worlds) if (w.path.length > (best?.path.length ?? 0) && (pathname === w.path || pathname.startsWith(`${w.path}/`))) best = w;
  return best ?? worlds.find((w) => w.path !== "") ?? worlds[0] ?? null;
}

const onThisMachine = (address: string): boolean => address === "::1" || address.startsWith("127.") || address.startsWith("::ffff:127.");

/**
 * Who a request came from: its peer, or for a peer on this machine (the front, a tunnel's connector) the last address its
 * X-Forwarded-For names that is not on this machine, which the proxy nearest the client wrote. Nothing reaching a server
 * from elsewhere may say who it is.
 */
export function clientAddress(peer: string, forwarded: string | null): string {
  if (forwarded === null || !onThisMachine(peer)) return peer;
  let who = peer;
  for (const part of forwarded.split(",")) {
    const a = part.trim();
    if (/^[0-9a-f.:]{2,45}$/i.test(a) && !onThisMachine(a)) who = a;
  }
  return who;
}

/**
 * A world's built file or map part, `pathname` falling under its path, answered from disk as the world itself answers it
 * (serveFile); null for any other path or for a file not there, which the world answers.
 */
export async function fromDisk(req: Request, pathname: string, to: FrontWorld): Promise<Response | null> {
  const rest = to.path === "" ? pathname : pathname.startsWith(`${to.path}/`) ? pathname.slice(to.path.length) : "";
  const dir = rest.startsWith("/assets/") ? to.files?.client : rest.startsWith("/map/") ? to.files?.parts : "";
  if (!dir) return null;
  const res = await serveFile(dir, req, rest.startsWith("/map/") ? rest.slice(4) : rest);
  return res.status === 404 ? null : res;
}

/** Headers that belong to one connection and so are not passed on. */
const HOP = ["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer"];

/** SnapshotBytesMax at its most, so the front skips nothing a world would send. */
const SNAPSHOT_BYTES_MOST = 2200;

/** A close code a socket may be closed with: the one given where it may be sent, and else a plain close. */
export function closeCode(code: number): number {
  return code === 1000 || (code >= 1001 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) || (code >= 3000 && code <= 4999) ? code : 1000;
}

export interface Pipe {
  /** The world's socket, open before the page's is taken. */
  up: WebSocket;
  voice: boolean;
  /** What the world sent before the page's socket was open, sent once it is. */
  early: Uint8Array[];
  down: ServerWebSocket<Pipe> | null;
}

/**
 * The world's socket at `target`, asked for with the page's headers, once it is open; null if the world turns it away or
 * does not answer. The page's socket is taken only then, so a page the world refuses is refused as the world itself would.
 */
function openUp(target: string, headers: Record<string, string>): Promise<WebSocket | null> {
  return new Promise((done) => {
    const up = new WebSocket(target, { headers });
    up.binaryType = "arraybuffer";
    const timer = setTimeout(() => (up.close(), done(null)), 10_000);
    up.onopen = () => (clearTimeout(timer), done(up));
    up.onerror = up.onclose = () => (clearTimeout(timer), done(null));
  });
}

/**
 * Sends a world's message on to its page. The world sees no backlog past the front, so the front keeps the world's rule
 * (backlog): what a slow page would wait behind is skipped, and a page far behind is dropped.
 */
export function sendDown(ws: Pick<ServerWebSocket<Pipe>, "data" | "getBufferedAmount" | "send" | "close">, m: Uint8Array): void {
  const buffered = ws.getBufferedAmount();
  const rule = ws.data.voice ? (buffered > VOICE_BACKLOG ? 1 : 0) : backlog(m[0] ?? 0, buffered, SNAPSHOT_BYTES_MOST);
  if (rule === 2) ws.close(1008, "too slow");
  else if (rule === 0) ws.send(m);
}

/** Passes a request on to `to`, as it came, and its answer back as it was sent: compressed where it was. */
async function pass(req: Request, url: URL, to: FrontWorld, forwarded: string): Promise<Response> {
  const headers = new Headers(req.headers);
  for (const h of HOP) headers.delete(h);
  headers.set("x-forwarded-for", forwarded);
  try {
    const res = await fetch(`http://127.0.0.1:${to.port}${url.pathname}${url.search}`, { method: req.method, headers, ...(req.method === "POST" ? { body:req.body } : {}), redirect: "manual", decompress: false, signal: req.signal });
    const back = new Headers(res.headers);
    for (const h of HOP) back.delete(h);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: back });
  } catch {
    return new Response("that world is not answering", { status: 502 });
  }
}

export interface RunningFront {
  readonly port: number;
  stop(): void;
}

/**
 * Starts the front for the cluster whose folder is `dir`, on `port` (0 for any) and, if it is given, only at `hostname`.
 * `log` hears each change in the worlds it sends to.
 */
export function startFront(dir: string, port = 8787, hostname?: string, log: (line: string) => void = () => {}): RunningFront {
  const folder = new ClusterFolder(resolve(dir));
  let known: FrontWorld[] = [];
  let read = 0;
  let said = "";
  /** The worlds running, read again at most once a second. */
  const worlds = (): FrontWorld[] => {
    const now = Date.now();
    if (now - read < 1000) return known;
    [known, read] = [frontWorlds(folder.announcements(), now), now];
    const news = known.map((w) => `${w.path || "/"} -> ${w.port}`).join(", ") || "none running";
    if (news !== said) log(`worlds: ${(said = news)}`);
    return known;
  };
  const server = Bun.serve<Pipe>({
    port,
    ...(hostname ? { hostname } : {}),
    async fetch(req, srv) {
      const url = new URL(req.url);
      const to = frontRoute(worlds(), url.pathname, req.headers.get("host") ?? url.host);
      if (!to) return new Response("no world of this cluster is running", { status: 503, headers: { "retry-after": "10" } });
      const { at, path } = placeOf(to.path, url.pathname);
      const allowed = req.method === "GET" || req.method === "HEAD" ||
        (at === "world" && frontPasses(req.method, path)) || (req.method === "POST" && sitePost(url.pathname));
      if (!allowed) return new Response("not here", { status: 405, headers: { allow: "GET, HEAD" } });
      // The world believes who the client is from a proxy on its own machine (clientAddress).
      const peer = srv.requestIP(req)?.address ?? "";
      const was = req.headers.get("x-forwarded-for");
      const forwarded = was ? `${was}, ${peer}` : peer;
      if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return (await fromDisk(req, url.pathname, to)) ?? pass(req, url, to, forwarded);
      // The world checks the page's origin against the host the page asked for, so both go on as the page sent them.
      const headers: Record<string, string> = { "x-forwarded-for": forwarded };
      for (const h of ["origin", "host", "user-agent"]) {
        const v = req.headers.get(h);
        if (v) headers[h] = v;
      }
      const up = await openUp(`ws://127.0.0.1:${to.port}${url.pathname}${url.search}`, headers);
      if (!up) return new Response("that world did not take the socket", { status: 403 });
      const data: Pipe = { up, voice: url.pathname.endsWith("/voice"), early: [], down: null };
      up.onmessage = (e) => {
        if (typeof e.data === "string") return;
        const m = new Uint8Array(e.data as ArrayBuffer);
        if (data.down) sendDown(data.down, m);
        else data.early.push(m);
      };
      up.onclose = (e) => data.down?.close(closeCode(e.code), e.reason);
      if (srv.upgrade(req, { data })) return undefined;
      up.close();
      return new Response("expected a WebSocket", { status: 400 });
    },
    websocket: {
      maxPayloadLength: MESSAGE_BYTES_MAX,
      open(ws) {
        ws.data.down = ws;
        for (const m of ws.data.early) sendDown(ws, m);
        ws.data.early.length = 0;
        // The world may have gone while the page's socket was being taken.
        if (ws.data.up.readyState !== WebSocket.OPEN) ws.close(1011, "that world is not answering");
      },
      message(ws, m) {
        if (ws.data.up.readyState === WebSocket.OPEN) ws.data.up.send(m);
      },
      close(ws, code, reason) {
        ws.data.up.close(closeCode(code), reason);
      },
    },
  });
  worlds();
  return { port: server.port ?? 0, stop: () => void server.stop(true) };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const value = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const dir = value("--cluster");
  if (!dir) throw new Error("--cluster names the cluster's folder: <the saves' folder>/clusters/<id>, or the servers' -ClusterDirOverride/<id>");
  const front = startFront(dir, Number(value("--port") ?? 8787), value("--host"), (line) => console.log(line));
  console.log(`SNARK front listening on http://localhost:${front.port}/ for the cluster in ${resolve(dir)}`);
}
