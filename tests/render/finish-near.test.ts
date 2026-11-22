// How near the eye each world finish, wall, front and glass comes (client/core/render/finish-near.ts), which sizes what
// the finishes and the facades ask for.
import { expect, test } from "bun:test";
import { SURFACE_NAMES, surfaceIndex } from "../../content/surfaces.ts";
import { FinishNear, LOOK_WORK, MOVE, NEAR_WALL } from "../../client/core/render/finish-near.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { coreRegistry } from "../fixtures/world.ts";

const id = (name: string): number => (SURFACE_NAMES as readonly string[]).indexOf(name);
const tintOf = (name: string): number => Array.from({ length: 256 }, (_, t) => t).find((t) => surfaceIndex(t, true) === id(name))!;

/** A kilometre of grass with a strip of asphalt 4 m wide along x = 400, a store with one plain piece, and the eye 1.6 m over (500, 500). */
function scene() {
  const reg = coreRegistry(), dims = { chunksX: 16, chunksZ: 16 };
  const hf = new Heightfield(dims, 2, 0, 0.01);
  hf.tint.fill(tintOf("grass"));
  for (let j = 0; j < hf.nz; j++) for (let i = 200; i <= 202; i++) hf.tint[j * hf.nx + i] = tintOf("asphalt");
  const kind = reg.defs.findIndex((d, k) => d?.type === "structure" && d.shape === undefined && reg.halfX[k]! > 0.5 && reg.halfY[k]! > 0.5 && reg.halfZ[k]! > 0.1);
  const store = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  store.add(kind, 500, reg.halfY[kind]!, 530, 0, 0, 100);
  const finish = reg.defs[kind]!.type === "structure" ? surfaceIndex((reg.defs[kind] as { color: number }).color, false) : -1;
  return { reg, hf, store, near: new FinishNear(reg, false), piece: 30 - reg.halfZ[kind]!, finish };
}

test("a look goes all round the eye a few thousand samples and pieces a frame, and finds the nearest ground of each finish and the nearest piece of each, a wall among them", () => {
  const { hf, store, near, piece, finish } = scene();
  let frames = 0;
  do {
    near.update(500, 1.6, 500, hf, store, 514, 2);
    expect(near.stats.work).toBeLessThanOrEqual(LOOK_WORK + 65);
    frames++;
  } while (near.stats.looks === 0 && frames < 100);
  // 65 rows of 65 samples of the near ground, the piece, and 67 rows of the far ground 16 m apart: three frames.
  expect([near.stats.looks, frames]).toEqual([1, 3]);
  expect(near.metres[id("grass")]).toBeCloseTo(1.6, 6);
  // The asphalt 100 m off, past the near ground's 64 m, is found by the road's macro's wider look, 16 m between samples.
  expect(near.metres[id("asphalt")]).toBeWithin(70, 100);
  expect([near.metres[finish], near.metres[NEAR_WALL]].map((m) => +m!.toFixed(3))).toEqual([piece, piece].map((m) => +Math.hypot(m, 0).toFixed(3)));
  // Nothing else is near.
  expect(near.metres[id("glass")]).toBe(Infinity);
});

test("until the next look is through, each distance stands less the way the eye has gone since the last began, so a surface is never taken as farther than it is; a jump starts afresh", () => {
  const { hf, store, near, piece, finish } = scene();
  while (near.stats.looks === 0) near.update(500, 1.6, 500, hf, store, 514, 2);
  // Moved less than MOVE toward the piece: no look begins, and every distance is the look's less the way gone.
  near.update(500, 1.6, 500 + MOVE / 2, hf, store, 514, 2);
  expect([near.stats.work, +near.metres[finish]!.toFixed(3), near.metres[id("grass")]]).toEqual([0, +(piece - MOVE / 2).toFixed(3), 0]);
  // Past MOVE a look begins, and its partial finds stand beside the last look's.
  near.update(500, 1.6, 500 + MOVE, hf, store, 514, 2);
  expect([near.stats.work > 0, near.metres[id("grass")]]).toEqual([true, 0]);
  while (near.stats.looks === 1) near.update(500, 1.6, 500 + MOVE, hf, store, 514, 2);
  expect([+near.metres[finish]!.toFixed(3), +near.metres[id("grass")]!.toFixed(3)]).toEqual([+(piece - MOVE).toFixed(3), 1.6]);
  // A jump: what was found before is gone, and the new place's ground is found within the frame.
  near.update(100, 1.6, 100, hf, store, 514, 2);
  expect([near.metres[finish], near.metres[NEAR_WALL], +near.metres[id("grass")]!.toFixed(3)]).toEqual([Infinity, Infinity, 1.6]);
});
