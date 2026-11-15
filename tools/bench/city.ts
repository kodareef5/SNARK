// The far city's benchmark rows on a built map's real city (client/core/render/farcity.ts): what its statics hold, what a
// chunk costs to make at each level, what each tier draws from the cameras of planning's views, a ghost flying across it
// at 600 m/s, a pteranodon's rider at 150 m, and walking through the hand-over. bun tools/bench/city.ts <file.snmap>
// [views.json], or bun run bench --city <file>; with --rider, the rider's flight alone.

import { readFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { Viewpoint } from "../../client/core/viewpoint.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { TIERS, type Tier } from "../../client/core/assets/tiers.ts";
import { FarStore } from "../../client/core/farcells.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { CITY_BUFFER, type FarCity } from "../../client/core/render/farcity.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { CHUNK_SIZE, chunkCount, chunkCx, chunkCz } from "../../shared/coords.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { CityStatics, cellPart, cityTops, goneByCells, mergedPart } from "../../shared/world/city.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { mapHeightfield, parseMap, placeStatics } from "../../shared/world/mapfile.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { corePackBytes } from "../../tests/fixtures/pack.ts";

type Record = (name: string, value: number, unit: string, budget?: number | null) => void;

interface View {
  name: string;
  x: number;
  z: number;
  y?: number;
  up?: number;
  look: [number, number, number?];
  size?: [number, number];
}

const DEFAULT_VIEWS = new URL("../../assets/source/maps/miami/reports/farcity/views.json", import.meta.url).pathname;
const percentile = (a: number[], q: number): number => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))] ?? 0;
const median = (a: number[]): number => percentile(a, 0.5);

/** A client's world on the map: every static in a near store, which holds a chunk whole `lag` seconds after it comes within three chunks of the camera. */
function cityWorld(path: string) {
  const file = new Uint8Array(readFileSync(path));
  const t0 = performance.now();
  const map = parseMap(file);
  const parseMs = performance.now() - t0;
  const reg = compileContent(CORE_CONTENT).registry!;
  const hf = mapHeightfield(map);
  const t1 = performance.now();
  const statics = new CityStatics(map.dims, map.statics, reg);
  const indexMs = performance.now() - t1;
  const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  placeStatics(map, structs, reg);
  const pack = parsePack(corePackBytes());
  const since = new Float64Array(chunkCount(map.dims)).fill(-1);
  let now = 0;
  let lag = 1;
  const cam = new Camera();
  const complete = (chunk: number): boolean => since[chunk]! >= 0 && now - since[chunk]! >= lag;
  const far = { cells: new FarStore(), complete };
  return {
    map, reg, hf, statics, structs, pack, cam, far, parseMs, indexMs,
    scene(tier: Tier, size: [number, number]): Scene {
      const scene = new Scene({ dims: map.dims, hf, structs, far, city: { statics, complete } }, reg, pack);
      scene.assets.tier = tier;
      scene.viewHeight = size[1];
      cam.aspect = size[0] / size[1];
      return scene;
    },
    /** Moves the clock on by `dt` seconds and the near window with the camera, with chunks held whole `held` seconds after they enter it. */
    step(dt: number, held: number): void {
      now += dt;
      lag = held;
      const [cx, cz] = [Math.floor(cam.x / CHUNK_SIZE), Math.floor(cam.z / CHUNK_SIZE)];
      for (let c = 0; c < since.length; c++) {
        const inside = Math.abs(chunkCx(map.dims, c) - cx) <= 3 && Math.abs(chunkCz(map.dims, c) - cz) <= 3;
        if (!inside) since[c] = -1;
        else if (since[c]! < 0) since[c] = now;
      }
    },
    /** Every chunk in the near window held whole now. */
    settleNear(): void {
      for (let c = 0; c < since.length; c++) if (since[c]! >= 0) since[c] = now - lag;
    },
  };
}

/** Points the camera at `look` from `v`'s place, as tools/map/cityviews.ts does. */
function aim(cam: Camera, hf: Heightfield, v: View): void {
  cam.x = v.x;
  cam.z = v.z;
  cam.y = v.y ?? hf.heightAt(v.x, v.z) + (v.up ?? 1.62);
  const [lx, lz, up = 0] = v.look;
  cam.yaw = Math.atan2(lx - cam.x, lz - cam.z);
  cam.pitch = Math.atan2(hf.heightAt(lx, lz) + up - cam.y, Math.hypot(lx - cam.x, lz - cam.z));
}

