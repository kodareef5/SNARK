// A street's wreck salvaged: a survivor's blows take it down its rungs, each rung gives what it holds, and the rules of
// the city govern it as they do a building's piece.

import { expect, test } from "bun:test";
import type { Source } from "../../server/combat.ts";
import { DMG_MELEE } from "../../shared/sim/damage.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { GONE_BLAST, GONE_TAKEN } from "../../shared/world/structures.ts";
import { ROCKET_REACH, city, rocket, type City } from "../fixtures/city.ts";
import type { Harness } from "../fixtures/net.ts";
import { count, put, record, survivor } from "../kit/kit.ts";

const COMPACT = "core:compact_abandoned_white", STRIPPED = "core:zzzzzzzwreck_compact_abandoned_stripped", SHELL = "core:zzzzzzzwreck_compact_abandoned_shell";
const GIVEN = ["polymer", "crystal", "electronics", "gasoline", "ingot", "oil", "fiber", "ore"] as const;

const version = (c: City, ref: number): number => c.h.world.structs.chunks[Math.floor(ref / 65536)]!.version;
/** A survivor and the blow of what she holds: a metal pick's power is 5, and bare hands strike 1. */
function hand(h: Harness, name: string, item = "core:pick_metal") {
  const id = survivor(h, name);
  const rec = record(h, id);
  const src: Source = { by: rec, x: 0, z: 0, item: item === "" ? 0 : h.reg.index.get(item)!, base: 32, type: DMG_MELEE, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0, pierce: 0 };
  return { id, rec, src, has: () => GIVEN.map((item) => count(h, id, item)) };
}
function blows(c: City, src: Source, ref: number, n: number): number {
  const p = c.at(ref);
  let done = 0;
  for (let k = 0; k < n; k++) done += c.h.host.combat.hitStructure(src, ref, p.x, p.y + 0.5, p.z);
  return done;
}

test("a wreck goes down its rungs under a tool, and each rung gives all it holds", () => {
  const c = city([{ kind: COMPACT, x: 100, z: 100 }]);
  const car = c.refs[0]!;
  const { h } = c;
  const ada = hand(h, "ada");
  const v = version(c, car);
  // A rung is 40 of work and a third of its health. One blow of a metal pick is an eighth of it, told to nobody.
  blows(c, ada.src, car, 1);
  expect([c.id(car), Math.round(c.hp(car)), version(c, car) - v, ada.has()]).toEqual([COMPACT, 7667, 0, [1, 0, 0, 0, 0, 0, 0, 0]]);
  blows(c, ada.src, car, 7);
  // Stripped: its fittings are given, and it is drawn as its stripped look.
  expect([c.id(car), Math.round(c.hp(car)), version(c, car) > v, ada.has()]).toEqual([STRIPPED, 5333, true, [10, 4, 2, 4, 0, 0, 0, 0]]);
  blows(c, ada.src, car, 8);
  // Gutted: a shell.
  expect([c.id(car), ada.has()]).toEqual([SHELL, [10, 4, 6, 4, 6, 4, 8, 0]]);
  blows(c, ada.src, car, 8);
  // Cut up: taken, with no cause to show, and its slot stays the map's.
  expect([c.id(car), ada.has()]).toEqual(["", [10, 4, 6, 4, 10, 4, 8, 35]]);
  const chunk = Math.floor(car / 65536), structs = h.world.structs;
  const batch = structs.chunks[chunk]!.gone.at(-1)!;
  expect([batch.cause, batch.runs]).toEqual([GONE_TAKEN, [car & 0xffff, 1]]);
  const built = structs.add(h.reg.index.get("core:wall")!, 100, 1.5, 104, 0, ada.rec.team, 100);
  expect([(built & 0xffff) >= structs.chunks[chunk]!.mapped, structs.chunks[chunk]!.kind[car & 0xffff]]).toEqual([true, 0]);
  expect(ada.rec.xp).toBeGreaterThan(0);
  expect(h.host.items.audit()).toEqual([]);
});

