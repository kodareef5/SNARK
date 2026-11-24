// The map's city returning: a building whole when its days are up and nobody is near, what keeps it away, an admin's
// reset, and what the store, the save and a client make of a piece set back.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Source } from "../../server/combat.ts";
import { FORM_HEAP, FORM_OPEN, FORM_WHOLE } from "../../shared/content/breaks.ts";
import { cycleTicks } from "../../shared/sim/clock.ts";
import { DMG_MELEE } from "../../shared/sim/damage.ts";
import { city, rocket, type City } from "../fixtures/city.ts";
import { Harness } from "../fixtures/net.ts";
import { Sketch, sketchCity, sketchId, type SketchCity } from "../fixtures/sketch.ts";
import { put, record, survivor } from "../kit/kit.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-regrow-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const huge = (c: City): Source => ({ ...rocket(c.h.reg), base: 1e7 });
function strike(c: City, ref: number): void {
  const p = c.at(ref);
  c.h.host.combat.hitStructure(huge(c), ref, p.x, p.y, p.z);
}
function openUp(c: City, ref: number): void {
  for (let k = 0; k < 4 && c.form(ref) !== FORM_OPEN; k++) strike(c, ref);
}
const ticks = (c: { h: Harness }, n: number): void => {
  const end = c.h.world.tick + n;
  while (c.h.world.tick < end) c.h.run(1000 / 30);
};
/** Sets CityRegrowDays so that a building returns `n` ticks after its last harm. */
const period = (h: Harness, n: number): void => void expect(h.host.rules.assign("CityRegrowDays", String(n / cycleTicks(h.world.clock)), "console")).toBe("");
const whole = (c: City, refs: readonly number[]): boolean => refs.every((ref) => c.form(ref) === FORM_WHOLE && c.hp(ref) === c.full(ref));

/** A mast of `storeys` round (x, z) on a map `chunks` wide, its ground pier cut so that all it carried is down. */
function fallen(storeys: number, x: number, z: number, chunks = 4, host = {}): { c: SketchCity; pier: number } {
  const s = new Sketch(2, 2, 8, x, z);
  s.storeys = s.playable = storeys;
  const piers: number[] = [];
  for (let storey = 0; storey < storeys; storey++) {
    piers.push(s.pier(0, 0, storey));
    for (let k = 0; k < 4; k++) s.slab(k % 2, k >> 1, storey + 1);
  }
  const c = sketchCity(s, chunks, host);
  // It stays down until a test sets its days.
  expect(c.h.host.rules.assign("CityRegrowDays", "0", "console")).toBe("");
  openUp(c, c.refs[piers[0]!]!);
  ticks(c, 80);
  expect(c.h.host.cityCollapse.waiting).toBe(0);
  expect(c.refs.filter((ref) => c.form(ref) === -1).length).toBe(storeys * 5 - 2);
  return { c, pier: c.refs[piers[0]!]! };
}

test("a fallen building returns whole when its days are up, and never with CityRegrowDays 0", () => {
  const { c } = fallen(3, 96, 96);
  const { h } = c;
  const structs = h.world.structs, chunk = Math.floor(c.refs[0]! / 65536);
  const regrow = h.host.cityRegrow;
  expect([structs.asPlaced(chunk), regrow.kept]).toEqual([false, 1]);
  ticks(c, 300);
  expect([regrow.buildings, structs.asPlaced(chunk)]).toEqual([0, false]);
  // Its last harm was its last wave. A hundred ticks from then it is due, and not a tick before the cursor comes by.
  period(h, 400);
  ticks(c, 10);
  expect(regrow.buildings).toBe(0);
  const version = structs.chunks[chunk]!.version;
  ticks(c, 120);
  expect([regrow.buildings, regrow.healed, regrow.kept]).toEqual([1, 15, 0]);
  // Every slot is the map's again: nothing differs, no slot is listed as changed, and the chunk changed version once.
  expect([whole(c, c.refs), structs.asPlaced(chunk), structs.changedSlots(chunk).length, structs.chunks[chunk]!.version - version]).toEqual([true, true, 0, 1]);
  // And it stands by the rule: breaking it again brings it down again.
  openUp(c, c.refs[0]!);
  ticks(c, 80);
  expect(c.refs.filter((ref) => c.form(ref) === -1).length).toBe(13);
});

