// A pteranodon's own flight through the server and a client (planning/reference/flyers-plan.md, FL1), at ARK's 1x numbers
// (assets/source/core/creatures/pteranodon/ref/FUNCTIONS.md, sections 3, 4 and 9). Until its client gets ARK's keys (FL2)
// a pilot holds jump to keep it up, as the client will hold it for a press of Space.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostOptions } from "../../server/host.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_BRAKE, BTN_JUMP, BTN_ROLL, BTN_SPRINT, MF_NO_JUMP, MF_WINDED, MODE_FLYER, MODE_WALK } from "../../shared/sim/character.ts";
import { V_HEALTH, V_TORPOR } from "../../shared/sim/vitals.ts";
import { capsuleFree, groundUnder } from "../../shared/world/collide.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const PTERA = id("pteranodon");
const p = reg.tamedMove[PTERA]!;

/**
 * Ada, an admin on a link of `latencyMs`, on a saddled pteranodon of her tribe that stood beside her on the plaza south of
 * the proving ground's blocks.
 */
function ridden(latencyMs = 60, host: HostOptions = {}) {
  const h = new Harness({}, 1, 60, { dev: true, ...host });
  const s = h.join("ada", { latencyMs });
  h.run(500);
  h.say(s, "enablecheats");
  h.say(s, "tp 256 244");
  h.run(300);
  const ents = h.world.ents;
  const c = h.client(s)!;
  const me = h.host.records.byPid.get(c.pid)!;
  const e = h.host.spawnCreature("core:pteranodon", 256, 248, 1);
  const rec = h.host.records.byPid.get(ents.pid[e]!)!;
  rec.team = me.team;
  rec.saddle = id("saddle_pteranodon");
  h.host.refreshBody(rec);
  h.run(300);
  expect(h.host.riding.mount(c, e)).toBe(RESULT_OK);
  // A new body's stamina is 100 until its stamina stat raises it; its 150 is full in a few seconds.
  h.run(7000);
  expect([s.driving, s.own.kind, ents.mode[e], ents.stamina[e]]).toEqual([e, PTERA, MODE_WALK, 150000]);
  const pilot = h.pilots[0]!;
  const ground = (): number => groundUnder(h.world.hf, ents.x[e]!, ents.z[e]!, p.radius);
  const health = (): number => h.host.survival.value(rec, V_HEALTH);
  return { h, s, c, pilot, ents, e, rec, me, ground, health };
}

type Ride = ReturnType<typeof ridden>;

/** Every frame, whether the mount is inside anything. */
const watcher = (r: Ride) => {
  let inside = 0;
  return { watch: (): void => void (capsuleFree(r.h.world, r.ents.x[r.e]!, r.ents.y[r.e]!, r.ents.z[r.e]!, p.radius, p.height) || inside++), inside: () => inside };
};

/**
 * Steers by the look alone toward (x, up metres over the ground there, z), its jump held, until within `near` metres or
 * `ms` have passed. Says whether it got there.
 */
function flyTo(r: Ride, x: number, up: number, z: number, buttons = 0, each?: () => void, near = 2.5, ms = 20000): boolean {
  const { h, s, pilot } = r;
  const y = groundUnder(h.world.hf, x, z, p.radius) + up;
  pilot.moveZ = 1;
  pilot.buttons = BTN_JUMP | buttons;
  for (let t = 0; t < ms; t += 100) {
    const [dx, dy, dz] = [x - s.own.x, y - s.own.y, z - s.own.z];
    if (Math.hypot(dx, dy, dz) < near) return true;
    pilot.yaw = Math.atan2(dx, dz);
    pilot.pitch = Math.max(-1.3, Math.min(1.3, Math.atan2(dy, Math.hypot(dx, dz))));
    h.run(100, each);
  }
  return false;
}

/** Takes off, climbs by the look to `up` metres over the plaza north of where it stood, and hovers there. */
function climb(r: Ride, up: number): void {
  const { h, pilot, ents, e } = r;
  pilot.buttons = BTN_JUMP;
  h.run(1500);
  expect(ents.mode[e]).toBe(MODE_FLYER);
  expect(flyTo(r, 256, up, 230)).toBe(true);
  pilot.moveZ = 0;
  h.run(3000);
}

