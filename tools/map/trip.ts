// `bun tools/map/trip.ts --map var/maps/miami.snmap [--mbit 5] [--out folder]`: what a player feels of a built map as it
// comes. A server of the map runs here behind a link of this tool's own, held to `--mbit` (shared by every connection,
// round by round, with --latency ms there and back), and a headless Chrome, muted, joins from an empty cache at ?trip
// (client/core/trip.ts). The body stands at the spawn point `--join` names, goes 300 m up once the street round it is
// drawn, waits there for the far city, then jumps to the spawn point `--to` names; the first request for that place's
// sector's ground is answered 503. It prints, by the page's clock: the first frame; the first in which the street is drawn
// with its pieces and materials; the first in which the far city is drawn; the last part; after the jump, the time until
// the body is predicted again and until the ground the fine terrain draws is the map's own; whether the failed part came on
// a later ask and the map was whole at the end; and the page's heap and array memory at the statics' hand-over. A picture
// is taken at each of those moments, into --out. The client must be built (bun run build). --chrome sets the browser.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readSync, openSync, closeSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "../../server/main.ts";
import { CHUNK_SIZE, SECTOR_CHUNKS } from "../../shared/coords.ts";
import { MODE_GHOST, MODE_WALK } from "../../shared/sim/character.ts";
import { groundUnder } from "../../shared/world/collide.ts";
import { readHead, type MapHead } from "../../shared/world/mapfile.ts";
import type { TripMark } from "../../client/core/trip.ts";

const ROOT = resolve(import.meta.dir, "../..");
const value = (flag: string, otherwise: string): string => {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? process.argv[at + 1]! : otherwise;
};
/** Seconds the trip waits for each thing before it goes on without. */
const PATIENCE = { frame: 180, street: 60, far: 120, jump: 20, after: 90, end: 120 };
/** Metres the body goes up once the street is drawn. */
const UP = 300;
/** Bytes a Chrome of the trip may hold in all its processes before the trip ends it. */
const CHROME_MOST = 8e9;

/** The head of the map file at `path`, read alone. */
function headOf(path: string): MapHead {
  const fd = openSync(path, "r");
  try {
    const start = new Uint8Array(16);
    readSync(fd, start, 0, 16, 0);
    const bytes = new Uint8Array(new DataView(start.buffer).getUint32(12, true));
    readSync(fd, bytes, 0, bytes.length, 0);
    return readHead(bytes, false);
  } finally {
    closeSync(fd);
  }
}

/**
 * A link to `port` on this machine, as a player's would be: what the server sends goes out over one line of `mbit`, each
 * connection given a slice in turn, and every byte either way comes `latency` / 2 ms late.
 */
function shapedLink(port: number, mbit: number, latency: number): { port: number; stop(): void } {
  const rate = (mbit * 1e6) / 8 / 1000;
  const SLICE = 16384;
  interface Pipe {
    up: import("bun").Socket<undefined> | null;
    early: Uint8Array[];
    down: Uint8Array[];
    out: Uint8Array[];
    upOut: Uint8Array[];
    closed: boolean;
    upClosed: boolean;
  }
  const pipes: { client: import("bun").Socket<Pipe>; pipe: Pipe }[] = [];
  let turn = 0;
  let free = 0;
  let pumping = false;
  const flush = (socket: import("bun").Socket<any>, queue: Uint8Array[]): void => {
    while (queue.length > 0) {
      const n = socket.write(queue[0]!);
      if (n < queue[0]!.length) {
        queue[0] = queue[0]!.subarray(Math.max(0, n));
        return;
      }
      queue.shift();
    }
  };
  const send = (socket: import("bun").Socket<any>, queue: Uint8Array[], bytes: Uint8Array): void => {
    queue.push(bytes);
    if (queue.length === 1) flush(socket, queue);
  };
  const pump = (): void => {
    const live = pipes.filter((p) => p.pipe.down.length > 0);
    if (live.length === 0) {
      pumping = false;
      return;
    }
    const { client, pipe } = live[turn++ % live.length]!;
    const head = pipe.down[0]!;
    const slice = head.subarray(0, SLICE);
    if (slice.length === head.length) pipe.down.shift();
    else pipe.down[0] = head.subarray(SLICE);
    free = Math.max(free, performance.now()) + slice.length / rate;
    const last = pipe.down.length === 0 && pipe.upClosed;
    setTimeout(() => {
      if (!pipe.closed) send(client, pipe.out, slice);
      if (last && !pipe.closed) client.end();
    }, Math.max(0, free - performance.now()) + latency / 2);
    setTimeout(pump, Math.max(0, free - performance.now()));
  };
  const listener = Bun.listen<Pipe>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(client) {
        const pipe: Pipe = { up: null, early: [], down: [], out: [], upOut: [], closed: false, upClosed: false };
        client.data = pipe;
        pipes.push({ client, pipe });
        void Bun.connect<undefined>({
          hostname: "127.0.0.1",
          port,
          socket: {
            data(_, bytes) {
              pipe.down.push(new Uint8Array(bytes));
              if (!pumping) {
                pumping = true;
                pump();
              }
            },
            drain(up) {
              flush(up, pipe.upOut);
            },
            close() {
              pipe.upClosed = true;
              if (pipe.down.length === 0) setTimeout(() => pipe.closed || client.end(), latency / 2);
            },
            error() {},
          },
        }).then((up) => {
          pipe.up = up;
          for (const bytes of pipe.early.splice(0)) send(up, pipe.upOut, bytes);
        }, () => client.end());
      },
      data(client, bytes) {
        const pipe = client.data, copy = new Uint8Array(bytes);
        setTimeout(() => (pipe.up ? send(pipe.up, pipe.upOut, copy) : pipe.early.push(copy)), latency / 2);
      },
      drain(client) {
        flush(client, client.data.out);
      },
      close(client) {
        client.data.closed = true;
        client.data.up?.end();
        pipes.splice(pipes.findIndex((p) => p.client === client), 1);
      },
      error() {},
    },
  });
  return { port: listener.port, stop: () => listener.stop(true) };
}