/** Builds frames, without a clock's budget, until the far city has nothing left to make or put on the card. */
function settleScene(scene: Scene, cam: Camera): void {
  const city = scene.city!;
  city.makeMs = Infinity;
  for (let i = 0; i < 50; i++) {
    const p = scene.build(cam, null);
    if (p.assetUploads.length === 0 && city.stats.behind === 0 && city.stats.made === 0) break;
  }
  city.makeMs = 2;
}

/** The far city's draws, triangles and bytes on the card in the last frame built. */
function drawn(scene: Scene): { draws: number; triangles: number } {
  const p = scene.packet;
  let draws = 0;
  let triangles = 0;
  for (let d = 0; d < p.drawCount; d++) {
    if (p.drawBuffer[d] !== CITY_BUFFER) continue;
    draws++;
    triangles += p.drawIndexCount[d]! / 3;
  }
  return { draws, triangles };
}

export function benchCity(section: (title: string) => void, record: Record, path: string, viewsPath = DEFAULT_VIEWS): void {
  const w = cityWorld(path);
  const { statics, hf, map } = w;
  section(`The far city on ${map.id}: ${statics.count} statics in ${statics.first.filter((_, c) => c < chunkCount(map.dims) && statics.in(c) > 0).length} chunks`);
  record("map file read, its statics by chunk", w.parseMs, "ms");
  record("statics indexed by chunk", w.indexMs, "ms");
  // The map's columns and the far city's, each buffer once: the city shares the map's where it draws every piece.
  const held = new Set([map.statics.first, map.statics.kind, map.statics.yaw, map.statics.x, map.statics.y, map.statics.z, map.statics.row, statics.first, statics.kind, statics.yaw, statics.x, statics.y, statics.z].map((a) => a.buffer));
  record("statics held, the map's and the far city's", [...held].reduce((sum, b) => sum + b.byteLength, 0) / 1048576, "MB");

  // A chunk's cost at each form, over the 200 busiest chunks.
  const chunks = [...Array(chunkCount(map.dims)).keys()].filter((c) => statics.in(c) > 0).sort((a, b) => statics.in(b) - statics.in(a)).slice(0, 200);
  const none = (): null => null;
  const forms: [string, (c: number) => unknown][] = [
    ["every box", (c) => mergedPart(statics, c, hf, none, 0.01, 0)],
    ["the lattice", (c) => mergedPart(statics, c, hf, none, 0.5, 2.1)],
    ["mass in 4 m cells", (c) => cellPart(statics, c, hf, null, 4, 4)],
    ["mass in 8 m cells", (c) => cellPart(statics, c, hf, null, 8, 4)],
    ["the far feed's tops of its statics", (c) => cityTops(statics, c, hf, null)],
    ["what the far feed's cells show gone", (c) => goneByCells(statics, c, hf, new Uint8Array(256), new Uint8Array(statics.in(c)))],
  ];
  for (const [name, make] of forms) {
    for (const c of chunks.slice(0, 20)) make(c);
    const ms = chunks.map((c) => {
      const t = performance.now();
      make(c);
      return performance.now() - t;
    });
    record(`make ${name}, a busy chunk, median`, median(ms), "ms");
    record(`make ${name}, a busy chunk, the worst`, Math.max(...ms), "ms");
  }

  const views = JSON.parse(readFileSync(viewsPath, "utf8")) as View[];
  for (const tier of TIERS) {
    section(`The far city on ${tier.name}: reach ${tier.reach.city} m, levels to ${tier.city.levels.map((l) => l.to).join(", ")} m`);
    let worst = { draws: 0, triangles: 0, bytes: 0, build: 0 };
    for (const v of views) {
      const size = v.size ?? [1920, 1080];
      const scene = w.scene(tier, size);
      aim(w.cam, hf, v);
      w.step(0, 1);
      w.settleNear();
      settleScene(scene, w.cam);
      const builds: number[] = [];
      for (let i = 0; i < 15; i++) {
        const t = performance.now();
        scene.build(w.cam, null);
        builds.push(performance.now() - t);
      }
      const { draws, triangles } = drawn(scene);
      const bytes = scene.city!.bytes / 1048576;
      record(`${v.name}: draws, triangles (k), card MB, frame build ms`, draws, `draws, ${(triangles / 1000).toFixed(0)} k triangles, ${bytes.toFixed(1)} MB, ${median(builds).toFixed(2)} ms`);
      worst = { draws: Math.max(worst.draws, draws), triangles: Math.max(worst.triangles, triangles), bytes: Math.max(worst.bytes, bytes), build: Math.max(worst.build, median(builds)) };
    }
    record(`${tier.name}: the most far city draws in a view`, worst.draws, "draws");
    record(`${tier.name}: the most far city triangles in a view`, worst.triangles / 1000, "k");
    record(`${tier.name}: the most far city on the card in a view`, worst.bytes, "MB");
    record(`${tier.name}: the slowest frame build in a view, median of 15`, worst.build, "ms");
  }

  const medium = TIERS.find((t) => t.name === "medium")!;
  for (const budget of [2, 0.5]) {
    for (const flight of [
      { name: "west across downtown at 150 m", from: [4300, 150, 2900], heading: [1, 0] },
      { name: "north over Brickell and downtown at 120 m", from: [6450, 120, 900], heading: [0, 1] },
    ]) {
      section(`A ghost at 600 m/s on medium, ${flight.name}, ${budget} ms a frame of making${budget < 2 ? " (a phone about four times slower)" : ""}`);
      const scene = w.scene(medium, [1920, 1080]);
      const cam = w.cam;
      [cam.x, cam.y, cam.z] = flight.from as [number, number, number];
      cam.yaw = Math.atan2(flight.heading[0]!, flight.heading[1]!);
      cam.pitch = -0.12;
      w.step(0, 1);
      w.settleNear();
      settleScene(scene, cam);
      const city = scene.city as FarCity;
      city.makeMs = budget;
      const builds: number[] = [];
      const makes: number[] = [];
      let unseenFrames = 0;
      let unseenMost = 0;
      let unseenNearest = Infinity;
      let run = 0;
      let longest = 0;
      let waited = 0;
      let coarse = 0;
      const frames = 6 * 60;
      for (let f = 0; f < frames; f++) {
        cam.x += (flight.heading[0]! * 600) / 60;
        cam.z += (flight.heading[1]! * 600) / 60;
        cam.y = Math.max(cam.y, hf.heightAt(cam.x, cam.z) + 20);
        w.step(1 / 60, 1);
        const t = performance.now();
        scene.build(cam, null);
        builds.push(performance.now() - t);
        makes.push(city.stats.makeMs);
        const s = city.stats;
        if (s.unseen > 0) {
          unseenFrames++;
          unseenMost = Math.max(unseenMost, s.unseen);
          unseenNearest = Math.min(unseenNearest, s.unseenAt);
          longest = Math.max(longest, ++run);
        } else run = 0;
        waited = Math.max(waited, s.unseenFrames);
        coarse = Math.max(coarse, s.coarse);
      }
      record("frame build, median", median(builds), "ms");
      record("frame build, 99th percentile", percentile(builds, 0.99), "ms");
      record("frame build, the worst", Math.max(...builds), "ms");
      record("making tiles a frame, median", median(makes), "ms");
      record("frames with a tile in view and reach not yet made", unseenFrames, `of ${frames}`);
      record("the most such tiles in a frame", unseenMost, "tiles");
      record("the nearest such tile", Number.isFinite(unseenNearest) ? unseenNearest : 0, "m");
      record("the longest run of such frames", (longest * 1000) / 60, "ms");
      record("the longest one tile waited in view to be drawn", (waited * 1000) / 60, "ms");
      record("the most tiles in view drawn coarser than wanted, a frame", coarse, "tiles");
    }
  }

  benchRider(section, record, w);

  section("Walking through downtown at 6 m/s on medium, chunks held whole a second after they come near");
  {
    const scene = w.scene(medium, [1920, 1080]);
    const cam = w.cam;
    [cam.x, cam.y, cam.z] = [6300, 0, 3425];
    cam.yaw = Math.atan2(1, 0);
    cam.pitch = -0.05;
    cam.y = hf.heightAt(cam.x, cam.z) + 1.7;
    w.step(0, 1);
    w.settleNear();
    settleScene(scene, cam);
    const handed: number[] = [];
    const others: number[] = [];
    let was = new Uint8Array(chunkCount(map.dims));
    for (let f = 0; f < 60 * 60; f++) {
      cam.x += 6 / 60;
      cam.y = hf.heightAt(cam.x, cam.z) + 1.7;
      w.step(1 / 60, 1);
      const now = Uint8Array.from(was, (_, c) => (w.far.complete(c) ? 1 : 0));
      const changed = now.some((v, c) => v !== was[c] && statics.in(c) > 0);
      was = now;
      const t = performance.now();
      scene.build(cam, null);
      (changed ? handed : others).push(performance.now() - t);
    }
    record("frames in which a city chunk changed hands", handed.length, "frames");
    record("frame build in those frames, median", median(handed), "ms");
    record("frame build in those frames, the worst", Math.max(...handed), "ms", 16.7);
    record("frame build in the others, median", median(others), "ms");
  }
}