test("a building stays down while a survivor is near, something is built in it, or a body is where a piece returns", () => {
  const { c } = fallen(2, 96, 96, 12);
  const { h } = c;
  const regrow = h.host.cityRegrow;
  // A survivor 200 m off keeps it away, and one 300 m off does not: but first something built in its frame does.
  const ada = survivor(h, "ada", { cheats: true, at: { x: 296, z: 96 } });
  period(h, 30);
  ticks(c, 90);
  expect(regrow.buildings).toBe(0);
  const built = h.world.structs.add(h.reg.index.get("core:wall")!, 100, 2, 100, 0, 7, 1000);
  put(h, ada, { x: 396, z: 96 });
  ticks(c, 90);
  expect(regrow.buildings).toBe(0);
  h.world.structs.remove(built);
  // A creature under the first floor's slab, where it is to return.
  const dodo = h.host.spawnCreature("core:dodo", 93, 93, 1);
  h.world.ents.y[dodo] = 3.2;
  ticks(c, 2);
  h.world.ents.y[dodo] = 3.2;
  expect(regrow.clear(sketchId(0))).toBe(false);
  h.world.ents.flags[dodo] = 0;
  expect(regrow.clear(sketchId(0))).toBe(true);
  ticks(c, 90);
  expect([regrow.buildings, whole(c, c.refs)]).toEqual([1, true]);
});

test("CityRegrowClearDistance is how near a survivor keeps a building from returning", () => {
  const { c } = fallen(2, 96, 96, 12);
  const { h } = c;
  survivor(h, "ada", { cheats: true, at: { x: 296, z: 96 } });
  period(h, 30);
  ticks(c, 90);
  expect(h.host.cityRegrow.buildings).toBe(0);
  // 200 m off is near at the 256 m it starts with, and not at 150.
  expect(h.host.rules.assign("CityRegrowClearDistance", "150", "console")).toBe("");
  ticks(c, 30);
  expect([h.host.cityRegrow.buildings, whole(c, c.refs)]).toEqual([1, true]);
});

test("a client that comes later is sent nothing of a building that returned: it fills from its own map", () => {
  const { c } = fallen(2, 96, 96, 12);
  const { h } = c;
  period(h, 30);
  ticks(c, 90);
  expect(h.host.cityRegrow.buildings).toBe(1);
  const chunk = Math.floor(c.refs[0]! / 65536);
  const ada = survivor(h, "ada", { cheats: true, at: { x: 110, z: 110 } });
  h.run(1500);
  const mine = ada.world!.structs.chunks[chunk]!, t = h.world.structs.chunks[chunk]!;
  expect(Array.from(mine.kind.subarray(0, t.mapped))).toEqual(Array.from(t.kind.subarray(0, t.mapped)));
  expect(c.refs.every((ref) => mine.kind[ref & 0xffff] === h.world.structs.mapKind(chunk, ref & 0xffff))).toBe(true);
});

test("an admin resets the building near, and a client that holds its chunk takes it again from its map", () => {
  const { c } = fallen(2, 96, 96);
  const { h } = c;
  const chunk = Math.floor(c.refs[0]! / 65536);
  const ada = survivor(h, "ada", { cheats: true, at: { x: 110, z: 110 } });
  h.run(1500);
  const mine = ada.world!.structs.chunks[chunk]!, t = h.world.structs.chunks[chunk]!;
  // It holds the chunk as it fell.
  expect(c.refs.filter((ref) => mine.kind[ref & 0xffff] === 0).length).toBe(8);
  expect(h.say(ada, "city status")[0]).toContain("1 buildings and chunks wait to return");
  expect(h.say(ada, "city reset here")[0]).toBe(`10 pieces set back, of building ${sketchId(0)}`);
  h.run(500);
  expect([whole(c, c.refs), h.world.structs.asPlaced(chunk), h.host.cityRegrow.kept]).toEqual([true, true, 0]);
  expect(Array.from(mine.kind.subarray(0, t.mapped))).toEqual(Array.from(t.kind.subarray(0, t.mapped)));
  expect(Array.from(mine.hp.subarray(0, t.mapped))).toEqual(Array.from(t.hp.subarray(0, t.mapped)));
  // The whole city, and a circle: nothing is left to set back.
  expect([h.say(ada, "city reset all")[0], h.say(ada, "city reset radius 100")[0]]).toEqual(["0 pieces set back, of 0 buildings", "0 pieces set back, of 0 buildings"]);
});

