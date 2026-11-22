// Where a frame's GPU time goes on this machine. Each row is the game's own page at `?bench=1` in headless Chrome, which
// times the GPU by timer query (client/core/passes.ts) while the view turns in place: with everything on, each pass by
// itself (`?passes=1`), and with each effect off in turn (`?off=`). On an Apple GPU through ANGLE a query between passes
// ends Metal's render pass and stores and loads the tiles, which a frame does not otherwise do, so a pass's row says
// where time goes and the whole frame's runs say what an effect costs. What the governor's levels leave is counted for
// the phone in tools/bench/governor.ts: this machine's GPU is not bound where a phone's is.
//
// The device scenes are drawn at three device pixels to one as the iPhone of D349 has them: the proving ground with the
// device probe's crowd, its thatch and a base of 1,024 pieces, the device probe's wood on the 8 km hills, and a flock of
// hurt and dead dodos. The city is a built Miami (var/maps/miami.snmap, or the file CITY_MAP names) in a 1,920 by 1,080
// window at one and two device pixels to one, on its street and over it, the survivor held there as a ghost: on medium,
// high and ultra, each also on the page's clock (`?sync=1`, every frame waiting for the card), which a timer query on this
// card reads too long where a frame has many passes or the card is busy with the frame before; with shadows and the far
// layers off in turn on medium at one and on ultra at two. The finish's light
// target, its bloom and bodies' contact are each turned off every other frame on high and ultra at one, as the walls'
// worn edges, the facades, the road's wear and the walks' are on the street, on the page's clock (`?sync=1&ab=`): what each costs is the median of a frame without it less the frames with it either side, which
// the turning view and other work on the card move little, and which a timer query on this card reads too long. The
// street lamps' light (render/street-lamps.ts) is turned off so on the street at night, at 22:00, on high and ultra, the
// moon's shadows (render/sky.ts castLight) there too on medium, high and ultra, at 1,920 by 1,080 and a laptop's 3,600 by
// 1,924, the street lamp that lights as a light (render/lamp.ts) and the shadows in the lamps' pool cards by the
// lamps' stations, and the
// wires between the poles (render/street-wires.ts) by day, and what stands overhead and the light from the ground
// (render/roof.ts) on the street on high at one and two and on ultra at two, and vehicles' glass seen through
// (render/vehicle-glass.ts) on the street and over the busy lamp's parked cars. A city row's GL draws and triangles are of the frame its run
// ends on, and their medians over the turn's frames; the view turns by the frames measured, not the time they took, so
// each run of a row ends on the same view whatever its frame rate, and what the scene times (a tree cell's swap of
// levels, the budget's squeeze, a lamp's fade) follows the run's clock, a sixtieth of a second a frame (bench-run.ts
// clock). Each run is held at its row's hour, or the hour the scene's server began at, so the sun stands still through
// it. Chrome is found as tools/probe.ts finds it, or named by CHROME;
// without it every row is skipped, and without the map the city's. The page is a client built for the bench in a
// process of its own (buildClientApart), or the built client CLIENT_DIR names. `bun tools/bench/gpu.ts [runs] [a row's first words|another's]...` runs these alone (a row's whole name ended
// with "$" runs that row alone), each `runs` times (3), and prints each row's range.
//
// Miami's street on high is also run with the page's processor slowed four and six times by the browser's own
// throttle, for our code's time. After a city run's report its GL calls are counted over COUNT_FRAMES frames by kind,
// and with GPU_PROFILE naming a folder the page's processor is then profiled for PROFILE_MS into a file a run there.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WOOD, basePieces, crowdScene } from "../../client/core/devicescene.ts";
import { CUE_DEAD, CUE_DECAY_SHIFT, CUE_OUT } from "../../shared/anim/pose.ts";
import { MODE_GHOST } from "../../shared/sim/character.ts";
import { hourOfDay, offsetForHour } from "../../shared/sim/clock.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { PROVING_SPAWN } from "../../shared/world/proving.ts";
import { SETTLE_MS } from "../../client/core/bench-run.ts";
import { PASSES, type Effect } from "../../client/core/passes.ts";
import { startServer } from "../../server/main.ts";
import { resolveNodes, writeMap } from "../../shared/world/mapfile.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { buildClientApart } from "../build-client.ts";
import { placeOf, type Place } from "./census.ts";
import { benchHills } from "./terrain.ts";
import { CHROME_FLAGS, findChrome } from "../chrome.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

type Scene = "base" | "wood" | "flock" | "city";
type View = "street" | "air" | "lamp" | "lamp-cars" | "lamp-front" | "marina" | "wall" | "canyon";
/** What each run measures: a scene, a tier, each pass by itself or the frame, an effect off or the far layers. On the city, where and at how many device pixels to one, and how many times slower the page's processor is made. */
interface Run {
  scene: Scene;
  tier: string;
  passes?: boolean;
  off?: Effect | "far";
  /** An effect every other frame draws without, on the page's clock. */
  ab?: Effect;
  /** Whether the frame is timed on the page's clock and not by query. */
  clock?: boolean;
  view?: View;
  scale?: number;
  cpu?: number;
  /** The hour the world is set to, where not the server's. */
  hour?: number;
  /** The window in points, where not 1,920 by 1,080: headless Chrome keeps 87 of its points for itself, so 1,800 by 1,049 at 2 is a canvas of 3,600 by 1,924. */
  window?: readonly [number, number];
}
const BASE_PIECES = 1024;

