import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { CreatureImpale } from "../../server/creature-impale.ts";
import { EntityRecord } from "../../server/records.ts";
import type { Clip, ClipSet } from "../../shared/anim/clip.ts";
import { ZONE_TORSO } from "../../shared/anim/human.ts";
import type { CreatureCombatFacet } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import type { PackRig } from "../../shared/pack/pack.ts";
import { MODE_SWIM } from "../../shared/sim/character.ts";
import { F_AWAKE, F_GROUNDED, F_HELD, F_PLAYER } from "../../shared/sim/entities.ts";
import { MICRO } from "../../shared/sim/lazy.ts";
import { IMPALE_SLOT } from "../../shared/sim/seats.ts";
import { V_HEALTH, V_TORPOR } from "../../shared/sim/vitals.ts";
import { ACT_COOL, ACT_HOLD, ACT_NONE, ACT_RELOAD } from "../../shared/sim/weapon.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

const strike = { name: "tail", clip: "impale_in", socket: "tip", radius: .5, reach: 4, damage: 10, type: "melee" as const, ticks: 24, lands: 6, through: 18, stamina: 5 };
const combat: CreatureCombatFacet = { primary: { ...strike, clip: "attack" }, secondary: { ...strike, cooldown: 90, impale: { socket: "tip", maxDrag: 100, maxHealthFraction: .5, seconds: 2, staminaPerSecond: 10, damagePerSecond: 30 } } };
const rig: PackRig = { id: "test:impaler", skeleton: "test:impaler", names: ["body", "tail"], parent: [-1, 0], rest: [0, 1, 0, 0, 2, 0], caps: [0, ZONE_TORSO, 0, -.5, 0, 0, .5, 0, .6], sockets: [{ name: "tip", bone: 1, x: 0, y: 0, z: 2.4 }] };
function clips(): ClipSet {
  const all: Clip[] = ["attack", "impale_in", "impale_hold", "impale_out"].map(name => {
    const rot = new Float32Array(31 * 8);
    for (let frame = 0; frame < 31; frame++) {
      rot[frame * 8 + 3] = 1;
      const angle = name === "impale_hold" ? .3 * Math.sin(frame * Math.PI / 30) : 0;
      rot[frame * 8 + 5] = Math.sin(angle / 2); rot[frame * 8 + 7] = Math.cos(angle / 2);
    }
    return { id: `${rig.id}/${name}`, bones: 2, frames: 31, loop: name === "impale_hold", rot, root: new Float32Array(31 * 3) };
  });
  return { clips: all, index: new Map(all.map((clip, i) => [clip.id, i])), hash: 0 };
}
function fixture(host = false) {
  const built = compileContent(CORE_CONTENT.map(d => d.type === "species" && d.id === "core:parasaur" ? { ...d, drag: 350, mesh: rig.id, skeleton: rig.id, combat } : d));
  if (!built.registry) throw new Error(built.errors.join("\n"));
  const h = new Harness({}, 1, 30, { map: writeMap(flatMap()), rigs: [rig], clips: clips() }, built.registry), { ents } = h.world;
  const spawn = (kind: string, x = 120, z = 122.4) => {
    const rec = h.host.records.create(h.reg.index.get(`core:${kind}`)!);
    rec.x = x; rec.y = 0; rec.z = z;
    const e = ents.create(rec.kind, x, 0, z, F_GROUNDED | F_AWAKE | (kind === "survivor" ? F_PLAYER : 0));
    ents.pid[e] = rec.pid; h.host.records.entOf.set(rec.pid, e); h.host.survival.init(rec); ents.pose(e, h.world.tick);
    return { rec, e };
  };
  const actor = spawn("parasaur", 120, 120), victim = spawn("survivor");
  h.host.survival.add(victim.rec, V_HEALTH, -60);
  ents.act[actor.e] = ACT_RELOAD; ents.actTicks[actor.e] = 8; ents.pose(actor.e, h.world.tick);
  const refreshes: number[] = [], dealt: number[] = [];
  let mayDismount = false, dismounts = 0;
  if (!host) h.host.combat.onCreatureHit = null;
  const impale = host ? h.host.impale : new CreatureImpale({ world: h.world, records: h.host.records, survival: h.host.survival,
    hostile: (a, v) => a !== v && !(a.team !== 0 && a.team === v.team),
    forceDismount: v => { dismounts++; if (!mayDismount) return false; ents.setSeat(h.host.records.entOf.get(v.pid)!, -1); return true; },
    refresh: rec => { refreshes.push(rec.pid); h.host.survival.init(rec); },
    damage: (a, v, attack, mode, points) => {
      const target = h.host.records.entOf.get(v.pid)!;
      h.host.combat.creatureContact(a, target, { ...attack, damage: points }, mode, [ents.x[target]!, ents.y[target]! + .9, ents.z[target]!], ZONE_TORSO, 1, true);
      dealt.push(h.host.combat.last.damage);
    },
  });
  const start = () => impale.tryStart(actor.rec, victim.e, h.reg.combat[actor.rec.kind]!.secondary!);
  const step = () => {
    h.server.tick();
    if (ents.act[actor.e] === ACT_HOLD) { ents.actTicks[actor.e] = ents.actTicks[actor.e]! + 1; ents.pose(actor.e, h.world.tick); }
    impale.step();
  };
  return { h, ents, actor, victim, impale, spawn, start, step, refreshes, dealt, dismounts: () => dismounts, allowDismount: () => { mayDismount = true; } };
}

