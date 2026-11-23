// A building's roof by its type and its roof's form (content/ruins.ts flatRoof, pitchFinish), as the map tool lays it.
import { expect, test } from "bun:test";
import { SEAM_SHARE } from "../../content/ruins.ts";
import { Mason, tilesOf, type Frame } from "../../tools/mapworld/ruin-geometry.ts";
import { stack } from "../../tools/mapworld/ruin-layouts.ts";
import type { Form, Rule } from "../../tools/mapworld/ruin-vocabulary.ts";

const frame: Frame = { x: 128, z: 128, yaw: 0, c: 1, s: 0, width: 32, depth: 16, rings: [[[-16, -8], [16, -8], [16, 8], [-16, 8], [-16, -8]]] };
/** How many pieces of each roof kind a building of `recipe` with a roof of form `roof` is laid with. */
function roofs(recipe: string, roof: string, roofDraw = 0.9): Record<string, number> {
  const form: Form = { shell: "masonry", inside: "suites", roof, front: "porch", windowEvery: 3 };
  const rule: Rule = { recipe, roofDraw, height: 8, finish: "limestone", feature: "rooms", holes: 0, wall: 0.4, bay: 8, matched: [], provisional: false, form };
  const m = new Mason(frame, 0);
  stack(m, tilesOf(frame, 8), 8, 8, rule, { seed: 7, playable: 1, detail: 0 });
  const n: Record<string, number> = {};
  for (const p of m.pieces) {
    const [, shape, finish] = p.kind.split("_");
    if (shape!.startsWith("zpitch") || finish === "tar") n[`${shape!.replace(/\d+$/, "")} ${finish}`] = (n[`${shape!.replace(/\d+$/, "")} ${finish}`] ?? 0) + 1;
  }
  return n;
}

test("a flat roof's top plates are tar and gravel, but a garage's deck and the plates under a pitch", () => {
  for (const [recipe, roof] of [["apartment", "service"], ["shop", "flat"], ["hotel", "terrace"], ["civic", "stepped"]]) expect(Object.keys(roofs(recipe!, roof!))).toEqual(["floor tar"]);
  expect(roofs("garage", "service")).toEqual({});
  expect(roofs("station", "canopy")).toEqual({});
  expect(roofs("house", "hip")["floor tar"]).toBeUndefined();
});

test("a house's pitched roof is clay but for a small share by its own draw; commerce's is standing seam", () => {
  expect(Object.keys(roofs("house", "hip", 0.9))).toEqual(["zpitch clay"]);
  expect(Object.keys(roofs("house", "hip", SEAM_SHARE / 2))).toEqual(["zpitch seam"]);
  expect(Object.keys(roofs("apartment", "pitched", 0.9))).toEqual(["zpitch clay"]);
  expect(Object.keys(roofs("shop", "pitched", 0.9))).toEqual(["zpitch seam"]);
});

test("a shed's monitors are standing seam in rust's colour over a tar roof, a nave's ridge clay", () => {
  expect(Object.keys(roofs("shed", "monitor")).sort()).toEqual(["floor tar", "zpitch rustseam"]);
  expect(Object.keys(roofs("theatre", "nave"))).toEqual(["zpitch clay"]);
});
