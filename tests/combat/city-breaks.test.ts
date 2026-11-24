// What harm does to a city piece: its panes, its stages, its forms, its heap, and the rules that govern them.

import { expect, test } from "bun:test";
import { cityWord } from "../../client/core/prompts.ts";
import type { Hear } from "../../client/core/sound/bodies.ts";
import { BuildSounds } from "../../client/core/sound/build.ts";
import type { Source } from "../../server/combat.ts";
import { FORM_BREACH_A, FORM_BREACH_B, FORM_HEAP, FORM_OPEN, FORM_WHOLE, formKind } from "../../shared/content/breaks.ts";
import { KEYS } from "../../shared/sound/cues.ts";
import { DMG_MELEE } from "../../shared/sim/damage.ts";
import { STAGE_CRACKED, STAGE_FAILING, STAGE_WHOLE, STAGE_WORN, bodyHealth, heapHealth, paned, stageOf, variantAt } from "../../shared/world/breaking.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { HIT_STRUCTURE, castWorld, rayHit } from "../../shared/world/ray.ts";
import { GONE_BLAST, GONE_TAKEN } from "../../shared/world/structures.ts";
import { GRENADE_REACH, ROCKET_REACH, city, grenade, rifle, rocket, type City } from "../fixtures/city.ts";
import { count, put, record, survivor } from "../kit/kit.ts";

const version = (c: City, ref: number): number => c.h.world.structs.chunks[Math.floor(ref / 65536)]!.version;
const mapKind = (c: City, ref: number): number => c.h.world.structs.mapKind(Math.floor(ref / 65536), ref & 0xffff);
/** A blast no piece outlives a rung of. */
const huge = (c: City): Source => ({ ...rocket(c.h.reg), base: 1e7 });
/** A rocket at the face of `ref`, `along` metres along its length from its middle. */
function fire(c: City, ref: number, along = 0, src: Source = rocket(c.h.reg), reach = ROCKET_REACH): void {
  const p = c.at(ref);
  c.h.host.combat.blast(src, p.x + along, p.y, p.z - 0.5, reach);
}

test("a bullet takes a window's glass and no more", () => {
  const c = city([{ shape: "zwin", finish: "limestucco", x: 100, z: 100 }, { shape: "wall8", finish: "limestucco", x: 100, z: 120 }]);
  const [win, wall] = c.refs as [number, number];
  const { reg, host } = c.h;
  const body = bodyHealth(reg, mapKind(c, win));
  expect([c.full(win), body]).toEqual([10000, 9700]);
  const at = c.at(win);
  const v = version(c, win);
  // A rifle round's 280 leaves the panes 20, which the next takes: neither goes into the wall round them.
  expect(host.combat.hitStructure(rifle(reg), win, at.x, at.y, at.z)).toBe(280);
  expect([c.hp(win), paned(reg, mapKind(c, win), c.hp(win)), version(c, win) - v]).toEqual([9720, true, 0]);
  expect(host.combat.hitStructure(rifle(reg), win, at.x, at.y, at.z)).toBe(20);
  // The panes going is seen, so it is told.
  expect([c.hp(win), paned(reg, mapKind(c, win), c.hp(win)), version(c, win) - v, c.form(win)]).toEqual([body, false, 1, FORM_WHOLE]);
  for (let k = 0; k < 5; k++) expect(host.combat.hitStructure(rifle(reg), win, at.x, at.y, at.z)).toBe(0);
  expect([c.hp(win), stageOf(reg, mapKind(c, win), c.hp(win))]).toEqual([body, STAGE_WHOLE]);
  // A wall of block with no panes takes no bullet at all.
  expect([host.combat.hitStructure(rifle(reg), wall, 100, 1, 120), c.hp(wall)]).toEqual([0, c.full(wall)]);
});