test("ridden on a 60 ms link, it takes off, flies a course round the blocks climbing and diving by the look, hovers on the brake, rolls, and lands, with no corrections and never inside anything", () => {
  const r = ridden(60);
  const { h, s, pilot, ents, e, ground } = r;
  const w = watcher(r);
  const settled = s.stats.corrections;
  // Jump held: it rises to a hover a few feet up and stays.
  pilot.buttons = BTN_JUMP;
  h.run(2000, w.watch);
  const hover = ents.y[e]! - ground();
  expect([ents.mode[e], hover > 1.2, hover < 1.6, Math.hypot(ents.vx[e]!, ents.vy[e]!, ents.vz[e]!)]).toEqual([MODE_FLYER, true, true, 0]);
  // Round the stacked blocks and the crate west of them, the house and the thin wall's west end: up over them, down past
  // their sides, low across the plaza and up again, at its flying pace.
  const legs: [number, number, number][] = [[262, 8, 262], [247, 2.5, 267], [244, 9, 252], [256, 3, 255], [270, 14, 250], [272, 3, 266], [252, 7, 280], [234, 9, 268], [246, 2.5, 258]];
  const reached = legs.map(([x, up, z]) => flyTo(r, x, up, z, 0, w.watch));
  expect(reached).toEqual(legs.map(() => true));
  // A barrel roll from a hover: a burst along its look, 90 stamina, and none again for 7 s.
  pilot.moveZ = 0;
  pilot.pitch = 0;
  h.run(2000, w.watch);
  const before = ents.stamina[e]!;
  pilot.buttons = BTN_JUMP | BTN_ROLL;
  let burst = 0;
  h.run(200, () => {
    w.watch();
    burst = Math.max(burst, Math.hypot(ents.vx[e]!, ents.vy[e]!, ents.vz[e]!));
  });
  pilot.buttons = BTN_JUMP;
  expect([burst, before - ents.stamina[e]! > 90000, ents.rollWait[e]! > 180]).toEqual([expect.closeTo(p.rollBurst, 0), true, true]);
  h.run(2000, w.watch);
  // A sprint north, high over the pillars, and back at its pace: what is left of 150 after the roll.
  let fastest = 0;
  const pace = (): void => {
    w.watch();
    fastest = Math.max(fastest, Math.hypot(ents.vx[e]!, ents.vy[e]!, ents.vz[e]!));
  };
  expect([flyTo(r, 262, 14, 320, BTN_SPRINT, pace, 4), flyTo(r, 262, 10, 262, 0, w.watch, 4)]).toEqual([true, true]);
  // Tamed it sprints at 1,897.5 units a second.
  expect(fastest).toBeCloseTo(p.flySpeed * p.flySprintMul, 1);
  // The brake holds it still in the air.
  pilot.buttons = BTN_JUMP | BTN_BRAKE;
  h.run(1000, w.watch);
  const [bx, by, bz] = [ents.x[e]!, ents.y[e]!, ents.z[e]!];
  h.run(1000, w.watch);
  expect([ents.x[e], ents.y[e], ents.z[e], ents.mode[e]]).toEqual([bx, by, bz, MODE_FLYER]);
  // Let go of its jump, it goes down and lands under it, unhurt.
  const health = r.health();
  pilot.moveZ = 0;
  pilot.buttons = 0;
  h.run(3000, w.watch);
  expect([ents.mode[e], ents.y[e]! - ground() < 0.01, r.health()]).toEqual([MODE_WALK, true, health]);
  expect([w.inside(), s.stats.corrections - settled]).toEqual([0, 0]);
  h.run(500);
  expect([s.own.x, s.own.y, s.own.z, s.own.mode, s.own.stamina]).toEqual([ents.x[e]!, ents.y[e]!, ents.z[e]!, ents.mode[e]!, ents.stamina[e]!]);
});

test("sprinted until spent, it is put down unhurt with its rider on it, gets nothing back in the air nor for 10 s after, and predicts it all with no corrections", () => {
  const r = ridden(60);
  const { h, s, c, pilot, ents, e } = r;
  climb(r, 20);
  const settled = s.stats.corrections;
  const health = r.health();
  // Sprinting level round a wide circle over the plaza, 47 m across at 19 m/s: 150 lasts 25 s.
  pilot.moveZ = 1;
  pilot.pitch = 0;
  pilot.buttons = BTN_JUMP | BTN_SPRINT;
  const start = h.now;
  // Sprinting spends 6 a second, 200 units a tick, of what the climb left.
  const lasts = (ents.stamina[e]! / 200 / 30) * 1000;
  let spentAt = -1;
  let low = Infinity;
  for (let t = 0; t < 40000 && ents.mode[e] === MODE_FLYER; t += 100) {
    h.run(100, (now) => {
      pilot.yaw = Math.PI + (now - start) / 2500;
      if (spentAt < 0 && (ents.mflags[e]! & MF_WINDED) !== 0) spentAt = now - start;
      if (ents.mode[e] === MODE_FLYER) low = Math.min(low, ents.stamina[e]!);
    });
    // Put down, it stands where it set down.
    if (spentAt > 0) pilot.moveZ = 0;
  }
  // Spent when that runs out, after the link's delay, and down a few seconds later.
  expect([lasts > 24000, spentAt > lasts, spentAt < lasts + 500, h.now - start - spentAt < 4000]).toEqual([true, true, true, true]);
  expect([low, ents.mode[e], ents.y[e]! - r.ground() < 0.01, r.health(), c.drive]).toEqual([0, MODE_WALK, true, health, e]);
  // On the ground with its rider: nothing back for 10 s, then its regeneration.
  pilot.moveZ = 0;
  pilot.buttons = 0;
  h.run(9500);
  expect(ents.stamina[e]).toBe(0);
  h.run(1500);
  expect(ents.stamina[e]!).toBeGreaterThan(0);
  expect(s.stats.corrections - settled).toBe(0);
});

