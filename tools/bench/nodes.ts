// Rows for resource nodes: working them out from the map, filling a chunk, a body's step and rays among them, and building
// a chunk of them for drawing. `bun tools/bench/nodes.ts` runs these alone.

import { Camera } from "../../client/core/render/camera.ts";
import { Scene } from "../../client/core/render/scene.ts";
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

if (import.meta.main) {
  benchNodes(
    (title) => console.log(`\n${title}`),
    (name, value, unit, budget = null) => console.log(`  ${name.padEnd(58)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`}`),
  );
}