test("impale follows a posed socket, owns one pair, stays damageable and applies each fixed tick only once", () => {
  const f = fixture(), { actor, victim, ents, impale } = f;
  expect(f.start()).toBe(true);
  expect([ents.seat[victim.e], ents.seatGen[victim.e], ents.seatSlot[victim.e]]).toEqual([actor.e + 1, ents.gen[actor.e], IMPALE_SLOT]);
  expect(ents.flags[victim.e]! & F_HELD).toBe(0);
  expect(f.h.host.survival.gods.has(victim.rec.pid)).toBe(false);
  expect(impale.holding(actor.rec.pid)).toBe(victim.rec.pid);
  expect(f.start()).toBe(false);
  const initial = [ents.x[victim.e]!, ents.y[victim.e]!, ents.z[victim.e]!];
  expect(initial[0]).toBeCloseTo(120, 5); expect(initial[1]).toBeGreaterThan(.5);
  for (let i = 0; i < 10; i++) f.step();
  expect(Math.abs(ents.x[victim.e]! - initial[0]!)).toBeGreaterThan(.2);
  expect(f.dealt).toEqual(Array(10).fill(1));
  impale.step(); expect(f.dealt.length).toBe(10);
  const hp = f.h.host.survival.value(victim.rec, V_HEALTH);
  f.h.host.combat.creatureContact(actor.rec, victim.e, { ...strike, damage: 5 }, undefined, [ents.x[victim.e]!, ents.y[victim.e]! + .9, ents.z[victim.e]!], ZONE_TORSO, 1);
  expect(f.h.host.survival.value(victim.rec, V_HEALTH)).toBeCloseTo(hp - 5, 5);
});

test("eligibility rejects healthy, heavy, friendly, sleeping, unconscious, missing-pose and self targets", () => {
  const f = fixture(), { actor, victim, ents, impale, h } = f, attack = h.reg.combat[actor.rec.kind]!.secondary!;
  h.host.survival.add(victim.rec, V_HEALTH, 60); expect(f.start()).toBe(false);
  h.host.survival.add(victim.rec, V_HEALTH, -60);
  actor.rec.team = victim.rec.team = 1; expect(f.start()).toBe(false); actor.rec.team = 0;
  victim.rec.out = true; expect(f.start()).toBe(false); victim.rec.out = false;
  ents.flags[actor.e] = ents.flags[actor.e]! & ~F_AWAKE; expect(f.start()).toBe(false); ents.flags[actor.e] = ents.flags[actor.e]! | F_AWAKE;
  const large = f.spawn("parasaur"); h.host.survival.add(large.rec, V_HEALTH, -150);
  expect(impale.tryStart(actor.rec, large.e, attack)).toBe(false);
  expect(impale.tryStart(actor.rec, actor.e, attack)).toBe(false);
  h.world.anims[actor.rec.kind] = null; expect(f.start()).toBe(false);
});

