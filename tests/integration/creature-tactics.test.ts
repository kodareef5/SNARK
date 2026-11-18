import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { MIND_HUNT, MIND_WANDER } from "../../server/behavior.ts";
import type { Clip, ClipSet } from "../../shared/anim/clip.ts";
import { ZONE_TORSO } from "../../shared/anim/human.ts";
import type { CreatureCombatFacet } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import type { PackRig } from "../../shared/pack/pack.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { ACT_COOL, ACT_DRAW, ACT_HOLD, ACT_NONE, ACT_SWING } from "../../shared/sim/weapon.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { MapWater } from "../../shared/world/water.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

const tail: CreatureCombatFacet = {
  primary: { name: "sweep", clip: "attack", alternateClip: "attack_right", socket: "tail_contact", radius: .45, reach: 4, damage: 8, type: "melee", ticks: 24, lands: 6, through: 18, stamina: 5 },
  ai: { primary: { bearing: 135, distance: 2.4, arc: 8 } },
};
const charge: CreatureCombatFacet = {
  primary: { ...tail.primary, alternateClip: undefined, socket: "horn_contact" },
  charge: { windup: 24, minWindup: 12, duration: 60, recovery: 12, cooldown: 120, speed: 12, turn: 25, stamina: 5, staminaPerSecond: 2,
    attack: { ...tail.primary, alternateClip: undefined, socket: "horn_contact", ticks: 60, lands: 1, through: 59 } },
  ai: { charge: { minDistance: 6, maxDistance: 16 } },
};
const rig: PackRig = { id: "test:tactics", skeleton: "test:tactics", names: ["body", "tail"], parent: [-1, 0], rest: [0, 0, 0, 0, 1, 0],
  caps: [0, ZONE_TORSO, 0, .4, 0, 0, 1.5, 0, .6], sockets: [{ name: "tail_contact", bone: 1, x: 0, y: 0, z: -2.4 }, { name: "horn_contact", bone: 0, x: 0, y: 1, z: 1.5 }] };
function clips(): ClipSet {
  const clips: Clip[] = ["attack", "attack_right", "charge_windup", "charge", "charge_recover"].map((name) => {
    const rot = new Float32Array(61 * 8), root = new Float32Array(61 * 3);
    for (let f = 0; f < 61; f++) {
      rot[f * 8 + 3] = 1;
      const angle = name === "attack" ? Math.PI / 4 : -Math.PI / 4;
      rot[f * 8 + 5] = Math.sin(angle / 2); rot[f * 8 + 7] = Math.cos(angle / 2);
    }
    return { id: `${rig.id}/${name}`, bones: 2, frames: 61, loop: false, rot, root };
  });
  return { clips, index: new Map(clips.map((c, i) => [c.id, i])), hash: 0 };
}
function setup(combat = tail, distance = 2.4) {
  const built = compileContent(CORE_CONTENT.map(d => d.id === "core:parasaur" && d.type === "species" ? { ...d, mesh: rig.id, skeleton: rig.id, combat, temper: "defends", alarm: 12 } : d));
  if (!built.registry) throw new Error(built.errors.join("\n"));
  const h = new Harness({}, 1, 30, { map: writeMap(flatMap()), clips: clips(), rigs: [rig] }, built.registry);
  h.join("observer"); h.run(100);
  const e = h.host.spawnCreature("core:parasaur", 120, 120, 1), ents = h.world.ents;
  expect(e).toBeGreaterThanOrEqual(0);
  ents.yaw[e] = 0; ents.pose(e, h.world.tick);
  const actor = h.host.records.byPid.get(ents.pid[e]!)!;
  actor.genome!.wild.fill(0); actor.genome!.tamed.fill(0);
  const rec = h.host.records.create(h.reg.index.get("core:survivor")!);
  rec.x = 120; rec.y = 0; rec.z = 120 + distance;
  const target = ents.create(rec.kind, rec.x, rec.y, rec.z, F_GROUNDED);
  ents.pid[target] = rec.pid; h.host.records.entOf.set(rec.pid, target); h.host.survival.init(rec); ents.pose(target, h.world.tick);
  const provoke = () => h.host.creatures.provoke(e, ents.x[target]!, ents.z[target]!, target);
  const tick = () => h.server.tick();
  const hp = () => h.host.survival.value(rec, V_HEALTH);
  return { h, e, ents, actor, rec, target, provoke, tick, hp, mind: h.host.creatures.mind };
}
const delta = (a: number, b: number) => ((a - b + 32768) & 65535) - 32768;

