// A building of the map coming down on a server: what falls, hangs and is left, how its waves are paced, who is harmed,
// and what the settings change. The buildings are set down by hand (tests/fixtures/sketch.ts).

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Source } from "../../server/combat.ts";
import { FIRST_WAIT, JUDGEMENTS, WAVE_TICKS } from "../../server/city-collapse.ts";
import { FORM_BREACH_A, FORM_BREACH_B, FORM_HEAP, FORM_HUNG, FORM_OPEN, FORM_WHOLE } from "../../shared/content/breaks.ts";
import { REMOVAL_NEWS_TICKS, S_CHUNK } from "../../shared/net/protocol.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { GONE_FELL, GONE_KEPT } from "../../shared/world/structures.ts";
import { rocket, type City } from "../fixtures/city.ts";
import { Harness } from "../fixtures/net.ts";
import { SIDE_BACK, SIDE_FRONT, SIDE_LEFT, SIDE_RIGHT, Sketch, sketchCity } from "../fixtures/sketch.ts";
import { record, survivor } from "../kit/kit.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-collapse-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const huge = (c: City): Source => ({ ...rocket(c.h.reg), base: 1e7 });
/** One blow no piece outlives a rung of, on the middle of `ref`. */
function strike(c: City, ref: number): void {
  const p = c.at(ref);
  c.h.host.combat.hitStructure(huge(c), ref, p.x, p.y, p.z);
}
/** Blows until `ref` is opened. */
function openUp(c: City, ref: number): void {
  for (let k = 0; k < 4 && c.form(ref) !== FORM_OPEN; k++) strike(c, ref);
  expect(c.form(ref)).toBe(FORM_OPEN);
}
/** Runs the server until its tick is `tick`. */
function until(c: City, tick: number): void {
  while (c.h.world.tick < tick) c.h.run(1000 / 30);
}
/** Runs until no building is in doubt, 20 seconds at most. Returns the tick it ended at. */
function settle(c: City): number {
  const end = c.h.world.tick + 600;
  while (c.h.host.cityCollapse.waiting > 0 && c.h.world.tick < end) c.h.run(1000 / 30);
  expect(c.h.host.cityCollapse.waiting).toBe(0);
  return c.h.world.tick;
}

/** Flats four bays long and two deep, five storeys: a lobby and four balconies a front bay, panels behind and at the ends. */
function flats(): { s: Sketch; lobby: number[]; balconies: number[][]; slabs: number[][] } {
  const s = new Sketch(4, 2);
  s.storeys = s.playable = 5;
  const lobby: number[] = [], balconies: number[][] = [], slabs: number[][] = [];
  for (let i = 0; i < 4; i++) {
    lobby.push(s.edge("zlobby", "concrete", i, 0, SIDE_FRONT, 0));
    balconies.push([1, 2, 3].map((storey) => s.edge("zbalc", "concrete", i, 0, SIDE_FRONT, storey)).concat(s.edge("zbalctop", "concrete", i, 0, SIDE_FRONT, 4)));
    for (let storey = 0; storey < 5; storey++) s.edge("zpanel8", "concrete", i, 1, SIDE_BACK, storey);
  }
  for (let storey = 0; storey < 5; storey++) for (let j = 0; j < 2; j++) {
    s.edge("zpanel8", "concrete", 0, j, SIDE_LEFT, storey);
    s.edge("zpanel8", "concrete", 3, j, SIDE_RIGHT, storey);
  }
  for (let level = 1; level <= 5; level++) slabs.push([0, 1, 2, 3, 4, 5, 6, 7].map((k) => s.slab(k % 4, k >> 2, level)));
  return { s, lobby, balconies, slabs };
}