test("the victim cannot be claimed twice or become an attacker in a chain", () => {
  const f = fixture(); expect(f.start()).toBe(true);
  const rival = f.spawn("parasaur", 121, 120), attack = f.h.reg.combat[rival.rec.kind]!.secondary!;
  f.ents.act[rival.e] = ACT_RELOAD; f.ents.pose(rival.e, f.h.world.tick);
  expect(f.impale.tryStart(rival.rec, f.victim.e, attack)).toBe(false);
  expect(f.impale.holding(rival.rec.pid)).toBe(0);
  const second = f.spawn("survivor"); f.h.host.survival.add(second.rec, V_HEALTH, -60);
  expect(f.impale.tryStart(f.actor.rec, second.e, attack)).toBe(false);
});

test("own occupants stay protected and foreign riders require the supplied safe dismount policy", () => {
  const f = fixture();
  f.ents.setSeat(f.victim.e, f.actor.e, 1);
  expect(f.start()).toBe(false); expect(f.dismounts()).toBe(0);
  const other = f.spawn("parasaur", 120, 123);
  f.ents.setSeat(f.victim.e, other.e, 1);
  expect(f.start()).toBe(false); expect(f.dismounts()).toBe(1);
  f.allowDismount(); expect(f.start()).toBe(true); expect(f.dismounts()).toBe(2);
});

test("a wall blocks socket acquisition and a later blocked path releases at the last safe location", () => {
  const blocked = fixture();
  blocked.h.world.structs.add(blocked.h.reg.index.get("core:wall")!, 120, 1.5, 121.2, 0, 0, 1);
  expect(blocked.start()).toBe(false); expect(blocked.ents.seat[blocked.victim.e]).toBe(0);
  const f = fixture(); expect(f.start()).toBe(true);
  const { ents, victim } = f, before = [ents.x[victim.e], ents.y[victim.e], ents.z[victim.e]];
  f.h.world.structs.add(f.h.reg.index.get("core:wall")!, 120, 1.5, 121.2, 0, 0, 1);
  f.step(); expect(f.impale.held(victim.rec.pid)).toBe(false); expect(ents.seat[victim.e]).toBe(0);
  expect([ents.x[victim.e], ents.y[victim.e], ents.z[victim.e]]).toEqual(before);
});

test("a wall built through the attachment uses bounded ordinary capsule depenetration on release", () => {
  const f = fixture(); expect(f.start()).toBe(true);
  const { ents, victim, h } = f, x = ents.x[victim.e]!, y = ents.y[victim.e]!, z = ents.z[victim.e]!;
  h.world.structs.add(h.reg.index.get("core:wall")!, x, y + 1.5, z, 0, 0, 1);
  f.impale.release(victim.rec.pid);
  const r = h.reg.bodyRadius[victim.rec.kind]!, height = h.reg.bodyHeight[victim.rec.kind]!;
  expect(capsuleFree(h.world, ents.x[victim.e]!, ents.y[victim.e]!, ents.z[victim.e]!, r, height)).toBe(true);
  expect(Math.hypot(ents.x[victim.e]! - x, ents.y[victim.e]! - y, ents.z[victim.e]! - z)).toBeLessThanOrEqual(2);
  expect(ents.seat[victim.e]).toBe(0);
});

test("KO, sleep, swimming, teleport, phase cancellation, explicit release and stop remove every transient seat", () => {
  for (const reason of ["out", "sleep", "air", "water", "teleport", "phase", "release", "stop"] as const) {
    const f = fixture(); expect(f.start()).toBe(true);
    const { ents, actor, victim } = f, before = [ents.x[victim.e], ents.y[victim.e], ents.z[victim.e]];
    if (reason === "out") { actor.rec.vitals!.value[V_TORPOR] = actor.rec.vitals!.max[V_TORPOR]!; actor.rec.out = true; }
    if (reason === "sleep") ents.flags[actor.e] = ents.flags[actor.e]! & ~F_AWAKE;
    if (reason === "air") ents.flags[actor.e] = ents.flags[actor.e]! & ~F_GROUNDED;
    if (reason === "water") ents.mode[actor.e] = MODE_SWIM;
    if (reason === "teleport") ents.setPosition(actor.e, 180, 0, 180);
    if (reason === "phase") ents.act[actor.e] = ACT_NONE;
    if (reason === "release") f.impale.release(actor.rec.pid);
    if (reason === "stop") f.impale.stop();
    f.impale.step();
    expect(f.impale.holding(actor.rec.pid)).toBe(0); expect(ents.seat[victim.e]).toBe(0);
    expect([ents.x[victim.e], ents.y[victim.e], ents.z[victim.e]]).toEqual(before);
    expect(ents.act[actor.e]).toBe(reason === "out" || reason === "phase" ? ACT_NONE : ACT_COOL);
  }
});

