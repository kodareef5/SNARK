import { expect, test } from "bun:test";
import { TICK_DT } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { Body, stepBody } from "../../shared/sim/character.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { NodeField, type NodeSpot } from "../../shared/world/nodes.ts";
import { PROVING_DIMS, PROVING_NODES_PER_CHUNK, PROVING_SEA_LEVEL, buildProvingHeightfield, provingNodes } from "../../shared/world/proving.ts";
import { HIT_NODE, castWorld, rayHit } from "../../shared/world/ray.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const hf = buildProvingHeightfield();
const CHUNKS = PROVING_DIMS.chunksX * PROVING_DIMS.chunksZ;
const field = (): NodeField => new NodeField(PROVING_DIMS, reg.halfX, reg.halfY, reg.halfZ, reg.soft, reg.nodeHits, provingNodes(hf, reg));
const kind = (id: string) => reg.index.get(id)!;

test("where nodes stand is a pure function of the map: the same every time, dry, off the plaza, and of every kind", () => {
  const a = provingNodes(hf, reg);
  const b = provingNodes(buildProvingHeightfield(), coreRegistry());
  const sa: NodeSpot = { kind: 0, x: 0, y: 0, z: 0, yaw: 0 };
  const sb: NodeSpot = { kind: 0, x: 0, y: 0, z: 0, yaw: 0 };
  const counts = new Map<number, number>();
  for (let chunk = 0; chunk < CHUNKS; chunk++) {
    for (let i = 0; i < PROVING_NODES_PER_CHUNK; i++) {
      a.at(chunk, i, sa);
      b.at(chunk, i, sb);
      expect([sa.kind, sa.x, sa.y, sa.z, sa.yaw]).toEqual([sb.kind, sb.x, sb.y, sb.z, sb.yaw]);
      if (sa.kind === 0) continue;
      counts.set(sa.kind, (counts.get(sa.kind) ?? 0) + 1);
      const ground = hf.heightAt(sa.x, sa.z);
      expect(ground).toBeGreaterThan(PROVING_SEA_LEVEL);
      expect(sa.y).toBeCloseTo(ground + reg.halfY[sa.kind]!, 5); // standing on the ground
      expect(Math.max(Math.abs(sa.x - 256), Math.abs(sa.z - 256))).toBeGreaterThan(96);
    }
  }
  const total = [...counts.values()].reduce((x, y) => x + y, 0);
  expect(total).toBeGreaterThan(1500);
  expect(total).toBeLessThan(CHUNKS * PROVING_NODES_PER_CHUNK);
  for (const id of ["core:tree", "core:rock", "core:bush"]) expect(counts.get(kind(id))!).toBeGreaterThan(200);
});

test("the node store holds only chunks someone is near, minus what is used up", () => {
  const f = field();
  const used = new Set<string>();
  const gone = (chunk: number, i: number) => used.has(`${chunk}:${i}`);
  expect(f.store.count).toBe(0);
  f.retain(27, 1, 1, gone); // a 3 by 3 block of chunks
  const one = f.store.count;
  expect(one).toBeGreaterThan(50);
  expect(f.isLoaded(27)).toBe(true);
  expect(f.isLoaded(0)).toBe(false);
  f.retain(28, 1, 1, gone); // overlapping: the shared chunks are not filled twice
  const two = f.store.count;
  expect(two).toBeGreaterThan(one);
  expect(two).toBeLessThan(one * 2);
  f.retain(27, 1, -1, gone);
  expect(f.isLoaded(27)).toBe(true); // still held by the second
  f.retain(28, 1, -1, gone);
  expect(f.store.count).toBe(0);

  // A used-up node is left out when its chunk is filled, and comes and goes while it is.
  const t = f.store;
  f.retain(9, 0, 1, gone);
  const slot = [...Array(PROVING_NODES_PER_CHUNK).keys()].find((i) => t.chunks[9]!.kind[i] !== 0)!;
  const was = t.chunks[9]!.kind[slot]!;
  f.retain(9, 0, -1, gone);
  used.add(`9:${slot}`);
  f.retain(9, 0, 1, gone);
  expect(t.chunks[9]!.kind[slot]).toBe(0);
  f.set(9, slot, true);
  expect(t.chunks[9]!.kind[slot]).toBe(was);
  expect(t.chunks[9]!.hp[slot]).toBe(reg.nodeHits[was]!);
  f.set(9, slot, false);
  expect(t.chunks[9]!.kind[slot]).toBe(0);
  f.set(3, 0, true); // a chunk that is not filled: nothing happens
  expect(f.isLoaded(3)).toBe(false);
  expect(f.kindAt(9, slot)).toBe(was); // what the map says is there, used up or not
});

