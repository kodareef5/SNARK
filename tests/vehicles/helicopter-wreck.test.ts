import { expect, test } from "bun:test";
import { HELICOPTER as spec, HELICOPTER_VEHICLE as def } from "../../content/vehicles/helicopter.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { FALLING } from "../../shared/anim/corpse.ts";
import { CreatureAnim } from "../../shared/anim/creature.ts";
import { CUE_DEAD } from "../../shared/anim/pose.ts";
import { buildRig } from "../../shared/anim/rigs.ts";
import { createHelicopter } from "../../shared/sim/helicopter.ts";
import { helicopterWreckDefinition, stepHelicopterWreck } from "../../shared/sim/helicopter-wreck.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { StaticHelicopterWorld } from "../../shared/world/helicopter.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { Corpses } from "../../client/core/ragdoll.ts";
import { RemoteSample } from "../../client/core/session.ts";

function scene() {
  const dims = { chunksX: 2, chunksZ: 2 }, hf = new Heightfield(dims, 2, -16, 1 / 256); hf.heights.fill(4096);
  const structs = new StructureStore(dims, new Float32Array([0, 10]), new Float32Array([0, .1]), new Float32Array([0, 10]));
  return { hf, structs, world: new StaticHelicopterWorld({ hf, structs }) };
}

test("inverted rigid salvage falls on its actual hull and never rights itself or collides as a live rotor disc", () => {
  const { world } = scene(), s = createHelicopter(spec, 64, 35, 64);
  s.qx = 1; s.qw = 0; s.vy = -12; s.vx = 4; s.engineOn = true; s.rotorRpm = spec.rotorRpm;
  stepHelicopterWreck(s, def, world);
  expect(s.y).toBeLessThan(35); expect(s.x).toBeGreaterThan(64);
  expect([s.qx, s.qy, s.qz, s.qw]).toEqual([1, 0, 0, 0]); expect(s.engineOn).toBe(false); expect(s.rotorRpm).toBe(0);
  let stopped = false;
  for (let i = 0; i < 200 && !stopped; i++) stopped = stepHelicopterWreck(s, def, world);
  expect(stopped).toBe(true); expect(s.y).toBeGreaterThan(3.30); expect(s.y).toBeLessThan(3.34);
  expect([s.qx, s.qy, s.qz, s.qw]).toEqual([1, 0, 0, 0]);
  expect(world.blocked(s, s, helicopterWreckDefinition(def))).toBeNull();
});

test("airborne wrecks retain crash spin and sink in water without powered lift", () => {
  const { world, hf } = scene(), s = createHelicopter(spec, 64, 25, 64);
  s.rollRate = 1.5; s.vz = 8;
  for (let i = 0; i < 15; i++) stepHelicopterWreck(s, def, world);
  expect(Math.abs(s.qz)).toBeGreaterThan(.2); expect(s.rollRate).toBeGreaterThan(1); expect(s.y).toBeLessThan(24);
  hf.seaLevel = 40;
  for (let i = 0; i < 120; i++) stepHelicopterWreck(s, def, world);
  expect(s.vy).toBeLessThan(-.3); expect(s.vy).toBeGreaterThan(-1); expect(Math.abs(s.vz)).toBeLessThan(.01);
});

test("terrain cell sides do not turn an inverted mast's support into a sideways collision", () => {
  const { world } = scene(), s = createHelicopter(spec, 70.27734375, 3.322, 64);
  s.qx = 1; s.qw = 0;
  const hit = world.blocked(s, { ...s, y: s.y - .035 }, helicopterWreckDefinition(def));
  expect(hit?.reason).toBe("terrain"); expect(hit?.ny).toBeGreaterThan(.9999);
  expect(Math.hypot(hit!.nx!, hit!.nz!)).toBeLessThan(1e-8);
});

test("an inverted wreck's submerged cabin receives water drag while its skid origin is still above the waterline", () => {
  const { world, hf } = scene(); hf.seaLevel = 10;
  const inverted = createHelicopter(spec, 64, 11, 64), upright = { ...inverted };
  inverted.qx = 1; inverted.qw = 0; inverted.vy = upright.vy = -8;
  stepHelicopterWreck(inverted, def, world); stepHelicopterWreck(upright, def, world);
  expect(inverted.y).toBeGreaterThan(10); expect(inverted.vy).toBeGreaterThan(-8);
  expect(upright.vy).toBeLessThan(-8); expect(inverted.vy - upright.vy).toBeGreaterThan(1);
});

test("a remotely observed rigid wreck keeps replicated attitude and a rest rig instead of a creature death pose", () => {
  const { hf, structs } = scene();
  const rig = buildRig({ id: "test:helicopter", skeleton: "test:heli", names: ["root", "rotor"], parent: [-1, 0], rest: [0, 0, 0, 0, 3.15, -.3] }, NO_CLIPS)!;
  const corpses = new Corpses([null, new CreatureAnim(rig, 1, 1)]), r = new RemoteSample();
  r.count = 1; r.id[0] = 8; r.kind[0] = 1; r.x[0] = r.z[0] = 64; r.y[0] = 30;
  r.vehicleRotorcraft[0] = 1; r.vehicleQx[0] = 1; r.vehicleQw[0] = 0; r.cue[0] = CUE_DEAD; r.anim[0] = FALLING;
  corpses.update(r, { hf, structs }, 64, 64, new Map());
  const c = corpses.list[0]!;
  expect(c.rigid).toBe(true); expect([c.qx, c.qw, c.y]).toEqual([1, 0, 30]); expect(c.fall).toBeNull();
  expect(Array.from(c.solved.rot)).toEqual([0, 0, 0, 1, 0, 0, 0, 1]);
  r.tick = 4; r.y[0] = 28; r.vehicleQx[0] = .8; r.vehicleQw[0] = .6;
  corpses.update(r, { hf, structs }, 64, 64, new Map());
  expect(c.y).toBe(28); expect(c.qx).toBeCloseTo(.8, 6); expect(c.qw).toBeCloseTo(.6, 6);
  r.tick = 6; r.anim[0] = 0;
  corpses.update(r, { hf, structs }, 64, 64, new Map());
  expect(c.falling).toBe(false); expect(c.fall).toBeNull(); expect(c.limp).toBe(true);
});
