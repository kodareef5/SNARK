import { expect, test } from "bun:test";
import { RemoteSample } from "../../client/core/session.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_JUMP, BTN_SPRINT, MF_WINDED, MODE_FLY, MODE_GHOST, MODE_SWIM, MODE_WALK, STAMINA_UNITS } from "../../shared/sim/character.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { capsuleFree, groundUnder } from "../../shared/world/collide.ts";
import { PROVING_POOL } from "../../shared/world/proving.ts";
import { Harness } from "../fixtures/net.ts";

function admin(link = {}) {
  const h = new Harness({}, 1, 60, { dev: true });
  const s = h.join("ada", link);
  h.run(500);
  expect(h.say(s, "enablecheats")).toEqual(["cheats enabled"]);
  return { h, s, pilot: h.pilots[0]!, ents: h.world.ents, e: h.ent(s) };
}

test("swimming is predicted exactly: wading in, diving, surfacing and climbing out cost no corrections", () => {
  const { h, s, pilot, ents, e } = admin({ latencyMs: 60 });
  expect(h.say(s, `tp ${PROVING_POOL.x + 33} ${PROVING_POOL.z}`)[0]).toContain("at 205");
  h.run(500);
  const settled = s.stats.corrections;
  const modes = new Set<number>();
  const rng = new Rng(3);
  for (let i = 0; i < 80; i++) {
    const toPool = Math.atan2(PROVING_POOL.x - s.own.x, PROVING_POOL.z - s.own.z);
    pilot.yaw = i % 5 === 4 ? toPool + Math.PI : toPool + rng.range(-0.6, 0.6);
    pilot.pitch = rng.range(-1.2, 1.2);
    pilot.moveZ = 1;
    pilot.moveX = rng.range(-0.5, 0.5);
    pilot.buttons = (rng.int(3) === 0 ? BTN_JUMP : 0) | (rng.int(2) === 0 ? BTN_SPRINT : 0);
    h.run(500, () => modes.add(s.own.mode));
  }
  expect(modes.has(MODE_SWIM)).toBe(true);
  expect(modes.has(MODE_WALK)).toBe(true);
  expect(s.stats.corrections - settled).toBe(0);
  expect(s.stats.stateCorrections).toBeLessThanOrEqual(2); // the teleport and nothing since
  pilot.moveX = pilot.moveZ = pilot.buttons = 0;
  h.run(1000);
  expect(s.own.x).toBe(ents.x[e]!);
  expect(s.own.y).toBe(ents.y[e]!);
  expect(s.own.mode).toBe(ents.mode[e]!);
});

test("running out of breath is predicted, not corrected", () => {
  const h = new Harness();
  const s = h.join("runner", { latencyMs: 40 });
  h.run(500);
  const pilot = h.pilots[0]!;
  const ents = h.world.ents;
  const e = h.ent(s);
  pilot.buttons = BTN_SPRINT;
  let winded = false;
  for (let i = 0; i < 80; i++) {
    pilot.moveZ = 1;
    pilot.yaw = i * 0.5;
    h.run(500, () => (winded ||= (s.own.mflags & MF_WINDED) !== 0));
  }
  expect(winded).toBe(true);
  expect(s.stats.corrections).toBe(0);
  expect(s.stats.stateCorrections).toBe(0);
  // The client runs a few ticks ahead, so its recovering stamina reads a little higher than the server's until both are full.
  pilot.moveZ = 0;
  pilot.buttons = 0;
  h.run(1000);
  expect(s.own.stamina).toBeGreaterThan(ents.stamina[e]!);
  h.run(13000);
  expect(s.own.stamina).toBe(100 * STAMINA_UNITS);
  expect(ents.stamina[e]).toBe(100 * STAMINA_UNITS);
  expect(s.stats.stateCorrections).toBe(0);
});

test("a stat change reaches the predicted body as a correction, and then prediction is exact again", () => {
  const { h, s, pilot, ents, e } = admin({ latencyMs: 50 });
  pilot.moveZ = 1;
  h.run(1000);
  const before = { corrections: s.stats.corrections, z: ents.z[e]! };
  h.run(1000);
  const walked = ents.z[e]! - before.z;
  expect(walked).toBeCloseTo(4.5, 1);

  // 100 points in speed at 1.5% each is 2.5 times as fast.
  pilot.yaw = Math.PI;
  expect(h.say(s, "setstat speed 100")).toEqual(["speed: 100 points, value 2.5"]);
  expect(ents.speedQ[e]).toBe(2500);
  expect(s.own.speedQ).toBe(2500);
  h.run(500);
  const z0 = ents.z[e]!;
  const c0 = s.stats.corrections;
  h.run(1000);
  expect(z0 - ents.z[e]!).toBeCloseTo(4.5 * 2.5, 0);
  expect(c0 - before.corrections).toBeLessThanOrEqual(2);
  expect(s.stats.corrections).toBe(c0);
  // 50 points in stamina at 10% each.
  expect(h.say(s, "setstat stamina 50")).toEqual(["stamina: 50 points, value 600"]);
  expect(s.own.staminaMax).toBe(600);
  pilot.moveZ = 0;
  h.run(1000);
  expect(s.own.z).toBe(ents.z[e]!);
  expect(h.say(s, "setstat luck 5")[0]).toContain("unknown stat");
  expect(h.say(s, "setstat speed 256")[0]).toContain("0 to 255");
  expect(h.say(s, "setstat speed 1.5")[0]).toContain("0 to 255");
  expect(ents.speedQ[e]).toBe(2500);
});

