// Rows for the terrain's pictures (D253): what they hold on the card, how many frames a window takes to fill at each
// tier's upload allowance, what the window costs the tile selection, and tiles drawn a level coarser for want of a
// window, flying the bench map's diagonal at speeds up to past anything in the game, and after teleports.
// `bun tools/bench/terrain.ts` runs these alone.

import { TIERS, tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { FramePacket, SOURCE_WINDOW } from "../../client/core/render/packet.ts";
import { TerrainLod, WINDOW, groundSize, type GroundBudget } from "../../client/core/render/terrain.ts";
import { Rng } from "../../shared/rng.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { ROAD_PLANES, RoadSectors, roadSamples } from "../../shared/world/roadframe.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

/** Memory in millions of bytes, as the plan counts it; an allowance in the tiers' megabytes of 2^20. */
const MB = 1e6;
/** Metres a second, at 60 frames a second. */
const SPEEDS = [60, 600, 3000];
const FLIGHT = 3000;

/** The bench map's hills, as tools/bench.ts makes them. */
export function benchHills(): Heightfield {
  const hf = new Heightfield({ chunksX: 128, chunksZ: 128 }, TERRAIN_CELL, -32, 1 / 64);
  for (let j = 0; j < hf.nz; j++) {
    for (let i = 0; i < hf.nx; i++) {
      const [x, z] = [i * hf.cell, j * hf.cell];
      hf.heights[j * hf.nx + i] = Math.round((40 + 30 * Math.sin(x / 400) * Math.cos(z / 350) + 8 * Math.sin(x / 53) * Math.sin(z / 61) + 32) * 64);
    }
  }
  return hf;
}

/** Medium's allowance, a frame at a time, as the residency keeps it. */
function allowance(): GroundBudget & { next(): void } {
  let spent = 0;
  return {
    get left() {
      return Math.max(0, tierOf("medium").uploadBytes - spent);
    },
    spend: (n) => void (spent += n),
    reserve: () => {},
    next: () => void (spent = 0),
  };
}

const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
const at = (xs: number[], q: number): number => sorted(xs)[Math.min(xs.length - 1, Math.floor(xs.length * q))]!;

export function benchTerrain(section: Section, record: Row, hf = benchHills()): void {
  section("Terrain pictures (headless): the bench map's 8 km, a window of 2 km round the camera");
  const size = groundSize(hf);
  record("on the card: the whole map's pair and two windows", size.bytes / MB, "MB", 9.5);
  record("one pair of every sample, as before, for comparison", (hf.nx * hf.nz * 3) / MB, "MB");
  for (const tier of TIERS) record(`frames to fill a window at ${tier.name}'s ${tier.uploadBytes / 2 ** 20} MB a frame`, Math.ceil(WINDOW / Math.floor(tier.uploadBytes / (size.width[SOURCE_WINDOW]! * 3))), "");

  const cam = new Camera();
  cam.split = tierOf("medium").split;
  const lod = new TerrainLod(hf);
  const budget = allowance();
  const p = new FramePacket();
  const frame = (): number => {
    budget.next();
    p.beginFrame();
    cam.y = hf.heightAt(cam.x, cam.z) + 30;
    cam.update();
    const t = performance.now();
    lod.select(cam, p, 4000, budget);
    return performance.now() - t;
  };
  for (const speed of SPEEDS) {
    lod.reset();
    const times: number[] = [];
    let [coarser, most, refills] = [0, 0, 0];
    for (let d = 0; d < FLIGHT; d += speed / 60) {
      [cam.x, cam.z, cam.yaw, cam.pitch] = [1500 + d * Math.SQRT1_2, 1500 + d * Math.SQRT1_2, Math.PI / 4, -0.15];
      times.push(frame());
      coarser += lod.coarser;
      most = Math.max(most, lod.coarser);
      if (p.groundWindow[3]! >= 0 && p.groundWindow[6] === 0) refills++;
    }
    record(`flying ${speed} m/s for ${FLIGHT / 1000} km: window refills`, refills - 1, "");
    record(`  tiles drawn a level coarser, all frames`, coarser, "", speed < 1000 ? 0 : null);
    record(`  the most in a frame`, most, "");
    if (speed === SPEEDS[0]) {
      record("  tile selection with the window, median", at(times, 0.5), "ms");
      record("  tile selection with the window, 99th percentile", at(times, 0.99), "ms");
    }
  }

  const rng = new Rng(253);
  const [coming, first]: number[][] = [[], []];
  lod.reset();
  for (let k = 0; k < 20; k++) {
    [cam.x, cam.z, cam.yaw] = [rng.range(200, 7990), rng.range(200, 7990), rng.range(0, 2 * Math.PI)];
    const old = p.groundWindow[0];
    frame();
    first.push(lod.coarser);
    let n = 1;
    while (p.groundWindow[0] === old && n < 20) (frame(), n++);
    coming.push(n);
  }
  record("20 teleports: frames until the new window is in, most", Math.max(...coming), "", 4);
  record("  tiles drawn a level coarser in the frame after, mean", first.reduce((s, v) => s + v, 0) / first.length, "");

  // What a part that lands costs: a sector's ground held in the window's middle, and a road square that comes inside it and outside.
  lod.reset();
  [cam.x, cam.z] = [4000, 4000];
  for (let k = 0; k < 8; k++) frame();
  const [wi, wj] = [p.groundWindow[1]!, p.groundWindow[2]!], per = 32;
  const [cx, cz] = [Math.ceil(wi / per), Math.ceil(wj / per) + 8];
  hf.hold(cx, cz, cx + 16, cz + 16);
  let [rows, roadBytes] = [0, 0];
  for (let k = 0; k < 8; k++) (frame(), (rows += p.groundWindow[3]! >= 0 ? p.groundWindow[7]! : 0));
  record("a sector held inside the window: its bytes put again", (rows * size.width[SOURCE_WINDOW]! * 3) / MB, "MB");
  const road = (hf.road = new RoadSectors()), plane = (): Uint8Array => new Uint8Array(257 * 257);
  frame();
  for (const [key, j] of [[1, cz * 16], [2, 4000]] as const) {
    road.put(key, cx * 16, j, 257, { across: plane(), along: plane(), half: plane(), lanes: plane() });
    roadBytes = 0;
    for (let k = 0; k < 8; k++) (frame(), (roadBytes += p.roadWindow[1]! * roadSamples(size.width[SOURCE_WINDOW]!) * ROAD_PLANES));
    record(`a road square that comes ${key === 1 ? "inside" : "outside"} the window: bytes copied`, roadBytes / MB, "MB");
  }
  hf.road = null;

  // The boxes of a 16 km map's 65,536 chunks: scanned from its 67 million samples, or read from bounds kept as its parts came.
  const big = new Heightfield({ chunksX: 256, chunksZ: 256 }, TERRAIN_CELL, -32, 1 / 64);
  let t = performance.now();
  new TerrainLod(big);
  record("a 16 km map's chunk boxes, scanned", performance.now() - t, "ms");
  big.bounds = new Uint16Array(256 * 256 * 2);
  t = performance.now();
  new TerrainLod(big);
  record("a 16 km map's chunk boxes, from bounds kept", performance.now() - t, "ms");
}

if (import.meta.main) {
  benchTerrain(
    (title) => console.log(`\n${title}`),
    (name, value, unit, budget = null) => console.log(`  ${name.padEnd(58)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`}`),
  );
}
