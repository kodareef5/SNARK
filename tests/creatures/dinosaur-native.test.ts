// Registered content and real source packs through the authoritative host. Synthetic geometry has separate tests.
import { expect } from "bun:test";
import { test } from "../fixtures/needs-art.ts";
import { AnimState, bodySeed } from "../../shared/anim/pose.ts";
import { creaturePose } from "../../shared/anim/creature.ts";
import { ZONE_TORSO } from "../../shared/anim/human.ts";
import { boneToModel, solve } from "../../shared/anim/skeleton.ts";
import { SEAT_FLOATS, seatOn } from "../../shared/anim/seat.ts";
import { MIND_HUNT } from "../../server/behavior.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_CLOSE, CMD_CRAFT, CMD_FEED, CMD_LEARN, CMD_MOVE, CMD_OPEN, RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_MELEE, BTN_PRIMARY, BTN_RELOAD, BTN_SECONDARY, BTN_SPRINT, BTN_USE } from "../../shared/sim/character.ts";
import { F_AWAKE, F_GROUNDED, F_PLAYER } from "../../shared/sim/entities.ts";
import { ACT_COOL, ACT_DRAW, ACT_EQUIP, ACT_HOLD, ACT_NONE } from "../../shared/sim/weapon.ts";
import { IMPALE_SLOT } from "../../shared/sim/seats.ts";
import { V_HEALTH, V_TORPOR } from "../../shared/sim/vitals.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

function yard(species = "trike", node?: { kind: string; x: number; z: number }) {
  const first = new Uint32Array(17); first.fill(1, 6);
  const map = flatMap(4, { nodes: node ? [{ kinds: [node.kind], first, kind: new Uint8Array(1),
    x: Uint16Array.of(Math.round((node.x - 64) * 1024)), z: Uint16Array.of(Math.round((node.z - 64) * 1024)), yaw: new Uint16Array(1) }] : [] });
  const h = new Harness({}, 1, 60, { dev: true, map: writeMap(map) });
  const ada = h.join("ada"); h.run(300); h.say(ada, "enablecheats");
  const client = h.client(ada)!, me = h.host.records.byPid.get(client.pid)!, ents = h.world.ents;
  h.host.survival.gods.add(me.pid);
  h.say(ada, "tp 122 119.75");
  const e = h.host.spawnCreature(`core:${species}`, 120, 120, 1);
  expect(e).toBeGreaterThanOrEqual(0);
  const rec = h.host.records.byPid.get(ents.pid[e]!)!;
  rec.genome!.wild.fill(0); rec.genome!.tamed.fill(0); h.host.survival.init(rec);
  h.host.creatures.mind.stay(e, 0xffffffff); ents.yaw[e] = 0; ents.pose(e, h.world.tick);
  const anim = h.world.anims[rec.kind]!;
  expect(anim).not.toBeNull();
  expect(anim.rig.bones).toBeGreaterThanOrEqual(30);
  expect(anim.rig.clips.get("attack")!.bones).toBe(anim.rig.bones);
  expect(anim.rig.sockets.has("seat")).toBe(true);
  const pilot = h.pilots[0]!;
  if (node) h.host.harvest!.field.retain(5, 0, 1, () => false);
  const mount = () => {
    expect(h.host.taming.give(rec, me, 0, "forced")).toBe(true);
    rec.saddle = h.reg.index.get(`core:saddle_${species}`)!;
    h.host.refreshBody(rec); h.host.creatures.claimed(e);
    h.host.creatures.mind.stay(e, 0xffffffff);
    expect(h.host.riding.mount(client, e)).toBe(RESULT_OK);
    h.run(300);
    expect([client.drive, ada.driving, ents.seat[client.ent], ents.seatGen[client.ent]]).toEqual([e, e, e + 1, ents.gen[e]]);
  };
  const target = (x: number, z: number, health = 100) => {
    const victim = h.host.records.create(h.reg.index.get("core:survivor")!);
    victim.x = x; victim.y = 0; victim.z = z;
    const id = ents.create(victim.kind, x, 0, z, F_PLAYER | F_AWAKE | F_GROUNDED);
    ents.pid[id] = victim.pid; h.host.records.entOf.set(victim.pid, id); h.host.survival.init(victim);
    if (health < 100) h.host.survival.add(victim, V_HEALTH, health - 100);
    ents.pose(id, h.world.tick);
    return { e: id, rec: victim, hp: () => h.host.survival.value(victim, V_HEALTH) };
  };
  const press = (buttons: number, ms = 50) => { pilot.buttons = buttons; h.run(ms); pilot.buttons = 0; };
  return { h, ada, client, me, ents, e, rec, anim, pilot, mount, target, press };
}