/**
 * A pteranodon's rider over downtown at 150 m on medium (flyers-plan.md, FL2): its tamed sprint, 18.975 m/s, its riding
 * camera (client/core/viewpoint.ts, the boom the app gives the stand-in), straight for 20 s, banking round at 15 degrees
 * a second for 20 s, and straight again, a frame a sixtieth of a second, with the machine's load before and after.
 */
function benchRider(section: (title: string) => void, record: Record, w: ReturnType<typeof cityWorld>): void {
  const medium = TIERS.find((t) => t.name === "medium")!;
  const speed = 18.975;
  section(`A pteranodon's rider at 150 m over downtown on medium, at ${speed} m/s, banking round for a third of the minute; load ${loadavg().map((l) => l.toFixed(1)).join(" ")} over ${cpus().length} cores`);
  const { hf, structs, reg } = w;
  const scene = w.scene(medium, [1920, 1080]);
  const cam = w.cam;
  const view = new Viewpoint();
  const kind = reg.index.get("core:pteranodon")!;
  const seat = reg.saddleSeats[reg.index.get("core:saddle_pteranodon")!]!.find((s) => s.driver)!;
  const up = seat.anchor[1] + 0.75;
  const boom = 1.5 + 1.2 * Math.max(reg.bodyHeight[kind]!, 2 * reg.bodyRadius[kind]!);
  let [x, z, yaw] = [4300, 2900, Math.PI / 2];
  const height = (): number => Math.max(hf.heightAt(x, z), hf.seaLevel) + 150;
  const place = (dt: number): void => void view.placeVehicle(cam, { hf, structs }, x, height() + up, z, yaw, -0.1, yaw, speed, dt, false, { vx: Math.sin(yaw) * speed, vy: 0, vz: Math.cos(yaw) * speed, id: 1, boom });
  place(16);
  w.step(0, 1);
  w.settleNear();
  settleScene(scene, cam);
  const builds: number[] = [];
  let draws = 0;
  let triangles = 0;
  let unseen = 0;
  const frames = 60 * 60;
  for (let f = 0; f < frames; f++) {
    if (f >= 20 * 60 && f < 40 * 60) yaw += (15 * Math.PI) / 180 / 60;
    x += (Math.sin(yaw) * speed) / 60;
    z += (Math.cos(yaw) * speed) / 60;
    place(1000 / 60);
    w.step(1 / 60, 1);
    const t = performance.now();
    const p = scene.build(cam, null);
    builds.push(performance.now() - t);
    draws = Math.max(draws, p.drawCount);
    triangles = Math.max(triangles, p.triangles);
    if (scene.city!.stats.unseen > 0) unseen++;
  }
  record("frame build, median", median(builds), "ms");
  record("frame build, 99th percentile", percentile(builds, 0.99), "ms");
  record("frame build, the worst", Math.max(...builds), "ms", 16.7);
  record("the most draws in a frame", draws, "draws");
  record("the most triangles in a frame", triangles / 1000, "k");
  record("frames with a far city tile in view not yet made", unseen, `of ${frames}`);
  record(`the machine's load after (1, 5, 15 minutes)`, loadavg()[0]!, `${loadavg().slice(1).map((l) => l.toFixed(1)).join(", ")} over ${cpus().length} cores`);
}

if (import.meta.main) {
  const rider = process.argv.includes("--rider");
  const [path, views] = process.argv.slice(2).filter((a) => a !== "--rider");
  if (!path) {
    console.error("bun tools/bench/city.ts <file.snmap> [views.json] [--rider]");
    process.exit(2);
  }
  const record: Record = (name, value, unit, budget = null) => {
    const verdict = budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`;
    console.log(`  ${name.padEnd(64)} ${value.toFixed(value < 10 ? 3 : 1).padStart(10)} ${unit}${verdict}`);
  };
  if (rider) benchRider((title) => console.log(`\n${title}`), record, cityWorld(path));
  else benchCity((title) => console.log(`\n${title}`), record, path, views);
}
