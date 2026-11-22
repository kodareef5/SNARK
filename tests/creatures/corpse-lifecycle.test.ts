import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { Fall, layCorpse, wireX, wireY } from "../../shared/anim/corpse.ts";
import { Solved } from "../../shared/anim/skeleton.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { quatRotate } from "../../shared/math/quat.ts";
import { decodeCorpseCheckpoint, encodeCorpseCheckpoint } from "../../shared/net/corpse.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { birdAnim } from "../fixtures/bird.ts";

const anim = birdAnim(), reg = compileContent(CORE_CONTENT).registry!;
function world(water = -Infinity, chunks = 2) {
  const dims = { chunksX: chunks, chunksZ: chunks }, hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let z = 0; z < hf.nz; z++) for (let x = 0; x < hf.nx; x++) hf.setSample(x, z, 0);
  hf.seaLevel = water;
  return { hf, structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts) };
}
function doll(x: number, y: number, z: number, yaw = 0, size = 1) {
  return new Fall(layCorpse(anim, false, false, x, y, z, yaw, size, new Solved(anim.rig.bones), true)!);
}

test("a physical corpse continues a long fall and a deep sink until solid support, then sleeps", () => {
  for (const [height, water, ticks] of [[80, -Infinity, 1000], [24, 40, 2100]]) {
    const w = world(water), f = doll(40, height!, 40), p = new Float64Array(3);
    f.ragdoll.launch(12, 0, 0, 0, 1, 0);
    for (let t = 0; t < 301; t++) f.tick(w);
    f.ragdoll.rootPosition(p);
    expect(p[1]).toBeGreaterThan(3); expect(f.still).toBe(false);
    const before = p[1]!;
    for (let t = 301; t < ticks!; t++) f.tick(w);
    f.ragdoll.rootPosition(p);
    expect(p[1]).toBeLessThan(before - 3); expect(p[1]).toBeLessThan(1);
    expect(f.still).toBe(true); expect(f.ragdoll.awake).toBe(false);
  }
});

test("late moving checkpoints resume bit-exactly after the root has translated and crossed a chunk", () => {
  for (const [x, y, z, yaw, size] of [[63.25, 9.375, 40.125, 1.1, .73], [900.5, 80, 780.25, 2.7, 1]]) {
    const w = world(-Infinity, 16), a = doll(x!, y!, z!, yaw, size), p = new Float64Array(3);
    a.ragdoll.launch(11, 4, 3, .8, 1.5, -.4);
    for (let i = 0; i < 13; i++) a.tick(w);
    a.ragdoll.rootPosition(p);
    const cp = decodeCorpseCheckpoint(encodeCorpseCheckpoint({ x: wireX(p[0]!), y: wireY(p[1]!), z: wireX(p[2]!), yaw: yaw!, size: size!, out: false, air: false, standing: true, awake: a.ragdoll.awake, ticks: a.ticks, state: a.ragdoll.checkpoint() }))!;
    const b = doll(cp.x, cp.y, cp.z, cp.yaw, cp.size);
    expect(b.ragdoll.restore(cp.state, cp.awake)).toBe(true); b.ticks = cp.ticks;
    for (let i = 0; i < 180; i++) {
      a.tick(w); b.tick(w);
      expect(b.ragdoll.checkpoint()).toEqual(a.ragdoll.checkpoint());
      expect([b.ticks, b.still]).toEqual([a.ticks, a.still]);
    }
  }
});

test("outward launches keep every capsule in map bounds at edges and corners", () => {
  const w = world(), v = new Float64Array(3);
  for (const [x, z, vx, vz] of [[3, 64, -30, 0], [125, 64, 30, 0], [64, 3, 0, -30], [64, 125, 0, 30], [3, 3, -30, -30], [125, 125, 30, 30]]) {
    const f = doll(x!, 2, z!, .7), r = f.ragdoll;
    r.launch(vx!, 2, vz!, 1, 2, 3);
    for (let t = 0; t < 180; t++) {
      f.tick(w);
      for (let i = 0; i < r.n; i++) {
        const b = r.def.bone[i]!, at = i * 3, radius = r.skel.capR[b]!;
        quatRotate(r.q, i * 4, (r.skel.capB[b * 3]! - r.skel.capA[b * 3]!) / 2, (r.skel.capB[b * 3 + 1]! - r.skel.capA[b * 3 + 1]!) / 2, (r.skel.capB[b * 3 + 2]! - r.skel.capA[b * 3 + 2]!) / 2, v, 0);
        expect(r.x[at]! - Math.abs(v[0]!) - radius).toBeGreaterThanOrEqual(-1e-8);
        expect(r.x[at]! + Math.abs(v[0]!) + radius).toBeLessThanOrEqual(128 + 1e-8);
        expect(r.x[at + 2]! - Math.abs(v[2]!) - radius).toBeGreaterThanOrEqual(-1e-8);
        expect(r.x[at + 2]! + Math.abs(v[2]!) + radius).toBeLessThanOrEqual(128 + 1e-8);
      }
    }
  }
});