test("a breached ground bay drops nothing, and two opened side by side peel the balconies over them", () => {
  const { s, lobby, balconies, slabs } = flats();
  const c = sketchCity(s);
  const { h } = c;
  const collapse = h.host.cityCollapse;
  const forms = (): number[] => c.refs.map((ref) => c.form(ref));
  const placed = forms();
  expect(placed.every((f) => f === FORM_WHOLE)).toBe(true);
  // A rocket's worth into one bay breaches it. It still carries, and the building is not in doubt.
  strike(c, c.refs[lobby[1]!]!);
  expect([FORM_BREACH_A, FORM_BREACH_B]).toContain(c.form(c.refs[lobby[1]!]!));
  expect(collapse.waiting).toBe(0);
  // That bay and the next opened: both stop carrying.
  const began = h.world.tick;
  openUp(c, c.refs[lobby[1]!]!);
  openUp(c, c.refs[lobby[2]!]!);
  expect(collapse.waiting).toBe(1);
  // Nothing moves for a second.
  until(c, began + FIRST_WAIT - 1);
  expect(forms().filter((f, k) => f !== placed[k]).length).toBe(2);
  const done = settle(c);
  // Three waves of two levels: the first a second after the loss, the last 16 ticks on.
  expect([collapse.waves, done - began]).toEqual([3, FIRST_WAIT + 2 * WAVE_TICKS]);
  // The eight balconies over the two bays fell. The lowest of each lies as its heap on what is left of its lobby.
  for (const bay of [1, 2]) expect(balconies[bay]!.map((k) => c.form(c.refs[k]!))).toEqual([FORM_HEAP, -1, -1, -1]);
  for (const bay of [0, 3]) expect(balconies[bay]!.map((k) => c.form(c.refs[k]!))).toEqual([FORM_WHOLE, FORM_WHOLE, FORM_WHOLE, FORM_WHOLE]);
  // The slabs over the two bays hang on every floor, and the rest stand.
  for (const floor of slabs) expect(floor.map((k) => c.form(c.refs[k]!))).toEqual([FORM_WHOLE, FORM_HUNG, FORM_HUNG, FORM_WHOLE, FORM_WHOLE, FORM_WHOLE, FORM_WHOLE, FORM_WHOLE]);
  // Six rows are gone of the building's, and nothing else changed.
  expect([collapse.fallen, collapse.hung, c.refs.filter((ref) => c.form(ref) === -1).length]).toEqual([8, 10, 6]);
  expect(forms().filter((f, k) => f !== placed[k]).length).toBe(2 + 8 + 10);
});

