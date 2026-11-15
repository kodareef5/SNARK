// Rows for the two depth ranges (D252): the draws the split lists twice, a draw across it being drawn in each range,
// and what the split costs the frame build. The bench map's bases as a client holds them, the chunks within four of
// the camera's, seen from 60 m off each of twenty bases as the main bench stands off its first, turning; then the same
// store built up in every chunk, a city, which is the most a split can cut through.
// `bun tools/bench/depth.ts` runs these alone.

import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { Rng } from "../../shared/rng.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { buildCorePack } from "../pack/build.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const DIMS = { chunksX: 128, chunksZ: 128 };
const KINDS = ["core:foundation", "core:wall", "core:wall", "core:ceiling", "core:ceiling", "core:pillar", "core:crate", "core:block"];
/** The chunks a client holds, this many either way of the camera's. */
const HELD = 4;
const BASES = 20;
const TURN = 36;
const SPLIT = tierOf("medium").split;

/** The bench map's hills. */
export function terrain(): Heightfield {
  const hf = new Heightfield(DIMS, TERRAIN_CELL, -32, 1 / 64);
  for (let j = 0; j < hf.nz; j++) {
    for (let i = 0; i < hf.nx; i++) {
      const [x, z] = [i * hf.cell, j * hf.cell];
      hf.heights[j * hf.nx + i] = Math.round((40 + 30 * Math.sin(x / 400) * Math.cos(z / 350) + 8 * Math.sin(x / 53) * Math.sin(z / 61) + 32) * 64);
    }
  }
  return hf;
}

/** A piece: its kind, place and turn. */
export type Piece = [number, number, number, number, number];

/** The bench map's 250 bases of 2,000 pieces, made in the order tools/bench.ts makes them, so they are the same, by chunk. */
export function bases(reg: Registry, hf: Heightfield, halfY: (kind: number) => number): { centers: [number, number][]; byChunk: Map<number, Piece[]> } {
  const rng = new Rng(2026);
  const kinds = KINDS.map((id) => reg.index.get(id)!);
  const centers: [number, number][] = [];
  const byChunk = new Map<number, Piece[]>();
  for (let b = 0; b < 250; b++) {
    const [cx, cz] = [Math.round(rng.range(400, 7790) / 3) * 3, Math.round(rng.range(400, 7790) / 3) * 3];
    centers.push([cx, cz]);
    const y0 = hf.heightAt(cx, cz);
    for (let n = 0; n < 2000; n++) {
      const kind = kinds[rng.int(kinds.length)]!;
      const x = cx + (rng.int(15) - 7) * 3;
      const z = cz + (rng.int(15) - 7) * 3;
      const piece: Piece = [kind, x, y0 + rng.int(4) * 3.3 + halfY(kind), z, rng.int(4) * 16384];
      const chunk = Math.floor(z / CHUNK_SIZE) * DIMS.chunksX + Math.floor(x / CHUNK_SIZE);
      if (!byChunk.has(chunk)) byChunk.set(chunk, []);
      byChunk.get(chunk)!.push(piece);
    }
  }
  return { centers, byChunk };
}

/** A scene of the pieces in the chunks a camera at (x, z) holds, or with `reach` in as many chunks either way. */
export function held(reg: Registry, pack: Pack, hf: Heightfield, x: number, z: number, piecesOf: (chunk: number) => Piece[], reach = HELD): Scene {
  const structs = new StructureStore(DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const [cx, cz] = [Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)];
  for (let dz = -reach; dz <= reach; dz++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (cx + dx < 0 || cz + dz < 0 || cx + dx >= DIMS.chunksX || cz + dz >= DIMS.chunksZ) continue;
      for (const [kind, px, py, pz, yaw] of piecesOf((cz + dz) * DIMS.chunksX + cx + dx)) structs.add(kind, px, py, pz, yaw, 1, 1000);
    }
  }
  const scene = new Scene({ dims: DIMS, hf, structs }, reg, pack);
  scene.viewHeight = 1080;
  return scene;
}

interface Turned {
  /** Per frame: draws with one range, with the split, and the frame build with each. */
  one: number[];
  two: number[];
  oneMs: number[];
  twoMs: number[];
  /** Draws in both ranges with the split at 256 m, for the plan's comparison. */
  at256: number[];
}

