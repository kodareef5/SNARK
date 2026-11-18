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

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
import { findChrome } from "../chrome.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

type Scene = "base" | "wood" | "flock" | "city";
type View = "street" | "air";
/** What each run measures: a scene, a tier, each pass by itself or the frame, an effect off or the far layers. On the city, where and at how many device pixels to one. */
interface Run {
  scene: Scene;
  tier: string;
  passes?: boolean;
  off?: Effect | "far";
  view?: View;
  scale?: number;
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
  }
  return runs;
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

const nameOf = (r: Run): string => `${r.scene}${r.view ? ` ${r.view}` : ""} ${r.tier}${r.scale ? ` x${r.scale}` : ""}${r.passes ? ", by pass" : ""}${r.off ? `, ${r.off === "far" ? "far layers" : r.off} off` : ""}`;

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
        const report = new Promise<Record<string, any> | null>((done) => ((got = done), setTimeout(() => done(null), 150000)));
        const pixels = r.view ? ["--window-size=1920,1080", `--force-device-scale-factor=${r.scale}`] : ["--window-size=390,669", "--force-device-scale-factor=3"];
        const hold = r.view ? holdAt(server, CITY_PLACES[r.view]) : null;
        const browser = Bun.spawn([CHROME!, "--headless=new", "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", ...pixels, `--user-data-dir=${profile}`, link], { stdout: "ignore", stderr: "ignore" });
        const result = await report;
        if (hold) clearInterval(hold);
        browser.kill();
        await browser.exited;
        say(`${nameOf(r)}: ${result ? `${result.gpuMs?.frame?.median ?? "untimed"} ms on the GPU, ${result.frameMs.median} ms a frame, ${result.drawCalls} GL draws, ${result.triangles} triangles` : "no report"} (load ${loadavg()[0]!.toFixed(1)})`);
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
        for (const [name, list] of reports) if (name.startsWith(`${key}, `) && name.endsWith(" off")) record(`${name.slice(key.length + 2)}: what it costs`, gpu(all) - gpu(list), `ms, ${draws - median(list.map((r) => r.drawCalls))} GL draws`);
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
