// `bun tools/map/trip.ts --map var/maps/miami.snmap [--mbit 5,20] [--out folder]`: what a player feels of a built map as it
// comes. A server of the map runs here behind a link of this tool's own, held to each `--mbit` (shared by every connection
// a slice at a time, with --latency ms there and back), and a headless Chrome, muted, joins from an empty cache at ?trip
// (client/core/trip.ts). The body joins on the map's thickest street; goes 300 m up once the street round it is drawn
// sharp, or PATIENCE.street seconds on; waits there until the far city is drawn or two thirds of the map have come, so that
// it jumps while the map still comes; then jumps to the thickest street 4 km away, whose sector's ground is answered 503 at
// its first ask. Each moment it prints comes with the bytes of art and of the map the page had in hand then, and the art
// is told by kind as the body goes up (client/core/trip.ts `art`).
// It prints, by the page's clock: the first frame; when every overview was in hand, the far ground and the sea drawn from
// them where the head's coarse picture stood before; the first in which the street is drawn with its pieces and materials;
// the first in which the far city is drawn, and the city's blocks past it, and when every tops part was in hand; when the page settled; after the jump, the time until the body is predicted again,
// until the ground the fine terrain draws is the map's own and until the street there is drawn; whether the failed part
// came on a later ask and the map was whole at the end; and the page's heap and array memory at the statics' hand-over.
// A picture is taken at each of those moments, into --out. It prints too when the world's finishes were drawn and when
// no texture on screen lacked its first step, both as they stood when the body went up, and what the server's tick took
// and how late its loop ran, since a server that cannot keep its tick answers every file late. The link runs in a
// process of its own, so its hops never wait on the server's loop. The client must be built (bun run build). --dist
// names another, --chrome the browser, --tier the tier the player has chosen, and --no-fail fails no request.

import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "../../server/main.ts";
import { CHUNK_SIZE, SECTOR_CHUNKS } from "../../shared/coords.ts";
import { MODE_GHOST, MODE_WALK } from "../../shared/sim/character.ts";
import { groundUnder } from "../../shared/world/collide.ts";
import { partsFolder, readHead, type MapHead } from "../../shared/world/mapfile.ts";
import { firstFrameParts, handOverParts } from "../../client/core/mapload.ts";
import type { TripMark } from "../../client/core/trip.ts";
import { CHROME_FLAGS, findChrome } from "../chrome.ts";

const ROOT = resolve(import.meta.dir, "../..");
const value = (flag: string, otherwise: string): string => {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? process.argv[at + 1]! : otherwise;
};
/** Seconds the trip waits for each thing before it goes on without. */
const PATIENCE = { frame: 180, street: 120, far: 120, jump: 20, after: 90, end: 120 };
/** Metres the body goes up once the street is drawn. */
const UP = 300;
/** Metres from where the trip joins to where it jumps to. */
const JUMP = 4000;
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

/** The link to `port` in a process of its own (tools/map/link.ts), so its hops never wait on the server's loop. */
async function linkApart(port: number, mbit: number, latency: number): Promise<{ port: number; stop(): void }> {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "link.ts"), String(port), String(mbit), String(latency)], { stdout: "pipe", stderr: "inherit" });
  const reader = child.stdout.getReader();
  let text = "";
  while (!text.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) throw new Error("the trip's link did not start");
    text += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  return { port: Number(text.trim()), stop: () => child.kill() };
}

/** Milliseconds between the looks at how late the server's loop runs. */
const LATE_EVERY = 20;

/** The `q` quantile of `values`, in ms with one decimal. */
const quantile = (values: readonly number[], q: number): string => ([...values].sort((a, b) => a - b)[Math.floor(values.length * q)] ?? 0).toFixed(1);

/** A page of a headless Chrome spoken to over DevTools. */
interface Page {
  send(method: string, params?: object): Promise<any>;
  value<T>(expression: string): Promise<T>;
  shot(path: string): Promise<void>;
}

export async function devtools(profile: string): Promise<Page & { close(): void }> {
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

/** The statics of the 3 by 3 chunks round each chunk of the map, as its head counts them. */
function around(head: MapHead): Uint32Array {
  const { chunksX, chunksZ } = head.dims;
  const out = new Uint32Array(chunksX * chunksZ);
  for (let cz = 0; cz < chunksZ; cz++) {
    for (let cx = 0; cx < chunksX; cx++) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (cx + dx >= 0 && cz + dz >= 0 && cx + dx < chunksX && cz + dz < chunksZ) out[cz * chunksX + cx] += head.counts[(cz + dz) * chunksX + cx + dx]!;
    }
  }
  return out;
}