/** Turns the camera through a circle in the scene, each step built with one range, the split, and the split at 256 m. */
function turn(scene: Scene, cam: Camera, out: Turned): void {
  const tier = (split: number) => ({ ...tierOf("medium"), split });
  const [one, two, low] = [tier(0), tier(SPLIT), tier(256)];
  // The first frames upload every chunk and level.
  for (let k = 0; k < 5; k++) scene.build(cam, null);
  const yaw = cam.yaw;
  for (let k = 0; k < TURN; k++) {
    cam.yaw = yaw + (k / TURN) * 2 * Math.PI;
    for (const [t, draws, ms] of [[one, out.one, out.oneMs], [two, out.two, out.twoMs]] as const) {
      scene.assets.tier = t;
      const at = performance.now();
      const p = scene.build(cam, null);
      ms.push(performance.now() - at);
      draws.push(p.drawCount);
    }
    scene.assets.tier = low;
    out.at256.push(scene.build(cam, null).drawCount - out.one[out.one.length - 1]!);
  }
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;
const mean = (xs: number[]): number => xs.reduce((s, v) => s + v, 0) / xs.length;

function rows(record: Row, t: Turned): void {
  const doubled = t.two.map((n, i) => n - t.one[i]!);
  record("draws a frame with one range, mean", mean(t.one), "");
  record(`draws a frame with the split at ${SPLIT} m, mean`, mean(t.two), "");
  record("of them drawn in both ranges, mean", mean(doubled), "");
  record("the share of a frame's draws that are doubled, mean", (mean(doubled) / mean(t.one)) * 100, "%");
  record("the most doubled in a frame", Math.max(...doubled), "");
  record("the share doubled with the split at 256 m, for comparison", (mean(t.at256) / mean(t.one)) * 100, "%");
  record("frame build with one range, median", median(t.oneMs), "ms");
  record(`frame build with the split at ${SPLIT} m, median`, median(t.twoMs), "ms");
  record("what the split adds to the frame build, median of each frame's", median(t.twoMs.map((ms, i) => ms - t.oneMs[i]!)), "ms", 0.1);
}

export function benchDepth(section: Section, record: Row): void {
  const reg = compileContent(CORE_CONTENT).registry!;
  const pack = parsePack(buildCorePack());
  const hf = terrain();
  const probe = new StructureStore(DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const { centers, byChunk } = bases(reg, hf, (kind) => probe.halfYOf(kind));

  section(`Two depth ranges (headless): the chunks a client holds round each of ${BASES} bench bases, from 60 m off it, turning`);
  const bench: Turned = { one: [], two: [], oneMs: [], twoMs: [], at256: [] };
  for (const [bx, bz] of centers.slice(0, BASES)) {
    const cam = new Camera();
    [cam.x, cam.z, cam.aspect] = [bx + 60, bz, 16 / 9];
    cam.y = hf.heightAt(cam.x, cam.z) + 8;
    cam.yaw = Math.PI / 2 + Math.PI;
    turn(held(reg, pack, hf, cam.x, cam.z, (c) => byChunk.get(c) ?? []), cam, bench);
  }
  rows(record, bench);

  section(`Two depth ranges (headless): a city, the ${(HELD * 2 + 1) ** 2} chunks a client holds each built up with 1,000 pieces, from its middle, turning`);
  const [x, z] = [4096 + 32, 4096 + 32];
  const rng = new Rng(9);
  const kinds = KINDS.map((id) => reg.index.get(id)!);
  const city: Turned = { one: [], two: [], oneMs: [], twoMs: [], at256: [] };
  const scene = held(reg, pack, hf, x, z, (chunk) => {
    const [x0, z0] = [(chunk % DIMS.chunksX) * CHUNK_SIZE, Math.floor(chunk / DIMS.chunksX) * CHUNK_SIZE];
    return Array.from({ length: 1000 }, (): Piece => {
      const kind = kinds[rng.int(kinds.length)]!;
      const [px, pz] = [x0 + 1.5 + rng.int(21) * 3, z0 + 1.5 + rng.int(21) * 3];
      return [kind, px, hf.heightAt(px, pz) + rng.int(4) * 3.3 + probe.halfYOf(kind), pz, rng.int(4) * 16384];
    });
  });
  const cam = new Camera();
  [cam.x, cam.z, cam.aspect] = [x, z, 16 / 9];
  cam.y = hf.heightAt(x, z) + 8;
  turn(scene, cam, city);
  rows(record, city);

  // No client holds this: it is the putting in order at its heaviest, near and far draws mixed in the thousands.
  section("Two depth ranges (headless): every bench base held, from 60 m off the first, turning");
  const all: Turned = { one: [], two: [], oneMs: [], twoMs: [], at256: [] };
  const [bx, bz] = centers[0]!;
  const far = new Camera();
  [far.x, far.z, far.aspect] = [bx + 60, bz, 16 / 9];
  far.y = hf.heightAt(far.x, far.z) + 8;
  turn(held(reg, pack, hf, far.x, far.z, (c) => byChunk.get(c) ?? [], DIMS.chunksX), far, all);
  rows(record, all);
}

if (import.meta.main) {
  benchDepth(
    (title) => console.log(`\n${title}`),
    (name, value, unit, budget = null) => console.log(`  ${name.padEnd(58)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`}`),
  );
}