test("trees and rocks stop a body, bushes do not, and a ray finds all three", () => {
  const f = field();
  f.retain(0, 16, 1, () => false);
  const world = { hf, structs: new StructureStore(PROVING_DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts), nodes: f.store };
  const p = reg.move[kind("core:survivor")]!;
  const spot: NodeSpot = { kind: 0, x: 0, y: 0, z: 0, yaw: 0 };
  const seen = new Set<number>();
  for (let chunk = 0; chunk < CHUNKS && seen.size < 3; chunk++) {
    for (let i = 0; i < PROVING_NODES_PER_CHUNK; i++) {
      f.source.at(chunk, i, spot);
      if (spot.kind === 0 || seen.has(spot.kind)) continue;
      // Level ground to the south of it, so a body can walk straight at it.
      const ground = hf.heightAt(spot.x, spot.z);
      if (Math.abs(hf.heightAt(spot.x, spot.z - 3) - ground) > 0.3 || !capsuleFree(world, spot.x, hf.heightAt(spot.x, spot.z - 3), spot.z - 3, p.radius, p.height)) continue;
      seen.add(spot.kind);
      const soft = reg.soft[spot.kind] === 1;
      // Standing on the very spot is free only for a bush.
      expect(capsuleFree(world, spot.x, ground, spot.z, p.radius, p.height)).toBe(soft);
      const b = new Body();
      b.x = spot.x;
      b.z = spot.z - 3;
      b.y = hf.heightAt(b.x, b.z);
      b.grounded = true;
      for (let t = 0; t < 90; t++) {
        stepBody(world, b, 0, 127, 0, 0, 0, p, TICK_DT);
        if (!capsuleFree(world, b.x, b.y, b.z, p.radius, p.height)) throw new Error("in solid");
      }
      // Three seconds of walking north: through a bush, or stopped (or turned aside) by anything else.
      if (soft) expect(b.z).toBeGreaterThan(spot.z + 5);
      else expect(Math.hypot(b.x - spot.x, b.z - spot.z)).toBeGreaterThan(reg.halfX[spot.kind]! + p.radius - 0.05);
      // Looking at its middle from two metres south: the ray reports this node.
      expect(castWorld(world, spot.x, spot.y, spot.z - 2.5, 0, 0, 1, 5)).toBe(HIT_NODE);
      expect(rayHit.ref).toBe(chunk * 65536 + i);
    }
  }
  expect(seen.size).toBe(3);
});

test("fuzz: bodies wandering among trees and rocks are always in free space", () => {
  const f = field();
  f.retain(0, 16, 1, () => false);
  const world = { hf, structs: new StructureStore(PROVING_DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts), nodes: f.store };
  const p = reg.move[kind("core:survivor")]!;
  for (let seed = 1; seed <= 4; seed++) {
    const rng = new Rng(seed);
    const b = new Body();
    do {
      b.x = rng.range(40, 470);
      b.z = rng.range(40, 470);
      b.y = hf.heightAt(b.x, b.z);
    } while (b.y < 0 || !capsuleFree(world, b.x, b.y, b.z, p.radius, p.height));
    b.grounded = true;
    let moveX = 0;
    let moveZ = 127;
    let yaw = 0;
    let buttons = 0;
    for (let i = 0; i < 5000; i++) {
      if (rng.int(25) === 0) {
        moveX = rng.int(255) - 127;
        moveZ = rng.int(255) - 127;
        yaw = rng.int(65536);
        buttons = rng.int(4);
      }
      stepBody(world, b, moveX, moveZ, yaw, 0, buttons, p, TICK_DT);
      if (!capsuleFree(world, b.x, b.y, b.z, p.radius, p.height)) throw new Error(`seed ${seed} in solid at tick ${i}: ${b.x}, ${b.y}, ${b.z}`);
    }
  }
});