/**
 * Where the trip joins and where it jumps to: the middle of the chunk whose 3 by 3 hold the map's most statics, its
 * thickest street; and of the chunks whose middles are JUMP metres from there, give or take a chunk, the one whose 3 by 3
 * hold the most.
 */
export function tripPlaces(head: MapHead): { from: { x: number; z: number }; to: { x: number; z: number } } {
  const n = around(head), w = head.dims.chunksX;
  const middle = (c: number) => ({ x: ((c % w) + 0.5) * CHUNK_SIZE, z: (Math.floor(c / w) + 0.5) * CHUNK_SIZE });
  let best = 0;
  for (let c = 0; c < n.length; c++) if (n[c]! > n[best]!) best = c;
  const from = middle(best);
  let far = -1;
  for (let c = 0; c < n.length; c++) {
    const m = middle(c);
    if (Math.abs(Math.hypot(m.x - from.x, m.z - from.z) - JUMP) <= CHUNK_SIZE && (far < 0 || n[c]! > n[far]!)) far = c;
  }
  return { from, to: middle(far) };
}

/** One trip over a link of `mbit`: its moments by the page's clock, and its pictures in `out`. */
export async function trip(opts: { map: string; dist: string; mbit: number; latency: number; out: string; chrome: string; fail: boolean; tier?: string }): Promise<string[]> {
  const head = headOf(opts.map);
  const { from, to } = tripPlaces(head);
  const sector = (x: number, z: number) => [Math.floor((head.dims.frameX + Math.floor(x / CHUNK_SIZE)) / SECTOR_CHUNKS), Math.floor((head.dims.frameZ + Math.floor(z / CHUNK_SIZE)) / SECTOR_CHUNKS)] as const;
  const [col, row] = sector(to.x, to.z);
  const failing = head.parts.find((p) => p.kind === "ground" && p.col === col && p.row === row)!;
  const parts = new Set([head.name, ...head.parts.filter((p) => p.kind !== "tops").map((p) => p.name)]);
  const asked: number[] = [];
  const fails = opts.fail ? 1 : 0;
  const server = startServer({
    dev: true,
    port: 0,
    clientDir: opts.dist,
    map: opts.map,
    routes: (_, url) => {
      if (url.pathname !== `/map/${failing.name}`) return null;
      asked.push(asked.length < fails ? 503 : 200);
      return asked.at(-1) === 503 ? new Response("not now", { status: 503 }) : null;
    },
  });
  // The page joins on the street; the trip moves it from there.
  Object.assign(server.host.world, { spawn: { x: from.x, z: from.z, yaw: 0 } });
  // What each tick of the server takes, and how late a timer of its loop fires.
  const ticks: number[] = [];
  const late: number[] = [];
  const game = server.host.game, tick = game.tick.bind(game);
  game.tick = () => {
    const t0 = performance.now();
    tick();
    ticks.push(performance.now() - t0);
  };
  const started = performance.now();
  let lateAt = started;
  const lateness = setInterval(() => {
    const now = performance.now();
    late.push(now - lateAt - LATE_EVERY);
    lateAt = now;
  }, LATE_EVERY);
  const link = await linkApart(server.port, opts.mbit, opts.latency);
  const profile = mkdtempSync(join(tmpdir(), "snark-trip-"));
  const chrome = Bun.spawn([opts.chrome, "--headless=new", ...CHROME_FLAGS, "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1280,720", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdout: "ignore", stderr: "ignore" });
  const lines: string[] = [];
  const say = (line: string): void => void (lines.push(line), console.log(line));
  let page: Awaited<ReturnType<typeof devtools>> | null = null;
  const watchdog = setInterval(() => chromeBytes(profile) > CHROME_MOST && chrome.kill(), 5000);
  try {
    page = await devtools(profile);
    await page.send("Page.enable");
    // A page keeps 250 resources' timings unless told more, and the game's page fetches more than that.
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: "performance.setResourceTimingBufferSize(100000)" });
    // A tier named is the player's chosen one, as the settings keep it (client/core/settings.ts).
    if (opts.tier) await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("snark.interface", ${JSON.stringify(JSON.stringify({ version: 2, tier: opts.tier }))})` });
    await page.send("Page.navigate", { url: `http://127.0.0.1:${link.port}/?quick=1&name=trip&trip` });
    const look = (): Promise<Seen> =>
      page!.value<Seen>(`({marks: globalThis.snarkTrip?.marks ?? [], now: performance.now(), parts: performance.getEntriesByType("resource").filter((r) => r.name.includes("/map/")).map((r) => ({name: r.name.slice(r.name.lastIndexOf("/") + 1), status: r.responseStatus, end: r.responseEnd, bytes: r.encodedBodySize}))})`);
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
        await overviewShot();
        await Bun.sleep(50);
      }
      await measure();
    };
    let shots = 0;
    const shot = async (name: string, when: number | undefined): Promise<void> => void (when !== undefined && (await page!.shot(join(opts.out, `${opts.mbit}mbit${fails ? "" : "-whole"}-${++shots}-${name}.png`))));
    const came = (name: string): boolean => seen.parts.some((p) => p.name === name && p.status === 200);
    /** A picture once every overview has come, wherever in the trip that is. */
    const overviews = head.parts.filter((p) => p.kind === "overview").map((p) => p.name);
    let overviewed = false;
    const overviewShot = async (): Promise<void> => {
      if (overviewed || !overviews.every(came)) return;
      overviewed = true;
      await shot("overviews", 0);
    };
    const s = (ms: number | undefined): string => (ms === undefined ? "never" : `${(ms / 1000).toFixed(2)} s`);
    const later = (ms: number | undefined, from: number | undefined): string => (ms === undefined || from === undefined ? "never" : `${((ms - from) / 1000).toFixed(2)} s after it`);

    /** The share of the map's bytes until its statics are all in hand that has come. */
    const handed = handOverParts(head).reduce((n, p) => n + statSync(join(partsFolder(opts.map), `${p.name}.br`)).size, statSync(join(partsFolder(opts.map), `${head.name}.br`)).size);
    const share = (): number => seen.parts.filter((p) => p.status === 200).reduce((n, p) => n + p.bytes, 0) / handed;
    await until(PATIENCE.frame, () => on("frame") !== undefined);
    await shot("first-frame", on("frame"));
    await until(PATIENCE.street, () => on("street") !== undefined);
    await shot("street", on("street"));
    const street = JSON.stringify(await page.value("globalThis.snarkTrip?.state()"));
    const kinds = await page.value<Record<string, number>>("globalThis.snarkTrip?.art() ?? {}");
    // Up, standing on nothing, once the street is drawn or the trip has waited long enough for it.
    const ents = server.host.world.ents;
    const e = server.host.game.clients.find((c) => c?.name === "trip")!.ent;
    ents.mode[e] = MODE_GHOST;
    ents.setPosition(e, ents.x[e]!, ents.y[e]! + UP, ents.z[e]!);
    ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
    const upAt = (seen = await look()).now, upShare = share();
    // The page has the body up within a round trip or two.
    await until(PATIENCE.jump, () => seen.now > upAt + 1500);
    await until(PATIENCE.far, () => on("far", upAt) !== undefined || share() >= 2 / 3);
    await shot("far-city", on("far", upAt));
    // The jump, once the far city is drawn or two thirds of the map have come: to the ground on the street 4 km away, walking.
    const move = server.host.world.reg.move[ents.kind[e]!]!;
    ents.mode[e] = MODE_WALK;
    ents.setPosition(e, to.x, groundUnder(server.host.world.hf, to.x, to.z, move.radius), to.z);
    ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
    const jumpAt = (seen = await look()).now, jumpShare = share();
    await until(PATIENCE.jump, () => on("jump", jumpAt) !== undefined);
    const jump = seen.marks.find((m) => m.what === "jump" && m.at >= jumpAt)?.at;
    await shot("jumped", jump);
    // The session sees the body's new place a frame after the probe may: prediction stops at the first frame it is off
    // after the jump, if it is, and runs again at the first after that it is on.
    const stop = (): TripMark | undefined => seen.marks.find((m) => m.what === "-predicting" && m.at >= jump!);
    await until(jump === undefined ? 0 : PATIENCE.jump, () => stop() !== undefined || seen.now > jump! + 1000);
    const again = (): number | undefined => (jump === undefined ? undefined : stop() === undefined ? jump : on("predicting", stop()!.at));
    await until(jump === undefined ? 0 : PATIENCE.after, () => again() !== undefined);
    const predicted = again();
    await shot("predicted", predicted);
    await until(jump === undefined ? 0 : PATIENCE.after, () => on("exact", jump) !== undefined);
    const exact = jump === undefined ? undefined : on("exact", jump);
    await shot("exact", exact);
    // Until the end, a picture as the page settles where it jumped to and as the far city is first drawn, if it was not before the jump.
    let farShot = on("far", upAt) !== undefined && on("far", upAt)! < jumpAt;
    let lastShot = false;
    const pictures = async (): Promise<void> => {
      if (!lastShot && on("settled", jump ?? upAt) !== undefined) {
        lastShot = true;
        await shot("settled", 0);
      }
      if (!farShot && on("far") !== undefined) {
        farShot = true;
        await shot("far-city", 0);
      }
    };
    await until(PATIENCE.street, () => (void pictures(), on("street", jump ?? upAt) !== undefined));
    await shot("street-there", on("street", jump ?? upAt));
    for (const t0 = performance.now(); performance.now() - t0 < PATIENCE.end * 1000 && chrome.exitCode === null; seen = await look()) {
      await measure();
      await pictures();
      if (on("settled", jump ?? upAt) !== undefined && on("handed") !== undefined && on("far", jump ?? upAt) !== undefined) break;
      await Bun.sleep(50);
    }
    await Bun.sleep(3000);
    seen = await look();
    await shot("end", seen.now);
    const whole = await page.value<{ ground: boolean; pieces: number }>("globalThis.snarkTrip?.whole() ?? {ground: false, pieces: 0}");
    const drawn = await page.value<string>("globalThis.snarkTrip?.app?.scene?.assets.tier.name ?? 'none'");
    writeFileSync(join(opts.out, `${opts.mbit}mbit${fails ? "" : "-whole"}.json`), JSON.stringify({ marks: seen.marks, parts: seen.parts, up: upAt, jump: jumpAt }));
    const statics = head.counts.reduce((n, c) => n + c, 0);
    const far = seen.marks.find((m) => m.what === "far");
    const sent = (names: readonly string[]): string => (names.reduce((n, name) => n + statSync(join(partsFolder(opts.map), `${name}.br`)).size, 0) / 1e6).toFixed(2);
    say(`trip on ${head.id} on ${drawn} over ${opts.mbit} Mbit/s, ${opts.latency} ms there and back: joined at ${from.x}, ${from.z}, went ${UP} m up at ${s(upAt)} (${Math.round(upShare * 100)}% of the map in), jumped to ${to.x}, ${to.z} at ${s(jumpAt)} (${Math.round(jumpShare * 100)}% in); ${failing.name}, the ground there, ${fails ? "was answered 503 at its first ask" : "failed at no ask (--no-fail)"}`);
    /** Bytes of art and of the map the page had in hand at the first `what` mark, or "" where it never came. */
    const bytes = (what: string): string => {
      const m = seen.marks.find((k) => k.what === what);
      if (!m) return "";
      const map = seen.parts.filter((p) => p.status === 200 && p.end <= m.at).reduce((n, p) => n + p.bytes, 0);
      return `   (art ${(m.art / 1e6).toFixed(1)} MB, map ${(map / 1e6).toFixed(1)} MB in hand)`;
    };
    say(`  first frame                           ${s(on("frame"))}${bytes("frame")}`);
    const overviewsAt = overviews.every(came) ? Math.max(...seen.parts.filter((p) => overviews.includes(p.name) && p.status === 200).map((p) => p.end)) : undefined;
    say(`  every overview in hand                ${s(overviewsAt)}, ${later(overviewsAt, on("frame"))}`);
    const at = (m: TripMark | undefined): string => (m ? `${s(m.at)} at ${m.x}, ${m.z}` : "never");
    const joined = on("street");
    say(`  street drawn with its materials       ${joined !== undefined && joined < upAt ? s(joined) : `not before the body went up (${street})`}; the street jumped to, ${later(jump === undefined ? undefined : on("street", jump), jump)}${bytes("street")}`);
    say(`  art by kind when the body went up     ${Object.entries(kinds).map(([k, n]) => `${k} ${(n / 1e6).toFixed(1)}`).join(", ")} MB`);
    say(`  far city drawn                        ${at(far)}${bytes("far")}`);
    const tops = head.parts.filter((p) => p.kind === "tops").map((p) => p.name);
    const topsAt = tops.length > 0 && tops.every(came) ? Math.max(...seen.parts.filter((p) => tops.includes(p.name) && p.status === 200).map((p) => p.end)) : undefined;
    say(`  city's blocks drawn                   ${at(seen.marks.find((m) => m.what === "blocks"))}${bytes("blocks")}; every tops part in hand ${s(topsAt)}, ${sent(tops)} MB of Brotli`);
    /** When `what` came, if it held when the body went up, else why not. */
    const held = (what: string): string => {
      const last = seen.marks.filter((m) => (m.what === what || m.what === `-${what}`) && m.at <= upAt).at(-1);
      return last?.what === what ? `${s(last.at)}, ${later(last.at, on("frame"))}` : `not before the body went up (${last ? `went at ${s(last.at)}` : "never"})`;
    };
    say(`  the finishes drawn (colour)           ${held("colour")}${bytes("colour")}`);
    say(`  no texture without its first step    ${held("soft")}${bytes("soft")}`);
    say(`  settled where it jumped to            ${later(on("settled", jump ?? upAt), jump ?? upAt)}; ${[...parts].filter(came).length} of ${parts.size} parts in hand`);
    say(`  statics handed over                   ${s(on("handed"))}${bytes("handed")}`);
    say(`  the jump drawn                        ${s(jump)}, ${jump === undefined ? "never" : `${((jump - jumpAt) / 1000).toFixed(2)} s after the server moved the body`}`);
    say(`  predicted again after the jump        ${later(predicted, jump)}`);
    say(`  ground exact after the jump           ${later(exact, jump)}`);
    say(`  the failed part                       ${fails === 0 ? "none failed" : `asked ${asked.length} times (${asked.join(", ")}): ${asked.includes(200) ? "it came on a later ask" : "it never came"}`}`);
    say(`  whole at the end                      ground ${whole.ground ? "all the map's own" : "not all the map's own"}; far city of ${whole.pieces} pieces, of the map's ${statics} statics`);
    say(`  memory at the hand-over, after a GC   ${heap || "never handed over"}`);
    say(`  the server's tick                     ${ticks.length} in ${((performance.now() - started) / 1000).toFixed(0)} s, p50 ${quantile(ticks, 0.5)} ms, p90 ${quantile(ticks, 0.9)} ms, most ${Math.max(0, ...ticks).toFixed(1)} ms; its loop late p50 ${quantile(late, 0.5)} ms, p90 ${quantile(late, 0.9)} ms`);
    const before = seen.parts.filter((p) => p.status === 200 && p.end <= (on("frame") ?? -1));
    const rule = [head.name, ...firstFrameParts(head, from.x, from.z).map((p) => p.name)];
    say(`  before the first frame               ${before.length} files of the map, ${(before.reduce((n, p) => n + p.bytes, 0) / 1e6).toFixed(2)} MB as sent: ${before.map((p) => p.name.split(".").slice(0, -2).join(".")).join(" ")}`);
    say(`  the build's rule there               ${rule.length} files, ${sent(rule)} MB of Brotli (client/core/mapload.ts firstFrameParts); until the statics are all in hand ${sent([head.name, ...handOverParts(head).map((p) => p.name)])} MB`);
    say(`  in all                                ${seen.parts.filter((p) => parts.has(p.name) && p.status === 200).length} of ${parts.size} parts, ${(seen.parts.reduce((n, p) => n + p.bytes, 0) / 1e6).toFixed(2)} MB of the map as sent`);
    return lines;
  } finally {
    clearInterval(watchdog);
    clearInterval(lateness);
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
  const chrome = value("--chrome", findChrome() ?? "");
  if (!chrome) throw new Error("no Chrome found: set CHROME or pass --chrome");
  if (!existsSync(map)) throw new Error(`${map} is missing: build it (bun tools/mapworld/build.ts <city>)`);
  mkdirSync(out, { recursive: true });
  const lines: string[] = [];
  for (const mbit of value("--mbit", "5,20").split(",").map(Number)) {
    lines.push(...(await trip({ map, dist: resolve(value("--dist", join(ROOT, "client/dist"))), mbit, latency: Number(value("--latency", "100")), out, chrome, fail: !process.argv.includes("--no-fail"), ...(process.argv.includes("--tier") ? { tier: value("--tier", "") } : {}) })));
  }
  writeFileSync(join(out, `trip${process.argv.includes("--no-fail") ? "-whole" : ""}.txt`), lines.join("\n") + "\n");
  process.exit(0);
}
