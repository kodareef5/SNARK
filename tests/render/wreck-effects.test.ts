// A street's wreck salvaged, as a client shows it (client/core/break-effects.ts, prompts.ts, fragments.ts): the word it
// says when looked at, and the dust and sparks of a blow, a rung and its last. It throws no masonry and no fragments.

import { expect, test } from "bun:test";
import { tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import { BULLET, BreakEffects, HEARD_BLOW, HEARD_IMPACT, PIECE, hearStructures, struckKind, type BreakDetails } from "../../client/core/break-effects.ts";
import { BREAK_CHIPS, BREAK_DUST, BREAK_GLASS, BREAK_SPARKS } from "../../client/core/details/breaks.ts";
import { BreakSets } from "../../client/core/fragments.ts";
import { cityWord } from "../../client/core/prompts.ts";
import { ruinKind } from "../../content/ruins.ts";
import type { Source } from "../../server/combat.ts";
import { ZONE_NONE } from "../../shared/anim/human.ts";
import { FORM_HEAP, formKind } from "../../shared/content/breaks.ts";
import { EVENT_HIT } from "../../shared/net/protocol.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { DMG_MELEE } from "../../shared/sim/damage.ts";
import { rungKind } from "../../shared/world/breaking.ts";
import { GONE_BLAST, GONE_TAKEN } from "../../shared/world/structures.ts";
import { city } from "../fixtures/city.ts";
import { record } from "../kit/kit.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry(), palette = defaultPalette();
const k = (id: string): number => reg.index.get(id)!;
const BLUE = k("core:zzzzroad_fastback_abandoned_blue"), RED = k("core:zzzzroad_fastback_abandoned_red");
const STRIPPED = rungKind(reg, BLUE, 1), SHELL = rungKind(reg, BLUE, 2);
const WALL = k(ruinKind("wall8", "concrete")), HEAP = formKind(reg, WALL, FORM_HEAP, 0);
const MEDIUM = tierOf("medium"), LOW = tierOf("lowpoly");

interface Burst { part: number; x: number; y: number; z: number; floor: number; size: number; count: number; rgb: number }
/** What a flush asked the details and the sounds for, and how it shook the view. */
function asked(breaks: BreakEffects, tier: Tier = MEDIUM): { bursts: Burst[]; heard: [what: number, kind: number, level: number][]; jolts: number[] } {
  const bursts: Burst[] = [], heard: [number, number, number][] = [], jolts: number[] = [];
  const details: BreakDetails = { breakBurst: (part, _id, x, y, z, floor, _tick, _due, size, count, rgb) => void bursts.push({ part, x, y, z, floor, size, count, rgb }) };
  breaks.flush(details, tier, 0, 100, 2, 100, { breaking: (what, kind, _x, _y, _z, level) => void heard.push([what, kind, level]) }, { jolt: (amount) => void jolts.push(amount) });
  return { bursts, heard, jolts };
}
const count = (bursts: readonly Burst[], part: number): number => bursts.reduce((n, b) => n + (b.part === part ? b.count : 0), 0);

test("a wreck says its look when looked at, and never a wall's stage", () => {
  expect(new Set([BLUE, STRIPPED, SHELL]).size).toBe(3);
  // Its health falls a third a rung, which would read as a wall worn, cracked and failing.
  for (const hp of [8000, 5334, 5333, 2666, 1]) expect([BLUE, STRIPPED, SHELL].map((kind) => cityWord(reg, BLUE, kind, hp))).toEqual(["wreck", "stripped", "shell"]);
  // One the street holds stripped is as the map set it down, and its first rung leaves its shell.
  const low = k("core:compact_abandoned_stripped_white");
  expect([cityWord(reg, low, low, 100), cityWord(reg, low, rungKind(reg, low, 1), 100)]).toEqual(["wreck", "shell"]);
  expect([cityWord(reg, WALL, WALL, 7000), cityWord(reg, WALL, HEAP, 48)]).toEqual(["cracked", "rubble"]);
});

test("a rung is a little dust and sparks where the wreck stands, and a metal blow", () => {
  const breaks = new BreakEffects(reg, palette);
  breaks.row(reg, 100, BLUE, STRIPPED, 100, 0, 104, 8000, 5333);
  const { bursts, heard, jolts } = asked(breaks);
  const n = Math.ceil(PIECE[1]! / 2);
  expect([count(bursts, BREAK_DUST), count(bursts, BREAK_SPARKS), count(bursts, BREAK_CHIPS), count(bursts, BREAK_GLASS)]).toEqual([Math.ceil(n / 2), n - Math.ceil(n / 2), 0, 0]);
  expect(heard).toEqual([[HEARD_BLOW, BLUE, 0.9]]);
  expect(jolts).toEqual([]);
  // At its middle, over the ground it stands on: a wreck's place is under it.
  const dust = bursts.find((b) => b.part === BREAK_DUST)!;
  expect([dust.x, dust.z, dust.floor]).toEqual([100, 104, 0]);
  expect(dust.y).toBeGreaterThan(0.4);
  expect(dust.y).toBeLessThan(1.2);
  // Low poly makes dust alone.
  breaks.row(reg, 100, BLUE, STRIPPED, 100, 0, 104, 8000, 5333);
  const low = asked(breaks, LOW).bursts;
  expect([count(low, BREAK_DUST), low.length]).toEqual([Math.ceil(PIECE[0]! / 2), 1]);
  // Its second rung, down to its shell, and a stripped one's only rung are the same.
  breaks.row(reg, 100, STRIPPED, SHELL, 100, 0, 104, 5333, 2667);
  expect(asked(breaks).heard).toEqual([[HEARD_BLOW, STRIPPED, 0.9]]);
  const stripped = k("core:compact_abandoned_stripped_white");
  breaks.row(reg, 100, stripped, rungKind(reg, stripped, 1), 100, 0, 104, 8000, 4000);
  expect(asked(breaks).heard).toEqual([[HEARD_BLOW, stripped, 0.9]]);
});

test("a wreck's dust is the road's whatever its paint; one set back whole makes none", () => {
  const breaks = new BreakEffects(reg, palette);
  const dust = (car: number): number => {
    breaks.row(reg, 100, car, rungKind(reg, car, 1), 100, 0, 104, 8000, 5333);
    return asked(breaks).bursts.find((b) => b.part === BREAK_DUST)!.rgb;
  };
  expect(dust(BLUE)).toBe(dust(RED));
  // Grown back as the map has it, and a row of health alone.
  breaks.row(reg, 100, STRIPPED, BLUE, 100, 0, 104, 5333, 8000);
  breaks.row(reg, 100, SHELL, BLUE, 100, 0, 104, 2667, 8000);
  breaks.row(reg, 100, BLUE, BLUE, 100, 0, 104, 8000, 5789);
  expect(asked(breaks)).toEqual({ bursts: [], heard: [], jolts: [] });
});

test("a wreck cut up gives a last puff, and a heap mined out gives none", () => {
  const breaks = new BreakEffects(reg, palette);
  breaks.row(reg, 100, SHELL, 0, 100, 0, 104, 1, 0, GONE_TAKEN);
  const { bursts, heard, jolts } = asked(breaks);
  expect([count(bursts, BREAK_DUST), count(bursts, BREAK_SPARKS), count(bursts, BREAK_CHIPS)]).toEqual([PIECE[1]! / 2, PIECE[1]! / 2, 0]);
  expect(heard).toEqual([[HEARD_IMPACT, SHELL, 0.76]]);
  expect(jolts).toEqual([]);
  // The same row of anything else, and of a wreck with any other cause, which comes with its removal's rubble.
  breaks.row(reg, 100, HEAP, 0, 100, 0, 104, 10, 0, GONE_TAKEN);
  breaks.row(reg, 100, WALL, 0, 100, 0, 104, 10, 0, GONE_TAKEN);
  breaks.row(reg, 100, k("core:wall_metal"), 0, 100, 0, 104, 10, 0, GONE_TAKEN);
  breaks.row(reg, 100, BLUE, 0, 100, 0, 104, 10, 0, GONE_BLAST);
  breaks.row(reg, 100, BLUE, 0, 100, 0, 104, 10, 0);
  expect(asked(breaks)).toEqual({ bursts: [], heard: [], jolts: [] });
});

test("a rung beside a wall that breaks leaves the wall its chips and its own sound", () => {
  const breaks = new BreakEffects(reg, palette);
  breaks.row(reg, 100, BLUE, STRIPPED, 100, 0, 104, 8000, 5333);
  breaks.take([{ kind: WALL, x: 101, y: 2, z: 104, yaw: 0, cause: GONE_BLAST, ox: 101, oy: 2, oz: 104, tick: 100, radius: 4, into: 0, map: WALL }]);
  const { bursts, heard } = asked(breaks);
  expect(count(bursts, BREAK_CHIPS)).toBeGreaterThan(0);
  expect(count(bursts, BREAK_SPARKS)).toBeGreaterThan(0);
  // The wall is heard as it was, and the wreck by its own kind.
  expect(heard.map(([what, kind]) => [what, kind])).toEqual([[HEARD_IMPACT, WALL], [HEARD_BLOW, BLUE]]);
});

test("a wreck throws no fragments: a rung leaves none, and blown apart it falls whole", () => {
  const sets = new BreakSets(reg);
  expect([sets.swap(BLUE, STRIPPED), sets.swap(STRIPPED, SHELL)]).toEqual([null, null]);
  expect([BLUE, STRIPPED, SHELL].map((kind) => sets.rubble(kind, BLUE, 100, 0, 104))).toEqual([null, null, null]);
  expect(sets.rubble(WALL, WALL, 100, 2, 104)).not.toBeNull();
});

test("a salvager's client finds each blow on the wreck, and shows a rung and the last", () => {
  const c = city([{ kind: "core:zzzzroad_fastback_abandoned_blue", x: 120, z: 120 }]);
  const car = c.refs[0]!;
  const { h } = c;
  const ada = h.join("ada");
  h.run(400);
  const breaks = new BreakEffects(reg, palette);
  hearStructures(ada, (was, kind, x, y, z, hpWas, hp, cause) => breaks.row(reg, 100, was, kind, x, y, z, hpWas, hp, cause));
  const pick: Source = { by: record(h, ada), x: 120, z: 117, item: k("core:pick_metal"), base: 32, type: DMG_MELEE, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0, pierce: 0 };
  const blows = (n: number): void => {
    for (let i = 0; i < n; i++) h.host.combat.hitStructure(pick, car, 120, 0.6, 118.6);
    h.run(200);
    // From an eye south of it, as the app looks before the sounds take the events.
    breaks.blows(ada.events, ada.world!, 120, 1.6, 116, 100);
  };
  ada.events.length = 0;
  // Seven blows change nothing a client is sent: each is a hit for her, found on the wreck.
  blows(7);
  const hits = ada.events.filter((e) => e.kind === EVENT_HIT);
  expect([hits.length, hits.every((e) => e.zone === ZONE_NONE && e.struck === BLUE)]).toEqual([7, true]);
  // Sparks where each landed, and no dust: metal makes none.
  let a = asked(breaks);
  expect([a.bursts.map((b) => [b.part, b.count]), a.heard]).toEqual([[[BREAK_SPARKS, 7 * BULLET[1]!]], []]);
  // A blow on a wall throws nothing, as before. Low poly has no sparks, so there a blow on a wreck is its mark alone.
  breaks.blow(100, WALL, 120, 0.6, 118.6);
  expect(asked(breaks).bursts).toEqual([]);
  breaks.blow(100, BLUE, 120, 0.6, 118.6);
  expect(asked(breaks, LOW).bursts).toEqual([]);
  // The eighth takes the rung.
  ada.events.length = 0;
  blows(1);
  expect(c.id(car)).toBe(reg.ids[STRIPPED]!);
  expect(struckKind(ada.world!, 120, 1.6, 116, 120, 0.6, 118.6)).toBe(STRIPPED);
  a = asked(breaks);
  expect(a.heard).toEqual([[HEARD_BLOW, BLUE, 0.9]]);
  // Eight more leave its shell, and eight more cut it up: one last puff, and nothing in the rubble to fall.
  ada.events.length = 0;
  blows(8);
  expect([c.id(car), asked(breaks).heard]).toEqual([reg.ids[SHELL]!, [[HEARD_BLOW, STRIPPED, 0.9]]]);
  blows(8);
  a = asked(breaks);
  expect([c.id(car), a.heard.map(([what, kind]) => [what, kind]), ada.rubble.length]).toEqual(["", [[HEARD_IMPACT, SHELL]], 0]);
  expect(struckKind(ada.world!, 120, 1.6, 116, 120, 0.6, 118.6)).toBe(0);
});
