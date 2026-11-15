// Where a frame's GPU time goes on this machine, in two real scenes: the proving ground with the device probe's crowd,
// its thatch and a base of 1,024 pieces, and the device probe's wood on the 8 km hills. Each is the game's own page at
// `?bench=1` in headless Chrome, three device pixels to one as the iPhone of D349 has them, which times the GPU by
// timer query (client/core/passes.ts) while the view turns in place: with everything on, each pass by itself
// (`?passes=1`), with each effect off in turn (`?off=`), and at each of the governor's levels (`?level=`). On an Apple
// GPU through ANGLE a query between passes ends Metal's render pass and stores and loads the tiles, which a frame does
// not otherwise do, so a pass's row says where time goes and the whole frame's runs say what an effect costs. Then the
// iPhone's soaks are replayed through the governor with the share of the GPU's time each level left here. Chrome is found as tools/probe.ts finds it, or
// named by CHROME; without it the rows are skipped. `bun tools/bench/gpu.ts [runs]` runs these alone, each `runs` times
// (3), and prints each row's range.

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { WOOD, basePieces, crowdScene } from "../../client/core/devicescene.ts";
import { CUE_DEAD, CUE_DECAY_SHIFT, CUE_OUT } from "../../shared/anim/pose.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { PROVING_SPAWN } from "../../shared/world/proving.ts";
import { ladder } from "../../client/core/governor.ts";
import { PASSES, type Effect } from "../../client/core/passes.ts";
import { startServer } from "../../server/main.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { curve, run } from "../../tests/fixtures/frames.ts";
import { buildClient } from "../build-client.ts";
import { benchHills } from "./terrain.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

type Scene = "base" | "wood" | "flock";
/** What each run measures: a scene, a tier, each pass by itself or the frame, an effect off, a level the governor holds. */
interface Run {
  scene: Scene;
  tier: string;
  passes?: boolean;
  off?: Effect;
  level?: number;
}
const BASE_PIECES = 1024;
/** The iPhone's soaks on high, medians a minute (D349; .cache/device on the phone's run, 2026-11-15): defaults, and half what its ladder held. The first minute held the display's rate. */
export const PHONE_SOAKS: Readonly<Record<string, readonly number[]>> = {
  "200 bodies, 1,024 pieces": [16.5, 20, 19, 19, 21, 22, 23, 24, 25, 27],
  "800 bodies, 64 near rocks": [16.5, 17, 17, 17, 18, 19, 21, 22, 24, 24],
};

const CHROME = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => p && existsSync(p));

export function plan(): Run[] {
  const runs: Run[] = [];
  const offs: Record<string, Effect[]> = { "base medium": ["shadows", "haze", "clouds", "water", "farblocks", "band"], "base high": ["shadows"], "wood medium": ["shadows", "haze", "clouds", "farnodes", "band"], "wood high": ["shadows", "farnodes", "band"] };
  for (const [key, list] of Object.entries(offs)) {
    const [scene, tier] = key.split(" ") as [Scene, string];
    runs.push({ scene, tier, passes: true }, { scene, tier }, ...list.map((off) => ({ scene, tier, off })));
  }
  for (let level = 1; level < ladder(tierOf("high"), 3).length; level++) runs.push({ scene: "base", tier: "high", level });
  for (const tier of ["medium", "ultra"]) runs.push({ scene: "flock", tier }, { scene: "flock", tier, off: "layers" });
  return runs;
}

/** Dodos round the spawn point, in two rings so that some fill the view whichever way it turns. */
export const FLOCK = 40;

/**
 * The flock: three in four hurt, a third of those at each stage, and one in four a corpse lying at a decay stage, set as
 * the server sets them.
 */
function flock(server: ReturnType<typeof startServer>): void {
  const { world, records, survival, hurt } = server.host;
  for (let k = 0; k < FLOCK; k++) {
    const [ring, turn] = k < FLOCK / 2 ? [2.5, k / (FLOCK / 2)] : [4.5, (k - FLOCK / 2 + 0.5) / (FLOCK / 2)];
    const e = server.host.spawnCreature("core:dodo", PROVING_SPAWN.x + Math.sin(turn * Math.PI * 2) * ring, PROVING_SPAWN.z + Math.cos(turn * Math.PI * 2) * ring, 10);
    if (e < 0) continue;
    const rec = records.byPid.get(world.ents.pid[e]!)!;
    if (k % 4 === 3) {
      world.ents.cue[e] = world.ents.cue[e]! | CUE_DEAD | CUE_OUT | (((k >> 2) & 3) << CUE_DECAY_SHIFT);
      world.history.cued(e);
    } else {
      survival.hurt(rec, (rec.vitals!.max[V_HEALTH]! / 1e6) * (0.3 + 0.25 * (k % 4)), 0);
      hurt.check(rec);
    }
  }
}

const nameOf = (r: Run): string => `${r.scene} ${r.tier}${r.passes ? ", by pass" : ""}${r.off ? `, ${r.off} off` : ""}${r.level ? `, level ${r.level}` : ""}`;