test("a defensive tail user turns into a rear quarter, settles, then hits with its posed tail", () => {
  const f = setup(); f.provoke(); const health = f.hp();
  let began = false, planted = 0;
  for (let n = 0; n < 120 && f.hp() >= health; n++) {
    f.tick();
    if (!began && f.ents.act[f.e] === ACT_SWING) {
      began = true; planted = f.ents.yaw[f.e]!;
      const aim = Math.atan2(f.ents.x[f.target]! - f.ents.x[f.e]!, f.ents.z[f.target]! - f.ents.z[f.e]!) * 65536 / (Math.PI * 2);
      expect(Math.abs(Math.abs(delta(aim, planted)) - 24576)).toBeLessThan(1600);
      expect(Math.hypot(f.ents.vx[f.e]!, f.ents.vz[f.e]!)).toBeLessThan(.36);
      expect(f.hp()).toBe(health);
    } else if (began && f.ents.act[f.e] === ACT_SWING) expect(f.ents.yaw[f.e]).toBe(planted);
  }
  expect(began).toBe(true); expect(f.hp()).toBeLessThan(health); expect(f.h.host.combat.last.damage).toBe(8);
});

test("tail tactics back out of a crowded strike before turning, without near-edge oscillation", () => {
  for (const distance of [0, .8]) {
    const f = setup(tail, distance); f.provoke();
    let began = false, backwards = 0;
    for (let n = 0; n < 180; n++) {
      f.tick();
      if (f.ents.vz[f.e]! < -.1) backwards++;
      if (f.ents.act[f.e] === ACT_SWING) { began = true; break; }
    }
    expect(backwards).toBeGreaterThan(8); expect(began).toBe(true);
    expect(Math.hypot(f.ents.x[f.target]! - f.ents.x[f.e]!, f.ents.z[f.target]! - f.ents.z[f.e]!)).toBeGreaterThan(2.2);
  }
});

test("a charge uses shared windup and recovery, with a real cooldown after passing its target", () => {
  const f = setup(charge, 12); f.provoke();
  const phases = new Set<number>(); let winding = 0, started = 0;
  for (let n = 0; n < 180; n++) {
    const before = f.ents.act[f.e]!; f.tick(); const act = f.ents.act[f.e]!;
    phases.add(act); if (act === ACT_DRAW) winding++;
    if (before !== ACT_DRAW && act === ACT_DRAW) started++;
    if (act === ACT_COOL) {
      expect(f.ents.creatureCooldown[f.e]).toBe(charge.charge!.cooldown);
      break;
    }
  }
  expect(phases.has(ACT_DRAW)).toBe(true); expect(phases.has(ACT_HOLD)).toBe(true); expect(phases.has(ACT_COOL)).toBe(true);
  expect(winding).toBe(charge.charge!.windup); expect(started).toBe(1);
  for (let n = 0; n < 90; n++) { f.tick(); expect(f.ents.act[f.e]).not.toBe(ACT_DRAW); }
});

test("a windup cancels immediately when its target entity disappears or its slot is reused", () => {
  const f = setup(charge, 12); f.provoke();
  for (let n = 0; n < 60 && f.ents.act[f.e] !== ACT_DRAW; n++) f.tick();
  expect(f.ents.act[f.e]).toBe(ACT_DRAW);
  f.ents.destroy(f.target);
  let replacement = -1;
  // EntityStore uses a FIFO free list. Exhaust its original slots to exercise actual generation reuse.
  const limit = f.ents.cap;
  for (let n = 0; n < limit && replacement !== f.target; n++) replacement = f.ents.create(f.rec.kind, 120, 0, 132, F_GROUNDED);
  expect(replacement).toBe(f.target);
  f.tick(); expect(f.ents.act[f.e]).toBe(ACT_NONE); expect(f.ents.creatureCooldown[f.e]).toBeGreaterThan(0);
  expect(f.mind.targetOf(f.e)).toBe(-1);
});

