// A ragdoll meets moving solids, such as cars (shared/anim/ragdoll.ts movers): it is shoved by one driven into it, rides
// one it lies on, is shoved aside by a creature's legs, and wakes when one moving comes near where it sleeps.
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

test("a car shoves a fallen survivor, and a watcher ends where the server's body lies", () => {
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

test("a rex's legs shove a lying body aside and walk on; a dodo is no solid", () => {
  const rex = solidOf(reg, reg.index.get("core:rex")!), dodo = solidOf(reg, reg.index.get("core:dodo")!);
  expect(rex).not.toBeNull();
  expect(rex!.vehicle).toBe(false);
  expect(dodo).toBeNull();
  expect(solidOf(reg, reg.index.get("core:compact")!)!.vehicle).toBe(true);
  for (const [yaw, off] of [[0, 0], [Math.PI / 2, 0], [0, .4], [Math.PI / 2, .4]] as const) {
    const w = flat(), r = layHuman(40 + off, 0, 40, yaw, true);
    for (let f = 0; f < 30; f++) r.step(w, STEP);
    const x0 = r.x[0]!, z0 = r.x[2]!;
    let z = 32;
    for (let f = 0; f < 150; f++) {
      const next = z + 3 * STEP;
      r.movers = [{ from: at(40, 0, z), to: at(40, 0, next), boxes: rex!.boxes, aside: !rex!.vehicle }];
      r.step(w, STEP);
      z = next;
    }
    // Shoved out past the side of its legs, not carried along the 15 m it walked.
    expect(Math.abs(r.x[0]! - x0), `yaw ${yaw} off ${off}`).toBeGreaterThan(rex!.boxes[3]!);
    expect(Math.abs(r.x[2]! - z0), `yaw ${yaw} off ${off}`).toBeLessThan(1);
  }
});

test("a parked car, or one passing a metre off, leaves a sleeping body asleep", () => {
  for (const yaw of [0, Math.PI / 2]) {
    const w = flat(), r = layHuman(40, 0, 40, yaw, true);
    for (let f = 0; f < 90 && r.awake; f++) r.step(w, STEP);
    expect(r.awake).toBe(false);
    // Parked with its side touching the bounds the body is woken within.
    r.movers = [{ from: at(41.2, 0, 40), to: at(41.2, 0, 40), boxes: CAR }];
    expect(r.step(w, STEP)).toBe(false);
    for (let z = 30; z < 50; z += .5) {
      r.movers = [{ from: at(42.6, 0, z), to: at(42.6, 0, z + .5), boxes: CAR }];
      expect(r.step(w, STEP), `yaw ${yaw} at ${z}`).toBe(false);
    }
  }
});

/** A watcher's sample of one compact car: entity `id` of generation `gen` at (x, 0, z), turned `yaw` about up, at `tick`. */
function carSeen(remote: RemoteSample, id: number, gen: number, x: number, z: number, yaw: number, tick: number): RemoteSample {
  remote.count = 1; remote.tick = tick;
  remote.id[0] = id; remote.gen[0] = gen; remote.kind[0] = reg.index.get("core:compact")!;
  remote.x[0] = x; remote.y[0] = 0; remote.z[0] = z; remote.yaw[0] = yaw;
  remote.vehicleQx[0] = 0; remote.vehicleQy[0] = Math.sin(yaw / 2); remote.vehicleQz[0] = 0; remote.vehicleQw[0] = Math.cos(yaw / 2);
  return remote;
}

test("a watcher's step turns a car as it turned and starts a reused slot's car still", () => {
  const w = flat(), drawn = new Corpses(new Map() as never, undefined, () => false, (k) => solidOf(reg, k)), remote = new RemoteSample();
  drawn.update(carSeen(remote, 5, 1, 40, 40, 0, 100), w, 0, 0, new Map(), undefined);
  drawn.update(carSeen(remote, 5, 1, 40, 40, Math.PI / 4, 101), w, 0, 0, new Map(), undefined);
  const [turned] = drawn.humans.carsAround(40, 40, 101);
  // The step to tick 101 turns it from its turn at 100 to its turn at 101: a quarter of a half turn.
  const dot = turned!.from.qx * turned!.to.qx + turned!.from.qy * turned!.to.qy + turned!.from.qz * turned!.to.qz + turned!.from.qw * turned!.to.qw;
  expect(2 * Math.acos(Math.min(1, Math.abs(dot)))).toBeCloseTo(Math.PI / 4, 6);
  // The slot's next generation, a car 40 m off: it has no way yet, so it moves nothing it meets.
  drawn.update(carSeen(remote, 5, 2, 80, 40, 0, 102), w, 0, 0, new Map(), undefined);
  const [fresh] = drawn.humans.carsAround(80, 40, 102);
  expect(Math.hypot(fresh!.to.x - fresh!.from.x, fresh!.to.z - fresh!.from.z)).toBe(0);
});

test("a watcher's step meets a braking car where it was each tick", () => {
  const w = flat(), drawn = new Corpses(new Map() as never, undefined, () => false, (k) => solidOf(reg, k)), remote = new RemoteSample();
  // Seen twice a tick: 15 m/s for two ticks, then stopped dead.
  const z = [40, 40.25, 40.5, 40.75, 41, 41, 41, 41];
  z.forEach((at, k) => drawn.update(carSeen(remote, 9, 1, 40, at, 0, 100 + k / 2), w, 0, 0, new Map(), undefined));
  // The step to 102 meets it as it went from 101 to 102: 0.5 m, then nothing after.
  let [m] = drawn.humans.carsAround(40, 41, 102);
  expect(m!.to.z - m!.from.z).toBeCloseTo(0.5, 9);
  [m] = drawn.humans.carsAround(40, 41, 103);
  expect(m!.to.z - m!.from.z).toBeCloseTo(0, 9);
});

test("at any frame rate a watcher's step meets a moving, turning car as it went", () => {
  const w = flat(), turn = (1.15 * Math.PI) / 180;
  for (const fps of [30, 60, 75, 90, 120, 144]) {
    const drawn = new Corpses(new Map() as never, undefined, () => false, (k) => solidOf(reg, k)), remote = new RemoteSample();
    // 40 cm and 1.15 degrees a tick, seen once a frame.
    for (let r = 100; r <= 112; r += 30 / fps) drawn.update(carSeen(remote, 7, 1, 40, 40 + 0.4 * (r - 100), turn * (r - 100), r), w, 0, 0, new Map(), undefined);
    const [m] = drawn.humans.carsAround(40, 43.2, 108);
    expect(m!.to.z - m!.from.z, `${fps}`).toBeCloseTo(0.4, 4);
    const dot = m!.from.qx * m!.to.qx + m!.from.qy * m!.to.qy + m!.from.qz * m!.to.qz + m!.from.qw * m!.to.qw;
    expect(2 * Math.acos(Math.min(1, Math.abs(dot))), `${fps}`).toBeCloseTo(turn, 4);
  }
});

test("a catch-up step meets a car where it was then, though it has driven on", () => {
  const w = flat(), drawn = new Corpses(new Map() as never, undefined, () => false, (k) => solidOf(reg, k)), remote = new RemoteSample();
  // A metre a tick from tick 0; drawn now at tick 15, nine metres past where it was at tick 6.
  for (let r = 0; r <= 15; r += 0.5) drawn.update(carSeen(remote, 3, 1, 40, 40 + r, 0, r), w, 0, 0, new Map(), undefined);
  const [m] = drawn.humans.carsAround(40, 46, 6);
  expect(m).toBeDefined();
  expect([m!.from.z, m!.to.z]).toEqual([45, 46]);
});