const CHROME = findChrome();
const CITY_MAP = process.env.CITY_MAP ?? fileURLToPath(new URL("../../var/maps/miami.snmap", import.meta.url));
/** The far city, far trees, rocks and bushes, and far bases. */
const FAR: readonly Effect[] = ["farcity", "farnodes", "farblocks"];
/**
 * Miami's street and air: on the ground 300 m into downtown's grid (the census's street-300), and 140 m over the far
 * city's hand-over (its air-handover), in metres from the 16 km map's centre as the census has them.
 */
const CITY_PLACES: Record<View, Place> = {
  // CITY_STREET, "east,north", puts it elsewhere: on a cut that does not hold downtown's grid (tools/mapworld/cut.ts).
  street: ((at) => ({ name: "street", east: at.length === 2 ? at[0]! : 859, north: at.length === 2 ? at[1]! : -3007, up: 0 }))((process.env.CITY_STREET ?? "").split(",").filter(Boolean).map(Number)),
  air: { name: "air", east: 1192, north: -3482, up: 140 },
  // 48 m west of the street, 6 m along the road from under the lens of a working lamp, which lights there by night.
  lamp: { name: "lamp", east: 889, north: -2961, up: 0 },
  // Two working lamps whose light is busy: one over a row of five abandoned cars at the kerb, 450 m north-west of the
  // street, the body 8 m out over the road and 6 m along it from the mast; and one before a three-storey front 3 m
  // behind its mast, two cars on the road under it, the body 6 m along the road from under its lens.
  "lamp-cars": { name: "lamp-cars", east: 1091, north: -2588, up: 0 },
  "lamp-front": { name: "lamp-front", east: -875, north: 2131, up: 0 },
  // On a marina's walkway among its moored boats (tools/boat/marinas.ts), where CITY_MARINA puts it on the map benched:
  // "east,north,y", metres from its centre and the dock's deck. Only then are its rows run.
  marina: ((at) => ({ name: "marina", east: at[0] ?? 0, north: at[1] ?? 0, y: at[2] ?? 0.7 }))((process.env.CITY_MARINA ?? "").split(",").map(Number)),
  // On East Flagler Street's south walk facing the Flagler Building's shops across the street, and in its middle looking
  // west down it, the walls either side at a slant: the views held still, which near trees do not move in.
  wall: { name: "wall", east: 974, north: -3000, up: 0 },
  canyon: { name: "canyon", east: 889, north: -3008, up: 0 },
};
/** Where a held view faces, yaw and pitch in degrees (yaw 0 north, -90 west), which the page is told as a look's orders. */
const LOOKS: Partial<Record<View, readonly [number, number]>> = { wall: [0, 8], canyon: [-88, 2] };

