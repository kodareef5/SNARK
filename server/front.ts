// One address for every world of a cluster, for whatever reaches only one place: a quick tunnel, a single forwarded port.
// Each world is reached at its own path (--public-url /miami), and the site around them, which every one of them answers
// alike (server/site.ts), at any. This passes each request and socket on to the world whose path it falls under, and the
// rest to the lowest world running. It finds them in the cluster's folder, as they find each other, and keeps nothing.
//
//   bun server/front.ts --cluster var/cluster/clusters/<id> [--port 8787] [--host address]
//
// A tunnel or proxy that routes by path itself, as a named Cloudflare tunnel's ingress rules do, needs none of this: it sends
// each world's path to that world's port and every other path to any of them.

import type { ServerWebSocket } from "bun";
import { resolve } from "node:path";
import { ClusterFolder, LIVE_MS, type Announcement } from "./cluster/folder.ts";
import { pathOf } from "./site.ts";

/** A world the front sends to: the path it is reached at ("" for the root of a host) and its port on this machine. */
export interface FrontWorld {
  world: number;
  path: string;
  port: number;
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
      out.push({ world: a.world, path: pathOf(a.url), port: a.port });
    } catch {
      // Its own server refused that address as it started, so it is not running with it.
    }
  }
  return out.sort((a, b) => a.world - b.world);
}

/**
 * Where a request for `pathname` goes: to the world whose path it falls under, the path itself included (that world sends it
 * on with its slash), and else, for the site, to the lowest world reached at a path, which answers the site, or failing one
 * the lowest of all. Null when none is running.
 */
export function frontRoute(worlds: readonly FrontWorld[], pathname: string): FrontWorld | null {
  for (const w of worlds) if (w.path !== "" && (pathname === w.path || pathname.startsWith(`${w.path}/`))) return w;
  return worlds.find((w) => w.path !== "") ?? worlds[0] ?? null;
}

/** Headers that belong to one connection and so are not passed on. */
const HOP = ["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer"];

/** A close code a socket may be closed with: the one given where it may be sent, and else a plain close. */
export function closeCode(code: number): number {
  return code === 1000 || (code >= 1001 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) || (code >= 3000 && code <= 4999) ? code : 1000;
}

interface Pipe {
  /** The world's socket, open before the page's is taken. */
  up: WebSocket;
  /** What the world sent before the page's socket was open, sent once it is. */
  early: (string | Uint8Array)[];
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

/** Passes a request on to `to`, as it came, and its answer back as it was sent: compressed where it was. */
async function pass(req: Request, url: URL, to: FrontWorld): Promise<Response> {
  const headers = new Headers(req.headers);
  for (const h of HOP) headers.delete(h);
  try {
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
    const res = await fetch(`http://127.0.0.1:${to.port}${url.pathname}${url.search}`, { method: req.method, headers, body, redirect: "manual", decompress: false });
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
      const to = frontRoute(worlds(), url.pathname);
      if (!to) return new Response("no world of this cluster is running", { status: 503, headers: { "retry-after": "10" } });
      if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return pass(req, url, to);
      // The world checks the page's origin against the host the page asked for, so both go on as the page sent them.
      const headers: Record<string, string> = {};
      for (const h of ["origin", "host", "user-agent"]) {
        const v = req.headers.get(h);
        if (v) headers[h] = v;
      }
      const up = await openUp(`ws://127.0.0.1:${to.port}${url.pathname}${url.search}`, headers);
      if (!up) return new Response("that world did not take the socket", { status: 403 });
      const data: Pipe = { up, early: [], down: null };
      up.onmessage = (e) => {
        const m = typeof e.data === "string" ? e.data : new Uint8Array(e.data as ArrayBuffer);
        if (data.down) data.down.send(m);
        else data.early.push(m);
      };
      up.onclose = (e) => data.down?.close(closeCode(e.code), e.reason);
      if (srv.upgrade(req, { data })) return undefined;
      up.close();
      return new Response("expected a WebSocket", { status: 400 });
    },
    websocket: {
      open(ws) {
        ws.data.down = ws;
        for (const m of ws.data.early) ws.send(m);
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
