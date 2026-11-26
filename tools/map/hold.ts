// What a page fetches and holds of a built map over time, with no browser: the page's own loader (client/core/mapload.ts)
// in Bun, over the map's file and its parts' copies, behind a modelled link, on a clock of its own.
//
//   bun tools/map/hold.ts <file.snmap> [--seconds 300] [--mbit 20] [--every 10] [--at x,z] [--drive dx,dz] [--speed 80]
//                         [--tier medium] [--touch] [--dead from,to] [--scope x,z[,up[,down]]] [--since 60]
//
// The body stands at --at (map metres; the map's first spawn point if not given) or, with --drive, goes there plus
// (dx, dz) at --speed and comes back, again and again. With --dead it has no place from one second to the other, the
// camera over where it fell. With --scope a sight is raised on (x, z) for `up` seconds and lowered for `down` (1.5 each),
// again and again from --since on. The last line tells what was asked for and came from --since on. Every --every seconds it prints the bytes come over the link (as
// Brotli; cold, a part's first coming, and again, a part come before, which a browser's cache would serve and the page
// decodes again, timed apart), the parts held and asked for, and what the page holds by class (client/core/mapheld.ts), the city following
// the statics held among them as the session makes it (HeldStatics.follow) and read as the renderers read it (news), and the most statics and city held at any
// step of a hand-over. The far shadow is told by its sizes, since it is made in the renderer. The page wants what --tier wants (map-want.ts), on a touch-first device with --touch. Time here is the link's
// alone: the loader's own work takes none.

import { existsSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Get } from "../../client/core/fetched.ts";
import { heldTotal, kindsBytes, mapLedger, type MapHeld } from "../../client/core/mapheld.ts";
import { MapLoader, type Place } from "../../client/core/mapload.ts";
import { tierWant, type WantFrom } from "../../client/core/map-want.ts";
import { forTouch, tierOf } from "../../client/core/assets/tiers.ts";
import { TOP_CELL, farCell } from "../../client/core/render/farshadow.ts";
import { CHUNK_SIZE, chunkCount } from "../../shared/coords.ts";
import { compileContent, withContent } from "../../shared/content/registry.ts";
import type { CityStatics } from "../../shared/world/city.ts";
import { partsFolder, readHead, readPart } from "../../shared/world/mapfile.ts";
import { headOf } from "../maps/diff.ts";

const args = process.argv.slice(2);
const value = (flag: string, otherwise: string): string => (args.includes(flag) ? args[args.indexOf(flag) + 1]! : otherwise);
const file = args.find((a, k) => !a.startsWith("--") && (k === 0 || !args[k - 1]!.startsWith("--")));
if (!file || !existsSync(file)) {
  console.error("bun tools/map/hold.ts <file.snmap> [--seconds 300] [--mbit 20] [--every 10] [--at x,z] [--drive dx,dz] [--speed 80] [--tier medium] [--touch] [--dead from,to] [--scope x,z[,up[,down]]] [--since 60]");
  process.exit(2);
}
const SECONDS = Number(value("--seconds", "300"));
const BYTES_PER_MS = (Number(value("--mbit", "20")) * 1e6) / 8 / 1000;
const EVERY = Number(value("--every", "10")) * 1000;
const RTT = 100;
const SPEED = Number(value("--speed", "80"));
const TIER = tierOf(value("--tier", "medium")), TOUCH = args.includes("--touch");
const WANT = tierWant(TIER, TOUCH);
const SINCE = Number(value("--since", "0")) * 1000;
const DEAD = args.includes("--dead") ? value("--dead", "").split(",").map((s) => Number(s) * 1000) : null;
const SCOPE = args.includes("--scope") ? value("--scope", "").split(",").map(Number) : null;

const head = headOf(file);
const folder = partsFolder(file);
const spawn = head.spawns[0] ?? { x: (head.dims.chunksX * CHUNK_SIZE) / 2, z: (head.dims.chunksZ * CHUNK_SIZE) / 2 };
const [ax, az] = args.includes("--at") ? value("--at", "").split(",").map(Number) : [spawn.x, spawn.z];
const [dx, dz] = args.includes("--drive") ? value("--drive", "").split(",").map(Number) : [0, 0];