test("a grenade wears a concrete wall and tells nothing until a stage is crossed", () => {
  const c = city([{ shape: "wall8", finish: "concrete", x: 100, z: 100 }]);
  const wall = c.refs[0]!;
  const { reg, world } = c.h;
  const chunk = Math.floor(wall / 65536);
  const v = version(c, wall);
  expect([c.full(wall), world.structs.asPlaced(chunk)]).toEqual([23400, true]);
  // 788 to what is built, 2.33 times to concrete: four leave it over two thirds.
  for (let k = 1; k <= 4; k++) {
    fire(c, wall, 0, grenade(reg), GRENADE_REACH);
    expect(c.hp(wall)).toBeCloseTo(23400 - k * 788 * 2.33, 0);
    expect([version(c, wall) - v, stageOf(reg, mapKind(c, wall), c.hp(wall))]).toEqual([0, STAGE_WHOLE]);
  }
  // The wall no longer stands as the map placed it, so it is saved and a client that comes later is sent its health.
  expect([world.structs.asPlaced(chunk), [...world.structs.changedSlots(chunk)]]).toEqual([false, [wall & 0xffff]]);
  expect(c.h.host.combat.city.silent).toBe(4);
  fire(c, wall, 0, grenade(reg), GRENADE_REACH);
  expect([version(c, wall) - v, stageOf(reg, mapKind(c, wall), c.hp(wall)), c.form(wall)]).toEqual([1, STAGE_WORN, FORM_WHOLE]);
});

test("a stage is the body's health over 2/3, 1/3 and 1/6 of the map kind's", () => {
  const c = city([{ shape: "zwin", finish: "limestucco", x: 100, z: 100 }]);
  const reg = c.h.reg, kind = mapKind(c, c.refs[0]!);
  const body = bodyHealth(reg, kind);
  const at = (share: number): number => stageOf(reg, kind, body * share);
  expect([stageOf(reg, kind, 10000), at(1), at(0.67), at(0.66), at(0.34), at(0.33), at(0.17), at(0.16), at(0)]).toEqual([STAGE_WHOLE, STAGE_WHOLE, STAGE_WHOLE, STAGE_WORN, STAGE_WORN, STAGE_CRACKED, STAGE_CRACKED, STAGE_FAILING, STAGE_FAILING]);
});

test("a rocket into one half of a wall leaves the other half's form whole", () => {
  const c = city([{ shape: "wall8", finish: "limestucco", x: 100, z: 100 }, { shape: "wall8", finish: "limestucco", x: 100, z: 140 }, { shape: "pier8", finish: "concrete", x: 140, z: 100 }, { shape: "wall8", finish: "limestucco", x: 150, z: 150, yaw: 16384 }]);
  const [west, east, pier, turned] = c.refs as [number, number, number, number];
  const world = c.h.world;
  fire(c, west, -2);
  fire(c, east, 2);
  expect([c.form(west), c.form(east)]).toEqual([FORM_BREACH_A, FORM_BREACH_B]);
  // The variant is the piece's place's, and its health is under a third and over none.
  const p = c.at(west);
  expect(c.id(west)).toBe(`core:zzzzzzbreak_wall8_a_${variantAt(p.x, p.y, p.z)}`);
  expect(c.hp(west) > 0 && c.hp(west) <= 5000).toBe(true);
  // A shot through the breached half's mouth goes by, and one at the other half meets the wall.
  const through = (x: number): number => castWorld(world, x, 1, 96, 0, 0, 1, 8);
  expect([through(98) === HIT_STRUCTURE && rayHit.ref === west, through(102) === HIT_STRUCTURE && rayHit.ref === west]).toEqual([false, true]);
  // A pier's halves are its lower and its upper.
  const q = c.at(pier);
  for (let k = 0; k < 2; k++) c.h.host.combat.blast(rocket(c.h.reg), q.x, q.y + 2.5, q.z - 0.6, ROCKET_REACH);
  expect(c.form(pier)).toBe(FORM_BREACH_B);
  // A wall turned a quarter is breached by its own frame's half: its length now lies along Z.
  const t = c.at(turned);
  c.h.host.combat.blast(rocket(c.h.reg), t.x - 0.5, t.y, t.z + 2, ROCKET_REACH);
  expect(c.form(turned)).toBe(FORM_BREACH_A);
});