function changeMode(f: ReturnType<typeof yard>, mode: number): void {
  for (let to = 1; to <= mode; to++) {
    f.press(BTN_RELOAD, 200);
    expect(f.ents.act[f.e]).toBe(ACT_EQUIP);
    expect(f.ents.creatureMode[f.e]).toBe(to - 1);
    f.h.run(500); expect(f.ents.creatureMode[f.e]).toBe(to);
    f.h.run(500); expect(f.ents.act[f.e]).toBe(ACT_NONE);
  }
}

test("native Trike horn sweep hits a front survivor once in its authored window, spares rider/rear, and respects a wall", () => {
  for (const blocked of [false, true]) {
    const f = yard(); f.mount();
    const front = f.target(120, 123.35), rear = f.target(120, 116.65), hits = f.h.host.combat.hits;
    if (blocked) f.h.world.structs.add(f.h.reg.index.get("core:wall_stone")!, 120, 1.5, 121.7, 0, 99, 10000);
    const committed: number[] = [];
    f.pilot.buttons = BTN_PRIMARY;
    for (let i = 0; i < 32; i++) {
      const before = f.h.host.combat.hits;
      f.h.run(1000 / 30);
      if (i === 2) f.pilot.buttons = 0;
      if (f.h.host.combat.hits > before) committed.push(f.ents.actTicks[f.e]!);
    }
    expect(f.h.host.combat.hits - hits).toBe(blocked ? 0 : 1);
    if (!blocked) { expect(committed[0]).toBeGreaterThanOrEqual(4); expect(committed[0]).toBeLessThanOrEqual(10); expect(front.hp()).toBeLessThan(70); }
    else expect(front.hp()).toBe(100);
    expect(rear.hp()).toBe(100);
    expect(f.h.host.survival.value(f.me, V_HEALTH)).toBe(100);
    expect(f.ents.act[f.e]).toBe(ACT_NONE);
    f.h.host.shutdown();
  }
});

test("native Trike ridden charge winds up, uses the moving horn once, slows the victim and recovers on cancel", () => {
  const f = yard(); f.mount();
  const victim = f.target(120, 130), hits = f.h.host.combat.hits;
  const from = f.ents.z[f.e]!, stamina = f.ents.stamina[f.e]!;
  f.pilot.buttons = BTN_SECONDARY;
  f.h.run(1000);
  expect(f.ents.act[f.e]).toBe(ACT_DRAW);
  expect(f.ents.z[f.e]).toBeCloseTo(from, 4);
  f.h.run(2300);
  expect(f.ents.act[f.e]).toBe(ACT_HOLD);
  expect(f.ents.z[f.e]!).toBeGreaterThan(from + 4);
  expect(f.h.host.combat.hits - hits).toBe(1);
  expect(victim.hp()).toBeLessThan(60);
  expect(f.ents.speedQ[victim.e]).toBeLessThan(1000);
  expect(f.ents.stamina[f.e]!).toBeLessThan(stamina - 12000);
  f.press(BTN_MELEE, 200);
  expect(f.ents.act[f.e]).toBe(ACT_COOL);
  expect(f.ents.creatureCooldown[f.e]).toBeGreaterThan(0);
  f.h.run(1000);
  expect(f.ents.act[f.e]).toBe(ACT_NONE);
  expect(f.h.host.combat.hits - hits).toBe(1);
  f.h.host.shutdown();
});

