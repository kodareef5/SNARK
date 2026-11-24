// What a launcher and its rocket are heard by (client/core/sound/actions.ts): the launch at the launcher, a loop that
// follows each round in flight until its blast, and the blast by what blew and how far, as late as sound takes to come.

import { expect, test } from "bun:test";
import { ActionSounds, ROCKET_LOOPS, type OwnState } from "../../client/core/sound/actions.ts";
import type { Hear } from "../../client/core/sound/bodies.ts";
import { SOUND_SPEED } from "../../client/core/sound/supply.ts";
import { RemoteSample, type CombatEvent, type LocalShot } from "../../client/core/session.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { EVENT_BLAST, EVENT_ROCKET } from "../../shared/net/protocol.ts";
import { V_COUNT, Vitals } from "../../shared/sim/vitals.ts";
import { CUES, KEYS, candidates } from "../../shared/sound/cues.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const ROCKET = reg.index.get("core:rocket")!;
const LAUNCHER = reg.index.get("core:rocket_launcher")!;
const GRENADE = reg.index.get("core:grenade")!;
const SPEED = reg.ammoSpeed[ROCKET]!;

function event(kind: number, more: Partial<CombatEvent> = {}): CombatEvent {
  return { kind, x: 0, y: 0, z: 0, zone: 0, damage: 0, kill: false, blocked: false, bearing: 0, side: false, silenced: false, name: "", item: 0, far: 0, level: 0, xp: 0, flies: false, vx: 0, vy: 0, vz: 0, back: 0, rays: 1, seed: 0, id: 0, own: false, surface: 0, made: 0, ...more };
}

/** The sounds of a player standing at the origin, and what they asked to be heard and looped, frame by frame. */
function ears() {
  const a = new ActionSounds(reg, (id) => (id === "core:rocket_launcher" ? 7 : -1));
  const vitals = new Vitals();
  vitals.max.fill(100e6, 0, V_COUNT);
  vitals.value.fill(100e6, 0, V_COUNT);
  const own: OwnState = { alive: true, x: 0, y: 0, z: 0, act: 0, actTicks: 0, held: 0, female: false, vitals, tick: 0, level: 1, engrams: 0 };
  const heard: { key: string; owner: number; x: number; z: number; level: number; delay: number }[] = [];
  const loops: { id: number; key: string; x: number; y: number; z: number; fade: number | undefined }[] = [];
  const hear: Hear = (owner, key, _e, x, _y, z, _lift, level, _flat, delay = 0) => heard.push({ key: KEYS[key]!.key, owner, x, z, level, delay });
  const frame = (ms: number): void => {
    a.nowMs = ms;
    loops.length = 0;
    a.update(new RemoteSample(), 0, 1.6, 0, own, -1, 0, 1, () => false, hear, () => {}, (id, _o, key, x, y, z, _l, on, _f, fade) => on && loops.push({ id, key: KEYS[key]!.key, x, y, z, fade }));
  };
  return { a, own, heard, loops, frame };
}

test("the launcher's cues stand on the explosion family's takes", () => {
  const falls = (name: string): string[] => candidates("core:x", KEYS.find((k) => k.key === name)!).map((c) => c.id);
  expect(falls("launch")).toContain("core:explosion/sound/rocket/launch");
  expect(falls("burst/rocket")[1]).toBe("core:explosion/sound/rocket/hit");
  expect(falls("burst/distant")[1]).toBe("core:explosion/sound/distant");
  expect([falls("burst/fireball")[1], falls("burst/debris")[1], falls("burst/shockwave")[1]]).toEqual(["core:explosion/sound/fireball", "core:explosion/sound/debris", "core:explosion/sound/shockwave"]);
  // No take of a rocket in flight yet: its own name first, for when one is made, then the capsule's jet.
  const fly = CUES.find((c) => c.name === "rocket/fly")!;
  expect([fly.loop, fly.falls]).toEqual([true, ["core:explosion/rocket/fly", "core:supply/jet@1.3"]]);
});