export function plan(): Run[] {
  const runs: Run[] = [];
  const offs: Record<string, Effect[]> = { "base medium": ["shadows", "haze", "clouds", "water", "farblocks", "band"], "base high": ["shadows"], "wood medium": ["shadows", "haze", "clouds", "farnodes", "band"], "wood high": ["shadows", "farnodes", "band"] };
  for (const [key, list] of Object.entries(offs)) {
    const [scene, tier] = key.split(" ") as [Scene, string];
    runs.push({ scene, tier, passes: true }, { scene, tier }, ...list.map((off) => ({ scene, tier, off })));
  }
  for (const tier of ["medium", "ultra"]) runs.push({ scene: "flock", tier }, { scene: "flock", tier, off: "layers" });
  for (const view of ["street", "air"] as View[]) {
    for (const tier of ["medium", "high", "ultra"]) for (const scale of [1, 2]) runs.push({ scene: "city", view, tier, scale }, { scene: "city", view, tier, scale, clock: true });
    for (const [tier, scale] of [["medium", 1], ["ultra", 2]] as const) for (const off of ["shadows", "far"] as const) runs.push({ scene: "city", view, tier, scale, off });
    // The finish (post.ts): the light target and its pass, bloom, and bodies' contact, each off every other frame.
    for (const tier of ["high", "ultra"]) for (const ab of ["light", "bloom", "contact"] as const) runs.push({ scene: "city", view, tier, scale: 1, ab });
    // What is hidden left out, and the opaque draws nearest first (render/hide.ts, render/scene.ts order).
    for (const [tier, scale] of view === "street" ? ([["high", 2], ["medium", 1]] as const) : ([["high", 2]] as const)) for (const off of ["hide", "order"] as const) runs.push({ scene: "city", view, tier, scale, off });
  }
  runs.push({ scene: "city", view: "street", tier: "high", scale: 1, off: "facades" });
  for (const tier of ["high", "ultra"]) runs.push({ scene: "city", view: "street", tier, scale: 1, ab: "edges" });
  // The facades' parts and marks, off every other frame, read again whenever the atlases or a room's light change.
  for (const tier of ["high", "ultra"]) runs.push({ scene: "city", view: "street", tier, scale: 1, ab: "facades" });
  for (const tier of ["high", "ultra"]) runs.push({ scene: "city", view: "street", tier, scale: 1, ab: "lamps", hour: 22 });
  // The moon's shadows (render/sky.ts castLight) at 22:00, on a canvas of 1,920 by 1,080 and on a laptop's 3,600 by 1,924.
  for (const tier of ["medium", "high", "ultra"]) runs.push({ scene: "city", view: "street", tier, scale: 1, window: [1920, 1167], ab: "moon", hour: 22 });
  for (const tier of ["high", "ultra"]) runs.push({ scene: "city", view: "street", tier, scale: 2, window: [1800, 1049], ab: "moon", hour: 22 });
  // The street lamp that lights as a light (render/lamp.ts), by one at 22:00, as both canvases, and by two whose light
  // falls on cars and a building's front; and at noon, when it is out.
  for (const view of ["lamp", "lamp-cars", "lamp-front"] as const) for (const tier of ["high", "ultra"]) for (const [scale, window] of [[1, [1920, 1167]], [2, [1800, 1049]]] as const) runs.push({ scene: "city", view, tier, scale, window, ab: "lamp", hour: 22 });
  runs.push({ scene: "city", view: "lamp", tier: "high", scale: 1, window: [1920, 1167], ab: "lamp", hour: 12 });
  // The shadows of the bodies and cars in every lamp's pool card (render/lamp.ts poolShade), on medium and high at both
  // canvases by the three lamps at 22:00, and at noon, when there are no cards.
  for (const view of ["lamp", "lamp-cars", "lamp-front"] as const) for (const tier of ["medium", "high"]) for (const [scale, window] of [[1, [1920, 1167]], [2, [1800, 1049]]] as const) runs.push({ scene: "city", view, tier, scale, window, ab: "pools", hour: 22 });
  runs.push({ scene: "city", view: "lamp", tier: "medium", scale: 1, window: [1920, 1167], ab: "pools", hour: 12 });
  for (const tier of ["high", "ultra"]) runs.push({ scene: "city", view: "street", tier, scale: 1, ab: "wires" });
  for (const tier of ["high", "ultra"]) runs.push({ scene: "city", view: "street", tier, scale: 1, ab: "road" });
  // The ground's street and walk edges from the streets' lines (render/streets.ts), off every other frame, on medium and
  // high on a canvas of 1,920 by 1,080 and on a laptop's 3,600 by 1,924.
  for (const tier of ["medium", "high"]) for (const [scale, window] of [[1, [1920, 1167]], [2, [1800, 1049]]] as const) runs.push({ scene: "city", view: "street", tier, scale, window, ab: "streets" });
  for (const tier of ["high", "ultra"]) runs.push({ scene: "city", view: "street", tier, scale: 1, ab: "walks" });
  // The whole frame on a laptop's 3,600 by 1,924 on medium and high, by query and on the page's clock: what a build with
  // bent kerbs costs against one with the walk kit, each run on the same client and the same street.
  for (const tier of ["medium", "high"]) for (const clock of [false, true]) runs.push({ scene: "city", view: "street", tier, scale: 2, window: [1800, 1049], ...(clock ? { clock } : {}) });
  // The bent kerbs' wear (render/bend.ts bentWear), on the canvases of 1,920 by 1,080 and 3,600 by 1,924.
  for (const [tier, scale] of [["medium", 1], ["high", 1], ["high", 2], ["medium", 2]] as const) runs.push({ scene: "city", view: "street", tier, scale, ...(scale === 2 ? { window: [1800, 1049] as [number, number] } : {}), ab: "kerbs" });
  // The walls' weathering read (world-surfaces.ts weathered), its layers long made by the time a run measures: on the
  // street turning, before a close wall and down a street at a slant, held, on high at 3,600 by 1,924 and medium at 1,920
  // by 1,080.
  for (const ab of ["weather"] as Effect[]) for (const view of ["street", "wall", "canyon"] as const) for (const [tier, scale] of [["medium", 1], ["high", 2]] as const) runs.push({ scene: "city", view, tier, scale, ...(scale === 2 ? { window: [1800, 1049] as [number, number] } : {}), ab });
  // What stands overhead (render/roof.ts) off every other frame, at the laptop canvas's pixels too.
  for (const [tier, scale] of [["high", 1], ["high", 2], ["ultra", 2]] as const) for (const ab of ["roofs", "bounce"] as const) runs.push({ scene: "city", view: "street", tier, scale, ab });
  for (const cpu of [4, 6]) runs.push({ scene: "city", view: "street", tier: "high", scale: 1, cpu });
  // Vehicles' glass seen through (render/vehicle-glass.ts) off every other frame: on the street by day, and over the
  // busy lamp's row of five parked cars by night.
  for (const [tier, scale] of [["high", 1], ["high", 2], ["medium", 1]] as const) runs.push({ scene: "city", view: "street", tier, scale, ab: "glass" });
  for (const tier of ["high", "medium"]) runs.push({ scene: "city", view: "lamp-cars", tier, scale: 1, window: [1920, 1167], ab: "glass", hour: 22 });
  if (process.env.CITY_MARINA) for (const tier of ["medium", "high"]) for (const scale of [1, 2]) runs.push({ scene: "city", view: "marina", tier, scale });
  return runs;
}

const COUNT_FRAMES = 30;
const PROFILE_MS = 5000;
/**
 * Counts the page's GL calls over COUNT_FRAMES frames, by kind, a frame's on average: each method of the context and of
 * its multi-draw extension wrapped from one frame's end to another's and put back. A call is said again where it sets a
 * binding, a uniform, a pointer or a state to what the context holds. Of the draws, it counts those listed (a multi-draw
 * call holds several), and those that could have gone in the call before them: with nothing but their run of indices
 * changed in between, or with only a vertex array, its pointers and three-float uniforms (another level and offset).
 */