test("native Trike defense recruits its herd and chooses an opportunistic charge through the shared controller", () => {
  const f = yard(), ai = f.h.reg.combat[f.rec.kind]!.ai;
  expect(ai?.primary).toEqual({ bearing: 0, distance: 3.35, arc: 30 });
  expect(ai?.charge).toEqual({ minDistance: 7, maxDistance: 16 });
  const herd = f.h.host.spawnCreature("core:trike", 124, 120, 1), target = f.target(120, 132);
  f.h.host.creatures.mind.stay(herd, 0xffffffff);
  f.h.host.creatures.provoke(f.e, 120, 132, target.e);
  expect(f.h.host.creatures.mind.mind[herd]).toBe(MIND_HUNT);
  const acts = new Set<number>();
  for (let i = 0; i < 150 && target.hp() === 100; i++) { f.h.run(1000 / 30); acts.add(f.ents.act[f.e]!); }
  expect(acts.has(ACT_DRAW)).toBe(true); expect(acts.has(ACT_HOLD)).toBe(true);
  expect(target.hp()).toBeLessThan(100);
  f.h.host.shutdown();
});

const saddleCases = [
  { species: "trike", hide: 140, fiber: 80, wood: 25, torpor: 251 },
  { species: "stego", hide: 200, fiber: 110, wood: 35, torpor: 501 },
];

