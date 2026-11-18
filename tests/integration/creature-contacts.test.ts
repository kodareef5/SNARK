// Synthetic contacts isolate the geometry. The native Brachiosaurus exercises it at full scale.
import { expect, test } from "bun:test";
import { artTest } from "../fixtures/needs-art.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { CreatureContacts } from "../../server/creature-combat.ts";
import type { Clip, ClipSet } from "../../shared/anim/clip.ts";
import { ZONE_TORSO } from "../../shared/anim/human.ts";
import type { CreatureCombatFacet, Def } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import type { PackRig } from "../../shared/pack/pack.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { ACT_NONE, ACT_SWING } from "../../shared/sim/weapon.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

const spec: CreatureCombatFacet = { primary: { name: "sweep", clip: "attack", socket: "contact", radius: .4, reach: 4, damage: 30, type: "melee", ticks: 24, lands: 6, through: 18, stamina: 5 } };
const rig: PackRig = { id: "test:sweeper", skeleton: "test:sweeper", names: ["body", "tail"], parent: [-1, 0], rest: [0, 1, 0, 0, 1, 0], caps: [0, ZONE_TORSO, 0, -.5, 0, 0, .5, 0, .6], sockets: [{ name: "contact", bone: 1, x: 0, y: 0, z: 2.4 }] };
interface ContactStudy { readonly socket?: readonly [number, number, number]; readonly radius?: number; readonly travelZ?: number; readonly convex?: boolean; readonly brachio?: boolean }
function clips(study: ContactStudy): ClipSet {
  const rot = new Float32Array(25 * 2 * 4), root = new Float32Array(25 * 3);
  for (let f = 0; f < 25; f++) {
    rot[f * 8 + 3] = 1;
    const angle = study.socket ? 0 : Math.max(-1, Math.min(1, (f - 12) / 6)) * Math.PI / 3;
    rot[f * 8 + 5] = Math.sin(angle / 2); rot[f * 8 + 7] = Math.cos(angle / 2);
    root[f * 3 + 2] = (f - 5) * (study.travelZ ?? 0);
  }
  const clip: Clip = { id: "test:sweeper/attack", bones: 2, frames: 25, loop: false, rot, root };
  return { clips: [clip], index: new Map([[clip.id, 0]]), hash: 0 };
}
function setup(node = false, study: ContactStudy = {}) {
  const nativeRig = study.socket ? { ...rig, sockets: [{ name: "contact", bone: 1, x: study.socket[0], y: study.socket[1], z: study.socket[2] }] } : rig;
  const extra: Def[] = study.convex ? [
    { type: "shape", id: "test:convex_wall_shape", role: "thing", boxes: [], hulls: [{ corners: [[-1.5, -1.5, -.1], [1.5, -1.5, -.1], [-1.5, 1.5, -.1], [1.5, 1.5, -.1], [-1.5, -1.5, .1], [1.5, -1.5, .1], [-1.5, 1.5, .1], [1.5, 1.5, .1]] }] },
    { type: "structure", class: "static", id: "test:convex_wall", mesh: "test:convex_wall_mesh", shape: "test:convex_wall_shape", color: 5, half: [1.5, 1.5, .1], hp: 1600, material: "core:mat_thatch" },
  ] : [];
  const built = compileContent([...CORE_CONTENT.map(d => d.id === "core:parasaur" && d.type === "species" ? { ...d, mesh: rig.id, skeleton: rig.id, combat: { ...spec, primary: { ...spec.primary, radius: study.radius ?? spec.primary.radius, harvest: { materials: ["wood"], power: 1, damage: 1 } } } } : d), ...extra]);
  if (!built.registry) throw new Error(built.errors.join("\n"));
  const first = new Uint32Array(17); first.fill(1, 6);
  const map = flatMap(4, { nodes: node ? [{ kinds: ["core:tree"], first, kind: new Uint8Array(1), x: Uint16Array.of(56 * 1024), z: Uint16Array.of(Math.round(58.4 * 1024)), yaw: new Uint16Array(1) }] : [] });
  const art = study.brachio ? {} : { clips: clips(study), rigs: [nativeRig] };
  const h = new Harness({}, 1, 30, { map: writeMap(map), ...art }, built.registry);
  if (node) h.host.harvest!.field.retain(5, 0, 1, () => false);
  const e = h.host.spawnCreature(study.brachio ? "core:brachio" : "core:parasaur", 120, 120, 1); expect(e).toBeGreaterThanOrEqual(0);
  const ents = h.world.ents, actor = h.host.records.byPid.get(ents.pid[e]!)!;
  actor.genome!.wild.fill(0); actor.genome!.tamed.fill(0); ents.yaw[e] = 0; ents.driven[e] = 1;
  const victims: number[] = [];
  const target = (x: number, z: number) => {
    const rec = h.host.records.create(h.reg.index.get("core:survivor")!);
    rec.x = x; rec.y = 0; rec.z = z;
    const i = ents.create(rec.kind, x, 0, z, F_GROUNDED); ents.pid[i] = rec.pid; ents.pose(i, h.world.tick);
    h.host.records.entOf.set(rec.pid, i); h.host.survival.init(rec); victims.push(i);
    return { e: i, rec, hp: () => rec.vitals!.value[0]! / 1e6 };
  };
  const contacts = new CreatureContacts({ world: h.world, records: h.host.records, harvest: node ? h.host.harvest : null,
    test: (i, a, b, r) => h.host.combat.creatureTest(i, a, b, r),
    hit: (by, i, attack, mode, point, zone, power) => h.host.combat.creatureContact(by, i, attack, mode, point, zone, power),
    structure: (by, ref, attack, mode, point, power) => h.host.combat.creatureStructure(by, ref, attack, mode, point, power),
  });
  let frame = 0, start = 1000;
  const step = () => { h.world.tick = start + frame; ents.act[e] = ACT_SWING; ents.actTicks[e] = frame++; ents.pose(e, h.world.tick); contacts.step([e], 1); };
  const again = () => { ents.act[e] = ACT_NONE; contacts.step([e], 1); start += 30; frame = 0; };
  return { h, e, actor, ents, target, contacts, step, again };
}

