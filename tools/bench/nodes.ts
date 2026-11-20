// Rows for resource nodes: working them out from the map, filling a chunk, a body's step and rays among them, building a
// chunk of them for drawing, and what a dense wood costs to draw with levels chosen by chunk or by cell. `bun
// tools/bench/nodes.ts` runs these alone.

import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { CHUNK_CELLS, Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Def } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { buildPack, type SourceMesh } from "../pack/write.ts";
import { CHUNK_SIZE, TICK_DT } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { Body, stepBody } from "../../shared/sim/character.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { NodeField, nodeForms, scatterNodes, type NodeSpot } from "../../shared/world/nodes.ts";
import { castWorld, lookDirection } from "../../shared/world/ray.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { corePack } from "../../tests/fixtures/pack.ts";
import { coreRegistry } from "../../tests/fixtures/world.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

/** The sizing target's map: 8 km square. */
const DIMS = { chunksX: 128, chunksZ: 128 };
const SLOTS = 160;

function rolling(): Heightfield {
  const hf = new Heightfield(DIMS, TERRAIN_CELL, -32, 1 / 64);
  for (let j = 0; j < hf.nz; j++) {
    for (let i = 0; i < hf.nx; i++) {
      const x = i * hf.cell;
      const z = j * hf.cell;
      hf.heights[j * hf.nx + i] = Math.round((40 + 30 * Math.sin(x / 400) * Math.cos(z / 350) + 8 * Math.sin(x / 53) * Math.sin(z / 61) + 32) * 64);
    }
  }
  return hf;
}

/** Microseconds per call of `fn` over `n` calls, the best of `rounds` runs. */
function best(rounds: number, n: number, fn: (i: number) => void): number {
  let least = Infinity;
  for (let r = 0; r < rounds; r++) {
    const t = performance.now();
    for (let i = 0; i < n; i++) fn(i);
    least = Math.min(least, ((performance.now() - t) * 1000) / n);
  }
  return least;
}

export function benchNodes(section: Section, record: Row): void {
  section("Resource nodes: worked out from the map, filled, walked among, shot through and drawn");
  const reg = coreRegistry();
  const hf = rolling();
  const kinds = ["core:tree", "core:tree", "core:tree", "core:rock", "core:rock", "core:bush"].map((id) => reg.index.get(id)!);
  const source = scatterNodes(DIMS, hf, 0xbe7c, SLOTS, nodeForms(reg), () => kinds);
  const spot: NodeSpot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  const chunks = DIMS.chunksX * DIMS.chunksZ;
  let t = performance.now();
  for (let c = 0; c < chunks; c++) for (let i = 0; i < SLOTS; i++) source.at(c, i, spot);
  const scan = performance.now() - t;
  record("work out every node of the 8 km map once", scan, "ms");
  record("work out one node", (scan * 1e6) / (chunks * SLOTS), "ns");

  const field = new NodeField(DIMS, reg, source);
  const far: number[] = [];
  for (let c = 0; c < chunks && far.length < 400; c += 37) far.push(c);
  const fills: number[] = [];
  for (let r = 0; r < 5; r++) {
    t = performance.now();
    for (const c of far) field.retain(c, 0, 1, () => false);
    fills.push((performance.now() - t) / far.length);
    for (const c of far) field.retain(c, 0, -1, () => false);
  }
  record("fill one chunk of nodes", Math.min(...fills), "ms", 0.2);

  // A forest a kilometre square in the middle of the map, every slot of every chunk filled where the ground allows.
  const middle = 64 * DIMS.chunksX + 64;
  field.retain(middle, 8, 1, () => false);
  const forest: CollisionWorld = { hf, structs: new StructureStore(DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts), nodes: field.store };
  const x0 = 64 * CHUNK_SIZE;
  const z0 = 64 * CHUNK_SIZE;
  const rng = new Rng(5);
  const moves = ["core:survivor", "core:raptor", "core:grazer", "core:parasaur"].map((id) => reg.move[reg.index.get(id)!]!);
  const bodies = Array.from({ length: 2000 }, () => {
    const b = new Body();
    b.x = x0 + rng.range(-400, 400);
    b.z = z0 + rng.range(-400, 400);
    b.y = hf.heightAt(b.x, b.z) + 1;
    return b;
  });
  const input = bodies.map(() => [0, 127, 0, 0]);
  const tick = (): void => {
    for (let i = 0; i < bodies.length; i++) {
      const inp = input[i]!;
      if (rng.int(20) === 0) {
        inp[0] = rng.int(255) - 127;
        inp[2] = rng.int(65536);
        inp[3] = rng.int(8) === 0 ? 1 : 0;
      }
      stepBody(forest, bodies[i]!, inp[0]!, inp[1]!, inp[2]!, 0, inp[3]!, moves[i % moves.length]!, TICK_DT);
    }
  };
  for (let k = 0; k < 30; k++) tick();
  record("a body's step in a forest, 2,000 bodies of four kinds", best(5, 100, tick) / bodies.length, "us");

  const d = [0, 0, 0];
  const shots = Array.from({ length: 2000 }, () => {
    const x = x0 + rng.range(-300, 300);
    const z = z0 + rng.range(-300, 300);
    lookDirection(rng.int(65536), rng.int(2000) - 1000, d);
    return [x, hf.heightAt(x, z) + 1.6, z, d[0]!, d[1]!, d[2]!];
  });
  const shoot = (s: number[], far: number): number => castWorld(forest, s[0]!, s[1]!, s[2]!, s[3]!, s[4]!, s[5]!, far);
  record("a 3.5 m look for a node to harvest, in a forest", best(5, shots.length, (i) => shoot(shots[i]!, 3.5)), "us");
  record("a 120 m shot in a forest", best(5, shots.length, (i) => shoot(shots[i]!, 120)), "us");

  // Every chunk of the forest built for drawing again, as when a node in each is used up.
  const scene = new Scene({ dims: DIMS, hf, structs: forest.structs, nodes: field.store }, reg, corePack());
  const cam = new Camera();
  cam.x = x0;
  cam.y = hf.heightAt(x0, z0) + 30;
  cam.z = z0;
  scene.viewDistance = 600;
  scene.build(cam, null);
  const tables = field.store.chunks.filter((c) => c !== null && c.live > 0);
  const rebuild = best(5, 1, () => {
    for (const table of tables) table!.shape++;
    scene.build(cam, null);
  });
  record("build one chunk of nodes for drawing", rebuild / tables.length, "us");
  record("draw a frame over the forest, nothing changed", best(5, 20, () => scene.build(cam, null)) / 1000, "ms");
}

