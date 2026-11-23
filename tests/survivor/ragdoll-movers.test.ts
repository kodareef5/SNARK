// A ragdoll meets moving solids, such as cars (shared/anim/ragdoll.ts movers): it is shoved by one driven into it, rides
// one it lies on, and wakes when one comes near where it sleeps.
import { expect, test } from "bun:test";
import { HUMAN, HUMAN_RAGDOLL } from "../../shared/anim/human.ts";
import { layHuman, standingPose } from "../../shared/anim/human-fall.ts";
import { Ragdoll, type Mover, type MoverPose } from "../../shared/anim/ragdoll.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { Corpses } from "../../client/core/ragdoll.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { survivorKind } from "../../shared/sim/blockers.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";
import { solidOf } from "../../shared/sim/vehicle-movers.ts";

const reg = compileContent(CORE_CONTENT).registry!;
const STEP = 1 / 30;

function flat() {
  const dims = { chunksX: 2, chunksZ: 2 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 0);
  return { hf, structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts) };
}

const at = (x: number, y: number, z: number): MoverPose => ({ x, y, z, qx: 0, qy: 0, qz: 0, qw: 1 });
/** A car-sized solid: a body from 0.2 m up to 1 m, 1.8 m wide and 4.4 m long, its frame on the ground under its middle. */
const CAR = Float64Array.of(0, 0.6, 0, 0.9, 0.4, 2.2);

test("a car driven into a lying body shoves it ahead and never through", () => {
  const w = flat(), r = layHuman(40, 0, 40, 0, true);
  for (let f = 0; f < 30; f++) r.step(w, STEP);
  let z = 30, inside = 0;
  for (let f = 0; f < 45; f++) {
    const next = z + 6 * STEP;
    r.movers = [{ from: at(40, 0, z), to: at(40, 0, next), boxes: CAR }];
    r.step(w, STEP);
    z = next;
    // No body's centre within the car's box, which runs 2.2 m either side of its middle.
    for (let i = 0; i < r.n; i++) if (Math.abs(r.x[i * 3]! - 40) < 0.9 && r.x[i * 3 + 1]! > 0.2 && r.x[i * 3 + 1]! < 1 && Math.abs(r.x[i * 3 + 2]! - z) < 2.2) inside++;
  }
  expect(inside).toBe(0);
  // The car's nose ended 2.2 m ahead of z: the body was carried well past where it lay.
  expect(r.x[2]!).toBeGreaterThan(41.5);
});

test("a body lying on a moving platform rides along with it", () => {
  const w = flat(), r = new Ragdoll(HUMAN, HUMAN_RAGDOLL);
  const platform = Float64Array.of(0, 0.5, 0, 2, 0.1, 2);
  r.start(standingPose(), standingPose(), 40, 0.62, 40, 0, 1);
  r.launch(0, 0, 0.5, 0.5, 0, 0);
  let x = 40, after = 0;
  for (let f = 0; f < 60; f++) {
    const next = x + 1.5 * STEP;
    r.movers = [{ from: at(x, 0, 40), to: at(next, 0, 40), boxes: platform }];
    r.step(w, STEP);
    x = next;
    // Yanked off its feet as the platform sets off, it lies on it after a second.
    if (f === 29) after = r.x[0]!;
  }
  // The second second at 1.5 m/s: it went the platform's way as fast, still on top of it.
  expect(r.x[0]! - after).toBeGreaterThan(1.4);
  expect(r.x[1]!).toBeGreaterThan(0.6);
  expect(r.awake).toBe(true);
});

test("a sleeping body wakes as a mover comes near, and sleeps on once it is gone", () => {
  const w = flat(), r = layHuman(40, 0, 40, 0, true);
  for (let f = 0; f < 90 && r.awake; f++) r.step(w, STEP);
  expect(r.awake).toBe(false);
  const far: Mover = { from: at(40, 0, 20), to: at(40, 0, 20.2), boxes: CAR };
  r.movers = [far];
  expect(r.step(w, STEP)).toBe(false);
  const near: Mover = { from: at(40, 0, 36.5), to: at(40, 0, 36.7), boxes: CAR };
  r.movers = [near];
  r.step(w, STEP);
  expect(r.awake).toBe(true);
});