// The clock: timers run in the order they fall due, and a request's answer comes once the link has carried its bytes.
let now = 0;
let linkFree = 0;
const timers: { at: number; go: () => void }[] = [];
const later = (ms: number, go: () => void): void => {
  timers.push({ at: now + ms, go });
};
const stats = { asked: 0, came: 0, wire: 0, raw: 0 };
// A part's first coming is cold; one come before comes again warm, which a browser's cache would serve, and is decoded again.
const again = { cold: 0, coldParts: 0, warm: 0, warmParts: 0, decodeMs: 0 };
const fetched = new Set<string>();
const partOf = new Map(head.parts.map((p) => [p.name, p]));
/** Milliseconds to read `bytes` of `name` once more as the loader reads them, its hash checked. */
function decodeAgain(name: string, bytes: Uint8Array): number {
  const t0 = performance.now();
  const p = partOf.get(name);
  if (p) readPart(head, p, bytes);
  else readHead(bytes);
  return performance.now() - t0;
}
// A part's raw bytes are the map file's; its folder holds only the copies for the wire (tools/map/pack.ts).
const fd = openSync(file, "r");
const where = new Map([[head.name, { at: 0, length: head.bytes }], ...head.parts.map((p): [string, { at: number; length: number }] => [p.name, p])]);
const get: Get = (url) =>
  new Promise((done) => {
    const name = url.slice(url.lastIndexOf("/") + 1);
    const part = where.get(name);
    stats.asked++;
    if (!part) return later(RTT, () => done(new Response("not found", { status: 404 })));
    const copy = join(folder, `${name}.br`);
    const wire = existsSync(copy) ? statSync(copy).size : part.length;
    linkFree = Math.max(now + RTT / 2, linkFree) + wire / BYTES_PER_MS;
    timers.push({
      at: linkFree + RTT / 2,
      go: () => {
        stats.came++;
        stats.wire += wire;
        const bytes = new Uint8Array(part.length);
        readSync(fd, bytes, 0, part.length, part.at);
        stats.raw += bytes.length;
        if (fetched.has(name)) {
          again.warm += wire;
          again.warmParts++;
          again.decodeMs += decodeAgain(name, bytes);
        } else {
          fetched.add(name);
          again.cold += wire;
          again.coldParts++;
        }
        done(new Response(bytes));
      },
    });
  });
const wait = (ms: number): Promise<void> => new Promise((go) => later(ms, go));
const turn = (): Promise<void> => new Promise((go) => setImmediate(go));

/** What was asked for and had come at --since. */
let since: { asked: number; came: number; wire: number } | null = null;
/** Where the body last was: the camera stays over it while it is dead. */
let fell: { x: number; z: number } | null = null;

/** Where the body is, or null while it is dead. */
function bodyAt(): Place | null {
  if (DEAD && now >= DEAD[0]! && now < DEAD[1]!) return null;
  const at = place();
  if (DEAD) fell = { x: at.x, z: at.z };
  return at;
}

/** What the page wants at the clock's time: the tier's, the camera over a dead body, and the sight while it is raised. */
function want(): WantFrom {
  const [up, down] = [(SCOPE?.[2] ?? 1.5) * 1000, (SCOPE?.[3] ?? 1.5) * 1000];
  const raised = SCOPE !== null && now >= SINCE && (now - SINCE) % (up + down) < up;
  return { ...WANT, camera: fell, focus: raised ? { x: SCOPE![0]!, z: SCOPE![1]! } : null };
}

/** Where the body is at the clock's time: still, or out along (dx, dz) and back at SPEED. */
function place(): Place {
  const length = Math.hypot(dx, dz);
  if (length === 0) return { x: ax!, z: az!, vx: 0, vz: 0 };
  const leg = (length / SPEED) * 1000, t = now % (2 * leg), out = t < leg, f = out ? t / leg : 2 - t / leg;
  const v = (out ? 1 : -1) * SPEED / length;
  return { x: ax! + dx! * f, z: az! + dz! * f, vx: dx! * v, vz: dz! * v };
}

// The city as the session makes it: following the sectors held, from the first frame on.
const compiled = compileContent(CORE_CONTENT);
if (!compiled.registry) throw new Error(compiled.errors.join("\n"));
let city: CityStatics | null = null;
const handed: string[] = [];
/** The most statics and city held, and at a hand-over's steps. */
const most = { held: 0, handing: 0 };
/** Statics and the city as the ledger counts them, its kinds apart. */
const heldNow = (): number => mapLedger({ loader, city, skip: [compiled.registry] }).filter((r) => r.name === "statics" || r.name === "city").reduce((n, r) => n + r.bytes, 0);
function* arriving(): Generator<void, void> {
  handed.push(`${(now / 1000).toFixed(1)} s ${loader.statics.size} sectors`);
  most.handing = Math.max(most.handing, heldNow());
}

/**
 * The far shadow's bytes by its sizes (client/core/render/farshadow.ts): its two grids of solid heights and ground at the
 * far map's cell for the tier's shadow side, and its few bytes a chunk. It copies nothing of the city or the ground.
 */