test("ghost passes through walls and is still seen; walk and tp refuse solid space", () => {
  const { h, s, pilot, ents, e } = admin();
  const bo = h.join("bo");
  h.run(300);
  // Use the proving ground's big block rather than its thin wall.
  const block = h.world.structs.chunks.flatMap((t, chunk) => (t ? [...t.kind.subarray(0, t.high)].map((k, slot) => ({ k, chunk, slot, t })) : [])).find((r) => r.k === h.reg.index.get("core:block"))!;
  const bx = block.t.x[block.slot]!;
  const by = block.t.y[block.slot]!;
  const bz = block.t.z[block.slot]!;

  expect(h.say(s, `tp ${bx} ${by} ${bz}`)).toEqual(["that spot is inside something"]);
  expect(h.say(s, `tp ${bx} ${bz - 3}`)[0]).toContain(`at ${bx}`);
  expect(ents.x[e]).toBe(bx);
  expect(h.say(s, "tp 99999 5")[0]).toContain("outside the map");
  expect(h.say(s, "tp 1")[0]).toContain("usage");
  // A teleport is drawn at once, with no smoothing offset.
  expect([s.smoothX, s.smoothY, s.smoothZ]).toEqual([0, 0, 0]);
  expect(s.own.x).toBe(bx);

  pilot.moveZ = 1;
  h.run(1500);
  expect(ents.z[e]!).toBeLessThan(bz - 1.35);
  pilot.moveZ = 0;
  expect(h.say(s, "ghost")).toEqual(["ghost on"]);
  expect(ents.mode[e]).toBe(MODE_GHOST);
  pilot.moveZ = 1;
  h.run(400);
  pilot.moveZ = 0;
  h.run(300);
  expect(ents.z[e]!).toBeGreaterThan(bz + 1.4);
  const seen = new RemoteSample();
  bo.sampleRemote(seen);
  expect(seen.count).toBe(1);
  expect(Math.abs(seen.z[0]! - ents.z[e]!)).toBeLessThan(0.01);
  h.say(s, `tp ${bx} ${by} ${bz}`);
  expect(h.say(s, "walk")).toEqual(["you are inside something; move to open space first"]);
  expect(ents.mode[e]).toBe(MODE_GHOST);
  h.say(s, `tp ${bx} ${by + 6} ${bz}`);
  expect(h.say(s, "walk")).toEqual(["ghost off"]);
  h.run(2000);
  // It lands on the block, or on something stacked on it.
  expect(ents.mode[e]).toBe(MODE_WALK);
  expect(ents.y[e]!).toBeGreaterThan(by + 0.99);
  expect(ents.y[e]!).toBeLessThan(by + 5.5);
  expect(ents.vy[e]).toBe(0);
  expect(s.own.y).toBe(ents.y[e]!);
  expect(h.say(bo, "ghost")[0]).toContain("denied");
  expect(h.say(bo, "tp 10 10")[0]).toContain("denied");
  expect(h.say(bo, "setstat speed 255")[0]).toContain("denied");
});