test("one huge hit makes one breach, not an open piece", () => {
  const c = city([{ shape: "wall8", finish: "limestucco", x: 100, z: 100 }]);
  const wall = c.refs[0]!;
  const body = bodyHealth(c.h.reg, mapKind(c, wall));
  fire(c, wall, -2, huge(c));
  expect([c.form(wall), c.hp(wall)]).toEqual([FORM_BREACH_A, 1]);
  fire(c, wall, 2, huge(c));
  // Opened, it is left a quarter of its body's health.
  expect([c.form(wall), c.hp(wall)]).toEqual([FORM_OPEN, body / 4]);
  fire(c, wall, 0, huge(c));
  expect(c.form(wall)).toBe(FORM_HEAP);
});

test("a piece on the ground ends as its heap and one in the air is removed", () => {
  const c = city([
    { shape: "wall8", finish: "limestucco", x: 100, z: 100 }, { shape: "wall8", finish: "limestucco", x: 100, z: 140, up: 9 },
    // One on a wall that stands, and a pair that go together.
    { shape: "wall8", finish: "concrete", x: 150, z: 100 }, { shape: "wall8", finish: "limestucco", x: 150, z: 100, up: 2.8 },
    { shape: "wall4", finish: "limestucco", x: 150, z: 150 }, { shape: "wall4", finish: "limestucco", x: 150, z: 150, up: 2.8 },
  ]);
  const [ground, air, under, on, low, high] = c.refs as [number, number, number, number, number, number];
  const structs = c.h.world.structs;
  const down = (ref: number): void => {
    for (let k = 0; k < 3; k++) fire(c, ref, 0, huge(c));
  };
  down(ground);
  expect([c.form(ground), c.hp(ground)]).toEqual([FORM_HEAP, heapHealth(c.h.reg, mapKind(c, ground))]);
  const p = c.at(ground);
  expect(c.id(ground)).toBe(`core:zzzzzzbreak_wall8_heap_${variantAt(p.x, p.y, p.z)}`);
  down(air);
  expect(c.id(air)).toBe("");
  // The slot is still the map's, and the chunk remembers both as the map's changed slots.
  expect(structs.mapKind(Math.floor(air / 65536), air & 0xffff)).toBe(c.h.reg.index.get("core:zruin_wall8_limestucco")!);
  // Its batches: the heap left in place, then the slot emptied, each a blast with its centre and reach.
  const gone = structs.chunks[Math.floor(ground / 65536)]!.gone.at(-1)!;
  expect([gone.cause, gone.radius, gone.left, gone.runs, [gone.x, gone.z]]).toEqual([GONE_BLAST, ROCKET_REACH, [ground & 0xffff, 1], [], [100, 99.5]]);
  expect(structs.chunks[Math.floor(air / 65536)]!.gone.at(-1)!.runs).toEqual([air & 0xffff, 1]);
  // A blast high on the upper wall leaves the concrete under it standing, and the upper one falls to a heap on it.
  const q = c.at(on);
  for (let k = 0; k < 3; k++) c.h.host.combat.blast({ ...rocket(c.h.reg), base: 3000 }, q.x, q.y + 1.2, q.z - 0.5, 3);
  expect([c.form(under), c.form(on)]).toEqual([FORM_WHOLE, FORM_HEAP]);
  // Two that go in one blast: the lower on the ground is a heap, and the upper had nothing left to rest on.
  for (const ref of [low, high]) for (let k = 0; k < 2; k++) c.h.host.combat.hitStructure(huge(c), ref, 150, 1, 150);
  expect([c.form(low), c.form(high)]).toEqual([FORM_OPEN, FORM_OPEN]);
  const r = c.at(low);
  c.h.host.combat.blast(huge(c), r.x, r.y + 1.4, r.z - 0.5, ROCKET_REACH);
  expect([c.form(low), c.id(high)]).toEqual([FORM_HEAP, ""]);
  const both = structs.chunks[Math.floor(low / 65536)]!.gone.at(-1)!;
  expect([both.left, both.runs, both.count]).toEqual([[low & 0xffff, 1], [high & 0xffff, 1], 2]);
});