test("a house, a shop row, a shed and a garage broken as the design's table has them lose nothing", () => {
  // A house on the 4 m kit: a beam, a sill and a fin a bay, a slab and a pitched roof a tile.
  const house = new Sketch(3, 2, 4, 80, 80);
  const bay: number[] = [];
  for (let i = 0; i < 3; i++) for (const [j, side] of [[0, SIDE_FRONT], [1, SIDE_BACK]] as const) {
    const pieces = [house.edge("beam4", "concrete", i, j, side, 0, 3.4), house.edge("sill4", "concrete", i, j, side, 0), house.edge("fin4", "concrete", i, j, side, 0)];
    if (i === 1 && j === 0) bay.push(...pieces);
  }
  for (let j = 0; j < 2; j++) {
    house.edge("beam4", "concrete", 0, j, SIDE_LEFT, 0, 3.4);
    house.edge("beam4", "concrete", 2, j, SIDE_RIGHT, 0, 3.4);
  }
  for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) {
    house.slab(i, j, 1);
    house.put("zpitch4", "clay", i, j, 4);
  }
  // A shop row: a storefront a bay under a parapet, panels behind, a roof.
  const shops = new Sketch(4, 1, 8, 150, 80);
  const store = shops.edge("zstore", "concrete", 1, 0, SIDE_FRONT, 0);
  for (let i = 0; i < 4; i++) {
    if (i !== 1) shops.edge("zstore", "concrete", i, 0, SIDE_FRONT, 0);
    shops.edge("zpanel8", "concrete", i, 0, SIDE_BACK, 0);
    shops.edge("zparapet8", "concrete", i, 0, SIDE_FRONT, 1);
    shops.slab(i, 0, 1, "floor8", "tar");
  }
  // A shed: three storeys of cladding on a frame of beams, one roof and no floors between.
  const shed = new Sketch(3, 1, 8, 80, 150);
  shed.storeys = shed.playable = 3;
  let clad = -1;
  for (let storey = 0; storey < 3; storey++) for (let i = 0; i < 3; i++) for (const side of [SIDE_FRONT, SIDE_BACK]) {
    shed.edge("beam8", "concrete", i, 0, side, storey, 3.4);
    const k = shed.edge("zclad", "concrete", i, 0, side, storey);
    if (storey === 0 && i === 1 && side === SIDE_FRONT) clad = k;
  }
  for (let i = 0; i < 3; i++) shed.slab(i, 0, 3, "floor8", "tar");
  // A garage: decks on piers every 16 m inside a ring of deck walls.
  const garage = new Sketch(4, 4, 8, 170, 170);
  garage.storeys = garage.playable = 2;
  let deck = -1;
  for (let storey = 0; storey < 2; storey++) {
    garage.pier(1, 1, storey);
    for (let k = 0; k < 4; k++) {
      garage.edge("zdeck", "concrete", k, 0, SIDE_FRONT, storey);
      garage.edge("zdeck", "concrete", k, 3, SIDE_BACK, storey);
      garage.edge("zdeck", "concrete", 0, k, SIDE_LEFT, storey);
      garage.edge("zdeck", "concrete", 3, k, SIDE_RIGHT, storey);
    }
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const k = garage.slab(i, j, storey + 1);
      if (storey === 0 && i === 1 && j === 1) deck = k;
    }
  }
  const c = sketchCity([house, shops, shed, garage]);
  const collapse = c.h.host.cityCollapse;
  const placed = c.all.map((refs) => refs.map((ref) => c.form(ref)));
  // The house's front bay is opened; the storefront is breached and then opened; the shed's bay is cut open; the deck is holed.
  for (const k of bay) openUp(c, c.all[0]![k]!);
  strike(c, c.all[1]![store]!);
  expect(collapse.waiting).toBe(1);
  openUp(c, c.all[1]![store]!);
  // A shop's half piers bear when it is opened, so its building was never in doubt.
  expect(collapse.waiting).toBe(1);
  openUp(c, c.all[2]![clad]!);
  strike(c, c.all[3]![deck]!);
  expect([FORM_BREACH_A, FORM_BREACH_B]).toContain(c.form(c.all[3]![deck]!));
  expect(collapse.waiting).toBe(2);
  settle(c);
  // Nothing fell or hung in any of them: only the pieces struck changed.
  expect([collapse.fallen, collapse.hung, collapse.waves]).toEqual([0, 0, 0]);
  const changed = c.all.map((refs, b) => refs.filter((ref, k) => c.form(ref) !== placed[b]![k]).length);
  expect(changed).toEqual([3, 1, 1, 1]);
  // The deck opened whole stands as its teeth, and nothing rode it.
  openUp(c, c.all[3]![deck]!);
  settle(c);
  expect([collapse.fallen, collapse.hung]).toEqual([0, 0]);
});

/** A mast: `storeys` of one pier with four slabs round its head, on 2 by 2 tiles round (x, z). */
function mast(storeys: number, x: number, z: number): { s: Sketch; piers: number[]; slabs: number[][] } {
  const s = new Sketch(2, 2, 8, x, z);
  s.storeys = s.playable = storeys;
  const piers: number[] = [], slabs: number[][] = [];
  for (let storey = 0; storey < storeys; storey++) {
    piers.push(s.pier(0, 0, storey));
    slabs.push([0, 1, 2, 3].map((k) => s.slab(k % 2, k >> 1, storey + 1)));
  }
  return { s, piers, slabs };
}

test("a pier cut to a stub brings down all it carried, lowest first, a wave every 8 ticks", () => {
  const { s, piers, slabs } = mast(6, 96, 96);
  const c = sketchCity(s);
  const { h } = c;
  const began = h.world.tick;
  openUp(c, c.refs[piers[0]!]!);
  // Level by level: what is gone after each wave.
  const gone = (): number[] => slabs.map((floor) => floor.filter((k) => c.form(c.refs[k]!) === -1).length);
  until(c, began + FIRST_WAIT - 1);
  expect(gone()).toEqual([0, 0, 0, 0, 0, 0]);
  until(c, began + FIRST_WAIT);
  expect(gone()).toEqual([4, 4, 0, 0, 0, 0]);
  until(c, began + FIRST_WAIT + WAVE_TICKS - 1);
  expect(gone()).toEqual([4, 4, 0, 0, 0, 0]);
  until(c, began + FIRST_WAIT + WAVE_TICKS);
  expect(gone()).toEqual([4, 4, 4, 4, 0, 0]);
  settle(c);
  expect(gone()).toEqual([4, 4, 4, 4, 4, 4]);
  // The stub stands, the pier that stood on it lies on it as a heap, and those over that left nothing.
  expect(piers.map((k) => c.form(c.refs[k]!))).toEqual([FORM_OPEN, FORM_HEAP, -1, -1, -1, -1]);
  // Each wave went as one batch that fell, from the first loss.
  const t = h.world.structs.chunks[Math.floor(c.refs[0]! / 65536)]!;
  const at = c.at(c.refs[piers[0]!]!);
  expect(t.gone.filter((g) => g.cause === GONE_FELL).map((g) => [g.x, g.y, g.z, g.count])).toEqual([[at.x, at.y, at.z, 10], [at.x, at.y, at.z, 10], [at.x, at.y, at.z, 9]]);
});

