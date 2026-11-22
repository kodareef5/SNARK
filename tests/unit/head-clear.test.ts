// A long creature holds its head clear of walls (MoveParams.headRadius, shared/sim/character.ts): walking at a wall it stops
// with its snout outside, turning beside one it does not swing its head in, it can always back or turn away, and the
// ground does not count, so it still climbs a hill whose rise is ahead of its head.
import { expect, test } from "bun:test";
import { compileContent } from "../../shared/content/registry.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { Body, headClear, stepBody } from "../../shared/sim/character.ts";
import { TICK_DT } from "../../shared/coords.ts";

const reg = compileContent(CORE_CONTENT).registry!;
const wall = reg.index.get("core:wall")!;

function world(slope = 0) {
  const dims = { chunksX: 4, chunksZ: 4 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, Math.max(0, (j * TERRAIN_CELL - 120) * slope));
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  return { hf, structs };
}

/** A wall of stone pieces 3 m tall and 18 m long across +Z at `z`, two high: 6 m. */
function wallAt(w: ReturnType<typeof world>, z: number): void {
  for (let k = -3; k <= 3; k++) for (const y of [1.5, 4.5]) w.structs.add(wall, 128 + k * 3, y, z, 0, 0, 1);
}

function creature(name: string, x: number, z: number, yaw = 0): Body {
  const b = new Body();
  b.kind = reg.index.get(`core:${name}`)!;
  b.x = x; b.y = 0; b.z = z; b.yaw = yaw; b.grounded = true;
  return b;
}

test("every big creature walking at a wall stops with its head outside it", () => {
  for (const name of ["rex", "spino", "trike", "stego", "parasaur", "raptor", "carbonemys"]) {
    const w = world();
    wallAt(w, 140);
    const p = reg.move[reg.index.get(`core:${name}`)!]!;
    expect(p.headRadius).toBeGreaterThan(0);
    // Eight metres from touching, which the slowest walks in under nine seconds.
    const b = creature(name, 128, 140 - p.headAhead! - p.headRadius! - 8);
    for (let t = 0; t < 300; t++) {
      stepBody(w, b, 0, 127, 0, 0, 0, p, TICK_DT);
      expect(headClear(w, p, b.x, b.y, b.z, b.yaw)).toBe(true);
    }
    // It came up close to the wall: its head within a few centimetres of the face, at 139.9.
    expect(b.z + p.headAhead! + p.headRadius!).toBeGreaterThan(139.6);
    expect(b.z + p.headAhead! + p.headRadius!).toBeLessThan(139.95);
  }
});

test("a rex standing along a wall does not turn its head into it, and turns away from it freely", () => {
  const w = world();
  wallAt(w, 140);
  const p = reg.move[reg.index.get("core:rex")!]!;
  // Facing +X, its flank 3 m from the wall: a turn toward the wall would put its head through it.
  const b = creature("rex", 128, 140 - 3.2, 16384);
  for (let t = 0; t < 120; t++) {
    stepBody(w, b, 0, 0, 0, 0, 0, p, TICK_DT);
    expect(headClear(w, p, b.x, b.y, b.z, b.yaw)).toBe(true);
  }
  // It turned only as far as its head stays clear, short of facing the wall.
  expect(Math.abs(((b.yaw - 0 + 32768) & 0xffff) - 32768)).toBeGreaterThan(4000);
  // Away from the wall it turns all the way round.
  for (let t = 0; t < 200; t++) stepBody(w, b, 0, 0, 32768, 0, 0, p, TICK_DT);
  expect(b.yaw).toBe(32768);
});

test("a rex whose head is at a wall backs and walks away from it", () => {
  const w = world();
  wallAt(w, 140);
  const p = reg.move[reg.index.get("core:rex")!]!;
  const b = creature("rex", 128, 120);
  for (let t = 0; t < 300; t++) stepBody(w, b, 0, 127, 0, 0, 0, p, TICK_DT);
  const at = b.z;
  for (let t = 0; t < 120; t++) stepBody(w, b, 0, 0, 32768, 0, 0, p, TICK_DT);
  for (let t = 0; t < 60; t++) stepBody(w, b, 0, 127, 32768, 0, 0, p, TICK_DT);
  expect(b.z).toBeLessThan(at - 3);
});

test("a rex climbs a hill though its head dips toward the rise ahead", () => {
  const w = world(0.45);
  const p = reg.move[reg.index.get("core:rex")!]!;
  const b = creature("rex", 128, 110);
  for (let t = 0; t < 300; t++) stepBody(w, b, 0, 127, 0, 0, 0, p, TICK_DT);
  // At its walk of 2.8 m/s, as far up as on the level less what the slope takes.
  expect(b.z).toBeGreaterThan(136);
  expect(b.y).toBeGreaterThan(7);
});

test("a rex walking at a shallow angle to a wall never puts its head into it, from either side, and goes on along it", () => {
  const p = reg.move[reg.index.get("core:rex")!]!;
  for (const degrees of [10, 20, 35]) for (const side of [1, -1]) {
    const w = world();
    // A wall along +Z at x = 128 + side * 8, three pieces of two storeys: 21 m long.
    for (let k = -3; k <= 3; k++) for (const y of [1.5, 4.5]) w.structs.add(wall, 128 + side * 8, y, 110 + k * 3, 16384, 0, 1);
    const yaw = Math.round(((side * degrees) / 360) * 65536) & 0xffff;
    const b = creature("rex", 128, 92, yaw);
    expect(headClear(w, p, b.x, b.y, b.z, b.yaw)).toBe(true);
    let into = 0;
    for (let t = 0; t < 240; t++) {
      stepBody(w, b, 0, 127, yaw, 0, 0, p, TICK_DT);
      if (!headClear(w, p, b.x, b.y, b.z, b.yaw)) into++;
    }
    expect([degrees, side, into]).toEqual([degrees, side, 0]);
    // Held off the wall, it slid on along it rather than stopping where it met it.
    expect(b.z).toBeGreaterThan(105);
  }
});