test("a piece with no breach opens, a shell stops at open, a plain piece is removed", () => {
  const c = city([{ shape: "beam8", finish: "concrete", x: 100, z: 100, up: 3 }, { shape: "zshaft8", finish: "concrete", x: 100, z: 140 }, { shape: "flight", finish: "concrete", x: 150, z: 100 }]);
  const [beam, shell, ramp] = c.refs as [number, number, number];
  fire(c, beam, 0, huge(c));
  expect([c.form(beam), c.hp(beam)]).toEqual([FORM_OPEN, c.full(beam) / 4]);
  for (let k = 0; k < 2; k++) fire(c, shell, 0, huge(c));
  expect(c.form(shell)).toBe(FORM_OPEN);
  const left = c.hp(shell);
  for (let k = 0; k < 3; k++) fire(c, shell, 0, huge(c));
  expect([c.form(shell), c.hp(shell)]).toEqual([FORM_OPEN, left]);
  // A flight of stairs never breaks: it is harmed as it was and gone at once, leaving nothing.
  fire(c, ramp, 0, grenade(c.h.reg), GRENADE_REACH);
  expect(c.hp(ramp)).toBeLessThan(c.full(ramp));
  expect(c.form(ramp)).toBe(FORM_WHOLE);
  fire(c, ramp, 0, huge(c));
  expect(c.id(ramp)).toBe("");
});

test("a piece behind two storeys of a blast is hurt less than one beside it", () => {
  // Each 3.75 m from the blast by its nearest point: one level with it, one over it.
  const c = city([{ shape: "wall4", finish: "limestucco", x: 100, z: 104 }, { shape: "wall4", finish: "limestucco", x: 100, z: 100, up: 5.15 }]);
  const [beside, above] = c.refs as [number, number];
  c.h.host.combat.blast(grenade(c.h.reg), 100, 1.4, 100, ROCKET_REACH);
  const lost = (ref: number): number => c.full(ref) - c.hp(ref);
  // What is past the two metres a storey clears counts twice: 5.5 m against 3.75 m, of a reach of 7.5 m.
  expect(lost(beside)).toBeCloseTo(788 * 3.5 * (1 - 2.75 / 6.5), -1);
  expect(lost(above)).toBeCloseTo(788 * 3.5 * (1 - 4.5 / 6.5), -1);
  expect(lost(above)).toBeLessThan(lost(beside) * 0.6);
});

test("a heap is mined for its yield, and its slot is never given to a built piece", () => {
  const c = city([{ shape: "wall8", finish: "limestucco", x: 100, z: 100 }, { shape: "wall8", finish: "limestucco", x: 100, z: 140 }]);
  const [wall, other] = c.refs as [number, number];
  const { h } = c;
  const reg = h.reg, structs = h.world.structs;
  for (const ref of [wall, other]) for (let k = 0; k < 3; k++) fire(c, ref, 0, huge(c));
  expect([c.form(wall), c.hp(wall)]).toEqual([FORM_HEAP, 48]);
  const ada = survivor(h, "ada");
  const rec = record(h, ada);
  const pick: Source = { by: rec, x: 100, z: 99, item: reg.index.get("core:pick")!, base: 16, type: DMG_MELEE, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0, pierce: 0 };
  const v = version(c, wall);
  const before = count(h, ada, "stone");
  // A pick's power is 3: a blow strikes 3 of the heap's 48 away, and gives that share of a block wall's 60 stone.
  expect(h.host.combat.hitStructure(pick, wall, 100, 1, 100)).toBe(3);
  expect([c.hp(wall), count(h, ada, "stone") - before, version(c, wall) - v]).toEqual([45, 3, 0]);
  for (let k = 0; k < 7; k++) h.host.combat.hitStructure(pick, wall, 100, 1, 100);
  expect([c.hp(wall), count(h, ada, "stone") - before]).toEqual([24, 30]);
  // Bare hands mine it too, a third as fast.
  expect(h.host.combat.hitStructure({ ...pick, item: 0, base: 8 }, wall, 100, 1, 100)).toBe(1);
  for (let k = 0; k < 8; k++) h.host.combat.hitStructure(pick, wall, 100, 1, 100);
  // Mined out, it has given all of it, and its slot is emptied with no cause to show.
  expect([c.id(wall), count(h, ada, "stone") - before]).toEqual(["", 60]);
  const batch = structs.chunks[Math.floor(wall / 65536)]!.gone.at(-1)!;
  expect([batch.cause, batch.runs, batch.left]).toEqual([GONE_TAKEN, [wall & 0xffff, 1], []]);
  expect(rec.xp).toBeGreaterThan(0);
  // A piece built in that chunk takes a slot past the map's, and the emptied one stays the map's.
  const chunk = Math.floor(wall / 65536);
  const built = structs.add(reg.index.get("core:wall")!, 100, 1.5, 104, 0, rec.team, 100);
  expect([Math.floor(built / 65536), (built & 0xffff) >= structs.chunks[chunk]!.mapped, structs.chunks[chunk]!.kind[wall & 0xffff]]).toEqual([chunk, true, 0]);
  // An explosive clears a heap, and nobody is given what it held.
  const held = count(h, ada, "stone");
  h.host.combat.blast({ ...rocket(reg), by: rec }, 100, 1, 139.5, ROCKET_REACH);
  expect([c.id(other), count(h, ada, "stone")]).toEqual(["", held]);
  expect(h.host.items.audit()).toEqual([]);
});