test("a car rolled into a fallen survivor shoves the body, and a watching client ends where the server's lies", () => {
  const h = new Harness({}, 5, 60, { dev: true, clips: NO_CLIPS, rigs: [], wild: false, map: writeMap(flatMap(4)) });
  try {
    h.host.setSetting("Knockdowns", "true");
    const s = h.join("walker", { latencyMs: 75 }), w = h.join("watcher");
    h.run(600);
    const a = h.world.ents, c = h.client(s)!, seen = h.client(w)!;
    const car = h.host.spawnVehicle("core:compact", 100, 65, 0);
    h.run(1000);
    a.setPosition(c.ent, 100, 0, 70);
    h.world.history.discontinuity(c.ent);
    a.setPosition(seen.ent, 94, 0, 72);
    h.world.history.discontinuity(seen.ent);
    h.run(600);
    expect(h.host.falls.knock(c.ent, 0, 0.5, 0, 0, 0, 1)).toBe(true);
    const remote = new RemoteSample(), drawn = new Corpses(h.world.anims, undefined, (k) => survivorKind(h.reg, k), (k) => solidOf(h.reg, k));
    const lay = [a.x[c.ent]!, a.z[c.ent]!];
    let inside = 0;
    h.run(1200, () => {
      a.vz[car] = a.z[car]! < 70 ? 4 : 0; a.vx[car] = 0;
      w.sampleRemote(remote);
      drawn.update(remote, w.world!, 0, 0, new Map(), w.corpseMotions);
      const r = h.host.falls.poseOf(c.ent) ? (h.host.falls as unknown as { down: Map<number, { fall: { ragdoll: Ragdoll } }> }).down.get(c.ent)!.fall.ragdoll : null;
      if (r) for (let i = 0; i < r.n; i++) if (Math.abs(r.x[i * 3]! - a.x[car]!) < 0.8 && r.x[i * 3 + 1]! > 0.3 && r.x[i * 3 + 1]! < 0.9 && Math.abs(r.x[i * 3 + 2]! - a.z[car]!) < 2) inside++;
    });
    expect(h.host.falls.isDown(c.ent) || h.host.falls.stats.rose === 1).toBe(true);
    // Shoved along the road, never through the car.
    expect(Math.hypot(a.x[c.ent]! - lay[0]!, a.z[c.ent]! - lay[1]!)).toBeGreaterThan(0.5);
    expect(inside).toBe(0);
    const f = drawn.humans.of(c.ent);
    if (f && f.down) expect(Math.hypot(f.x - a.x[c.ent]!, f.z - a.z[c.ent]!)).toBeLessThan(0.5);
  } finally { h.host.shutdown(); }
});

test("a rex is a solid a ragdoll meets, a dodo is not, and a rex walking into a lying body shoves it", () => {
  const rex = solidOf(reg, reg.index.get("core:rex")!), dodo = solidOf(reg, reg.index.get("core:dodo")!);
  expect(rex).not.toBeNull();
  expect(rex!.vehicle).toBe(false);
  expect(dodo).toBeNull();
  expect(solidOf(reg, reg.index.get("core:compact")!)!.vehicle).toBe(true);
  const w = flat(), r = layHuman(40, 0, 40, Math.PI / 2, true);
  for (let f = 0; f < 30; f++) r.step(w, STEP);
  let z = 32;
  for (let f = 0; f < 90; f++) {
    const next = z + 3 * STEP;
    r.movers = [{ from: at(40, 0, z), to: at(40, 0, next), boxes: rex!.boxes }];
    r.step(w, STEP);
    z = next;
  }
  expect(r.x[2]!).toBeGreaterThan(41);
});