/** A page of a headless Chrome spoken to over DevTools. */
interface Page {
  send(method: string, params?: object): Promise<any>;
  value<T>(expression: string): Promise<T>;
  shot(path: string): Promise<void>;
}

async function devtools(profile: string): Promise<Page & { close(): void }> {
  const active = join(profile, "DevToolsActivePort");
  for (let k = 0; k < 300 && !existsSync(active); k++) await Bun.sleep(100);
  const port = Number(readFileSync(active, "utf8").split("\n")[0]);
  let target: { type: string; webSocketDebuggerUrl: string } | undefined;
  for (let k = 0; k < 100 && !target; k++) {
    target = ((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[]).find((t) => t.type === "page");
    if (!target) await Bun.sleep(100);
  }
  const ws = new WebSocket(target!.webSocketDebuggerUrl);
  await new Promise((go) => (ws.onopen = go));
  let id = 0;
  const waiting = new Map<number, { ok: (r: any) => void; fail: (e: Error) => void }>();
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    const w = m.id ? waiting.get(m.id) : undefined;
    if (!w) return;
    waiting.delete(m.id);
    if (m.error) w.fail(new Error(JSON.stringify(m.error)));
    else w.ok(m.result);
  };
  const send = (method: string, params: object = {}): Promise<any> =>
    new Promise((ok, fail) => {
      const n = ++id;
      waiting.set(n, { ok, fail });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  return {
    send,
    async value<T>(expression: string): Promise<T> {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`${expression}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value as T;
    },
    async shot(path: string): Promise<void> {
      const s = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(path, Buffer.from(s.data, "base64"));
    },
    close: () => ws.close(),
  };
}

/** Bytes resident in every process whose command line names `profile`: a Chrome's, as `ps` counts them. */
function chromeBytes(profile: string): number {
  const ps = Bun.spawnSync(["ps", "-A", "-o", "rss=,command="]).stdout.toString();
  return ps.split("\n").filter((l) => l.includes(profile)).reduce((n, l) => n + Number(l.trim().split(/\s+/)[0]) * 1024, 0);
}

interface Seen {
  marks: TripMark[];
  now: number;
  parts: { name: string; status: number; end: number; bytes: number }[];
}

/** One trip over a link of `mbit`: its moments by the page's clock, and its pictures in `out`. */
export async function trip(opts: { map: string; dist: string; mbit: number; latency: number; out: string; join: string; to: string; chrome: string }): Promise<string[]> {
  const head = headOf(opts.map);
  const spawn = (name: string) => head.spawns.find((s) => s.name === name) ?? (() => { throw new Error(`${opts.map} has no spawn point named ${name}: it has ${head.spawns.map((s) => s.name).join(", ")}`); })();
  const [from, to] = [spawn(opts.join), spawn(opts.to)];
  const sector = (x: number, z: number) => [Math.floor((head.dims.frameX + Math.floor(x / CHUNK_SIZE)) / SECTOR_CHUNKS), Math.floor((head.dims.frameZ + Math.floor(z / CHUNK_SIZE)) / SECTOR_CHUNKS)] as const;
  const [col, row] = sector(to.x, to.z);
  const failing = head.parts.find((p) => p.kind === "ground" && p.col === col && p.row === row)!;
  const parts = new Set([head.name, ...head.parts.filter((p) => p.kind !== "tops").map((p) => p.name)]);
  const asked: number[] = [];
  const server = startServer({
    dev: true,
    port: 0,
    clientDir: opts.dist,
    map: opts.map,
    routes: (_, url) => {
      if (url.pathname !== `/map/${failing.name}`) return null;
      asked.push(asked.length === 0 ? 503 : 200);
      return asked.length === 1 ? new Response("not now", { status: 503 }) : null;
    },
  });
  // The page joins where `--join` is; the trip moves it from there.
  Object.assign(server.host.world, { spawn: { x: from.x, z: from.z, yaw: from.yaw } });
  const link = shapedLink(server.port, opts.mbit, opts.latency);
  const profile = mkdtempSync(join(tmpdir(), "snark-trip-"));
  const chrome = Bun.spawn([opts.chrome, "--headless=new", "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1280,720", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdout: "ignore", stderr: "ignore" });
  const lines: string[] = [];
  const say = (line: string): void => void (lines.push(line), console.log(line));
  let page: Awaited<ReturnType<typeof devtools>> | null = null;
  const watchdog = setInterval(() => chromeBytes(profile) > CHROME_MOST && chrome.kill(), 5000);
  try {
    page = await devtools(profile);
    await page.send("Page.enable");
    // A page keeps 250 resources' timings unless told more, and the game's page fetches more than that.
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: "performance.setResourceTimingBufferSize(100000)" });
    await page.send("Page.navigate", { url: `http://127.0.0.1:${link.port}/?quick=1&name=trip&trip` });
    const look = (): Promise<Seen> =>
      page!.value<Seen>(`({marks: globalThis.snarkTrip?.marks ?? [], now: performance.now(), parts: performance.getEntriesByType("resource").filter((r) => r.name.includes("/map/")).map((r) => ({name: r.name.slice(r.name.lastIndexOf("/") + 1), status: r.responseStatus, end: r.responseEnd, bytes: r.transferSize}))})`);
    let seen = await look();
    let heap = "";
    /** At the statics' hand-over, once: the page's heap and its arrays' bytes after a full collection. */
    const measure = async (): Promise<void> => {
      if (heap !== "" || !seen.marks.some((m) => m.what === "handed")) return;
      heap = "measuring";
      await page!.send("HeapProfiler.collectGarbage");
      const h = await page!.send("Runtime.getHeapUsage");
      heap = `${((h.usedSize ?? 0) / 1e6).toFixed(1)} MB of heap and ${((h.backingStorageSize ?? 0) / 1e6).toFixed(1)} MB of arrays`;
    };
    /** The first frame at or after `after` at which `what` was on, or undefined if none has been yet. */
    const on = (what: string, after = -Infinity): number | undefined => {
      const marks = seen.marks.filter((m) => m.what === what || m.what === `-${what}`);
      const then = marks.filter((m) => m.at <= after).at(-1);
      if (then?.what === what) return after;
      return marks.find((m) => m.at > after && m.what === what)?.at;
    };
    /** Waits until `ready` holds of what the page shows, or `seconds` pass. */
    const until = async (seconds: number, ready: () => boolean): Promise<void> => {
      const t0 = performance.now();
      for (; !ready() && performance.now() - t0 < seconds * 1000 && chrome.exitCode === null; seen = await look()) {
        await measure();
        await Bun.sleep(50);
      }
      await measure();
    };
    let shots = 0;
    const shot = async (name: string, when: number | undefined): Promise<void> => void (when !== undefined && (await page!.shot(join(opts.out, `${opts.mbit}mbit-${++shots}-${name}.png`))));
    const came = (name: string): boolean => seen.parts.some((p) => p.name === name && p.status === 200);
    const s = (ms: number | undefined): string => (ms === undefined ? "never" : `${(ms / 1000).toFixed(2)} s`);
    const later = (ms: number | undefined, from: number | undefined): string => (ms === undefined || from === undefined ? "never" : `${((ms - from) / 1000).toFixed(2)} s after it`);

    await until(PATIENCE.frame, () => on("frame") !== undefined);
    await shot("first-frame", on("frame"));
    await until(PATIENCE.street, () => on("street") !== undefined);
    await shot("street", on("street"));
    // Up, standing on nothing, once the street is drawn.
    const ents = server.host.world.ents;
    const e = server.host.game.clients.find((c) => c?.name === "trip")!.ent;
    ents.mode[e] = MODE_GHOST;
    ents.setPosition(e, ents.x[e]!, ents.y[e]! + UP, ents.z[e]!);
    ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
    const upAt = (seen = await look()).now;
    await until(PATIENCE.far, () => on("far", upAt) !== undefined);
    await shot("far-city", on("far", upAt));
    // The jump: to the ground at the spawn point `--to` names, walking.
    const move = server.host.world.reg.move[ents.kind[e]!]!;
    ents.mode[e] = MODE_WALK;
    ents.setPosition(e, to.x, groundUnder(server.host.world.hf, to.x, to.z, move.radius), to.z);
    ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
    const jumpAt = (seen = await look()).now;
    await until(PATIENCE.jump, () => on("jump", jumpAt) !== undefined);
    const jump = seen.marks.find((m) => m.what === "jump" && m.at >= jumpAt)?.at;
    await shot("jumped", jump);
    await until(jump === undefined ? 0 : PATIENCE.after, () => on("predicting", jump) !== undefined);
    const again = jump === undefined ? undefined : on("predicting", jump);
    await shot("predicted", again);
    await until(jump === undefined ? 0 : PATIENCE.after, () => on("exact", jump) !== undefined);
    const exact = jump === undefined ? undefined : on("exact", jump);
    await shot("exact", exact);
    await until(PATIENCE.end, () => [...parts].every(came) && on("handed") !== undefined && on("far", jump ?? upAt) !== undefined);
    await Bun.sleep(3000);
    seen = await look();
    await shot("end", seen.now);
    const whole = await page.value<{ ground: boolean; pieces: number }>("globalThis.snarkTrip?.whole() ?? {ground: false, pieces: 0}");
    const statics = head.counts.reduce((n, c) => n + c, 0);
    const lastPart = [...parts].every(came) ? Math.max(...seen.parts.filter((p) => parts.has(p.name) && p.status === 200).map((p) => p.end)) : undefined;
    const far = seen.marks.find((m) => m.what === "far");
    say(`trip on ${head.id} over ${opts.mbit} Mbit/s, ${opts.latency} ms there and back: joined at ${from.name} (${from.x}, ${from.z}), went ${UP} m up at ${s(upAt)}, jumped to ${to.name} (${to.x}, ${to.z}) at ${s(jumpAt)}; ${failing.name}, the ground there, was answered 503 at its first ask`);
    say(`  first frame                           ${s(on("frame"))}`);
    say(`  street drawn with its materials       ${s(on("street"))}`);
    say(`  far city drawn                        ${s(far?.at)}${far ? ` at (${far.x}, ${far.z})` : ""}`);
    say(`  last part                             ${lastPart === undefined ? `never: ${[...parts].filter((n) => !came(n)).join(" ")} not come` : s(lastPart)}`);
    say(`  statics handed over                   ${s(on("handed"))}`);
    say(`  the jump drawn                        ${s(jump)}`);
    say(`  predicted again after the jump        ${later(again, jump)}`);
    say(`  ground exact after the jump           ${later(exact, jump)}`);
    say(`  the failed part                       asked ${asked.length} times (${asked.join(", ")}): ${asked.includes(200) ? "it came on a later ask" : "it never came"}`);
    say(`  whole at the end                      ground ${whole.ground ? "all the map's own" : "not all the map's own"}; far city of ${whole.pieces} pieces, of the map's ${statics} statics`);
    say(`  memory at the hand-over, after a GC   ${heap || "never handed over"}`);
    say(`  ${seen.parts.filter((p) => parts.has(p.name) && p.status === 200).length} of ${parts.size} parts in, ${(seen.parts.reduce((n, p) => n + p.bytes, 0) / 1e6).toFixed(2)} MB of the map over the wire`);
    return lines;
  } finally {
    clearInterval(watchdog);
    page?.close();
    chrome.kill();
    await chrome.exited;
    link.stop();
    server.stop();
    rmSync(profile, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const map = resolve(value("--map", join(ROOT, "var/maps/miami.snmap")));
  const out = resolve(value("--out", join(ROOT, "var/trip")));
  const chrome = value("--chrome", process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  if (!existsSync(map)) throw new Error(`${map} is missing: build it (bun tools/mapworld/build.ts <city>)`);
  mkdirSync(out, { recursive: true });
  const lines: string[] = [];
  for (const mbit of value("--mbit", "5,20").split(",").map(Number)) {
    lines.push(...(await trip({ map, dist: resolve(value("--dist", join(ROOT, "client/dist"))), mbit, latency: Number(value("--latency", "100")), out, join: value("--join", "Bayfront Park"), to: value("--to", "Belle Isle"), chrome })));
  }
  writeFileSync(join(out, "trip.txt"), lines.join("\n") + "\n");
  process.exit(0);
}