test("death, record removal and recycled generations cannot leave an orphan seat or modify the replacement", () => {
  for (const reason of ["dead", "removed", "attacker-generation", "victim-generation", "record-replacement"] as const) {
    const f = fixture(); expect(f.start()).toBe(true);
    const { ents, actor, victim, h } = f;
    if (reason === "dead") victim.rec.dead = true;
    if (reason === "removed") h.host.records.byPid.delete(victim.rec.pid);
    if (reason === "record-replacement") h.host.records.byPid.set(victim.rec.pid, new EntityRecord(victim.rec.pid, victim.rec.kind));
    if (reason === "attacker-generation") ents.gen[actor.e] = ents.gen[actor.e]! + 1;
    if (reason === "victim-generation") { ents.gen[victim.e] = ents.gen[victim.e]! + 1; ents.setSeat(victim.e, actor.e, 1); }
    f.impale.step(); expect(f.impale.held(victim.rec.pid)).toBe(false);
    expect(ents.seatSlot[victim.e]).toBe(reason === "victim-generation" ? 1 : 0);
    if (reason === "attacker-generation") expect(ents.act[actor.e]).toBe(ACT_HOLD);
  }
});

test("a short hold is bounded independently of controller ticks and lethal ordinary damage releases immediately", () => {
  const f = fixture(); f.h.host.survival.gods.add(f.victim.rec.pid); expect(f.start()).toBe(true);
  for (let i = 0; i < 59; i++) f.step();
  expect(f.impale.held(f.victim.rec.pid)).toBe(true);
  f.step();
  expect(f.impale.held(f.victim.rec.pid)).toBe(false); expect(f.ents.seat[f.victim.e]).toBe(0);
  const lethal = fixture(); lethal.victim.rec.vitals!.value[V_HEALTH] = .5 * MICRO;
  expect(lethal.start()).toBe(true); lethal.step();
  expect(lethal.victim.rec.dead).toBe(true);
  expect(lethal.impale.holding(lethal.actor.rec.pid)).toBe(0);
});

test("ordinary host combat starts impale, applies ongoing damage, and the real knockout hook releases it", () => {
  const f = fixture(true), { h, actor, victim, ents, impale } = f;
  const attack = h.reg.combat[actor.rec.kind]!.secondary!;
  h.host.combat.creatureContact(actor.rec, victim.e, attack, undefined, [120, .9, 122.4], ZONE_TORSO, 1);
  expect(impale.holding(actor.rec.pid)).toBe(victim.rec.pid);
  const hits = h.host.combat.hits, hp = h.host.survival.value(victim.rec, V_HEALTH);
  for (let n = 0; n < 10; n++) h.server.tick();
  expect(h.host.combat.hits - hits).toBe(10);
  expect(h.host.survival.value(victim.rec, V_HEALTH)).toBeLessThan(hp - 9);
  h.host.survival.add(actor.rec, V_TORPOR, actor.rec.vitals!.max[V_TORPOR]! / MICRO);
  expect(actor.rec.out).toBe(true);
  expect(impale.holding(actor.rec.pid)).toBe(0);
  expect(ents.seat[victim.e]).toBe(0);
});

test("a teleported victim is released where it safely arrived, never pulled across the world", () => {
  const f = fixture(); expect(f.start()).toBe(true);
  f.ents.setPosition(f.victim.e, 190, 0, 180);
  f.step();
  expect(f.impale.held(f.victim.rec.pid)).toBe(false);
  expect([f.ents.x[f.victim.e], f.ents.y[f.victim.e], f.ents.z[f.victim.e]]).toEqual([190, 0, 180]);
});

test("a foreign seat assignment ends the old relation without clearing somebody else's new seat", () => {
  const f = fixture(); expect(f.start()).toBe(true);
  const host = f.spawn("parasaur", 130, 120);
  f.ents.setSeat(f.victim.e, host.e, 2);
  f.impale.step();
  expect(f.impale.held(f.victim.rec.pid)).toBe(false);
  expect([f.ents.seat[f.victim.e], f.ents.seatGen[f.victim.e], f.ents.seatSlot[f.victim.e]]).toEqual([host.e + 1, f.ents.gen[host.e], 2]);
});