test("animated tail contact reaches both sides once, misses behind, and cannot hit its own occupants", () => {
  const f = setup(), left = f.target(118.3, 121.7), right = f.target(121.7, 121.7), behind = f.target(120, 117.6), rider = f.target(120, 122.4);
  f.ents.seat[rider.e] = f.e + 1; f.ents.seatGen[rider.e] = f.ents.gen[f.e]!; f.ents.seatSlot[rider.e] = 1;
  const initial = [left.hp(), right.hp(), behind.hp(), rider.hp()];
  for (let i = 0; i < 6; i++) f.step(); expect([left.hp(), right.hp()]).toEqual(initial.slice(0, 2));
  for (let i = 6; i <= 24; i++) f.step();
  expect([initial[0]! - left.hp(), initial[1]! - right.hp()]).toEqual([30, 30]);
  expect([behind.hp(), rider.hp()]).toEqual(initial.slice(2));
  f.again(); for (let i = 0; i <= 24; i++) f.step();
  expect(f.h.host.combat.hits).toBe(4);
  expect(f.h.host.combat.last.damage).toBe(30); // Health regeneration between attacks remains active.

});
test("a wall between the animal and its swept socket blocks damage even when the socket reaches through", () => {
  const f = setup(), target = f.target(120, 122.4), health = target.hp();
  f.h.world.structs.add(f.h.reg.index.get("core:wall")!, 120, 1.5, 121.3, 0, 0, 1);
  for (let i = 0; i <= 24; i++) f.step(); expect(target.hp()).toBe(health);
});
test("a removed socket fails closed and a dead attacker cannot keep a previous sweep alive", () => {
  const f = setup(), target = f.target(120, 122.4), health = target.hp();
  f.actor.dead = true; for (let i = 0; i < 15; i++) f.step(); expect(target.hp()).toBe(health);
  f.actor.dead = false; f.h.world.anims[f.actor.kind] = null; for (let i = 15; i <= 24; i++) f.step(); expect(target.hp()).toBe(health);
});


test("swept structure damage uses material and ownership rules, once per action, without reaching through another wall", () => {
  const f = setup(), world = f.h.world, reg = f.h.reg, store = world.structs;
  const near = store.add(reg.index.get("core:wall_thatch")!, 120, 1.5, 122.05, 0, 2, 1600);
  const far = store.add(reg.index.get("core:wall_thatch")!, 120, 1.5, 122.6, 0, 2, 1600);
  const hp = (ref: number) => store.chunks[Math.floor(ref / 65536)]!.hp[ref & 65535]!;
  const before = hp(near), behind = hp(far);
  for (let i = 0; i <= 24; i++) f.step();
  const once = hp(near);
  expect(once).toBeLessThan(before); expect(hp(far)).toBe(behind);
  f.again(); for (let i = 0; i <= 24; i++) f.step();
  expect(once - hp(near)).toBeCloseTo(before - once, 4); expect(hp(far)).toBe(behind);
  f.actor.team = 2;
  const friendly = hp(near);
  f.again(); for (let i = 0; i <= 24; i++) f.step();
  expect(hp(near)).toBe(friendly);
});


test("animated node contact harvests once into the tame bag and cannot gather through a wall", () => {
  const f = setup(true), harvest = f.h.host.harvest!;
  f.actor.team = 9;
  const node = harvest.field.store.chunks[5]!;
  const before = node.hp[0]!;
  for (let i = 0; i <= 24; i++) f.step();
  expect(harvest.hits).toBe(1);
  expect(node.hp[0]!).toBeLessThan(before);
  expect(f.actor.inv!.total(f.h.reg.index.get("core:wood")!)).toBeGreaterThan(0);
  expect(f.h.host.items.audit()).toEqual([]);
  const left = node.hp[0]!;
  f.h.world.structs.add(f.h.reg.index.get("core:wall")!, 120, 1.5, 121.2, 0, 0, 10000);
  f.again(); for (let i = 0; i <= 24; i++) f.step();
  expect(harvest.hits).toBe(1); expect(node.hp[0]).toBe(left);
});