test("RubbleYieldMultiplier scales a heap's yield, and CityToolSalvage off stops it", () => {
  const c = city([{ shape: "wall4", finish: "concrete", x: 100, z: 100 }, { shape: "zpartition", finish: "concrete", x: 100, z: 140 }]);
  const [wall, partition] = c.refs as [number, number];
  const { h } = c;
  for (let k = 0; k < 3; k++) fire(c, wall, 0, huge(c));
  expect(c.form(wall)).toBe(FORM_HEAP);
  const ada = survivor(h, "ada");
  const rec = record(h, ada);
  const pick: Source = { by: rec, x: 100, z: 99, item: h.reg.index.get("core:pick_metal")!, base: 32, type: DMG_MELEE, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0, pierce: 0 };
  expect(h.host.rules.assign("CityToolSalvage", "False", "console")).toBe("");
  expect([h.host.combat.hitStructure(pick, wall, 100, 1, 100), h.host.combat.hitStructure(pick, partition, 100, 1, 140), c.hp(partition)]).toEqual([0, 0, c.full(partition)]);
  expect(h.host.rules.assign("CityToolSalvage", "True", "console")).toBe("");
  expect(h.host.rules.assign("RubbleYieldMultiplier", "2", "console")).toBe("");
  // A tool cuts plaster: a metal pick's 32, by half.
  expect([h.host.combat.hitStructure(pick, partition, 100, 1, 140), c.hp(partition)]).toEqual([16, c.full(partition) - 16]);
  for (let k = 0; k < 5; k++) h.host.combat.hitStructure(pick, wall, 100, 1, 100);
  // One half of concrete gives 40 stone, 10 flint and 6 ore: twice that here.
  expect([c.id(wall), count(h, ada, "stone"), count(h, ada, "flint"), count(h, ada, "ore")]).toEqual(["", 80, 20, 12]);
});

test("a body standing where a heap appears ends on top of it, not inside", () => {
  const c = city([{ shape: "wall8", finish: "limestucco", x: 100, z: 100 }]);
  const wall = c.refs[0]!;
  const { h } = c;
  const ada = survivor(h, "ada", { god: true });
  put(h, ada, { x: 101, z: 100.8 });
  h.run(300);
  const e = h.ent(ada), ents = h.world.ents, reg = h.reg;
  const free = (): boolean => capsuleFree(h.world, ents.x[e]!, ents.y[e]!, ents.z[e]!, reg.bodyRadius[ents.kind[e]!]!, reg.bodyHeight[ents.kind[e]!]!);
  expect([free(), ents.y[e]]).toEqual([true, 0]);
  for (let k = 0; k < 3; k++) fire(c, wall, -3, huge(c));
  expect(c.form(wall)).toBe(FORM_HEAP);
  // The heap is solid where she stood. She is on it at once, and from there is free to stand or slide off it.
  expect([free(), ents.y[e]! > 0.1]).toEqual([true, true]);
  for (let k = 0; k < 10; k++) {
    h.run(100);
    expect(free()).toBe(true);
  }
  // Without that she would be held in it: a body set down in the heap now does not come out.
  const [x, y, z] = [ents.x[e]!, ents.y[e]!, ents.z[e]!];
  [ents.x[e], ents.y[e], ents.z[e]] = [101, 0, 100.8];
  h.run(500);
  expect([free(), ents.x[e], ents.z[e]! < 100.9]).toEqual([false, 101, true]);
  [ents.x[e], ents.y[e], ents.z[e]] = [x, y, z];
});