/** Each run's report from the page, `times` times over, a scene's server at a time. */
async function measure(runs: Run[], times: number, say: (line: string) => void): Promise<Map<string, Record<string, any>[]>> {
  const out = new Map<string, Record<string, any>[]>();
  const dist = mkdtempSync(join(tmpdir(), "snark-gpu-client-"));
  await buildClient({ stress: true, dist, quick: true });
  for (const scene of ["base", "wood", "flock"] as Scene[]) {
    const mine = runs.filter((r) => r.scene === scene);
    if (mine.length === 0) continue;
    let got: (report: Record<string, any>) => void = () => {};
    const routes = (req: Request, url: URL): Response | Promise<Response> | null => (url.pathname === "/__bench" && req.method === "POST" ? req.json().then((r) => (got(r as Record<string, any>), new Response("ok"))) : null);
    const mapDir = scene === "wood" ? mkdtempSync(join(tmpdir(), "snark-gpu-map-")) : "";
    if (mapDir) {
      const hills = benchHills();
      writeFileSync(join(mapDir, "hills.snmap"), writeMap({ id: "bench:hills", dims: hills.dims, minY: hills.minY, stepY: hills.stepY, seaLevel: -Infinity, heights: hills.heights, tint: hills.tint.fill(12), statics: [], nodes: [WOOD], spawns: [{ name: "Middle", x: 4096, z: 4096, yaw: 0 }] }));
    }
    const server = startServer({ port: 0, hostname: "127.0.0.1", clientDir: dist, probeScene: true, routes, ...(mapDir ? { map: join(mapDir, "hills.snmap") } : {}) });
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
        const link = `http://127.0.0.1:${server.port}/?bench=1&name=bench&tier=${r.tier}${r.passes ? "&passes=1" : ""}${r.off ? `&off=${r.off}` : ""}${r.level ? `&level=${r.level}` : ""}`;
        const report = new Promise<Record<string, any> | null>((done) => ((got = done), setTimeout(() => done(null), 120000)));
        const browser = Bun.spawn([CHROME!, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=390,669", "--force-device-scale-factor=3", `--user-data-dir=${profile}`, link], { stdout: "ignore", stderr: "ignore" });
        const result = await report;
        browser.kill();
        await browser.exited;
        say(`${nameOf(r)}: ${result ? `${result.gpuMs?.frame?.median ?? "untimed"} ms on the GPU, ${result.frameMs.median} ms a frame` : "no report"} (load ${loadavg()[0]!.toFixed(1)})`);
        if (result) out.set(nameOf(r), [...(out.get(nameOf(r)) ?? []), result]);
      }
    }
    server.stop();
    rmSync(profile, { recursive: true, force: true });
    if (mapDir) rmSync(mapDir, { recursive: true, force: true });
  }
  rmSync(dist, { recursive: true, force: true });
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

/**
 * The share of the GPU's time each step of high's ladder left of the level before in the base scene, from the level
 * runs. A step adds no work, so a level measured slower than the one before it is taken as no faster: the difference is
 * another page's on the shared GPU.
 */
export function shares(reports: Map<string, Record<string, any>[]>): Record<string, number> {
  const steps = ladder(tierOf("high"), 3);
  const out: Record<string, number> = {};
  let before = gpu(reports.get("base high"));
  for (let level = 1; level < steps.length; level++) {
    const now = Math.min(before, gpu(reports.get(`base high, level ${level}`)));
    out[steps[level]!.name] = Math.round((now / before) * 1000) / 1000;
    before = now;
  }
  return out;
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
  const left = shares(reports);
  if (Object.values(left).some((x) => !Number.isFinite(x))) return;
  section("The governor's steps on high, base: the share of the GPU's time each left of the level before");
  for (const [name, share] of Object.entries(left)) record(name, share, "");
  for (const [soak, points] of Object.entries(PHONE_SOAKS)) {
    section(`The iPhone's soak on high (${soak}) replayed through the governor, each level leaving what it left here`);
    const warm = curve(points);
    const steps = ladder(tierOf("high"), 3).map((s) => left[s.name] ?? 1);
    const leaves = steps.map((_, i) => steps.slice(1, i + 1).reduce((a, b) => a * b, 1));
    const { minutes } = run(10, (t, level) => ({ gpu: warm(t) * leaves[level]! }));
    record("minute 1, median frame", minutes[0]!.median, "ms");
    record("minute 10, median frame, no slower than minute 1", minutes[9]!.median, "ms", minutes[0]!.median + 0.5);
    record("minute 10 without the governor", points.at(-1)!, "ms");
    record("the level at minute 10", minutes[9]!.level, "");
  }
}

export async function benchGpu(section: Section, record: Row, times = 1): Promise<void> {
  if (!CHROME) return void section("GPU by pass: skipped, no Chrome (set CHROME)");
  section(`GPU by pass: ${plan().length} runs of the game's page, ${times} each, load ${loadavg()[0]!.toFixed(1)}`);
  rows(section, record, await measure(plan(), times, () => {}));
}

if (import.meta.main) {
  if (!CHROME) throw new Error("no Chrome: set CHROME");
  const times = Number(process.argv[2] ?? 3);
  const only = process.argv[3];
  const runs = plan().filter((r) => !only || nameOf(r).startsWith(only));
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