test("two buildings falling in one chunk share its waves, and no batch still news is forgotten", () => {
  const a = mast(16, 80, 80), b = mast(16, 110, 80);
  const c = sketchCity([a.s, b.s]);
  const { h } = c;
  const structs = h.world.structs;
  const chunk = Math.floor(c.all[0]![0]! / 65536);
  expect(c.all[1]!.every((ref) => Math.floor(ref / 65536) === chunk)).toBe(true);
  const s = h.join("ada");
  for (let n = 0; n < 100 && !structs.held.every((k) => h.client(s)?.known[k] === structs.chunks[k]!.version); n++) h.run(100);
  h.run(300);
  let bytes = 0, messages = 0;
  const end = h.ends[0]!, on = end.onMessage!;
  end.onMessage = (ch, d) => {
    if (d[0] === S_CHUNK) {
      bytes += d.length;
      messages++;
    }
    on(ch, d);
  };
  openUp(c, c.all[0]![a.piers[0]!]!);
  openUp(c, c.all[1]![b.piers[0]!]!);
  const t = structs.chunks[chunk]!;
  // Each tick: the batches the chunk keeps, and for one it has let go of, how old it was.
  const seen = new Map<number, number>();
  const stamps: number[] = [];
  let youngest = Infinity, most = 0, spent = 0;
  const limit = h.world.tick + 900;
  while (h.host.cityCollapse.waiting > 0 && h.world.tick < limit) {
    h.run(1000 / 30);
    const kept = new Set(t.gone.map((g) => g.version));
    for (const [version, stamp] of seen) if (!kept.has(version)) {
      youngest = Math.min(youngest, h.world.tick - stamp);
      seen.delete(version);
    }
    for (const g of t.gone) if (g.cause === GONE_FELL && !seen.has(g.version)) {
      seen.set(g.version, g.stamp);
      stamps.push(g.stamp);
    }
    most = Math.max(most, h.host.cityCollapse.falling);
    spent = Math.max(spent, h.host.cityCollapse.spent);
  }
  expect(h.host.cityCollapse.waiting).toBe(0);
  // Sixteen waves between them, never two of the chunk's within 8 ticks, so never more than 8 in the 60 ticks a batch is news.
  expect(stamps.length).toBe(16);
  for (let k = 1; k < stamps.length; k++) expect(stamps[k]! - stamps[k - 1]!).toBeGreaterThanOrEqual(WAVE_TICKS);
  for (let k = GONE_KEPT; k < stamps.length; k++) expect(stamps[k]! - stamps[k - GONE_KEPT]!).toBeGreaterThanOrEqual(REMOVAL_NEWS_TICKS);
  expect(youngest).toBeGreaterThanOrEqual(REMOVAL_NEWS_TICKS);
  expect([most, spent <= JUDGEMENTS + 2 * 3 * c.all[0]!.length]).toEqual([2, true]);
  h.run(500);
  // The client was sent each wave as its batch: its rows are the server's, and the whole of both falls cost it this.
  const mine = s.world!.structs.chunks[chunk]!;
  expect(Array.from(mine.kind.subarray(0, t.high))).toEqual(Array.from(t.kind.subarray(0, t.high)));
  console.log(`city collapse wire: two masts of 80 pieces each falling in one chunk, ${messages} chunk messages, ${bytes} bytes; ${s.rubble.length} pieces seen to fall`);
  expect(bytes).toBeLessThan(16 * 64);
  expect(messages).toBeLessThanOrEqual(20);
});