test("with AllowCityDamage off nothing changes form", () => {
  const c = city([{ shape: "zwin", finish: "limestucco", x: 100, z: 100 }, { shape: "wall4", finish: "limestucco", x: 100, z: 140 }, { shape: "zpartition", finish: "concrete", x: 150, z: 100 }]);
  const [win, wall, partition] = c.refs as [number, number, number];
  const { h } = c;
  expect(h.host.rules.assign("AllowCityDamage", "False", "console")).toBe("");
  const combat = h.host.combat;
  // Neither a bullet into glass nor a blow on plaster does anything.
  expect([combat.hitStructure(rifle(h.reg), win, 100, 2, 100), combat.hitStructure({ ...rifle(h.reg), type: DMG_MELEE }, partition, 150, 1, 100)]).toEqual([0, 0]);
  fire(c, wall);
  // A rocket that would have breached it only harms it: 7,350 by 3.5, far more than a third of its 7,500 would stand.
  fire(c, win, 0, { ...rocket(h.reg), base: 80 });
  expect([c.form(win), c.hp(win) < 3000]).toEqual([FORM_WHOLE, true]);
  expect(c.id(wall)).toBe("");
  const gone = h.world.structs.chunks[Math.floor(wall / 65536)]!.gone.at(-1)!;
  expect([gone.left, gone.runs]).toEqual([[], [wall & 0xffff, 1]]);
  fire(c, win, 0, huge(c));
  expect(c.id(win)).toBe("");
});

test("a city wall inside a tribe's protect radius is spared on a PvE server", () => {
  const c = city([{ shape: "wall8", finish: "limestucco", x: 100, z: 100 }, { shape: "wall8", finish: "limestucco", x: 100, z: 160 }]);
  const [near, far] = c.refs as [number, number];
  const { h } = c;
  const [ada, bob] = [record(h, survivor(h, "ada")), record(h, survivor(h, "bob"))];
  expect(ada.team !== 0 && bob.team !== 0 && ada.team !== bob.team).toBe(true);
  // Bob's tribe built 10 m from the first wall's end, 14 m from its middle.
  h.world.structs.add(h.reg.index.get("core:wall")!, 114, 1.5, 100, 0, bob.team, 100);
  expect(h.host.rules.assign("serverPVE", "True", "console")).toBe("");
  const by = (rec: typeof ada): Source => ({ ...rocket(h.reg), by: rec });
  const combat = h.host.combat;
  combat.blast(by(ada), 100, 1.4, 99.5, ROCKET_REACH);
  combat.blast(by(ada), 100, 1.4, 159.5, ROCKET_REACH);
  expect([c.form(near), c.hp(near), c.form(far)]).toEqual([FORM_WHOLE, c.full(near), FORM_BREACH_B]);
  // Bob's own explosive harms it as it would his own wall, and anyone's does once the server is PvP.
  combat.blast(by(bob), 100, 1.4, 99.5, ROCKET_REACH);
  expect(c.form(near)).toBe(FORM_BREACH_B);
  expect(h.host.rules.assign("serverPVE", "False", "console")).toBe("");
  combat.blast(by(ada), 100, 1.4, 99.5, ROCKET_REACH);
  expect(c.form(near)).toBe(FORM_OPEN);
  // A radius of none spares nothing.
  expect(h.host.rules.assign("serverPVE", "True", "console")).toBe("");
  expect(h.host.rules.assign("CityProtectRadius", "0", "console")).toBe("");
  combat.blast(by(ada), 100, 1.4, 99.5, ROCKET_REACH);
  expect(c.form(near)).toBe(FORM_HEAP);
});

