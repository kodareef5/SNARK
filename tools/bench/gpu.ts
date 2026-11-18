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
// high and ultra, with shadows and the far layers off in turn on medium at one and on ultra at two. A city row's GL
// draws and triangles are of the frame its run ends on. Chrome is found as tools/probe.ts finds it, or named by CHROME;
// without it every row is skipped, and without the map the city's. The page is a client built for the bench in a
// process of its own (buildClientApart), or the built client CLIENT_DIR names. `bun tools/bench/gpu.ts [runs] [a row's first words]` runs these alone, each `runs` times (3), and
// prints each row's range.
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
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { PROVING_SPAWN } from "../../shared/world/proving.ts";
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
type View = "street" | "air";
/** What each run measures: a scene, a tier, each pass by itself or the frame, an effect off or the far layers. On the city, where and at how many device pixels to one, and how many times slower the page's processor is made. */
interface Run {
  scene: Scene;
  tier: string;
  passes?: boolean;
  off?: Effect | "far";
  view?: View;
  scale?: number;
  cpu?: number;
}
const BASE_PIECES = 1024;

const CHROME = findChrome();
const CITY_MAP = process.env.CITY_MAP ?? fileURLToPath(new URL("../../var/maps/miami.snmap", import.meta.url));
/** The far city, far trees, rocks and bushes, and far bases. */
const FAR: readonly Effect[] = ["farcity", "farnodes", "farblocks"];
/** Miami's street and air: on the ground 300 m into downtown's grid (the census's street-300), and 140 m over the far city's hand-over (its air-handover). */
const CITY_PLACES: Record<View, Place> = {
  street: { name: "street", east: -2469, north: -639, up: 0 },
  air: { name: "air", east: -2136, north: -1114, up: 140 },
};

export function plan(): Run[] {
  const runs: Run[] = [];
  const offs: Record<string, Effect[]> = { "base medium": ["shadows", "haze", "clouds", "water", "farblocks", "band"], "base high": ["shadows"], "wood medium": ["shadows", "haze", "clouds", "farnodes", "band"], "wood high": ["shadows", "farnodes", "band"] };
  for (const [key, list] of Object.entries(offs)) {
    const [scene, tier] = key.split(" ") as [Scene, string];
    runs.push({ scene, tier, passes: true }, { scene, tier }, ...list.map((off) => ({ scene, tier, off })));
  }
  for (const tier of ["medium", "ultra"]) runs.push({ scene: "flock", tier }, { scene: "flock", tier, off: "layers" });
  for (const view of ["street", "air"] as View[]) {
    for (const tier of ["medium", "high", "ultra"]) for (const scale of [1, 2]) runs.push({ scene: "city", view, tier, scale });
    for (const [tier, scale] of [["medium", 1], ["ultra", 2]] as const) for (const off of ["shadows", "far"] as const) runs.push({ scene: "city", view, tier, scale, off });
    // What is hidden left out, and the opaque draws nearest first (render/hide.ts, render/scene.ts order).
    for (const [tier, scale] of view === "street" ? ([["high", 2], ["medium", 1]] as const) : ([["high", 2]] as const)) for (const off of ["hide", "order"] as const) runs.push({ scene: "city", view, tier, scale, off });
  }
  for (const cpu of [4, 6]) runs.push({ scene: "city", view: "street", tier: "high", scale: 1, cpu });
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

const nameOf = (r: Run): string => `${r.scene}${r.view ? ` ${r.view}` : ""} ${r.tier}${r.scale ? ` x${r.scale}` : ""}${r.passes ? ", by pass" : ""}${r.off ? `, ${r.off === "far" ? "far layers" : r.off} off` : ""}${r.cpu ? `, processor ${r.cpu} times slower` : ""}`;

/** Each run's report from the page, `times` times over, a scene's server at a time. */
async function measure(runs: Run[], times: number, say: (line: string) => void): Promise<Map<string, Record<string, any>[]>> {
  const out = new Map<string, Record<string, any>[]>();
  const dist = process.env.CLIENT_DIR ?? mkdtempSync(join(tmpdir(), "snark-gpu-client-"));
  if (!process.env.CLIENT_DIR) await buildClientApart({ stress: true, dist, quick: true });
  for (const scene of ["base", "wood", "flock", "city"] as Scene[]) {
    const mine = runs.filter((r) => r.scene === scene);
    if (mine.length === 0) continue;
    let got: (report: Record<string, any>) => void = () => {};
    const routes = (req: Request, url: URL): Response | Promise<Response> | null => (url.pathname === "/__bench" && req.method === "POST" ? req.json().then((r) => (got(r as Record<string, any>), new Response("ok"))) : null);
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
    for (let k = 0; k < times; k++) {
      for (const r of mine) {
        const link = `http://127.0.0.1:${server.port}/?bench=1&name=bench&tier=${r.tier}${r.passes ? "&passes=1" : ""}${r.off ? `&off=${r.off === "far" ? FAR.join(",") : r.off}` : ""}`;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const report = new Promise<Record<string, any> | null>((done) => ((got = done), (timer = setTimeout(() => done(null), 150000 * (r.cpu ?? 1)))));
        const pixels = r.view ? ["--window-size=1920,1080", `--force-device-scale-factor=${r.scale}`] : ["--window-size=390,669", "--force-device-scale-factor=3"];
        const hold = r.view ? holdAt(server, CITY_PLACES[r.view]) : null;
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
        browser.kill();
        await browser.exited;
        say(`${nameOf(r)}: ${result ? `${result.gpuMs?.frame?.median ?? "untimed"} ms on the GPU, ${result.frameMs.median} ms a frame, ${result.buildAndSubmitMs.median} ms ours, ${result.drawCalls} GL draws, ${result.triangles} triangles${result.calls ? `, a frame ${JSON.stringify(result.calls)}` : ""}` : "no report"} (load ${loadavg()[0]!.toFixed(1)})`);
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
        record("GL draws, triangles", draws, `draws, ${(median(all.map((r) => r.triangles)) / 1e6).toFixed(2)} M triangles`);
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
    }
  }
}

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
  rows(section, record, await measure(runs, times, () => {}));
}

if (import.meta.main) {
  if (!CHROME) throw new Error("no Chrome: set CHROME");
  const times = Number(process.argv[2] ?? 3);
  const only = process.argv[3];
  const runs = runnable(console.log).filter((r) => !only || nameOf(r).startsWith(only));
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
}