test("a reset by radius sets back only the loose pieces inside its circle", () => {
  // Two walls of no building, 33 m apart in one chunk.
  const c = city([{ shape: "wall8", finish: "concrete", x: 70, z: 70 }, { shape: "wall8", finish: "concrete", x: 70, z: 103 }]);
  const { h } = c;
  expect(h.host.rules.assign("CityRegrowDays", "0", "console")).toBe("");
  expect(Math.floor(c.refs[0]! / 65536)).toBe(Math.floor(c.refs[1]! / 65536));
  for (const ref of c.refs) strike(c, ref);
  expect(c.refs.map((ref) => whole(c, [ref]))).toEqual([false, false]);
  expect(h.host.cityRegrow.reset(70, 70, 1)).toEqual({ buildings: 0, slots: 1 });
  // The far wall is left broken, and its chunk keeps its clock.
  expect([c.refs.map((ref) => whole(c, [ref])), h.host.cityRegrow.kept]).toEqual([[true, false], 1]);
  expect(h.host.cityRegrow.reset(70, 70, 40)).toEqual({ buildings: 0, slots: 1 });
  expect([whole(c, c.refs), h.host.cityRegrow.kept]).toEqual([true, 0]);
});

test("a broken piece of no building returns by the same clock, and a healed chunk leaves the save", () => {
  const db = join(dir, "regrow.db");
  const c = city([{ shape: "wall8", finish: "concrete", x: 100, z: 100 }, { shape: "wall8", finish: "concrete", x: 100, z: 110 }], 4, { dbPath: db });
  const { h } = c;
  expect(h.host.rules.assign("CityRegrowDays", "0", "console")).toBe("");
  for (let k = 0; k < 3; k++) strike(c, c.refs[0]!);
  strike(c, c.refs[1]!);
  expect([c.form(c.refs[0]!), c.form(c.refs[1]!) === FORM_WHOLE]).toEqual([FORM_HEAP, false]);
  h.run(2500);
  const saved = (): number => (h.host.persistence!.store.db.query("SELECT count(*) AS n FROM chunk_structs").get() as { n: number }).n;
  expect([saved(), h.host.cityRegrow.kept]).toEqual([1, 1]);
  period(h, 30);
  ticks(c, 60);
  expect([h.host.cityRegrow.chunks, whole(c, c.refs), h.host.cityRegrow.kept]).toEqual([1, true, 0]);
  h.run(2500);
  expect(saved()).toBe(0);
});

test("a salvaged wreck returns whole as the map placed it, by its chunk's clock", () => {
  const kind = "core:compact_abandoned_white";
  const c = city([{ kind, x: 40, z: 40 }, { kind, x: 50, z: 40 }]);
  const [taken, stripped] = c.refs as [number, number];
  const { h } = c;
  expect(h.host.rules.assign("CityRegrowDays", "0", "console")).toBe("");
  const pick: Source = { by: record(h, survivor(h, "ada")), x: 0, z: 0, item: h.reg.index.get("core:pick_metal")!, base: 32, type: DMG_MELEE, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0, pierce: 0 };
  for (let k = 0; k < 24; k++) h.host.combat.hitStructure(pick, taken, 40, 0.5, 40);
  for (let k = 0; k < 8; k++) h.host.combat.hitStructure(pick, stripped, 50, 0.5, 40);
  expect([c.id(taken), c.id(stripped)]).toEqual(["", "core:zzzzzzzwreck_compact_abandoned_stripped"]);
  // She stands at the map's middle, over 100 m off: near enough to hold them back until the distance is less.
  period(h, 30);
  ticks(c, 60);
  expect(c.id(taken)).toBe("");
  expect(h.host.rules.assign("CityRegrowClearDistance", "50", "console")).toBe("");
  ticks(c, 60);
  expect([c.id(taken), c.id(stripped), whole(c, c.refs)]).toEqual([kind, kind, true]);
});

test("a building's last harm is saved with the world, and it returns on that clock after a restart", () => {
  const db = join(dir, "clock.db");
  const { c } = fallen(2, 96, 96, 4, { dbPath: db });
  const harmedAt = c.h.world.tick;
  c.h.run(2500);
  c.h.host.shutdown();
  const h = new Harness({}, 1, 30, { dev: true, map: c.map, dbPath: db });
  const regrow = h.host.cityRegrow;
  expect(regrow.kept).toBe(1);
  const structs = h.world.structs, chunk = Math.floor(c.refs[0]! / 65536);
  // Due 600 ticks after its last wave, which was before the save: not yet, then at once.
  period(h, 600);
  const began = h.world.tick;
  while (h.world.tick < began + 60) h.run(1000 / 30);
  expect([regrow.buildings, structs.asPlaced(chunk)]).toEqual([0, false]);
  while (h.world.tick < harmedAt + 620) h.run(1000 / 30);
  expect([regrow.buildings, structs.asPlaced(chunk)]).toEqual([1, true]);
  h.host.shutdown();
});
