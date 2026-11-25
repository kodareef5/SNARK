// What a page fetches and holds of a built map over time, with no browser: the page's own loader (client/core/mapload.ts)
// in Bun, over the map's parts folder, behind a modelled link, on a clock of its own.
//
//   bun tools/map/hold.ts <file.snmap> [--seconds 300] [--mbit 20] [--every 10] [--at x,z] [--drive dx,dz] [--speed 80]
//
// The body stands at --at (map metres; the map's first spawn point if not given) or, with --drive, goes there plus
// (dx, dz) at --speed and comes back, again and again. Every --every seconds it prints the bytes come over the link (as
// Brotli), the parts held and asked for, and what the page holds by class (client/core/mapheld.ts), the city made of the
// statics handed over among them as the session makes it. The far shadow is told by its sizes, since it is made in the
// renderer. Time here is the link's alone: the loader's own work takes none.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Get } from "../../client/core/fetched.ts";
import { heldTotal, mapLedger, type MapHeld } from "../../client/core/mapheld.ts";
import { MapLoader, type Place } from "../../client/core/mapload.ts";
import { CHUNK_SIZE, chunkCount } from "../../shared/coords.ts";
import { compileContent, withContent } from "../../shared/content/registry.ts";
import { CityStatics } from "../../shared/world/city.ts";
import { partsFolder, type MapStatics } from "../../shared/world/mapfile.ts";
import { headOf } from "../maps/diff.ts";

const args = process.argv.slice(2);
const value = (flag: string, otherwise: string): string => (args.includes(flag) ? args[args.indexOf(flag) + 1]! : otherwise);
const file = args.find((a, k) => !a.startsWith("--") && (k === 0 || !args[k - 1]!.startsWith("--")));
if (!file || !existsSync(file)) {
  console.error("bun tools/map/hold.ts <file.snmap> [--seconds 300] [--mbit 20] [--every 10] [--at x,z] [--drive dx,dz] [--speed 80]");
  process.exit(2);
}
const SECONDS = Number(value("--seconds", "300"));
const BYTES_PER_MS = (Number(value("--mbit", "20")) * 1e6) / 8 / 1000;
const EVERY = Number(value("--every", "10")) * 1000;
const RTT = 100;
const SPEED = Number(value("--speed", "80"));

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
const get: Get = (url) =>
  new Promise((done) => {
    const path = join(folder, url.slice(url.lastIndexOf("/") + 1));
    stats.asked++;
    if (!existsSync(path)) return later(RTT, () => done(new Response("not found", { status: 404 })));
    const wire = existsSync(`${path}.br`) ? statSync(`${path}.br`).size : statSync(path).size;
    linkFree = Math.max(now + RTT / 2, linkFree) + wire / BYTES_PER_MS;
    timers.push({
      at: linkFree + RTT / 2,
      go: () => {
        stats.came++;
        stats.wire += wire;
        const bytes = readFileSync(path);
        stats.raw += bytes.length;
        done(new Response(bytes));
      },
    });
  });
const wait = (ms: number): Promise<void> => new Promise((go) => later(ms, go));
const turn = (): Promise<void> => new Promise((go) => setImmediate(go));

/** Where the body is at the clock's time: still, or out along (dx, dz) and back at SPEED. */
function place(): Place {
  const length = Math.hypot(dx, dz);
  if (length === 0) return { x: ax!, z: az!, vx: 0, vz: 0 };
  const leg = (length / SPEED) * 1000, t = now % (2 * leg), out = t < leg, f = out ? t / leg : 2 - t / leg;
  const v = (out ? 1 : -1) * SPEED / length;
  return { x: ax! + dx! * f, z: az! + dz! * f, vx: dx! * v, vz: dz! * v };
}

// The city as the session makes it of each hand-over: of the sectors round the body, then of the whole map's.
const compiled = compileContent(CORE_CONTENT);
if (!compiled.registry) throw new Error(compiled.errors.join("\n"));
let city: CityStatics | null = null;
let cityFailed = "";
const handed: string[] = [];
const arrived = (statics: MapStatics, whole: boolean): void => {
  handed.push(`${(now / 1000).toFixed(1)} s ${whole ? "whole" : "near"}`);
  try {
    city = new CityStatics(head.dims, statics, withContent(compiled.registry!, loader.staged.content?.defs ?? []));
  } catch (e) {
    cityFailed = e instanceof Error ? e.message : String(e);
  }
};

/**
 * The far shadow's bytes by its sizes (client/core/render/farshadow.ts): the three grids of 4 m cells it keeps, and the
 * copy of the city and the ground its first job sends its worker, which is let go once the grids are made.
 */
function farShadowBytes(statics: MapStatics | null, hf: { heights: Uint16Array }): { held: number; once: number } {
  const held = 3 * chunkCount(head.dims) * (CHUNK_SIZE / 4) ** 2 * 2;
  const once = statics ? statics.kind.length * 16 + statics.first.byteLength + hf.heights.byteLength : 0;
  return { held, once };
}

const mb = (n: number): string => (n / 1e6).toFixed(1);
const line = (rows: readonly MapHeld[]): string => rows.map((r) => `${r.name} ${mb(r.bytes)}`).join(", ");

const started = MapLoader.start(get, `map/${head.name}`, { wait });
let loader!: MapLoader;
let ready = false;
void started.then(async (l) => {
  loader = l;
  await l.follow(place, { arrived });
  ready = true;
  console.log(`${(now / 1000).toFixed(1)} s  first frame: ${mb(stats.wire)} MB come`);
});

console.log(`${head.id}: ${head.dims.chunksX} by ${head.dims.chunksZ} chunks, ${head.parts.length} parts; body at ${Math.round(ax!)}, ${Math.round(az!)}${dx || dz ? `, driving ${Math.round(Math.hypot(dx!, dz!))} m and back at ${SPEED} m/s` : ", still"}; ${value("--mbit", "20")} Mbit/s`);
let nextSample = 0;
for (;;) {
  for (let k = 0; k < 4; k++) await turn();
  if (now >= nextSample && loader) {
    const rows = mapLedger({ loader, city, skip: [compiled.registry] });
    const shadow = city ? farShadowBytes(loader.statics, loader.staged.hf) : { held: 0, once: 0 };
    const p = loader.progress();
    console.log(`${(now / 1000).toFixed(0).padStart(4)} s  came ${mb(stats.wire).padStart(6)} MB in ${stats.came} parts, ${p.left} left${ready ? "" : " (before the first frame)"}; holds ${mb(heldTotal(rows) + shadow.held)} MB: ${line(rows)}${shadow.held ? `, far shadow ${mb(shadow.held)} by its sizes, and ${mb(shadow.once)} copied once to its worker` : ""}`);
    nextSample += EVERY;
  }
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
console.log(`hand-overs: ${handed.join("; ") || "none"}${cityFailed ? `; the city could not be made: ${cityFailed}` : ""}`);
process.exit(0);