test("past CityCollapseMostAtOnce a building waits as it stands", () => {
  const a = mast(4, 80, 80), b = mast(4, 110, 150);
  const c = sketchCity([a.s, b.s]);
  const { h } = c;
  expect(h.host.rules.assign("CityCollapseMostAtOnce", "1", "console")).toBe("");
  const began = h.world.tick;
  openUp(c, c.all[0]![a.piers[0]!]!);
  openUp(c, c.all[1]![b.piers[0]!]!);
  const standing = (k: number, m: { slabs: number[][] }): number => m.slabs.flat().filter((p) => c.form(c.all[k]![p]!) !== -1).length;
  until(c, began + FIRST_WAIT + 1);
  // The first is falling. The second, in another chunk, has lost nothing yet.
  expect([h.host.cityCollapse.falling, h.host.cityCollapse.waiting, standing(0, a) < 16, standing(1, b)]).toEqual([1, 2, true, 16]);
  settle(c);
  expect([standing(0, a), standing(1, b)]).toEqual([0, 0]);
});

test("with CityCollapse off pieces break and nothing falls", () => {
  const { s, piers, slabs } = mast(3, 96, 96);
  const c = sketchCity(s);
  const { h } = c;
  expect(h.host.rules.assign("CityCollapse", "false", "console")).toBe("");
  openUp(c, c.refs[piers[0]!]!);
  // The pier over the stub is destroyed: it rests on what is under its foot, as it did before buildings were judged.
  for (let k = 0; k < 3; k++) strike(c, c.refs[piers[1]!]!);
  until(c, h.world.tick + 3 * FIRST_WAIT);
  expect([h.host.cityCollapse.waiting, h.host.cityCollapse.waves]).toEqual([0, 0]);
  expect(piers.map((k) => c.form(c.refs[k]!))).toEqual([FORM_OPEN, FORM_HEAP, FORM_WHOLE]);
  expect(slabs.flat().every((k) => c.form(c.refs[k]!) === FORM_WHOLE)).toBe(true);
});

test("a destroyed piece of a building is left as its heap where the rule says it rests", () => {
  const s = new Sketch(1, 1);
  s.storeys = 3;
  const walls = [0, 1, 2].map((storey) => s.edge("zwin", "concrete", 0, 0, SIDE_FRONT, storey));
  const beam = s.edge("beam8", "concrete", 0, 0, SIDE_BACK, 0, 3.4);
  const c = sketchCity(s);
  // The top wall goes: the wall under it stands, so it lies there as its heap.
  for (let k = 0; k < 3; k++) strike(c, c.refs[walls[2]!]!);
  expect(c.form(c.refs[walls[2]!]!)).toBe(FORM_HEAP);
  // A beam at a storey's head has nothing under its foot.
  for (let k = 0; k < 3 && c.form(c.refs[beam]!) !== -1; k++) strike(c, c.refs[beam]!);
  expect(c.form(c.refs[beam]!)).toBe(-1);
  // The middle wall goes: it rests on the ground wall, and the heap that lay on it has nothing under it and is cleared.
  for (let k = 0; k < 3; k++) strike(c, c.refs[walls[1]!]!);
  expect(c.form(c.refs[walls[1]!]!)).toBe(FORM_HEAP);
  settle(c);
  expect(walls.map((k) => c.form(c.refs[k]!))).toEqual([FORM_WHOLE, FORM_HEAP, -1]);
});

test("past a tick's judgements a destroyed piece is answered by the look straight down", () => {
  // 1,120 pieces: its pins and one judgement are 3,360, and a second judgement passes the 4,000 of a tick.
  const { s, slabs } = mast(224, 96, 96);
  const c = sketchCity(s);
  const collapse = c.h.host.cityCollapse;
  const destroy = (k: number): void => {
    for (let n = 0; n < 3; n++) strike(c, c.refs[k]!);
    expect(c.form(c.refs[k]!)).toBe(-1);
  };
  destroy(slabs[223]![0]!);
  expect(collapse.judged).toBe(3 * c.refs.length);
  destroy(slabs[223]![1]!);
  expect(collapse.judged).toBe(4 * c.refs.length);
  expect(collapse.judged).toBeGreaterThan(JUDGEMENTS);
  destroy(slabs[223]![2]!);
  expect(collapse.judged).toBe(4 * c.refs.length);
  // The next tick has its own.
  until(c, c.h.world.tick + 1);
  destroy(slabs[223]![3]!);
  expect(collapse.judged).toBe(5 * c.refs.length);
});