test("a rung gives the same whatever the blows, and bare hands strike 1", () => {
  const c = city([{ kind: COMPACT, x: 100, z: 100 }, { kind: COMPACT, x: 100, z: 120 }]);
  const [one, two] = c.refs as [number, number];
  const { h } = c;
  const [ada, bob] = [hand(h, "ada", ""), hand(h, "bob", "core:pick")];
  blows(c, ada.src, one, 39);
  expect([c.id(one), ada.has().slice(0, 4)]).toEqual([COMPACT, [9, 3, 1, 3]]);
  blows(c, ada.src, one, 1);
  expect([c.id(one), ada.has().slice(0, 4)]).toEqual([STRIPPED, [10, 4, 2, 4]]);
  // A stone pick's power is 3: fourteen blows pass the rung, and what is over goes into the next.
  blows(c, bob.src, two, 14);
  expect([c.id(two), bob.has()]).toEqual([STRIPPED, [10, 4, 2, 4, 0, 0, 0, 0]]);
  blows(c, bob.src, two, 13);
  expect([c.id(two), bob.has()]).toEqual([SHELL, [10, 4, 6, 4, 6, 4, 8, 0]]);
});

test("a look the street holds lower has only the rungs left to it", () => {
  const c = city([{ kind: "core:compact_abandoned_stripped_white", x: 100, z: 100 }, { kind: "core:compact_wreck", x: 100, z: 120 }, { kind: "core:compact_abandoned_roof_white", x: 100, z: 140 }, { kind: "core:zzzzroad_bus_abandoned", x: 140, z: 100 }]);
  const [stripped, burnt, roof, bus] = c.refs as [number, number, number, number];
  const { h } = c;
  const who = ["ada", "bob", "cy", "dee"].map((name) => hand(h, name));
  // Stripped where the map set it: gutted and cut up, eight blows each.
  blows(c, who[0]!.src, stripped, 16);
  expect([c.id(stripped), who[0]!.has()]).toEqual(["", [0, 0, 4, 0, 10, 4, 8, 35]]);
  // A burnt one is half its metal, and one on its roof its body.
  blows(c, who[1]!.src, burnt, 8);
  blows(c, who[2]!.src, roof, 8);
  expect([c.id(burnt), who[1]!.has(), c.id(roof), who[2]!.has()]).toEqual(["", [0, 0, 0, 0, 2, 0, 0, 17], "", [0, 0, 0, 0, 4, 0, 0, 35]]);
  // A bus takes three times the work and gives three times as much.
  blows(c, who[3]!.src, bus, 23);
  expect(who[3]!.has().slice(0, 4)).toEqual([28, 11, 5, 11]);
  blows(c, who[3]!.src, bus, 1);
  expect([c.id(bus), Math.round(c.hp(bus)), who[3]!.has().slice(0, 4)]).toEqual(["core:zzzzzzzwreck_bus_abandoned_stripped", 10667, [30, 12, 6, 12]]);
});

test("a blast takes a wreck down its rungs and gives nothing", () => {
  const c = city([{ kind: COMPACT, x: 100, z: 100 }, { kind: COMPACT, x: 100, z: 140 }]);
  const [car, other] = c.refs as [number, number];
  const { h } = c;
  const ada = hand(h, "ada");
  const by: Source = { ...rocket(h.reg), by: ada.rec };
  // A rocket's 7,350 by the 0.3008 metal takes: two take it past a third of its 8,000.
  h.host.combat.hitStructure(by, car, 100, 0.5, 100);
  expect([c.id(car), Math.round(c.hp(car))]).toEqual([COMPACT, 5789]);
  h.host.combat.hitStructure(by, car, 100, 0.5, 100);
  expect([c.id(car), Math.round(c.hp(car)), ada.has()]).toEqual([STRIPPED, 3578, [0, 0, 0, 0, 0, 0, 0, 0]]);
  // What the blasts took is lost: a tool is given only the share of each rung it strikes itself.
  blows(c, ada.src, car, 3);
  expect([Math.round(c.hp(car)), ada.has()]).toEqual([2578, [0, 0, 2, 0, 3, 2, 3, 1]]);
  blows(c, ada.src, car, 8);
  expect([c.id(car), ada.has()]).toEqual(["", [0, 0, 2, 0, 7, 2, 3, 35]]);
  // One that leaves it no health destroys it, as a blast does anything.
  h.host.combat.blast({ ...by, base: 1e7 }, 100, 0.5, 139.5, ROCKET_REACH);
  const batch = h.world.structs.chunks[Math.floor(other / 65536)]!.gone.at(-1)!;
  expect([c.id(other), batch.cause]).toEqual(["", GONE_BLAST]);
  expect(ada.has()).toEqual([0, 0, 2, 0, 7, 2, 3, 35]);
});