const COUNT_CALLS = `new Promise((done) => {
  const kinds = [["draws", /^(multiD|d)raw(Arrays|Elements|RangeElements)/], ["uniforms", /^uniform[1-4M]/], ["binds", /^(bind|useProgram$|activeTexture$)/], ["pointers", /[vV]ertexAttrib/], ["state", /^(enable|disable|depth|cull|polygonOffset|blendFunc|viewport|clear|colorMask)/], ["other", /./]];
  const calls = {}, again = {}, draws = { listed: 0, runs: 0, levels: 0 };
  for (const [k] of kinds) calls[k] = again[k] = 0;
  const ids = new WeakMap();
  let made = 0;
  const id = (o) => (o === null || typeof o !== "object" ? String(o) : ids.get(o) ?? (ids.set(o, "#" + ++made), ids.get(o)));
  const text = (a) => a.map((v) => (ArrayBuffer.isView(v) ? Array.prototype.join.call(v) : id(v))).join("|");
  const held = new Map();
  let vao = null, unit = 0, shape = null, changed = 0, levelOnly = true;
  const what = (name, a) => {
    if (name === "useProgram") return ["program", id(a[0])];
    if (name === "bindVertexArray") return ["vao", id(a[0])];
    if (name === "activeTexture") return ["unit", String(a[0])];
    if (name === "bindTexture") return ["texture " + unit + " " + a[0], id(a[1])];
    if (name === "bindBuffer") return ["buffer " + a[0] + (a[0] === 0x8893 ? " " + id(vao) : ""), id(a[1])];
    if (name === "bindFramebuffer") return ["framebuffer " + a[0], id(a[1])];
    if (name === "enable" || name === "disable") return ["cap " + a[0], name];
    if (/^uniform[1-4M]/.test(name)) return ["uniform " + id(a[0]), text(a.slice(1))];
    if (/^vertexAttribI?Pointer$/.test(name)) return ["attribute " + id(vao) + " " + a[0], text(a.slice(1)) + " " + held.get("buffer 34962")];
    if (/^(depthMask|depthFunc|depthRange|cullFace|polygonOffset|viewport|blendFuncSeparate|clearColor)$/.test(name)) return [name, text(a)];
    return null;
  };
  const gl = document.querySelector("#view").getContext("webgl2");
  const multi = gl.getExtension("WEBGL_multi_draw");
  const saved = [];
  for (const proto of [WebGL2RenderingContext.prototype, ...(multi ? [Object.getPrototypeOf(multi)] : [])]) for (const name of Object.getOwnPropertyNames(proto)) {
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (typeof d.value !== "function" || name === "constructor") continue;
    const kind = kinds.find(([, r]) => r.test(name))[0], f = d.value;
    saved.push([proto, name, d]);
    proto[name] = function (...a) {
      calls[kind]++;
      const set = what(name, a), same = set !== null && held.get(set[0]) === set[1];
      if (set) held.set(set[0], set[1]);
      if (same) again[kind]++;
      if (name === "bindVertexArray") vao = a[0];
      if (name === "activeTexture") unit = a[0];
      if (kind === "draws") {
        const many = name === "multiDrawElementsInstancedWEBGL";
        const now = name === "drawElementsInstanced" ? [a[0], a[2], a[4]].join() : many ? [a[0], a[3], a[6][a[7]]].join() : null;
        draws.listed += many ? a[8] : 1;
        if (now !== null && now === shape) { if (changed === 0) draws.runs++; else if (levelOnly) draws.levels++; }
        [shape, changed, levelOnly] = [now, 0, true];
      } else if (!same) {
        changed++;
        levelOnly &&= /^(bindVertexArray|bindBuffer|vertexAttribI?Pointer|uniform3f)$/.test(name);
      }
      return f.apply(this, a);
    };
  }
  let n = 0;
  const tick = () => {
    if (n++ < ${COUNT_FRAMES}) return void requestAnimationFrame(tick);
    for (const [proto, name, d] of saved) Object.defineProperty(proto, name, d);
    const each = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v / ${COUNT_FRAMES})]));
    done(JSON.stringify({ calls: each(calls), again: each(again), draws: each(draws), offers: gl.getSupportedExtensions().filter((e) => /multi_draw|base_vertex/.test(e)) }));
  };
  requestAnimationFrame(tick);
})`;

/** The page of a Chrome started with a profile and a debugging port of its own: a call to it over the DevTools protocol. */
async function devtools(profile: string): Promise<{ send: (method: string, params?: object) => Promise<any>; close: () => void }> {
  const file = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100 && !existsSync(file); i++) await Bun.sleep(100);
  const port = Number(readFileSync(file, "utf8").split("\n")[0]);
  const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
  const ws = new WebSocket(targets.find((t) => t.type === "page")!.webSocketDebuggerUrl);
  await new Promise((open) => (ws.onopen = open));
  const waiting = new Map<number, (result: any) => void>();
  let id = 0;
  ws.onmessage = (m) => {
    const reply = JSON.parse(String(m.data));
    waiting.get(reply.id)?.(reply.result);
    waiting.delete(reply.id);
  };
  return { send: (method, params = {}) => new Promise((r) => (waiting.set(++id, r), ws.send(JSON.stringify({ id, method, params })))), close: () => ws.close() };
}

/** Holds every survivor on `server` at `p` as a ghost, still, from the moment it has a body. */
function holdAt(server: ReturnType<typeof startServer>, p: Place): ReturnType<typeof setInterval> {
  const { world, game } = server.host;
  const [x, y, z] = placeOf([world.hf.sizeX / 2, world.hf.sizeZ / 2], world.hf, p);
  return setInterval(() => {
    const ents = world.ents;
    for (const c of game.clients) {
      if (!c?.active || c.closed || c.ent < 0) continue;
      if (ents.mode[c.ent] === MODE_GHOST && Math.hypot(ents.x[c.ent]! - x, ents.y[c.ent]! - y, ents.z[c.ent]! - z) < 1) continue;
      ents.mode[c.ent] = MODE_GHOST;
      ents.setPosition(c.ent, x, y, z);
      ents.vx[c.ent] = ents.vy[c.ent] = ents.vz[c.ent] = 0;
    }
  }, 100);
}

