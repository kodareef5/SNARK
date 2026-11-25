// Which parts of its map a page wants (client/core/map-want.ts): each kind within its reach of a centre, kept a sector
// past it, from the body, where it heads, the camera, a sight's focus and the map screen.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FOCUS_STATICS, KEEP_PAST, PHONE_STATICS, PartBoxes, ROAD_REACH, STATICS_BUDGET, Wanted, centresOf, staticsReach, tierWant } from "../../client/core/map-want.ts";
import { CHUNK_SIZE, SECTOR_CHUNKS } from "../../shared/coords.ts";
import { OVERVIEW_CHUNKS, mapTops, readHead, squareOf, writeMap, type MapPart } from "../../shared/world/mapfile.ts";
import { wideMap } from "../fixtures/map.ts";
import { coreRegistry } from "../fixtures/world.ts";

const map = wideMap();
const head = readHead(writeMap({ ...map, tops: mapTops(map, coreRegistry()) }));
const boxes = new PartBoxes(head);

/** Metres from (x, z) to a part's square. */
const off = (p: MapPart, x: number, z: number): number => {
  const sq = squareOf(head.dims, p.kind === "overview" || p.kind === "tops" ? OVERVIEW_CHUNKS : SECTOR_CHUNKS, p.col, p.row)!;
  return Math.hypot(Math.max(sq.cx0 * CHUNK_SIZE - x, x - sq.cx1 * CHUNK_SIZE, 0), Math.max(sq.cz0 * CHUNK_SIZE - z, z - sq.cz1 * CHUNK_SIZE, 0));
};
const names = (parts: Iterable<MapPart>): string[] => [...parts].map((p) => p.name).sort();

test("each kind is wanted within its reach of the body: overviews and tops the view, ground the fine window", () => {
  const body = { x: 300, z: 600 };
  const want = new Wanted().look(boxes, centresOf(body, body, { view: 2000, statics: 900 }));
  const reach = (p: MapPart): number => (p.kind === "overview" || p.kind === "tops" ? 2000 : p.kind === "ground" ? Math.max(ROAD_REACH, 900) : 900);
  const expected = boxes.parts.filter((p) => off(p, body.x, body.z) <= reach(p));
  expect(names(want.parts.keys())).toEqual(names(expected));
  // Every kind is among them, and some of each but the overviews are not.
  for (const kind of ["overview", "ground", "statics", "tops"]) expect([kind, expected.some((p) => p.kind === kind)]).toEqual([kind, true]);
  for (const kind of ["ground", "statics"]) expect([kind, boxes.parts.some((p) => p.kind === kind && !want.parts.has(p))]).toEqual([kind, true]);
  // Each by its metres from the body.
  for (const [p, d] of want.parts) expect(d).toBe(off(p, body.x, body.z));
});

test("a part is kept a sector past its reach, so a body on a border does not let it go and ask again", () => {
  const statics = boxes.parts.filter((p) => p.kind === "statics");
  const reach = 900;
  // A body walking east a metre a step: each sector is wanted once, and kept from then on until a sector past the reach.
  const held = new Set<MapPart>();
  const asks = new Map<MapPart, number>();
  for (let x = 0; x <= 4480; x += 16) {
    for (const dx of [0, 40, -40, 0]) {
      const body = { x: x + dx, z: 600 };
      const want = new Wanted().look(boxes, centresOf(body, body, { view: 2000, statics: reach }));
      for (const p of statics) {
        if (want.parts.has(p) && !held.has(p)) {
          held.add(p);
          asks.set(p, (asks.get(p) ?? 0) + 1);
        }
        if (held.has(p) && !want.kept.has(p)) {
          expect(off(p, body.x, body.z)).toBeGreaterThan(reach + KEEP_PAST);
          held.delete(p);
        }
      }
    }
  }
  expect([...asks.values()].every((n) => n === 1)).toBe(true);
  expect(asks.size).toBe(statics.filter((p) => off(p, 0, 600) <= 4480).length);
});

test("a sight's focus wants the fine window's ground and a sector of statics; the map screen its overviews", () => {
  const body = { x: 100, z: 600 }, focus = { x: 4300, z: 600 };
  const from = { view: 1500, statics: 600 };
  const alone = new Wanted().look(boxes, centresOf(body, body, from));
  const sighted = new Wanted().look(boxes, centresOf(body, body, { ...from, focus }));
  const added = boxes.parts.filter((p) => sighted.parts.has(p) && !alone.parts.has(p));
  expect(added.length).toBeGreaterThan(0);
  for (const p of added) expect([p.kind, off(p, focus.x, focus.z) <= (p.kind === "ground" ? ROAD_REACH : FOCUS_STATICS)]).toEqual([p.kind, p.kind === "ground" || p.kind === "statics" || p.kind === "buildings"]);
  // The map screen open over the east end: its overviews, and nothing else.
  const near = { view: 300, statics: 300 }, mine = new Wanted().look(boxes, centresOf(body, body, near));
  const screen = new Wanted().look(boxes, centresOf(body, body, { ...near, screen: { x: 4000, z: 600, half: 500 } }));
  const shown = boxes.parts.filter((p) => screen.parts.has(p) && !mine.parts.has(p));
  expect(shown.length > 0 && shown.every((p) => p.kind === "overview")).toBe(true);
  // Where the body is heading counts as the body.
  const ahead = new Wanted().look(boxes, centresOf(body, { x: 3000, z: 600 }, from));
  expect(boxes.parts.filter((p) => p.kind === "statics" && off(p, 3000, 600) <= 600).every((p) => ahead.parts.has(p))).toBe(true);
});

test("a part a reader waits for is wanted wherever it is, by its metres from the body", () => {
  const body = { x: 100, z: 600 };
  const far = boxes.parts.find((p) => p.kind === "statics" && off(p, body.x, body.z) > 3000)!;
  const want = new Wanted().look(boxes, centresOf(body, body, { view: 1000, statics: 500 }), new Set([far]));
  expect([want.parts.get(far), want.kept.has(far)]).toEqual([off(far, body.x, body.z), true]);
});

test("a phone holds statics to 1,536 m on the tiers that reach past it, and a smaller budget", () => {
  expect([staticsReach(tierOf("medium"), false), staticsReach(tierOf("medium"), true), staticsReach(tierOf("high"), true), staticsReach(tierOf("lowpoly"), false)]).toEqual([2500, PHONE_STATICS, PHONE_STATICS, 2048]);
  expect([tierWant(tierOf("medium")).budget, tierWant(tierOf("high"), true).budget, tierWant(tierOf("ultra")).view]).toEqual([STATICS_BUDGET.medium, STATICS_BUDGET.touch, 8000]);
});
