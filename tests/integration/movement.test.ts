import { expect, test } from "bun:test";
import { RemoteSample } from "../../client/core/session.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_JUMP, BTN_SPRINT, MF_WINDED, MODE_GHOST, MODE_SWIM, MODE_WALK, STAMINA_UNITS } from "../../shared/sim/character.ts";
import { PROVING_POOL } from "../../shared/world/proving.ts";
import { Harness } from "../fixtures/net.ts";

/** One cheating survivor on a dev server, with what its server-side body is. */
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
  // Toward the pool and around it for 40 seconds, looking up and down, sprinting and jumping at random.
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
  // Laps of the plaza, sprint held for forty seconds: winded, recovered, winded again.
  for (let i = 0; i < 80; i++) {
    pilot.moveZ = 1;
    pilot.yaw = i * 0.5;
    h.run(500, () => (winded ||= (s.own.mflags & MF_WINDED) !== 0));
  }
  expect(winded).toBe(true);
  expect(s.stats.corrections).toBe(0);
  expect(s.stats.stateCorrections).toBe(0);
  // The client runs a few ticks ahead, so while stamina is recovering its number is a
  // little higher than the server's. No correction in forty seconds is what shows they
  // agree tick for tick; once both are full, the numbers themselves match.
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

  // 100 points in speed at 1.5% each: two and a half times as fast.
  pilot.yaw = Math.PI;
  expect(h.say(s, "setstat speed 100")).toEqual(["speed: 100 points, value 2.5"]);
  expect(ents.speedQ[e]).toBe(2500);
  expect(s.own.speedQ).toBe(2500);
  h.run(500);
  const z0 = ents.z[e]!;
  const c0 = s.stats.corrections;
  h.run(1000);
  expect(z0 - ents.z[e]!).toBeCloseTo(4.5 * 2.5, 0);
  // The change itself cost at most a couple of corrections; nothing after it.
  expect(c0 - before.corrections).toBeLessThanOrEqual(2);
  expect(s.stats.corrections).toBe(c0);
  // Stamina follows the same path: 50 points at 10% each.
  expect(h.say(s, "setstat stamina 50")).toEqual(["stamina: 50 points, value 600"]);
  expect(s.own.staminaMax).toBe(600);
  pilot.moveZ = 0;
  h.run(1000);
  expect(s.own.z).toBe(ents.z[e]!);
  // Bad input changes nothing.
  expect(h.say(s, "setstat luck 5")[0]).toContain("unknown stat");
  expect(h.say(s, "setstat speed 256")[0]).toContain("0 to 255");
  expect(h.say(s, "setstat speed 1.5")[0]).toContain("0 to 255");
  expect(ents.speedQ[e]).toBe(2500);
});

test("ghost passes through walls and is still seen; walk and tp refuse solid space", () => {
  const { h, s, pilot, ents, e } = admin();
  const bo = h.join("bo");
  h.run(300);
  // The thin wall of the proving ground stands north-east of the spawn; walk into the big block instead.
  const block = h.world.structs.chunks.flatMap((t, chunk) => (t ? [...t.kind.subarray(0, t.high)].map((k, slot) => ({ k, chunk, slot, t })) : [])).find((r) => r.k === h.reg.index.get("core:block"))!;
  const bx = block.t.x[block.slot]!;
  const by = block.t.y[block.slot]!;
  const bz = block.t.z[block.slot]!;

  // A teleport into the block is refused; next to it is fine.
  expect(h.say(s, `tp ${bx} ${by} ${bz}`)).toEqual(["that spot is inside something"]);
  expect(h.say(s, `tp ${bx} ${bz - 3}`)[0]).toContain(`at ${bx}`);
  expect(ents.x[e]).toBe(bx);
  expect(h.say(s, "tp 99999 5")[0]).toContain("outside the map");
  expect(h.say(s, "tp 1")[0]).toContain("usage");
  // A teleport is shown at once, not glided to.
  expect([s.smoothX, s.smoothY, s.smoothZ]).toEqual([0, 0, 0]);
  expect(s.own.x).toBe(bx);

  // Walking north, the block stops a body.
  pilot.moveZ = 1;
  h.run(1500);
  expect(ents.z[e]!).toBeLessThan(bz - 1.35);
  // As a ghost it goes straight through to the far side, and bo still sees it.
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
  // Inside the block: leaving ghost mode is refused, so no body is ever left in solid space.
  h.say(s, `tp ${bx} ${by} ${bz}`);
  expect(h.say(s, "walk")).toEqual(["you are inside something; move to open space first"]);
  expect(ents.mode[e]).toBe(MODE_GHOST);
  h.say(s, `tp ${bx} ${by + 6} ${bz}`);
  expect(h.say(s, "walk")).toEqual(["ghost off"]);
  h.run(2000);
  // It fell onto the block (or whatever is stacked on it) and stands there.
  expect(ents.mode[e]).toBe(MODE_WALK);
  expect(ents.y[e]!).toBeGreaterThan(by + 0.99);
  expect(ents.y[e]!).toBeLessThan(by + 5.5);
  expect(ents.vy[e]).toBe(0);
  expect(s.own.y).toBe(ents.y[e]!);
  // Without cheats none of it works.
  expect(h.say(bo, "ghost")[0]).toContain("denied");
  expect(h.say(bo, "tp 10 10")[0]).toContain("denied");
  expect(h.say(bo, "setstat speed 255")[0]).toContain("denied");
});

test("a small correction is hidden by an offset that fades; the drawn position never jumps", () => {
  const h = new Harness();
  const s = h.join("ada", { latencyMs: 30 });
  h.run(500);
  const ents = h.world.ents;
  const e = h.ent(s);
  const drawn = (): number => s.own.x + s.smoothX;
  const before = drawn();
  // The server moves the body half a metre: something the client could not have predicted.
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
  expect(biggest).toBeLessThan(0.12); // and it glides: no frame moves it more than a walking step
  expect(s.smoothX).toBe(0);
  expect(drawn()).toBe(ents.x[e]!);
  expect(drawn() - before).toBeCloseTo(0.5, 5);
});