test("charge opportunities reject a wall and a newly blocked windup cancels before rushing", () => {
  for (const afterStart of [false, true]) {
    const f = setup(charge, 12); f.provoke();
    if (afterStart) {
      for (let n = 0; n < 60 && f.ents.act[f.e] !== ACT_DRAW; n++) f.tick();
      expect(f.ents.act[f.e]).toBe(ACT_DRAW);
    }
    f.h.world.structs.add(f.h.reg.index.get("core:wall")!, 120, 1.5, 126, 0, 0, 100);
    for (let n = 0; n < (afterStart ? 8 : 15); n++) { f.tick(); expect(f.ents.act[f.e]).not.toBe(ACT_HOLD); if (!afterStart) expect(f.ents.act[f.e]).not.toBe(ACT_DRAW); }
    if (afterStart) expect(f.ents.creatureCooldown[f.e]).toBeGreaterThan(0);
  }
});

test("an owned passive tail user stays passive, while an explicit attack order still uses its tail", () => {
  const f = setup(); f.actor.team = 7; f.ents.team[f.e] = 7;
  f.mind.order(f.e, 0); f.provoke();
  for (let n = 0; n < 30; n++) f.tick();
  expect(f.mind.mind[f.e]).toBe(MIND_WANDER); expect(f.ents.act[f.e]).toBe(ACT_NONE);
  f.mind.attack(f.e, f.target);
  expect(f.mind.mind[f.e]).toBe(MIND_HUNT);
  const before = f.hp(); for (let n = 0; n < 120 && f.hp() >= before; n++) f.tick();
  expect(f.hp()).toBeLessThan(before);
});

test("the existing wild alarm recruits a nearby herd member into defensive tactical pursuit", () => {
  const f = setup(charge, 12), ally = f.h.host.spawnCreature("core:parasaur", 124, 120, 1);
  f.provoke(); expect(f.mind.targetOf(f.e)).toBe(f.target); expect(f.mind.targetOf(ally)).toBe(f.target);
  expect(f.mind.mind[ally]).toBe(MIND_HUNT);
});

test("tail tactics choose the nearer mirrored side and both authored contacts damage their target", () => {
  for (const yaw of [22000, 43536]) {
    const f = setup(); f.ents.yaw[f.e] = yaw; f.provoke(); const health = f.hp();
    for (let n = 0; n < 90 && f.hp() >= health; n++) f.tick();
    expect(f.hp()).toBeLessThan(health);
    expect(f.ents.creatureSide[f.e]).toBe(yaw < 32768 ? 0 : 1);
    expect(Math.abs(delta(f.ents.yaw[f.e]!, yaw))).toBeLessThan(5000);
  }
});

test("charge lanes reject deep water, a drop, and a wall clipping only the capsule edge", () => {
  for (const hazard of ["water", "drop", "edge-wall"]) {
    const f = setup(charge, 12), hf = f.h.world.hf;
    if (hazard === "water") {
      const chunks = Uint32Array.from({ length: f.h.world.dims.chunksX * f.h.world.dims.chunksZ }, (_, i) => i);
      const cells = new Uint16Array(chunks.length * 64 * 64);
      for (const c of chunks) {
        const startZ = Math.floor(c / f.h.world.dims.chunksX) * 64;
        for (let z = 0; z < 64; z++) if (startZ + z >= 124 && startZ + z < 129) cells.fill(1, c * 4096 + z * 64, c * 4096 + (z + 1) * 64);
      }
      hf.water = new MapWater(f.h.world.dims, hf.minY, hf.stepY, 1, [{ name: "deep strip", level: Math.round((3 - hf.minY) / hf.stepY) }], chunks, cells);
    } else if (hazard === "drop") {
      for (let j = 0; j < hf.nz; j++) if (j * hf.cell >= 124 && j * hf.cell <= 128) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, -4);
    } else {
      const p = f.h.reg.move[f.actor.kind]!;
      f.h.world.structs.add(f.h.reg.index.get("core:wall")!, 120 + p.radius - .05, 1.5, 126, 16384, 0, 100);
    }
    f.provoke();
    for (let n = 0; n < 15; n++) { f.tick(); expect(f.ents.act[f.e]).not.toBe(ACT_DRAW); expect(f.ents.act[f.e]).not.toBe(ACT_HOLD); }
  }
});