test("another's rocket is heard to leave, and followed in flight until its blast", () => {
  const e = ears();
  e.frame(0);
  e.a.absorb([event(EVENT_ROCKET, { x: 10, y: 2, z: 0, item: ROCKET, flies: true, vx: 0, vy: 0, vz: SPEED, back: 3, id: 5 })], [], 0);
  e.frame(1000);
  // The launch is the launcher's own occasion, where the round left.
  expect(e.heard.map((h) => [h.key, h.owner, h.x, h.z])).toEqual([["launch", 7, 10, 0]]);
  // The loop is where the round is: three ticks out when told.
  expect(e.loops.map((l) => [l.key, l.id >= ROCKET_LOOPS, l.x])).toEqual([["rocket/fly", true, 10]]);
  expect(e.loops[0]!.z).toBeCloseTo((SPEED * 3) / TICK_RATE, 3);
  expect(e.loops[0]!.fade).toBeLessThan(500);
  const loop = e.loops[0]!.id;
  // Told again by the same number, it is one round still; half a second on it is 30 m further and has dropped.
  e.a.absorb([event(EVENT_ROCKET, { x: 10, y: 2, z: 0, item: ROCKET, flies: true, vx: 0, vy: 0, vz: SPEED, back: 9, id: 5 })], [], 0);
  e.frame(1500);
  expect(e.loops.map((l) => l.id)).toEqual([loop]);
  expect(e.loops[0]!.z).toBeCloseTo((SPEED * 3) / TICK_RATE + SPEED / 2, 3);
  expect(e.loops[0]!.y).toBeLessThan(2);
  expect(e.heard.length).toBe(1);
  // Its blast ends the loop.
  e.a.absorb([event(EVENT_BLAST, { x: 10, y: 0, z: 40, item: ROCKET, far: 7.5, id: 5 })], [], 0);
  e.frame(1600);
  expect(e.loops).toEqual([]);
});

test("a rocket told long after it left is followed, and no launch is heard", () => {
  const e = ears();
  e.frame(0);
  e.a.absorb([event(EVENT_ROCKET, { x: 0, y: 30, z: -200, item: ROCKET, flies: true, vx: 0, vy: 0, vz: SPEED, back: 60, id: 9 })], [], 0);
  e.frame(100);
  expect(e.heard).toEqual([]);
  expect(e.loops.length).toBe(1);
  expect(e.loops[0]!.z).toBeCloseTo(-200 + SPEED * 2, 3);
  // It runs out at its reach with no blast told: the loop ends there.
  e.frame(100 + 4000);
  expect(e.loops).toEqual([]);
});

test("the player's own rocket is heard from its firing, and ends at its blast", () => {
  const e = ears();
  e.own.held = LAUNCHER;
  e.frame(0);
  const shot: LocalShot = { x: 0, y: 1.6, z: 0, yaw: 0, pitch: 0, cone: 0, seed: 3, draw: 1, ammo: ROCKET, weapon: LAUNCHER };
  e.a.absorb([], [shot], 0);
  e.frame(16);
  // A launch, with no report of a rifle, pump or spent case.
  expect(e.heard.map((h) => h.key)).toEqual(["launch"]);
  e.frame(500);
  expect(e.loops.length).toBe(1);
  expect(Math.hypot(e.loops[0]!.x, e.loops[0]!.z)).toBeCloseTo(SPEED * 0.484, 0);
  e.a.absorb([event(EVENT_ROCKET, { x: 0, y: 1.6, z: 0, item: ROCKET, flies: true, vz: SPEED, back: 4, id: 12, own: true })], [], 0);
  e.frame(600);
  // No second launch and no second loop.
  expect([e.heard.length, e.loops.length]).toEqual([1, 1]);
  e.a.absorb([event(EVENT_BLAST, { x: 0, y: 0, z: 50, item: ROCKET, far: 7.5, id: 12 })], [], 0);
  e.frame(700);
  expect(e.loops).toEqual([]);
});

test("a blast is heard by what blew and how far, as late as sound takes to come", () => {
  const e = ears();
  e.frame(0);
  const at = (z: number, item: number): string[] => {
    e.heard.length = 0;
    e.a.absorb([event(EVENT_BLAST, { x: 0, y: 1.6, z, item, far: 7.5 })], [], 0);
    e.frame(0);
    for (const h of e.heard) expect(h.delay).toBeGreaterThanOrEqual(z / SOUND_SPEED - 1e-9);
    expect(e.heard[0]!.delay).toBeCloseTo(z / SOUND_SPEED, 6);
    return e.heard.map((h) => h.key);
  };
  // A rocket close by: its crack, its fire, its wave, and what it threw coming down after.
  expect(at(20, ROCKET)).toEqual(["burst/rocket", "burst/fireball", "burst/shockwave", "burst/debris"]);
  expect(e.heard[3]!.delay).toBeGreaterThan(e.heard[0]!.delay);
  expect(at(100, ROCKET)).toEqual(["burst/rocket", "burst/fireball"]);
  expect(at(240, ROCKET)).toEqual(["burst/distant"]);
  // A grenade keeps its own smaller set, and anything else the plain one.
  expect(at(20, GRENADE)).toEqual(["blast/near", "burst/debris"]);
  expect(at(100, GRENADE)).toEqual(["blast/near"]);
  expect(at(240, GRENADE)).toEqual(["blast/far"]);
  expect(at(20, 0)).toEqual(["blast/near"]);
  // However far, it waits no longer than the supply drop's strike does.
  e.heard.length = 0;
  e.a.absorb([event(EVENT_BLAST, { x: 0, y: 0, z: 9000, item: ROCKET, far: 7.5 })], [], 0);
  e.frame(0);
  expect(e.heard.map((h) => h.delay)).toEqual([14]);
});