/** How far the world's hour may move before a run's hold sets it back: 36 s of the day, the sun a sixth of a degree. */
const HOUR_HELD = 0.01;

/**
 * Holds `server`'s world at `hour` through a run (D1122): the sun stands where it stood however long the run's map takes
 * to come, so two runs of a row, a minute or two apart, draw it in one place. Left to the server's clock, the day moves an
 * hour in a little over two minutes.
 */
function holdHour(server: ReturnType<typeof startServer>, hour: number): ReturnType<typeof setInterval> {
  const w = server.host.world;
  const set = (): void => {
    w.dayOffset = offsetForHour(w.tick, hour, w.clock);
    server.host.game.replication.markAllOwn();
  };
  set();
  return setInterval(() => {
    const off = (((hourOfDay(w.tick, w.dayOffset, w.clock) - hour) % 24) + 36) % 24 - 12;
    if (Math.abs(off) > HOUR_HELD) set();
  }, 100);
}

/** Dodos round the spawn point, in two rings so that some fill the view whichever way it turns. */
export const FLOCK = 40;

/**
 * The flock: three in four hurt, a third of those at each stage, and one in four a corpse lying at a decay stage, set as
 * the server sets them. Returns how many there are: a dodo whose place is taken is left out.
 */
export function flock(server: ReturnType<typeof startServer>): number {
  const { world, records, survival, hurt } = server.host;
  let n = 0;
  for (let k = 0; k < FLOCK; k++) {
    const [ring, turn] = k < FLOCK / 2 ? [2.5, (k + 0.5) / (FLOCK / 2)] : [4.5, (k - FLOCK / 2) / (FLOCK / 2)];
    const e = server.host.spawnCreature("core:dodo", PROVING_SPAWN.x + Math.sin(turn * Math.PI * 2) * ring, PROVING_SPAWN.z + Math.cos(turn * Math.PI * 2) * ring, 10);
    if (e < 0) continue;
    n++;
    const rec = records.byPid.get(world.ents.pid[e]!)!;
    if (k % 4 === 3) {
      world.ents.cue[e] = world.ents.cue[e]! | CUE_DEAD | CUE_OUT | (((k >> 2) & 3) << CUE_DECAY_SHIFT);
      world.history.cued(e);
    } else {
      survival.hurt(rec, (rec.vitals!.max[V_HEALTH]! / 1e6) * (0.3 + 0.25 * (k % 4)), 0);
      hurt.check(rec);
    }
  }
  return n;
}

const nameOf = (r: Run): string => `${r.scene}${r.view ? ` ${r.view}` : ""} ${r.tier}${r.scale ? ` x${r.scale}` : ""}${r.window ? ` in ${r.window.join("x")}` : ""}${r.passes ? ", by pass" : ""}${r.off ? `, ${r.off === "far" ? "far layers" : r.off} off` : ""}${r.cpu ? `, processor ${r.cpu} times slower` : ""}${r.ab ? `, ${r.ab} off every other frame` : ""}${r.clock ? ", on the page's clock" : ""}${r.hour !== undefined ? `, at ${r.hour}:00` : ""}`;