test("the city's settings govern a wreck, and WreckYieldMultiplier what it gives", () => {
  const c = city([{ kind: COMPACT, x: 100, z: 100 }]);
  const car = c.refs[0]!;
  const { h } = c;
  const ada = hand(h, "ada");
  const set = (name: string, value: string): void => void expect(h.host.rules.assign(name, value, "console")).toBe("");
  set("CityToolSalvage", "False");
  expect([blows(c, ada.src, car, 2), c.hp(car)]).toEqual([0, 8000]);
  set("CityToolSalvage", "True");
  set("AllowCityDamage", "False");
  expect([blows(c, ada.src, car, 2), c.hp(car)]).toEqual([0, 8000]);
  set("AllowCityDamage", "True");
  set("WreckYieldMultiplier", "2");
  blows(c, ada.src, car, 8);
  expect([c.id(car), ada.has().slice(0, 4)]).toEqual([STRIPPED, [20, 8, 4, 8]]);
  // A creature's blow, a bullet and a fist's damage are not work.
  const bullet: Source = { ...ada.src, item: 0, base: 280, type: 1 };
  const hp = c.hp(car);
  h.host.combat.hitStructure({ ...ada.src, by: null }, car, 100, 0.5, 100);
  h.host.combat.hitStructure(bullet, car, 100, 0.5, 100);
  expect(c.hp(car)).toBe(hp);
});

test("a wreck beside a tribe's base is anyone's to salvage, and a rung counts against the breaks cap", () => {
  const cars = [0, 1, 2].map((k) => ({ kind: COMPACT, x: 100 + k * 30, z: 100 }));
  const c = city(cars);
  const [near, second, third] = c.refs as [number, number, number];
  const { h } = c;
  const [ada, bob] = [hand(h, "ada"), hand(h, "bob")];
  h.world.structs.add(h.reg.index.get("core:wall")!, 100, 1.5, 106, 0, bob.rec.team, 100);
  const set = (name: string, value: string): void => void expect(h.host.rules.assign(name, value, "console")).toBe("");
  set("serverPVE", "True");
  // A blast is spared there, as a building's piece is. A tool is not: the tribe's own could not salvage it either.
  h.host.combat.hitStructure({ ...rocket(h.reg), by: ada.rec }, near, 100, 0.5, 100);
  expect(c.hp(near)).toBe(8000);
  blows(c, bob.src, near, 4);
  blows(c, ada.src, near, 4);
  expect([c.id(near), ada.has()[0], bob.has()[0]]).toEqual([STRIPPED, 5, 5]);
  // One break a minute: the rung she took was hers, and the next car gives her nothing more.
  set("CityBreaksPerMinute", "1");
  blows(c, ada.src, second, 8);
  expect([c.id(second), blows(c, ada.src, third, 8), c.hp(third)]).toEqual([STRIPPED, 0, 8000]);
});