function farShadowBytes(): number {
  const size = forTouch(TIER, TOUCH).shadows.size;
  if (size <= 0) return 0;
  const side = CHUNK_SIZE / TOP_CELL, k = farCell(head.dims, size) / TOP_CELL;
  const w = Math.ceil((head.dims.chunksX * side) / k), h = Math.ceil((head.dims.chunksZ * side) / k);
  return 2 * w * h * 2 + chunkCount(head.dims) * 10;
}

const mb = (n: number): string => (n / 1e6).toFixed(1);
const line = (rows: readonly MapHeld[]): string => rows.map((r) => `${r.name} ${mb(r.bytes)}`).join(", ");

const started = MapLoader.start(get, `map/${head.name}`, { wait, every: wait });
let loader!: MapLoader;
let ready = false;
void started.then(async (l) => {
  loader = l;
  city = l.held.follow(withContent(compiled.registry!, l.staged.content?.defs ?? []));
  // Each sector set in is a moment the most may be held at.
  l.held.onSet(() => void (most.held = Math.max(most.held, heldNow())));
  await l.follow(bodyAt, { arriving, want });
  ready = true;
  console.log(`${(now / 1000).toFixed(1)} s  first frame: ${mb(stats.wire)} MB come`);
});

console.log(`${head.id}: ${head.dims.chunksX} by ${head.dims.chunksZ} chunks, ${head.parts.length} parts; body at ${Math.round(ax!)}, ${Math.round(az!)}${dx || dz ? `, driving ${Math.round(Math.hypot(dx!, dz!))} m and back at ${SPEED} m/s` : ", still"}; ${value("--mbit", "20")} Mbit/s; view ${WANT.view} m, statics ${WANT.statics} m`);
let nextSample = 0;
let askedThen = 0;
let settledAt = -1;
/** The squares the city's readers last took in (CityStatics.news), as the renderers follow them. */
let readSquares = new Uint32Array(0);
for (;;) {
  for (let k = 0; k < 4; k++) await turn();
  const following = city as CityStatics | null;
  if (following) {
    if (readSquares.length !== following.size) readSquares = new Uint32Array(following.size);
    following.news(readSquares, () => {});
  }
  if (now >= nextSample && loader) {
    const rows = mapLedger({ loader, city, skip: [compiled.registry] });
    most.held = Math.max(most.held, heldNow());
    const shadow = farShadowBytes();
    const p = loader.progress();
    if (!p.settled || stats.asked > askedThen) settledAt = -1;
    if (p.settled && settledAt < 0) settledAt = now;
    const still = settledAt >= 0 ? `, settled ${((now - settledAt) / 1000).toFixed(0)} s` : "";
    console.log(`${(now / 1000).toFixed(0).padStart(4)} s  came ${mb(stats.wire).padStart(6)} MB in ${stats.came} parts (cold ${mb(again.cold)}, again ${mb(again.warm)}), ${stats.asked - askedThen} asked since, ${p.left} of ${p.parts} wanted left${ready ? still : " (before the first frame)"}; ${loader.statics.size} sectors of statics, ${mb(loader.statics.bytes)} MB; holds ${mb(heldTotal(rows) + shadow)} MB: ${line(rows)}${shadow ? `, far shadow ${mb(shadow)} by its sizes` : ""}`);
    askedThen = stats.asked;
    nextSample += EVERY;
  }
  if (now >= SINCE) since ??= { asked: stats.asked, came: stats.came, wire: stats.wire };
  if (now >= SECONDS * 1000) break;
  timers.sort((a, b) => a.at - b.at);
  // With nothing due before the next sample, the clock goes to it: a body that moves may want more.
  if (timers.length === 0 || (nextSample > now && nextSample < timers[0]!.at)) {
    now = Math.max(now + 1, nextSample);
    continue;
  }
  const t = timers.shift()!;
  now = Math.max(now, t.at);
  t.go();
}
console.log(`hand-overs: ${handed.join("; ") || "none"}`);
console.log(`came ${mb(stats.wire)} MB in ${stats.came} parts: cold ${mb(again.cold)} MB, ${again.coldParts} parts the first time; again ${mb(again.warm)} MB, ${again.warmParts} parts come before, which a browser's cache would serve, decoded again in ${again.decodeMs.toFixed(0)} ms`);
if (since && SINCE > 0) console.log(`from ${SINCE / 1000} s on: ${stats.asked - since.asked} asked, ${mb(stats.wire - since.wire)} MB in ${stats.came - since.came} parts`);
console.log(`statics and city held at most: ${mb(most.held)} MB at the samples, ${mb(most.handing)} MB at a hand-over; the city's kinds ${mb(city ? kindsBytes(city) : 0)} MB apart`);
process.exit(0);