for (const { species, hide, fiber, wood, torpor } of saddleCases) test(`a survivor crafts a native ${species} saddle, tames with berries and mounts the moving seat`, () => {
  const f = yard(species);
  const id = (name: string) => f.h.reg.index.get(`core:${name}`)!;
  const berry = id("berry"), saddle = id(`saddle_${species}`);
  const bag = f.h.host.items.inv(f.me);
  const command = (op: number, write?: (w: BitWriter) => void) => {
    const seq = f.ada.command(op, write);
    expect(seq).toBeGreaterThan(0);
    let result = -1;
    f.ada.onResult = (ack, code) => { if (ack === seq) result = code; };
    f.h.run(200);
    expect(result).toBe(RESULT_OK);
  };
  const transfer = (item: number) => {
    const from = f.ada.inventory!.item.indexOf(item), to = f.ada.open!.inventory.free();
    expect(from).toBeGreaterThanOrEqual(0); expect(to).toBeGreaterThanOrEqual(0);
    command(CMD_MOVE, w => {
      w.bits(BOX_SELF, 1); w.varint(from);
      w.bits(BOX_OPEN, 1); w.varint(to);
      w.u16(0); w.u16(item);
    });
    return to;
  };
  const use = () => {
    f.pilot.yaw = Math.atan2(f.ents.x[f.e]! - f.ents.x[f.client.ent]!, f.ents.z[f.e]! - f.ents.z[f.client.ent]!);
    f.pilot.pitch = 0;
    f.h.run(200); f.press(BTN_USE, 150); f.h.run(200);
  };

  const materials = [[id("hide"), hide], [id("fiber"), fiber], [id("wood"), wood]] as const;
  const startingAmounts = materials.map(([item]) => bag.total(item));
  for (const [item, count] of materials) expect(f.h.host.items.mint(f.me, item, count)).toBe(count);
  expect(f.h.host.items.mint(f.me, berry, 3)).toBe(3);
  f.h.host.progression.addXp(f.me, 1_000_000); f.h.run(300);
  command(CMD_LEARN, w => w.u16(id(`engram-saddle_${species}`)));
  command(CMD_CRAFT, w => { w.u16(saddle); w.u8(1); });
  f.h.run(10000);
  expect(bag.total(saddle)).toBe(1);
  expect(materials.map(([item]) => bag.total(item))).toEqual(startingAmounts);

  f.h.say(f.ada, "setting TamingSpeedMultiplier 1000");
  f.h.host.survival.add(f.rec, V_TORPOR, torpor); f.h.run(100);
  expect(f.rec.out).toBe(true); expect(f.rec.tame).not.toBeNull();
  use();
  expect(f.client.open).toBe(f.rec.pid);
  transfer(berry);
  expect(bag.total(berry)).toBe(0); expect(f.rec.inv!.total(berry)).toBe(3);
  f.h.run(16000);
  expect(f.h.host.taming.bites).toBe(0); expect(f.rec.team).toBe(0);
  f.h.run(4000);
  expect([f.h.host.taming.bites, f.h.host.taming.tamed, f.rec.out, f.rec.tame, f.rec.team]).toEqual([1, 1, false, null, f.me.team]);
  expect(f.rec.inv!.total(berry)).toBe(2);

  if (f.client.open !== f.rec.pid) command(CMD_OPEN, w => w.u32(f.e));
  const slot = transfer(saddle);
  expect(bag.total(saddle)).toBe(0); expect(f.rec.inv!.item[slot]).toBe(saddle);
  command(CMD_FEED, w => { w.varint(slot); w.u16(saddle); });
  command(CMD_CLOSE);
  expect(f.rec.inv!.total(saddle)).toBe(0); expect(f.rec.saddle).toBe(saddle);
  use();
  expect([f.client.drive, f.ada.driving, f.ents.seat[f.client.ent], f.ents.seatGen[f.client.ent]]).toEqual([f.e, f.e, f.e + 1, f.ents.gen[f.e]]);
  f.pilot.yaw = 0;
  const frame = new Float64Array(SEAT_FLOATS), state = new AnimState();
  const seat = f.h.reg.saddleSeats[f.rec.saddle]![0]!;
  f.pilot.moveZ = 1; f.pilot.buttons = BTN_SPRINT;
  const from = f.ents.z[f.e]!, fromX = f.ents.x[f.e]!;
  for (let i = 0; i < 12; i++) {
    f.h.run(100);
    state.unpack(f.ents.anim[f.e]!, f.ents.cue[f.e]!); state.seed = bodySeed(f.e);
    seatOn(f.anim, seat, state, f.h.world.tick, f.ents.x[f.e]!, f.ents.y[f.e]!, f.ents.z[f.e]!, f.ents.yaw[f.e]! * Math.PI * 2 / 65536, frame);
    expect(f.ents.x[f.client.ent]).toBeCloseTo(frame[0]!, 4);
    expect(f.ents.y[f.client.ent]).toBeCloseTo(frame[1]!, 4);
    expect(f.ents.z[f.client.ent]).toBeCloseTo(frame[2]!, 4);
  }
  expect(Math.hypot(f.ents.x[f.e]! - fromX, f.ents.z[f.e]! - from)).toBeGreaterThan(3);
  f.pilot.moveZ = f.pilot.buttons = 0; f.h.run(300);
  f.press(BTN_USE, 150); f.h.run(300);
  expect(f.ents.seat[f.client.ent]).toBe(0);
  const human = f.h.reg.move[f.me.kind]!;
  expect(capsuleFree(f.h.world, f.ents.x[f.client.ent]!, f.ents.y[f.client.ent]!, f.ents.z[f.client.ent]!, human.radius, human.crouchHeight)).toBe(true);
  expect(f.h.host.items.audit()).toEqual([]);
  f.h.host.shutdown();
});

test("native Stego alternates both rear-quarter tail sweeps, hits within its window, and leaves a front target alone", () => {
  const f = yard("stego"); f.mount();
  const left = f.target(117.35, 115.41), right = f.target(122.65, 115.41), front = f.target(120, 125.3);
  const hitFrames: number[] = [], sides = new Set<number>();
  for (let attack = 0; attack < 2; attack++) {
    f.pilot.buttons = BTN_PRIMARY;
    for (let i = 0; i < 42; i++) {
      const hits = f.h.host.combat.hits;
      f.h.run(1000 / 30);
      if (i === 3) f.pilot.buttons = 0;
      if (f.h.host.combat.hits > hits) { hitFrames.push(f.ents.actTicks[f.e]!); sides.add(f.ents.creatureSide[f.e]!); }
    }
  }
  expect(hitFrames.length).toBe(2); expect(sides).toEqual(new Set([0, 1]));
  for (const tick of hitFrames) { expect(tick).toBeGreaterThanOrEqual(14); expect(tick).toBeLessThanOrEqual(21); }
  expect(left.hp()).toBeLessThan(65); expect(right.hp()).toBeLessThan(65); expect(front.hp()).toBe(100);
  expect(f.h.host.survival.value(f.me, V_HEALTH)).toBe(100);
  f.h.host.shutdown();
});