/** Each run's report from the page, `times` times over, a scene's server at a time. */
async function measure(runs: Run[], times: number, say: (line: string) => void): Promise<Map<string, Record<string, any>[]>> {
  const out = new Map<string, Record<string, any>[]>();
  const dist = process.env.CLIENT_DIR ?? mkdtempSync(join(tmpdir(), "snark-gpu-client-"));
  if (!process.env.CLIENT_DIR) await buildClientApart({ stress: true, dist, quick: true });
  for (const scene of ["base", "wood", "flock", "city"] as Scene[]) {
    const mine = runs.filter((r) => r.scene === scene);
    if (mine.length === 0) continue;
    let got: (report: Record<string, any>) => void = () => {};
    const routes = (req: Request, url: URL): Response | Promise<Response> | null => {
      const held = LOOKS[url.searchParams.get("view") as View];
      if (url.pathname === "/__look" && held) return Response.json({ look: held.map((d) => (d * Math.PI) / 180) });
      return url.pathname === "/__bench" && req.method === "POST" ? req.json().then((r) => (got(r as Record<string, any>), new Response("ok"))) : null;
    };
    const mapDir = scene === "wood" ? mkdtempSync(join(tmpdir(), "snark-gpu-map-")) : "";
    if (mapDir) {
      const hills = benchHills();
      writeFileSync(join(mapDir, "hills.snmap"), writeMap(resolveNodes({ id: "bench:hills", dims: hills.dims, minY: hills.minY, stepY: hills.stepY, seaLevel: -Infinity, heights: hills.heights, tint: hills.tint.fill(12), statics: [], nodes: [WOOD], spawns: [{ name: "Middle", x: 4096, z: 4096, yaw: 0 }] }, compileContent(CORE_CONTENT).registry!)));
    }
    const map = scene === "city" ? CITY_MAP : mapDir ? join(mapDir, "hills.snmap") : null;
    const server = startServer({ port: 0, hostname: "127.0.0.1", clientDir: dist, probeScene: true, routes, ...(map ? { map } : {}) });
    if (scene === "base") {
      const world = server.host.world;
      const crowd = crowdScene();
      for (const s of crowd.bodies) server.host.spawnCreature(s.species, s.x, s.z, 1);
      const ground = world.hf.heightAt(crowd.floor.x, crowd.floor.z);
      const add = (id: string, x: number, y: number, z: number, yaw: number): void => {
        const kind = world.reg.index.get(id) ?? 0;
        const def = world.reg.defs[kind];
        if (def?.type === "structure") world.structs.add(kind, x, y, z, yaw, 0, def.hp);
      };
      for (const p of crowd.pieces) add(p.id, p.x, ground + p.y, p.z, p.yaw);
      for (const p of basePieces(BASE_PIECES)) add(p.id, p.x, world.hf.heightAt(p.house.x, p.house.z) + p.y, p.z, p.yaw);
    }
    if (scene === "flock") flock(server);
    // One profile a scene: the asset cache is warm after the first run, and the page joins as the same survivor.
    const profile = mkdtempSync(join(tmpdir(), "snark-gpu-"));
    // A run with no hour of its own is held at the hour the scene's server began at.
    const day = hourOfDay(server.host.world.tick, server.host.world.dayOffset, server.host.world.clock);
    for (let k = 0; k < times; k++) {
      for (const r of mine) {
        const link = `http://127.0.0.1:${server.port}/?bench=1&name=bench&tier=${r.tier}${r.passes ? "&passes=1" : ""}${r.off ? `&off=${r.off === "far" ? FAR.join(",") : r.off}` : ""}${r.ab ? `&sync=1&ab=${r.ab}` : ""}${r.clock ? "&sync=1" : ""}${r.view && LOOKS[r.view] ? `&still&look=${r.view}` : ""}`;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const report = new Promise<Record<string, any> | null>((done) => ((got = done), (timer = setTimeout(() => done(null), (SETTLE_MS + 120000) * (r.cpu ?? 1)))));
        const pixels = r.view ? [`--window-size=${(r.window ?? [1920, 1080]).join(",")}`, `--force-device-scale-factor=${r.scale}`] : ["--window-size=390,669", "--force-device-scale-factor=3"];
        const hold = r.view ? holdAt(server, CITY_PLACES[r.view]) : null;
        const held = holdHour(server, r.hour ?? day);
        rmSync(join(profile, "DevToolsActivePort"), { force: true });
        const browser = Bun.spawn([CHROME!, "--headless=new", ...CHROME_FLAGS, "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", ...pixels, "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdout: "ignore", stderr: "ignore" });
        const page = await devtools(profile);
        if (r.cpu) await page.send("Emulation.setCPUThrottlingRate", { rate: r.cpu });
        await page.send("Page.navigate", { url: link });
        const result = await report;
        clearTimeout(timer);
        const counted = result && r.view ? await page.send("Runtime.evaluate", { expression: COUNT_CALLS, awaitPromise: true, returnByValue: true }) : null;
        if (counted?.result?.value) result!.calls = JSON.parse(counted.result.value);
        else if (counted) say(`${nameOf(r)}: the calls were not counted: ${counted.exceptionDetails?.exception?.description ?? "no answer"}`);
        if (result && r.view && process.env.GPU_PROFILE) {
          await page.send("Profiler.enable");
          await page.send("Profiler.setSamplingInterval", { interval: 200 });
          await page.send("Profiler.start");
          await Bun.sleep(PROFILE_MS);
          writeFileSync(join(process.env.GPU_PROFILE, `${nameOf(r)}.cpuprofile`), JSON.stringify((await page.send("Profiler.stop")).profile));
        }
        page.close();
        if (hold) clearInterval(hold);
        clearInterval(held);
        browser.kill();
        await browser.exited;
        const ab = result?.alternate ? `${result.alternate.own} ms on the page's clock with it, ${result.alternate.other} without, a frame without it ${result.alternate.less} ms against those either side` : `${result?.gpuMs?.frame?.median ?? "untimed"} ms ${r.clock ? "on the page's clock" : "on the GPU"}`;
        say(`${nameOf(r)}: ${result ? `${ab}, ${result.frameMs.median} ms a frame, ${result.buildAndSubmitMs.median} ms ours, ${result.drawCalls} GL draws, ${result.triangles} triangles${result.turn ? ` (over the turn ${result.turn.draws} and ${result.turn.triangles})` : ""}${result.calls ? `, a frame ${JSON.stringify(result.calls)}` : ""}` : "no report"} (load ${loadavg()[0]!.toFixed(1)})`);
        if (result) out.set(nameOf(r), [...(out.get(nameOf(r)) ?? []), result]);
      }
    }
    server.stop();
    rmSync(profile, { recursive: true, force: true });
    if (mapDir) rmSync(mapDir, { recursive: true, force: true });
  }
  if (!process.env.CLIENT_DIR) rmSync(dist, { recursive: true, force: true });
  return out;
}

const median = (list: number[]): number => [...list].sort((a, b) => a - b)[(list.length - 1) >> 1]!;
/**
 * A pass's GPU ms over runs: the median of the runs' medians, or for the whole frame, frame by frame the least of the
 * runs (each run turns through the same views at the same frames, and other work on a shared GPU only adds to a
 * query's time), then the median of those.
 */
function gpu(reports: Record<string, any>[] | undefined, pass = "frame"): number {
  if (!reports || reports.length === 0) return NaN;
  if (pass !== "frame") return median(reports.map((r) => r.gpuMs?.[pass]?.median ?? NaN));
  const lists = reports.map((r) => r.gpuFrames as number[]);
  const n = Math.min(...lists.map((l) => l.length));
  return Math.round(median(Array.from({ length: n }, (_, i) => Math.min(...lists.map((l) => l[i]!)))) * 1000) / 1000;
}

/** The rows, from reports of the plan's runs. */
export function rows(section: Section, record: Row, reports: Map<string, Record<string, any>[]>): void {
  for (const key of ["base medium", "base high", "wood medium", "wood high", "flock medium", "flock ultra"]) {
    const all = reports.get(key);
    const by = reports.get(`${key}, by pass`);
    if (!all) continue;
    section(`GPU, ${key} (headless Chrome, ${all[0]!.canvas.join(" by ")} pixels, ${all[0]!.renderer})`);
    for (const pass of by ? PASSES : []) record(`${pass}, timed by itself, median`, gpu(by, pass), "ms");
    if (by) record("the frame, its passes timed one by one, median", gpu(by), "ms");
    record("the frame, timed whole, median", gpu(all), "ms");
    record("a frame's time, median, by the clock", median(all.map((r) => r.frameMs.median)), "ms");
    for (const [name, list] of reports) if (name.startsWith(`${key}, `) && name.endsWith(" off")) record(`${name.slice(key.length + 2)}: what it costs`, gpu(all) - gpu(list), "ms");
  }
  for (const view of ["street", "air"] as View[]) {
    for (const tier of ["medium", "high", "ultra"]) {
      for (const scale of [1, 2]) {
        const key = `city ${view} ${tier} x${scale}`;
        const all = reports.get(key);
        if (!all) continue;
        const draws = median(all.map((r) => r.drawCalls));
        section(`GPU on Miami, ${view}, ${tier}, ${scale} device pixel${scale > 1 ? "s" : ""} to one (headless Chrome, ${all[0]!.canvas.join(" by ")} pixels, ${all[0]!.renderer})`);
        record("the frame, timed whole, median", gpu(all), "ms");
        const clocked = reports.get(`${key}, on the page's clock`);
        if (clocked) record("the frame on the page's clock, waiting for the card, median", gpu(clocked), "ms");
        record("GL draws, triangles", draws, `draws, ${(median(all.map((r) => r.triangles)) / 1e6).toFixed(2)} M triangles`);
        // The medians over the turn's frames, which every run of the row sees alike (bench-run.ts since).
        if (all[0]!.turn) record("over the turn, median GL draws, triangles", median(all.map((r) => r.turn.draws)), `draws, ${(median(all.map((r) => r.turn.triangles)) / 1e6).toFixed(2)} M triangles`);
        record("our code's time a frame, median", median(all.map((r) => r.buildAndSubmitMs.median)), "ms");
        const counted = all.at(-1)!.calls as Record<"calls" | "again" | "draws", Record<string, number>> | undefined;
        const sum = (o: Record<string, number>): number => Object.values(o).reduce((a, b) => a + b, 0);
        const kinds = (o: Record<string, number>): string => Object.entries(o).map(([k, v]) => `${v} ${k}`).join(", ");
        if (counted) {
          record("GL calls a frame", sum(counted.calls), `calls: ${kinds(counted.calls)}`);
          record("of them, setting what the context holds", sum(counted.again), `calls: ${kinds(counted.again)}`);
          record("draws listed a frame, in draw calls", counted.draws.listed!, `draws in ${counted.calls.draws} calls`);
          record("draw calls that could go in the one before", counted.draws.runs!, `calls, but for their indices; ${counted.draws.levels} more but for their level and offset`);
        }
        for (const [name, list] of reports) {
          if (!name.startsWith(`${key}, `) || !name.endsWith(" off")) continue;
          const tris = (median(all.map((r) => r.triangles)) - median(list.map((r) => r.triangles))) / 1e6;
          const ours = median(all.map((r) => r.buildAndSubmitMs.median)) - median(list.map((r) => r.buildAndSubmitMs.median));
          record(`${name.slice(key.length + 2)}: what it costs`, gpu(all) - gpu(list), `ms, ${draws - median(list.map((r) => r.drawCalls))} GL draws, ${tris.toFixed(2)} M triangles, ${ours.toFixed(2)} ms of our code`);
        }
        for (const [name, list] of reports) if (name.startsWith(`${key}, processor`)) record(`our code's time a frame, ${name.slice(key.length + 2)}, median`, median(list.map((r) => r.buildAndSubmitMs.median)), "ms");
      }
      const head = `city ${view} ${tier} x1, `;
      const alternating = [...reports].filter(([name, list]) => name.startsWith(head) && name.endsWith(" every other frame") && list[0]?.alternate);
      if (alternating.length > 0) section(`On Miami, ${view}, ${tier}, 1 device pixel to one, effects off every other frame, on the page's clock (?sync=1&ab=)`);
      for (const [name, list] of alternating) {
        if (name.includes(", light off")) record("everything on, median", median(list.map((r) => r.alternate.own)), "ms");
        record(`${name.slice(head.length, -" every other frame".length)}: what it costs, frame by frame`, -median(list.map((r) => r.alternate.less)), "ms");
      }
    }
  }
}

/**
 * Each run timed on the page's clock against its twin timed by query: the same view, so the same scene, which their draws
 * and triangles over the turn hold to within AGREE. A pair that is not was measured on two scenes (a run began while the
 * map still came: 710 draws and 2.40 M triangles on the clock against 580 and 1.79 M by query); each pair's line, and the
 * names of those that do not agree.
 */
export function agreement(reports: Map<string, Record<string, any>[]>): { lines: string[]; apart: string[] } {
  const lines: string[] = [], apart: string[] = [];
  for (const [name, clocked] of reports) {
    if (!name.includes(", on the page's clock")) continue;
    const queried = reports.get(name.replace(", on the page's clock", ""));
    if (!queried || !clocked[0]?.turn || !queried[0]?.turn) continue;
    const of = (list: Record<string, any>[], k: string): number => median(list.map((r) => r.turn[k] as number));
    const draws = [of(queried, "draws"), of(clocked, "draws")], triangles = [of(queried, "triangles"), of(clocked, "triangles")];
    const off = Math.max(Math.abs(draws[1]! - draws[0]!) / draws[0]!, Math.abs(triangles[1]! - triangles[0]!) / triangles[0]!);
    if (!(off <= AGREE)) apart.push(name);
    const waited = (list: Record<string, any>[]): string => list.map((r) => (r.waited ? `${r.waited.gaveUp ? "gave up waiting" : `the map whole at ${(r.waited.mapMs / 1000).toFixed(1)} s`}` : "not waited for")).join(", ");
    const nodes = (list: Record<string, any>[]): string => `near trees, rocks and bushes ${of(list, "nearNodes")}, far ${of(list, "farNodes")}`;
    lines.push(`${name.replace(", on the page's clock", "")}: by query ${draws[0]} draws, ${(triangles[0]! / 1e6).toFixed(2)} M triangles, ${nodes(queried)} (${waited(queried)}); on the page's clock ${draws[1]}, ${(triangles[1]! / 1e6).toFixed(2)} M, ${nodes(clocked)} (${waited(clocked)}); ${(off * 100).toFixed(2)}% apart${off <= AGREE ? "" : `, more than ${AGREE * 100}%: not the same scene`}`);
  }
  // A row run more than once: how far its runs drew apart, which says what the pair's own spread is.
  for (const [name, list] of reports) {
    if (list.length < 2 || !list.every((r) => r.turn)) continue;
    const spread = (k: string): string => {
      const v = list.map((r) => r.turn[k] as number), most = Math.max(...v), least = Math.min(...v);
      return `${k} ${v.join(" and ")} (${least > 0 ? (((most - least) / least) * 100).toFixed(2) : "?"}%)`;
    };
    // The stores whose draws over the turn were not the same in every run, by their sums over its frames.
    const stores = [...new Set(list.flatMap((r) => Object.keys(r.turnStores ?? {})))].map((s) => [s, list.map((r) => r.turnStores?.[s]?.sum ?? 0)] as const).filter(([, v]) => v.some((x) => x !== v[0]));
    lines.push(`${name}, its ${list.length} runs: ${["draws", "triangles", "nearNodes", "farNodes"].map(spread).join(", ")}${stores.length > 0 ? `; draws over the turn not alike: ${stores.map(([s, v]) => `${s} ${v.join(" and ")}`).join(", ")}` : ""}`);
  }
  return { lines, apart };
}
/** How far apart a run on the page's clock and its twin by query may draw: a share of the draws and of the triangles. */
const AGREE = 0.01;

/** The plan's runs, less the city's where there is no built map, which `say` is told. */
function runnable(say: (line: string) => void): Run[] {
  if (existsSync(CITY_MAP)) return plan();
  say(`GPU on Miami: skipped, no built map at ${CITY_MAP} (bun tools/mapworld/build.ts miami, or set CITY_MAP)`);
  return plan().filter((r) => r.scene !== "city");
}

export async function benchGpu(section: Section, record: Row, times = 1): Promise<void> {
  if (!CHROME) return void section("GPU by pass: skipped, no Chrome (set CHROME)");
  const runs = runnable(section);
  section(`GPU by pass: ${runs.length} runs of the game's page, ${times} each, load ${loadavg()[0]!.toFixed(1)}`);
  const reports = await measure(runs, times, () => {});
  rows(section, record, reports);
  const agreed = agreement(reports);
  if (agreed.lines.length > 0) section(`The page's clock against the query, each pair's draws and triangles over the turn:\n${agreed.lines.join("\n")}`);
  if (agreed.apart.length > 0) throw new Error(`GPU by pass: ${agreed.apart.length} runs on the page's clock drew another scene than their twins by query: ${agreed.apart.join("; ")}`);
}

if (import.meta.main) {
  if (!CHROME) throw new Error("no Chrome: set CHROME");
  const times = Number(process.argv[2] ?? 3);
  // Each word after the runs is a row's first words, or a row's whole name ended with "$"; a bar parts several in one word.
  const only = process.argv.slice(3).flatMap((o) => o.split("|"));
  const runs = runnable(console.log).filter((r) => only.length === 0 || only.some((o) => (o.endsWith("$") ? nameOf(r) === o.slice(0, -1) : nameOf(r).startsWith(o))));
  console.log(`${runs.length} runs, ${times} each, load ${loadavg()[0]!.toFixed(1)}`);
  const reports = await measure(runs, times, (line) => console.log(`  ${line}`));
  writeFileSync(join(tmpdir(), "snark-gpu-bench.json"), JSON.stringify([...reports]));
  // The rows over every run, then each run's by itself for the range.
  const print = (name: string, value: number, unit: string): void => console.log(`  ${name.padEnd(64)} ${value.toFixed(3).padStart(9)} ${unit}`);
  console.log(`
all ${times} runs`);
  rows((t) => console.log(`
${t}`), print, reports);
  for (let k = 0; k < times && times > 1; k++) {
    const one = new Map([...reports].map(([name, list]) => [name, list.slice(k, k + 1)]));
    console.log(`\nrun ${k + 1}`);
    rows((t) => console.log(`\n${t}`), (name, value, unit) => console.log(`  ${name.padEnd(64)} ${value.toFixed(3).padStart(9)} ${unit}`), one);
  }
  // The runs on the page's clock and their twins by query drew the same scene, or the bench says it measured two.
  const agreed = agreement(reports);
  if (agreed.lines.length > 0) console.log(`\nthe page's clock against the query, over the turn\n${agreed.lines.map((l) => `  ${l}`).join("\n")}`);
  if (agreed.apart.length > 0) {
    console.error(`\n${agreed.apart.length} runs on the page's clock drew another scene than their twins by query: ${agreed.apart.join("; ")}`);
    process.exit(1);
  }
}