/** A mesh of `tris[l]` triangles at level l, spread through a box `half` wide and `tall` high on its origin, stating `errors`. */
function standIn(id: string, tris: readonly number[], errors: readonly number[], half: number, tall: number, rng: Rng): SourceMesh {
  return {
    id,
    lods: tris.map((n, l) => {
      const positions = new Float32Array(n * 9);
      for (let k = 0; k < n; k++) {
        const [x, y, z] = [rng.range(-half, half), rng.range(0, tall), rng.range(-half, half)];
        positions.set([x, y, z, x + 0.3, y, z, x, y + 0.3, z + 0.1], k * 9);
      }
      return { positions, colors: new Uint8Array(n * 3).fill(7), indices: Uint32Array.from({ length: n * 3 }, (_, i) => i), ...(l > 0 ? { error: errors[l - 1]! } : {}) };
    }),
  };
}

/**
 * Every slot of 5 by 5 chunks filled, a tree for every three plants, at the triangles the artists give: 8,000 for a tree's
 * finest level and 400 for a plant's, four variants of each. Seen on the medium tier at 1,080 rows from 1.6 m up, in the middle of
 * a chunk and at its corner, all round. Returns the triangles and draws a frame, choosing levels by cells of each size.
 */
function denseWood(sides: readonly number[]): { tris: number; draws: number }[] {
  const rng = new Rng(17);
  const tree = { tris: [8000, 3000, 1000, 300, 8], errors: [0.012, 0.05, 0.2, 1] };
  const plant = { tris: [400, 150, 40, 12], errors: [0.005, 0.02, 0.08] };
  const meshes = [1, 2, 3, 4].flatMap((v) => [standIn(`test:wood_${v}`, tree.tris, tree.errors, 4, 12, rng), standIn(`test:plant_${v}`, plant.tris, plant.errors, 0.6, 0.8, rng)]);
  const node = (name: string, half: [number, number, number], size: [number, number], soft: boolean): Def => ({ type: "node", id: `test:${name}`, mesh: "box", color: 7, half, hits: 5, respawnHours: 1, yields: [], xp: 1, size, soft, variants: [1, 2, 3, 4].map((v) => ({ mesh: `test:${name}_${v}` })) });
  const reg = compileContent([...CORE_CONTENT, node("wood", [0.4, 5, 0.4], [0.8, 1.25], false), node("plant", [0.5, 0.4, 0.5], [0.7, 1.3], true)]).registry!;
  const pack = parsePack(buildPack(meshes, defaultPalette()));
  const dims = { chunksX: 5, chunksZ: 5 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 0);
  const [wood, plant1] = [reg.index.get("test:wood")!, reg.index.get("test:plant")!];
  const field = new NodeField(dims, reg, scatterNodes(dims, hf, 3, 256, nodeForms(reg), () => [wood, plant1, plant1, plant1]));
  field.retain(12, 2, 1, () => false);
  const scene = new Scene({ dims, hf, structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts), nodes: field.store }, reg, pack);
  scene.assets.tier = tierOf("medium");
  scene.viewHeight = 1080;
  const cam = new Camera();
  cam.aspect = 16 / 9;
  return sides.map((side) => {
    scene.chunkCells = side;
    for (const t of field.store.chunks) if (t) t.shape++;
    let [tris, draws, frames] = [0, 0, 0];
    for (const [x, z] of [[160, 160], [130, 130]] as const) {
      for (let k = 0; k < 8; k++) {
        [cam.x, cam.y, cam.z, cam.yaw, cam.pitch] = [x, 1.6, z, (k * Math.PI) / 4, -0.05];
        scene.build(cam, null);
        const p = scene.build(cam, null);
        tris += p.triangles;
        draws += p.drawCount;
        frames++;
      }
    }
    return { tris: tris / frames, draws: draws / frames };
  });
}

/** Rows for what a dense wood costs to draw, its drawn, levelled and culled by the chunk and by cells of 16 and 8 m. */
export function benchDenseWood(section: Section, record: Row): void {
  section("A dense wood from inside it: every slot of 5 by 5 chunks filled, trees of 8,000 triangles and plants of 400");
  const [chunk, cells, fine] = denseWood([1, CHUNK_CELLS, 8]);
  for (const [name, at] of [["by the chunk", chunk!], [`by ${64 / CHUNK_CELLS} m cells`, cells!], ["by 8 m cells", fine!]] as const) {
    record(`triangles a frame, levels chosen ${name}`, at.tris / 1e6, "M");
    record(`draws a frame, levels chosen ${name}`, at.draws, "");
  }
}

if (import.meta.main) {
  const section = (title: string): void => console.log(`\n${title}`);
  const record: Row = (name, value, unit, budget = null) => console.log(`  ${name.padEnd(58)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`}`);
  benchNodes(section, record);
  benchDenseWood(section, record);
}