test("native Stego defense turns its rear quarter toward a frontal threat before landing the authored tail", () => {
  const f = yard("stego"), target = f.target(120, 125.3);
  f.h.host.creatures.provoke(f.e, 120, 125.3, target.e);
  let bearing = 0;
  for (let i = 0; i < 240 && target.hp() === 100; i++) {
    f.h.run(1000 / 30);
    const aim = Math.atan2(f.ents.x[target.e]! - f.ents.x[f.e]!, f.ents.z[target.e]! - f.ents.z[f.e]!) * 65536 / (2 * Math.PI);
    bearing = Math.abs((((aim - f.ents.yaw[f.e]! + 32768) % 65536 + 65536) % 65536) - 32768) * 360 / 65536;
  }
  expect(target.hp()).toBeLessThan(100);
  expect(bearing).toBeGreaterThan(125); expect(bearing).toBeLessThan(175);
  f.h.host.shutdown();
});

test("native Stego plate transitions change posed plates and apply hardened resistance, heavy slow and sharpened armor piercing", () => {
  const dealt: number[] = [], taken: number[] = [], poses: Float32Array[] = [];
  for (let mode = 0; mode < 3; mode++) {
    const f = yard("stego"); f.mount();
    changeMode(f, mode);
    const st = new AnimState(); st.unpack(f.ents.anim[f.e]!, f.ents.cue[f.e]!); st.seed = bodySeed(f.e);
    creaturePose(f.anim, st, f.h.world.tick, f.anim.rig.a);
    const plate = f.anim.rig.names.findIndex(n => n.startsWith("plate")); expect(plate).toBeGreaterThanOrEqual(0);
    poses.push(f.anim.rig.a.rot.slice(plate * 4, plate * 4 + 4));
    const victim = f.target(122.65, 115.41), inv = f.h.host.items.inv(victim.rec);
    for (const [slot, name] of ["hat", "shirt", "gloves", "pants", "boots"].entries()) {
      const item = f.h.reg.index.get(`core:flak_${name}`)!;
      expect(f.h.host.items.mint(victim.rec, item, 1)).toBe(1);
      expect(f.h.host.items.move(victim.rec, inv.item.indexOf(item), victim.rec, inv.armor + slot, 1)).toBe(1);
    }
    f.press(BTN_PRIMARY, 150); f.h.run(1200);
    expect(f.h.host.combat.hits).toBe(1); dealt.push(f.h.host.combat.last.damage);
    expect(f.ents.speedQ[victim.e]).toBe(mode === 1 ? 500 : 1000);
    const primary = f.h.reg.combat[f.h.reg.index.get("core:trike")!]!.primary;
    f.h.host.combat.creatureContact(victim.rec, f.e, primary, undefined, [120, 1.5, 120], ZONE_TORSO, 1, true);
    taken.push(f.h.host.combat.last.damage);
    expect(f.h.host.items.audit()).toEqual([]);
    f.h.host.shutdown();
  }
  expect(poses[0]).not.toEqual(poses[1]); expect(poses[1]).not.toEqual(poses[2]);
  expect(taken[1]!).toBeCloseTo(taken[0]! * 2, 5); expect(taken[2]!).toBeCloseTo(taken[1]!, 5);
  expect(dealt[1]!).toBeCloseTo(dealt[0]!, 5); expect(dealt[2]!).toBeGreaterThan(dealt[0]! * 5.5);
});