test("a survivor past the breaks cap changes nothing more until it refills", () => {
  const walls = [0, 1, 2, 3].map((k) => ({ shape: "wall8" as const, finish: "limestucco" as const, x: 100 + k * 20, z: 100 }));
  const c = city(walls);
  const { h } = c;
  const ada = record(h, survivor(h, "ada"));
  expect(h.host.rules.assign("CityBreaksPerMinute", "2", "console")).toBe("");
  const by: Source = { ...huge(c), by: ada };
  for (const ref of c.refs.slice(0, 3)) fire(c, ref, 0, by);
  // Two were breached. The third hit did nothing at all, to form or to health.
  expect(c.refs.map((ref) => [c.form(ref), c.hp(ref) === c.full(ref)])).toEqual([[FORM_BREACH_B, false], [FORM_BREACH_B, false], [FORM_WHOLE, true], [FORM_WHOLE, true]]);
  // Nobody's hit, and another survivor's, are not hers.
  fire(c, c.refs[3]!, 0, huge(c));
  expect(c.form(c.refs[3]!)).toBe(FORM_BREACH_B);
  // Half a minute gives back one.
  h.run(31_000);
  fire(c, c.refs[2]!, 0, by);
  fire(c, c.refs[0]!, 0, by);
  expect([c.form(c.refs[2]!), c.form(c.refs[0]!)]).toEqual([FORM_BREACH_B, FORM_BREACH_B]);
});

test("CityResistanceMultiplier divides what a city piece takes", () => {
  const c = city([{ shape: "wall8", finish: "concrete", x: 100, z: 100 }]);
  const wall = c.refs[0]!;
  expect(c.h.host.rules.assign("CityResistanceMultiplier", "4", "console")).toBe("");
  fire(c, wall, 0, grenade(c.h.reg), GRENADE_REACH);
  expect(c.full(wall) - c.hp(wall)).toBeCloseTo((788 * 2.33) / 4, 0);
  expect(stageOf(c.h.reg, mapKind(c, wall), c.hp(wall))).not.toBe(STAGE_CRACKED);
});

test("a client says a city piece's stage, never its health", () => {
  const c = city([{ shape: "wall8", finish: "concrete", x: 100, z: 100 }]);
  const reg = c.h.reg, wall = mapKind(c, c.refs[0]!);
  const [breach, open, heap] = [FORM_BREACH_A, FORM_OPEN, FORM_HEAP].map((form) => formKind(reg, wall, form, 0)) as [number, number, number];
  // The prompt's words: none for a piece that stands whole, its stage after, and "rubble" for a heap whatever its health.
  expect([23400, 16000, 15000, 7000, 3000].map((hp) => cityWord(reg, wall, wall, hp))).toEqual(["", "", "worn", "cracked", "failing"]);
  expect([cityWord(reg, wall, breach, 7000), cityWord(reg, wall, open, 5850), cityWord(reg, wall, heap, 48)]).toEqual(["cracked", "cracked", "rubble"]);
  const sounds = new BuildSounds(reg, () => 0);
  const heard: [string, number][] = [];
  const hear: Hear = (_o, key, _e, _x, _y, _z, _a, gain) => heard.push([KEYS[key]!.key, gain]);
  // A stage crossed after much silent wear, and one after little: the client's health was stale, so neither is louder.
  sounds.structure(wall, wall, 100, 1, 100, 23400, 15000, -1);
  sounds.structure(wall, wall, 100, 1, 100, 15700, 15000, -1);
  sounds.structure(wall, breach, 100, 1, 100, 15000, 7000, -1);
  sounds.structure(open, 0, 100, 1, 100, 100, 0, GONE_BLAST);
  sounds.update(0, 0, 0, hear, () => {});
  expect(heard).toEqual([["hit/stone", 0.9], ["hit/stone", 0.9], ["hit/stone", 0.9], ["destroy/stone", 1]]);
});