test("one blast across eight buildings is judged within a tick's judgements, a building over at most", () => {
  // 400 pieces each: a building's pins and one judgement are 1,200, so eight asked of at once would be 9,600.
  const masts = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => mast(80, 40 + 60 * (k % 4), 60 + 120 * (k >> 2)));
  const c = sketchCity(masts.map((m) => m.s));
  const collapse = c.h.host.cityCollapse;
  const each = c.all[0]!.length;
  const falls = masts.map((m, k) => c.all[k]![m.slabs[79]![0]!]!);
  expect(collapse.resting(falls, null, new Set())).toBe(true);
  // The fourth passes 4,000 and is the last judged: the other four are answered by the look straight down.
  expect([each, collapse.judged]).toEqual([400, 4 * 3 * each]);
  expect(collapse.judged).toBeLessThanOrEqual(JUDGEMENTS + 3 * each);
  // The next tick has its own, and the pins made are kept.
  until(c, c.h.world.tick + 1);
  expect(collapse.resting(falls, null, new Set())).toBe(true);
  expect(collapse.judged - 4 * 3 * each).toBeLessThanOrEqual(JUDGEMENTS + 3 * each);
  expect(collapse.judged).toBeGreaterThan(4 * 3 * each);
});

test("a body under a falling storey is harmed once a wave, by CityCollapseDamage", () => {
  const harm = (scale: string): number => {
    const { s, piers } = mast(4, 96, 96);
    const c = sketchCity(s);
    const { h } = c;
    expect(h.host.rules.assign("CityCollapseDamage", scale, "console")).toBe("");
    // One under the first floor, off the pier, and one outside the building.
    const ada = record(h, survivor(h, "ada", { cheats: true, at: { x: 93, z: 93 } }));
    const bob = record(h, survivor(h, "bob", { cheats: true, at: { x: 120, z: 96 } }));
    const was = [h.host.survival.value(ada, V_HEALTH), h.host.survival.value(bob, V_HEALTH)];
    openUp(c, c.refs[piers[0]!]!);
    settle(c);
    expect(h.host.survival.value(bob, V_HEALTH)).toBe(was[1]!);
    return Math.round(was[0]! - h.host.survival.value(ada, V_HEALTH));
  };
  // The first wave takes levels 1 and 2 and the second 3 and 4: the body on the ground is within two storeys of the first alone.
  expect([harm("1"), harm("2"), harm("0")]).toEqual([35, 70, 0]);
});

test("a client near hears a building give, once, a second before it falls", () => {
  const { s, piers } = mast(3, 96, 96);
  const c = sketchCity(s);
  const { h } = c;
  const ada = h.join("ada");
  h.run(500);
  const heard: { x: number; y: number; z: number }[] = [];
  const take = (): void => {
    heard.push(...ada.groans);
    ada.groans.length = 0;
  };
  openUp(c, c.refs[piers[0]!]!);
  strike(c, c.refs[piers[0]!]!);
  h.run(400, take);
  take();
  const at = c.at(c.refs[piers[0]!]!);
  expect(heard).toEqual([{ x: at.x, y: at.y, z: at.z }]);
});

test("after a restart a building with a carrier broken is judged once and comes down", () => {
  const db = join(dir, "collapse.db");
  const { s, piers, slabs } = mast(4, 96, 96);
  const c = sketchCity(s, 4, { dbPath: db });
  expect(c.h.host.rules.assign("CityCollapse", "false", "console")).toBe("");
  openUp(c, c.refs[piers[0]!]!);
  c.h.run(2500);
  c.h.host.shutdown();
  // The same map and save, with collapse on again as a new server has it.
  const h = new Harness({}, 1, 30, { dev: true, map: c.map, dbPath: db });
  const collapse = h.host.cityCollapse;
  expect(collapse.waiting).toBe(1);
  const began = h.world.tick;
  while (collapse.waiting > 0 && h.world.tick < began + 300) h.run(1000 / 30);
  const form = (ref: number): number => h.world.structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff]!;
  // It fell at once, with no wait and nothing heard, and every slab is gone.
  expect([collapse.waiting, collapse.waves, h.world.tick - began]).toEqual([0, 2, WAVE_TICKS + 1]);
  expect(slabs.flat().every((k) => form(c.refs[k]!) === 0)).toBe(true);
  h.host.shutdown();
});