test("knocked out, caught by a bola or let go of by its rider in the air, it stops flying, falls and lands hurt; the bola'd one's rider stays on, the others' are put off", () => {
  const seen = (["knocked out", "bola", "let go"] as const).map((how) => {
    const r = ridden(60);
    const { h, s, c, ents, e, rec } = r;
    climb(r, 20);
    const health = r.health();
    if (how === "knocked out") h.host.survival.add(rec, V_TORPOR, rec.vitals!.max[V_TORPOR]! / 1e6 + 1);
    else if (how === "bola") h.host.buffs.give(rec, id("entangled"), 0, 30);
    else h.host.riding.dismount(c);
    let falling = false;
    h.run(4000, () => void (falling ||= ents.mode[e] === MODE_WALK && ents.vy[e]! < -10));
    return [how, falling, ents.mode[e], ents.y[e]! - r.ground() < 0.01, r.health() < health, c.drive === e, s.driving === e];
  });
  expect(seen).toEqual([
    ["knocked out", true, MODE_WALK, true, true, false, false],
    ["bola", true, MODE_WALK, true, true, true, true],
    ["let go", true, MODE_WALK, true, true, false, false],
  ]);
});

test("too heavy, it does not take off, and loaded so in the air it is put down unhurt", () => {
  const r = ridden(60);
  const { h, pilot, ents, e, rec } = r;
  // 260 stones of 0.5 over its 120 of weight.
  h.host.items.mint(rec, id("stone"), 260);
  h.run(300);
  expect(ents.mflags[e]! & MF_NO_JUMP).toBe(MF_NO_JUMP);
  pilot.buttons = BTN_JUMP;
  h.run(2000);
  expect([ents.mode[e], ents.y[e]! - r.ground() < 0.01]).toEqual([MODE_WALK, true]);
  h.host.items.burnItem(rec, id("stone"), 260);
  h.run(300);
  expect(ents.mflags[e]! & MF_NO_JUMP).toBe(0);
  climb(r, 20);
  const health = r.health();
  h.host.items.mint(rec, id("stone"), 260);
  h.run(6000);
  expect([ents.mode[e], ents.y[e]! - r.ground() < 0.01, r.health()]).toEqual([MODE_WALK, true, health]);
});

test("saved flying 30 m up and loaded without its rider, it does not fall: its jump let go, it goes down and sets down unhurt", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-flight-"));
  try {
    const dbPath = join(dir, "world.db");
    const r = ridden(60, { dbPath });
    climb(r, 30);
    const pid = r.rec.pid;
    const health = r.health();
    r.h.host.shutdown();
    const h = new Harness({}, 1, 60, { dev: true, dbPath });
    h.join("bob");
    const ents = h.world.ents;
    const e = h.host.records.entOf.get(pid)!;
    const rec = h.host.records.byPid.get(pid)!;
    const ground = (): number => groundUnder(h.world.hf, ents.x[e]!, ents.z[e]!, p.radius);
    expect([ents.mode[e], ents.y[e]! - ground() > 25]).toEqual([MODE_FLYER, true]);
    // No faster down than its descent, twice its flying speed, and in flight until it touches.
    let fastest = 0;
    let early = false;
    h.run(8000, () => {
      fastest = Math.max(fastest, -ents.vy[e]!);
      early ||= ents.mode[e] !== MODE_FLYER && ents.y[e]! - ground() > 0.01;
    });
    expect([fastest <= 2 * p.flySpeed + 1e-4, early, ents.mode[e], ents.y[e]! - ground() < 0.01, h.host.survival.value(rec, V_HEALTH)]).toEqual([true, false, MODE_WALK, true, health]);
    h.host.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