test("fly is stopped by what is built and by the ground, where a ghost goes through; it is predicted with no corrections, and walk drops the flyer as any fall", () => {
  const { h, s, pilot, ents, e } = admin({ latencyMs: 60 });
  const block = h.world.structs.chunks.flatMap((t, chunk) => (t ? [...t.kind.subarray(0, t.high)].map((k, slot) => ({ k, chunk, slot, t })) : [])).find((r) => r.k === h.reg.index.get("core:block"))!;
  const [bx, bz] = [block.t.x[block.slot]!, block.t.z[block.slot]!];
  const p = h.reg.move[ents.kind[e]!]!;
  const ground = (): number => groundUnder(h.world.hf, ents.x[e]!, ents.z[e]!, p.radius);
  expect(h.say(s, `tp ${bx} ${bz - 4}`)[0]).toContain(`at ${bx}`);
  expect(h.say(s, "fly")).toEqual(["flying"]);
  expect([ents.mode[e], s.own.mode]).toEqual([MODE_FLY, MODE_FLY]);
  h.run(500);
  const settled = s.stats.corrections;
  let inside = 0;
  const watch = (): void => void (capsuleFree(h.world, ents.x[e]!, ents.y[e]!, ents.z[e]!, p.radius, p.height) || inside++);
  // Sprinting north, level, at the block: it stops against its south face.
  [pilot.yaw, pilot.pitch, pilot.moveZ, pilot.buttons] = [0, 0, 1, BTN_SPRINT];
  h.run(1500, watch);
  expect(ents.z[e]!).toBeLessThan(bz - 1 - p.radius + 0.01);
  // Straight down: it stops on the ground.
  pilot.pitch = -Math.PI / 2;
  h.run(1000, watch);
  expect(ents.y[e]!).toBeCloseTo(ground(), 2);
  // Up, as fast as a ghost rises, 12 m a second, with nothing above.
  [pilot.pitch, pilot.moveZ, pilot.buttons] = [0, 0, BTN_JUMP];
  h.run(1000, watch);
  const up = ents.y[e]! - ground();
  expect([up > 10, up <= 12.01]).toEqual([true, true]);
  pilot.buttons = 0;
  h.run(500, watch);
  expect([inside, s.stats.corrections - settled]).toEqual([0, 0]);
  // Walk drops it, and the fall hurts as any fall from there does.
  const rec = h.host.records.byPid.get(ents.pid[e]!)!;
  const health = h.host.survival.value(rec, V_HEALTH);
  expect(h.say(s, "walk")).toEqual(["flying off"]);
  h.run(3000);
  expect([ents.mode[e], ents.y[e]! - ground() < 0.01, h.host.survival.value(rec, V_HEALTH) < health]).toEqual([MODE_WALK, true, true]);
  expect(h.say(s, "walk")).toEqual(["you are neither a ghost nor flying"]);

  // A ghost from the same place goes into the block and on through it, and down through the ground.
  expect(h.say(s, `tp ${bx} ${bz - 4}`)[0]).toContain(`at ${bx}`);
  expect(h.say(s, "ghost")).toEqual(["ghost on"]);
  [pilot.yaw, pilot.pitch, pilot.moveZ] = [0, 0, 1];
  h.run(1000);
  expect(ents.z[e]!).toBeGreaterThan(bz + 1 + p.radius);
  pilot.pitch = -Math.PI / 2;
  h.run(500);
  expect(ents.y[e]!).toBeLessThan(ground() - 2);
  // Flying is refused inside the ground, as walking is.
  expect(h.say(s, "fly")[0]).toContain("inside something");
  expect(ents.mode[e]).toBe(MODE_GHOST);
});

test("a ghost holding sprint ramps to 600 m/s and back to 12 alike on both sides: no correction over a clean link", () => {
  const { h, s, pilot, ents, e } = admin({ latencyMs: 60 });
  expect(h.say(s, "ghost")).toEqual(["ghost on"]);
  h.run(500);
  const settled = s.stats.corrections;
  const speed = (): number => Math.hypot(ents.vx[e]!, ents.vy[e]!, ents.vz[e]!);
  let most = 0;
  [pilot.pitch, pilot.moveZ, pilot.buttons] = [0.2, 1, BTN_SPRINT];
  h.run(5000, (now) => {
    pilot.yaw = now / 700;
    most = Math.max(most, speed());
  });
  pilot.buttons = 0;
  h.run(500);
  expect([most, speed(), s.stats.corrections - settled]).toEqual([expect.closeTo(600, 2), expect.closeTo(12, 3), 0]);
  pilot.moveZ = 0;
  h.run(1000);
  expect([s.own.x, s.own.y, s.own.z, s.stats.corrections - settled]).toEqual([ents.x[e]!, ents.y[e]!, ents.z[e]!, 0]);
});

test("a small correction is hidden by an offset that fades; the drawn position never jumps", () => {
  const h = new Harness();
  const s = h.join("ada", { latencyMs: 30 });
  h.run(500);
  const ents = h.world.ents;
  const e = h.ent(s);
  const drawn = (): number => s.own.x + s.smoothX;
  const before = drawn();
  ents.setPosition(e, ents.x[e]! + 0.5, ents.y[e]!, ents.z[e]!);
  let last = before;
  let biggest = 0;
  let sawOffset = false;
  h.run(1000, () => {
    biggest = Math.max(biggest, Math.abs(drawn() - last));
    last = drawn();
    sawOffset ||= s.smoothX < -0.3;
  });
  expect(s.stats.corrections).toBe(1);
  expect(sawOffset).toBe(true); // just after the correction the body is still drawn near where it was
  expect(biggest).toBeLessThan(0.12); // no frame moves it more than a walking step
  expect(s.smoothX).toBe(0);
  expect(drawn()).toBe(ents.x[e]!);
  expect(drawn() - before).toBeCloseTo(0.5, 5);
});