test("whoever stands where a stripped wreck's door comes ajar is moved out of it, and walks away", () => {
  const c = city([{ kind: COMPACT, x: 100, z: 100 }]);
  const car = c.refs[0]!;
  const { h } = c;
  const ada = hand(h, "ada");
  const ents = h.world.ents, reg = h.reg;
  const body = (who: typeof ada) => h.ent(who.id);
  const free = (e: number): boolean => capsuleFree(h.world, ents.x[e]!, ents.y[e]!, ents.z[e]!, reg.bodyRadius[ents.kind[e]!]!, reg.bodyHeight[ents.kind[e]!]!);
  // Beside each door, as near as a body stands to swing at it. The stripped look's ajar door is on one side.
  const bob = hand(h, "bob");
  put(h, ada.id, { x: 101.4, z: 99.5 });
  put(h, bob.id, { x: 98.6, z: 99.5 });
  h.run(300);
  const [a, b] = [body(ada), body(bob)];
  expect([free(a), free(b)]).toEqual([true, true]);
  const was = [[ents.x[a]!, ents.z[a]!], [ents.x[b]!, ents.z[b]!]];
  blows(c, ada.src, car, 8);
  expect(c.id(car)).toBe(STRIPPED);
  // One of them stood where the door now is. Both are free, the one moved less than a metre, straight away from the car.
  const moved = [Math.hypot(ents.x[a]! - was[0]![0]!, ents.z[a]! - was[0]![1]!), Math.hypot(ents.x[b]! - was[1]![0]!, ents.z[b]! - was[1]![1]!)];
  expect([free(a), free(b), Math.max(...moved) > 0.1, Math.max(...moved) < 1, Math.min(...moved)]).toEqual([true, true, true, true, 0]);
  for (let k = 0; k < 10; k++) {
    h.run(100);
    expect([free(a), free(b)]).toEqual([true, true]);
  }
});

test("a stone that flew there is no blow of a tool, and a tougher city takes more blows for the same", () => {
  const c = city([{ kind: COMPACT, x: 100, z: 100 }, { kind: COMPACT, x: 100, z: 120 }]);
  const [car, other] = c.refs as [number, number];
  const { h } = c;
  const ada = hand(h, "ada", "core:slingshot");
  // A slingshot's stone is melee damage. Flown, it strikes no work and is given nothing.
  for (let k = 0; k < 8; k++) h.host.combat.hitStructure({ ...ada.src, ranged: true }, car, 100, 0.5, 100);
  expect([c.hp(car), ada.has()]).toEqual([8000, [0, 0, 0, 0, 0, 0, 0, 0]]);
  // CityResistanceMultiplier 2: a metal pick's blow strikes half as much, sixteen to a rung, and the rung gives the same.
  const bob = hand(h, "bob");
  expect(h.host.rules.assign("CityResistanceMultiplier", "2", "console")).toBe("");
  blows(c, bob.src, other, 1);
  expect(Math.round(8000 - c.hp(other))).toBe(167);
  blows(c, bob.src, other, 14);
  expect(c.id(other)).toBe(COMPACT);
  blows(c, bob.src, other, 1);
  expect([c.id(other), bob.has().slice(0, 4)]).toEqual([STRIPPED, [10, 4, 2, 4]]);
});

test("a lesser look a map sets down itself is a plain piece: no tool works it, and a blast harms it as it did any wreck", () => {
  const c = city([{ kind: SHELL, x: 100, z: 100 }, { kind: STRIPPED, x: 100, z: 120 }]);
  const [shell, stripped] = c.refs as [number, number];
  const { h } = c;
  const ada = hand(h, "ada");
  expect([c.hp(shell), blows(c, ada.src, shell, 8), c.hp(shell), ada.has()]).toEqual([8000, 0, 8000, [0, 0, 0, 0, 0, 0, 0, 0]]);
  h.host.combat.hitStructure(rocket(h.reg), shell, 100, 0.5, 100);
  h.host.combat.blast(rocket(h.reg), 100, 0.5, 119.5, ROCKET_REACH);
  expect([c.id(shell), Math.round(c.hp(shell)), c.id(stripped), c.hp(stripped) < 8000]).toEqual([SHELL, 5789, STRIPPED, true]);
  for (let k = 0; k < 3; k++) h.host.combat.hitStructure(rocket(h.reg), shell, 100, 0.5, 100);
  expect(c.id(shell)).toBe("");
});