test("native horn and tail harvesting deposits resources once per strike and Stego modes favor their authored materials", () => {
  for (const kind of ["core:tree", "core:bush"]) {
    const f = yard("trike", { kind, x: 120, z: 123.35 }); f.mount();
    f.press(BTN_PRIMARY, 150); f.h.run(900);
    expect(f.h.host.harvest!.hits).toBe(1);
    expect(f.rec.inv!.total(f.h.reg.index.get(kind === "core:tree" ? "core:thatch" : "core:berry")!)).toBeGreaterThan(0);
    expect(f.h.host.items.audit()).toEqual([]); f.h.host.shutdown();
  }
  const yields: number[][] = [];
  for (let mode = 0; mode < 3; mode++) {
    const got = [0, 0, 0];
    for (const kind of ["core:tree", "core:bush"]) {
      const f = yard("stego", { kind, x: 122.65, z: 115.41 }); f.mount(); changeMode(f, mode);
      f.press(BTN_PRIMARY, 150); f.h.run(1200);
      expect(f.h.host.harvest!.hits).toBe(1);
      for (const [i, item] of ["core:wood", "core:thatch", "core:berry"].entries()) got[i]! += f.rec.inv!.total(f.h.reg.index.get(item)!);
      expect(f.h.host.items.audit()).toEqual([]); f.h.host.shutdown();
    }
    yields.push(got);
  }
  expect(yields[0]![0]!).toBeGreaterThan(yields[1]![0]!);
  expect(yields[1]![1]!).toBeGreaterThan(yields[0]![1]!);
  expect(yields[2]![2]!).toBeGreaterThan(yields[0]![2]!);
});

test("native Stego impale acquires a wounded enemy through its real strike, damages while attached and releases safely", () => {
  const f = yard("stego"); f.mount();
  // Measured committed secondary strike at tick25; the target stays on the ground rather than being moved onto the socket.
  const victim = f.target(116.84307, 114.94066, 45), bystander = f.target(120, 125.3);
  f.press(BTN_SECONDARY, 150);
  let acquired = false;
  for (let i = 0; i < 40; i++) {
    f.h.run(1000 / 30);
    if (f.h.host.impale.holding(f.rec.pid)) { acquired = true; break; }
  }
  expect(victim.hp()).toBeLessThan(45);
  expect(acquired).toBe(true);
  expect([f.ents.seat[victim.e], f.ents.seatGen[victim.e], f.ents.seatSlot[victim.e]]).toEqual([f.e + 1, f.ents.gen[f.e], IMPALE_SLOT]);
  expect(f.ents.act[f.e]).toBe(ACT_HOLD);
  const hp = victim.hp(), st = new AnimState(), point = new Float64Array(3);
  f.h.run(300);
  expect(victim.hp()).toBeLessThan(hp);
  st.unpack(f.ents.anim[f.e]!, f.ents.cue[f.e]!); st.seed = bodySeed(f.e);
  creaturePose(f.anim, st, f.h.world.tick, f.anim.rig.a); solve(f.anim.rig, f.anim.rig.a, f.anim.rig.solved);
  const socket = f.anim.rig.sockets.get(f.h.reg.combat[f.rec.kind]!.secondary!.impale!.socket)!;
  boneToModel(f.anim.rig.solved, socket.bone, socket.x, socket.y, socket.z, point);
  expect(f.ents.y[victim.e]! + f.h.reg.bodyHeight[victim.rec.kind]! * .5).toBeCloseTo(f.ents.y[f.e]! + point[1]!, 4);
  f.press(BTN_SECONDARY, 200); f.h.run(100);
  expect(f.h.host.impale.holding(f.rec.pid)).toBe(0); expect(f.ents.seat[victim.e]).toBe(0);
  const human = f.h.reg.move[victim.rec.kind]!;
  expect(capsuleFree(f.h.world, f.ents.x[victim.e]!, f.ents.y[victim.e]!, f.ents.z[victim.e]!, human.radius, human.height)).toBe(true);
  expect(bystander.hp()).toBe(100);
  f.h.host.shutdown();
});