test("a socket sphere in front of two close walls damages only the visible surface, for boxes and convex parts", () => {
  for (const convex of [false, true]) {
    const f = setup(false, { socket: [0, .2, 1.8], radius: .8, convex }), store = f.h.world.structs;
    const kind = f.h.reg.index.get(convex ? "test:convex_wall" : "core:wall_thatch")!;
    const near = store.add(kind, 120, 1.5, 122.2, 0, 2, 1600), far = store.add(kind, 120, 1.5, 122.5, 0, 2, 1600);
    const hp = (ref: number) => store.chunks[Math.floor(ref / 65536)]!.hp[ref & 65535]!;
    const before = hp(near), behind = hp(far);
    for (let i = 0; i <= 24; i++) f.step();
    expect(hp(near)).toBeLessThan(before); expect(hp(far)).toBe(behind);
    // Moving the front wall aside exposes the same rear part: this is obstruction, not an unreachable hit volume.
    store.remove(near);
    f.again(); for (let i = 0; i <= 24; i++) f.step();
    expect(hp(far)).toBeLessThan(behind);
  }
});

test("a socket centre before a thin wall cannot harvest a tree within its radius behind that wall", () => {
  for (const blocked of [false, true]) {
    const f = setup(true, { socket: [0, .2, 1.4], radius: 1 }), harvest = f.h.host.harvest!;
    f.actor.team = 9;
    const node = harvest.field.store.chunks[5]!, before = node.hp[0]!;
    if (blocked) f.h.world.structs.add(f.h.reg.index.get("core:wall")!, 120, 1.5, 121.9, 0, 0, 10000);
    for (let i = 0; i <= 24; i++) f.step();
    expect(harvest.hits).toBe(blocked ? 0 : 1);
    if (blocked) { expect(node.hp[0]).toBe(before); expect(f.actor.inv?.total(f.h.reg.index.get("core:wood")!) ?? 0).toBe(0); }
    else { expect(node.hp[0]!).toBeLessThan(before); expect(f.actor.inv!.total(f.h.reg.index.get("core:wood")!)).toBeGreaterThan(0); }
  }
});

test("box and convex corner overlaps require the actual sphere, and contact reports that corner rather than object origin", () => {
  for (const convex of [false, true]) for (const within of [false, true]) {
    const offset = within ? .55 : .6;
    const f = setup(false, { socket: [1.5 + offset, .2, 2.1 - offset], radius: .8, convex }), store = f.h.world.structs;
    const kind = f.h.reg.index.get(convex ? "test:convex_wall" : "core:wall")!;
    const ref = store.add(kind, 120, 1.5, 122.2, 0, 2, 10000), points: number[][] = [];
    const front = store.chunks[Math.floor(ref / 65536)]!.z[ref & 65535]! - .1;
    f.contacts.ctx.structure = (_by, hit, _attack, _mode, point) => { expect(hit).toBe(ref); points.push([...point]); };
    for (let i = 0; i <= 24; i++) f.step();
    expect(points.length).toBe(within ? 1 : 0);
    if (within) {
      expect(points[0]![0]).toBeCloseTo(121.5, 4); expect(points[0]![1]).toBeCloseTo(1.2, 4); expect(points[0]![2]).toBeCloseTo(front, 4);
    }
  }
});

test("a moving sphere advances past a false expanded-box corner to its actual swept corner contact", () => {
  for (const convex of [false, true]) {
    const f = setup(false, { socket: [2.1, .2, 1.5], radius: .8, travelZ: .1, convex }), store = f.h.world.structs;
    const ref = store.add(f.h.reg.index.get(convex ? "test:convex_wall" : "core:wall")!, 120, 1.5, 122.2, 0, 2, 10000);
    const front = store.chunks[Math.floor(ref / 65536)]!.z[ref & 65535]! - .1;
    const points: number[][] = [];
    f.contacts.ctx.structure = (_by, _ref, _attack, _mode, point) => points.push([...point]);
    for (let i = 0; i < 6; i++) f.step(); expect(points).toEqual([]);
    f.step(); expect(points.length).toBe(1);
    expect(points[0]![0]).toBeCloseTo(121.5, 4); expect(points[0]![2]).toBeCloseTo(front, 4);
    for (let i = 7; i <= 24; i++) f.step(); expect(points.length).toBe(1);
  }
});

artTest("a ridden Brachiosaurus can stomp an exposed survivor but a standard wall shelters that same position", () => {
  for (const wall of [false, true]) {
    const f = setup(false, { brachio: true });
    try {
      const victim = f.target(121.04, 122.98);
      const before = victim.hp();
      if (wall) f.h.world.structs.add(f.h.reg.index.get("core:wall")!, 120.8, 1.5, 122.25, 0, 0, 10000);
      for (let frame = 0; frame <= 30; frame++) f.step();
      if (wall) expect(victim.hp()).toBe(before);
      else expect(victim.hp()).toBeLessThan(before);
    } finally {
      f.h.host.shutdown();
    }
  }
});
