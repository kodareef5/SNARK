// What the support rule says of buildings set down by hand: what stands, what hangs, what falls, and what a pin holds.

import { expect, test } from "bun:test";
import { FORM_OPEN, formKind } from "../../shared/content/breaks.ts";
import { FALLS, HANGS, PIN_ALWAYS, PIN_WHILE, RESTS, STANDS, VERDICT } from "../../shared/world/bearing.ts";
import { SIDE_BACK, SIDE_FRONT, SIDE_LEFT, SIDE_RIGHT, Sketch, stood, type Stood } from "../fixtures/sketch.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
/** Opens the piece `ref`: its open form, which carries nothing unless its family always does. */
function open(b: Stood, ref: number): void {
  const kind = formKind(reg, b.structs.mapKind(Math.floor(ref / 65536), ref & 0xffff), FORM_OPEN, 0);
  expect(kind).not.toBe(0);
  b.structs.swap(ref, kind);
}
const verdicts = (b: Stood): number[] => b.judge().map((v) => v & VERDICT);

test("a slab stands on its walls, and falls when all of them are opened", () => {
  const s = new Sketch(1, 1);
  const walls = [SIDE_FRONT, SIDE_RIGHT, SIDE_BACK, SIDE_LEFT].map((side) => s.edge("wall8", "concrete", 0, 0, side, 0));
  const slab = s.slab(0, 0, 1);
  const b = stood(s);
  expect(verdicts(b)).toEqual([STANDS, STANDS, STANDS, STANDS, STANDS]);
  for (const w of walls.slice(0, 3)) open(b, b.refs[w]!);
  expect(verdicts(b)[slab]).toBe(STANDS);
  open(b, b.refs[walls[3]!]!);
  // The opened walls are what is left of them, and stand on the ground.
  expect(verdicts(b)).toEqual([STANDS, STANDS, STANDS, STANDS, FALLS]);
});

test("a cell stands between two that are held, hangs beside one, and else falls", () => {
  const s = new Sketch(3, 1);
  const walls = [0, 1, 2].map((i) => [s.edge("wall8", "concrete", i, 0, SIDE_FRONT, 0), s.edge("wall8", "concrete", i, 0, SIDE_BACK, 0)]);
  const slabs = [0, 1, 2].map((i) => s.slab(i, 0, 1));
  const b = stood(s);
  for (const w of walls[1]!) open(b, b.refs[w]!);
  expect(slabs.map((k) => verdicts(b)[k])).toEqual([STANDS, STANDS, STANDS]);
  for (const w of walls[0]!) open(b, b.refs[w]!);
  expect(slabs.map((k) => verdicts(b)[k])).toEqual([FALLS, HANGS, STANDS]);
});

test("a wall falls with the wall it stood on, and what stood on it too", () => {
  const s = new Sketch(1, 1);
  s.storeys = 3;
  const column = [0, 1, 2].map((storey) => s.edge("zwin", "limestucco", 0, 0, SIDE_FRONT, storey));
  const parapet = s.edge("zparapet8", "limestucco", 0, 0, SIDE_FRONT, 3);
  const b = stood(s);
  expect(verdicts(b)).toEqual([STANDS, STANDS, STANDS, STANDS]);
  open(b, b.refs[column[1]!]!);
  expect(verdicts(b)).toEqual([STANDS, STANDS, FALLS, FALLS]);
  expect(parapet).toBe(3);
});

test("a wall rides a slab that stands, and a parapet rides neither a sill nor a hanging slab", () => {
  const s = new Sketch(2, 1);
  s.storeys = s.playable = 2;
  const under = [s.edge("wall8", "concrete", 1, 0, SIDE_FRONT, 0), s.edge("wall8", "concrete", 1, 0, SIDE_BACK, 0)];
  const slabs = [s.slab(0, 0, 1), s.slab(1, 0, 1)];
  // Over tile 1 a wall stands on the slab's far side, where no wall is under it; over tile 0 a parapet on the slab that hangs.
  const wall = s.edge("wall8", "concrete", 1, 0, SIDE_RIGHT, 1);
  const sill = s.edge("sill8", "concrete", 1, 0, SIDE_FRONT, 1);
  const onSill = s.edge("zparapet8", "limestucco", 1, 0, SIDE_FRONT, 2);
  const onHung = s.edge("zparapet8", "limestucco", 0, 0, SIDE_LEFT, 1);
  const b = stood(s);
  const placed = b.pins();
  // As placed the slab over no wall hangs and the parapets ride nothing, so they are pinned.
  expect([placed[slabs[0]!], placed[onHung], placed[onSill], placed[wall], placed[sill]]).toEqual([PIN_WHILE, PIN_WHILE, PIN_WHILE, 0, 0]);
  expect(verdicts(b)).toEqual(new Array(8).fill(STANDS));
  for (const w of under) open(b, b.refs[w]!);
  // Nothing holds either slab now, so the wall and the sill on one fall, and the pinned pieces with what they touched.
  const v = verdicts(b);
  expect([v[slabs[1]!], v[wall], v[sill], v[slabs[0]!], v[onHung], v[onSill]]).toEqual([FALLS, FALLS, FALLS, FALLS, FALLS, FALLS]);
});

/** A floor of 7 by 7 tiles walled round, with piers every 16 m as the ruins set them, a stair in a corner and `storeys` of it. */
function tower(storeys: number): { s: Sketch; piers: number[][]; slabs: number[][]; walls: number[][] } {
  const s = new Sketch(7, 7);
  s.storeys = s.playable = storeys;
  s.stair(0, 0, storeys);
  const piers: number[][] = [], slabs: number[][] = [], walls: number[][] = [];
  for (let storey = 0; storey < storeys; storey++) {
    piers.push([[1, 1], [1, 3], [3, 1], [3, 3]].map(([i, j]) => s.pier(i!, j!, storey)));
    const ring: number[] = [];
    for (let k = 0; k < 7; k++) ring.push(s.edge("zcurt", "limestone", k, 0, SIDE_FRONT, storey), s.edge("zcurt", "limestone", k, 6, SIDE_BACK, storey), s.edge("zcurt", "limestone", 0, k, SIDE_LEFT, storey), s.edge("zcurt", "limestone", 6, k, SIDE_RIGHT, storey));
    walls.push(ring);
    const floor: number[] = [];
    for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) floor.push(i + j === 0 ? -1 : s.slab(i, j, storey + 1));
    slabs.push(floor);
  }
  return { s, piers, slabs, walls };
}

test("a tower of piers every 16 m stands as placed with no pin", () => {
  const { s } = tower(3);
  const b = stood(s);
  expect(b.pins().every((p) => p === 0)).toBe(true);
  expect(verdicts(b).every((v) => v === STANDS)).toBe(true);
});

test("a ground pier cut to a stub drops the piers over it, and their slabs hang", () => {
  const { s, piers, slabs, walls } = tower(3);
  const b = stood(s);
  open(b, b.refs[piers[0]![0]!]!);
  const v = verdicts(b);
  // The stub stands. The piers over it have lost their foot.
  expect(piers.map((row) => v[row[0]!])).toEqual([STANDS, FALLS, FALLS]);
  expect(piers.flatMap((row) => row.slice(1).map((k) => v[k]))).toEqual(new Array(9).fill(STANDS));
  // The four cells round the pier, on every floor: none stands, and none of them is without a neighbour, so none falls.
  const group = [1 + 7, 2 + 7, 1 + 14, 2 + 14];
  for (const floor of slabs) expect(group.map((c) => v[floor[c]!])).toEqual([HANGS, HANGS, HANGS, HANGS]);
  // Every other slab and every wall stands.
  for (const floor of slabs) expect(floor.filter((k, c) => k >= 0 && !group.includes(c)).every((k) => v[k] === STANDS)).toBe(true);
  expect(walls.flat().every((k) => v[k] === STANDS)).toBe(true);
});

test("a deep floor pancakes where no cell beside it stands", () => {
  const { s, piers, slabs } = tower(1);
  const b = stood(s);
  for (const k of piers[0]!) open(b, b.refs[k]!);
  const v = verdicts(b);
  const at = (i: number, j: number): number => v[slabs[0]![j * 7 + i]!]!;
  // The ring inside the walls' hangs from it, and the middle nine have nothing beside them that stands.
  expect([at(1, 3), at(3, 1), at(5, 3), at(3, 5)]).toEqual([HANGS, HANGS, HANGS, HANGS]);
  expect([at(2, 2), at(3, 3), at(4, 4), at(2, 4)]).toEqual([FALLS, FALLS, FALLS, FALLS]);
  expect([at(0, 3), at(6, 6), at(3, 0)]).toEqual([STANDS, STANDS, STANDS]);
});

test("a roof over a hollow shell is one plate, and stands while a third of its edge is held", () => {
  const s = new Sketch(3, 3);
  s.storeys = 4;
  s.playable = 0;
  const walls: number[] = [];
  for (let k = 0; k < 3; k++) walls.push(s.edge("zshaft8", "concrete", k, 0, SIDE_FRONT, 0), s.edge("zshaft8", "concrete", k, 2, SIDE_BACK, 0), s.edge("zshaft8", "concrete", 0, k, SIDE_LEFT, 0), s.edge("zshaft8", "concrete", 2, k, SIDE_RIGHT, 0));
  const roof: number[] = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) roof.push(s.slab(i, j, 4, "floor8", "tar"));
  const b = stood(s);
  expect(verdicts(b).every((v) => v === STANDS)).toBe(true);
  // Shells are taken away until the front row's three cells are the only ones held: three of the eight at the edge.
  for (const k of walls) if (![0, 4, 8].includes(k - walls[0]!)) b.structs.remove(b.refs[k]!);
  expect(roof.map((k) => verdicts(b)[k])).toEqual(new Array(9).fill(STANDS));
  b.structs.remove(b.refs[walls[0]!]!);
  expect(roof.map((k) => verdicts(b)[k])).toEqual(new Array(9).fill(FALLS));
});

test("a stair holds the slabs beside it, and a piece with no family never falls", () => {
  const s = new Sketch(3, 1);
  s.stair(0, 0, 2);
  const slabs = [0, 1, 2].map((i) => s.slab(i, 0, 1));
  const flight = s.put("flight", "concrete", 2, 0, 9);
  const b = stood(s);
  // The third slab is a bay from the stair: it hangs as placed, so it is pinned and stands.
  expect(slabs.map((k) => b.pins()[k])).toEqual([0, 0, PIN_WHILE]);
  expect(verdicts(b)).toEqual([STANDS, STANDS, STANDS, STANDS]);
  b.structs.remove(b.refs[slabs[1]!]!);
  expect([verdicts(b)[slabs[0]!], verdicts(b)[slabs[2]!], verdicts(b)[flight]]).toEqual([STANDS, FALLS, STANDS]);
});

test("a slab over four tiles hangs when half of them fail and falls when most do", () => {
  const s = new Sketch(2, 2);
  const walls = [s.edge("wall8", "concrete", 0, 0, SIDE_FRONT, 0), s.edge("wall8", "concrete", 1, 0, SIDE_FRONT, 0), s.edge("wall8", "concrete", 0, 1, SIDE_BACK, 0)];
  const slab = s.put("floor16", "concrete", 0, 0, 3.6, 4, 4);
  const b = stood(s);
  expect(verdicts(b)[slab]).toBe(STANDS);
  open(b, b.refs[walls[2]!]!);
  expect(verdicts(b)[slab]).toBe(HANGS);
  open(b, b.refs[walls[1]!]!);
  expect(verdicts(b)[slab]).toBe(HANGS);
  open(b, b.refs[walls[0]!]!);
  expect(verdicts(b)[slab]).toBe(FALLS);
});

test("in 4 m bays a slab reaches one bay past the wall that holds it", () => {
  const cells = (bay: number): number[] => {
    const s = new Sketch(3, 1, bay);
    s.edge(bay === 4 ? "beam4" : "beam8", "concrete", 0, 0, SIDE_FRONT, 0, 3.4);
    const slabs = [0, 1, 2].map((i) => s.slab(i, 0, 1));
    const b = stood(s);
    // Without its pins: what the rule alone says of the building as placed.
    return slabs.map((k) => (b.pins()[k] === 0 ? STANDS : b.pins()[k] === PIN_WHILE ? HANGS : FALLS));
  };
  expect(cells(4)).toEqual([STANDS, STANDS, HANGS]);
  expect(cells(8)).toEqual([STANDS, HANGS, HANGS]);
});

test("a pinned piece falls once nothing stands under or beside it, and one that touched nothing never does", () => {
  const s = new Sketch(3, 1);
  const wall = s.edge("wall8", "concrete", 0, 0, SIDE_FRONT, 0);
  const slabs = [0, 1].map((i) => s.slab(i, 0, 1));
  const afloat = s.slab(2, 0, 3);
  const b = stood(s);
  expect([b.pins()[slabs[0]!], b.pins()[slabs[1]!], b.pins()[afloat]]).toEqual([0, PIN_WHILE, PIN_ALWAYS]);
  expect(verdicts(b)).toEqual([STANDS, STANDS, STANDS, STANDS]);
  b.structs.remove(b.refs[wall]!);
  expect(verdicts(b).slice(1)).toEqual([FALLS, FALLS, STANDS]);
});

test("a fallen piece rests where something stands right under its foot", () => {
  const s = new Sketch(1, 1);
  s.storeys = 3;
  const ground = s.edge("zlobby", "concrete", 0, 0, SIDE_FRONT, 0);
  for (const storey of [1, 2]) s.edge("zwin", "limestucco", 0, 0, SIDE_FRONT, storey);
  const beam = s.edge("beam8", "concrete", 0, 0, SIDE_BACK, 0, 3.4);
  const b = stood(s);
  // On the ground, on a wall, and a beam at a storey's top on nothing.
  expect(b.judge().map((v) => v & RESTS)).toEqual([RESTS, RESTS, RESTS, 0]);
  open(b, b.refs[ground]!);
  // The opened wall carries nothing, and a heap may lie on what is left of it. What fell from over that leaves none.
  expect(b.judge()).toEqual([STANDS | RESTS, FALLS | RESTS, FALLS, STANDS]);
  expect(beam).toBe(3);
});

test("a piece outside the frame and a piece somebody owns never fall", () => {
  const s = new Sketch(1, 1);
  const porch = s.put("zroof8", "concrete", 0, 0, 12, 0, -9);
  const wall = s.edge("zwin", "limestucco", 0, 0, SIDE_FRONT, 2);
  const b = stood(s);
  expect(b.pins()).toEqual([0, PIN_ALWAYS]);
  const t = b.structs.chunks[Math.floor(b.refs[wall]! / 65536)]!;
  t.owner[b.refs[wall]! & 0xffff] = 7;
  expect(verdicts(b)).toEqual([STANDS, STANDS]);
  expect(porch).toBe(0);
});

/** Three bays walled front and back on two storeys, a stair in the middle one. Returns the ground walls by tile, and the pieces over them. */
function flats(): { b: Stood; ground: number[][]; over: number[]; beam: number } {
  const s = new Sketch(3, 1);
  s.storeys = s.playable = 2;
  s.stair(1, 0, 2);
  const walls = (storey: number): number[][] => [0, 1, 2].map((i) => [s.edge("wall8", "concrete", i, 0, SIDE_FRONT, storey), s.edge("wall8", "concrete", i, 0, SIDE_BACK, storey)]);
  const ground = walls(0);
  const beam = s.edge("beam8", "concrete", 0, 0, SIDE_FRONT, 0, 3.4);
  const over = [...[0, 1, 2].map((i) => s.slab(i, 0, 1)), ...walls(1).flat(), ...[0, 1, 2].map((i) => s.slab(i, 0, 2))];
  return { b: stood(s), ground, over, beam };
}

test("a storey left a quarter of its uprights stands, and with less it gives way with all over it", () => {
  const { b, ground, over, beam } = flats();
  const at = (share: number): number[] => { const v = b.judge(share).map((x) => x & VERDICT); return over.map((k) => v[k]!); };
  expect(at(0.25)).toEqual(over.map(() => STANDS));
  // Four of six ground walls opened leave a third: the stair holds every slab, as it does without the storey's rule.
  for (const w of [...ground[0]!, ...ground[2]!]) open(b, b.refs[w]!);
  expect(at(0.25)).toEqual(over.map(() => STANDS));
  // A fifth leaves a sixth. The stair does not hold the storey up: every slab and wall over it falls, and its beam.
  open(b, b.refs[ground[1]![0]!]!);
  expect(at(0.25)).toEqual(over.map(() => FALLS));
  expect(b.judge(0.25)[beam]! & VERDICT).toBe(FALLS);
  // The wall left on the ground and the opened ones stand where they are.
  expect(ground.flat().map((k) => b.judge(0.25)[k]! & VERDICT)).toEqual(ground.flat().map(() => STANDS));
  // With no share asked, the stair holds it all up as before.
  expect(at(0)).toEqual(over.map(() => STANDS));
  // A lower share asks for more to be broken.
  expect(at(0.1)).toEqual(over.map(() => STANDS));
});

test("a storey the map stood no upright on is not asked for its share", () => {
  const s = new Sketch(3, 1);
  s.stair(0, 0, 2);
  const slabs = [0, 1, 2].map((i) => s.slab(i, 0, 1));
  const b = stood(s);
  expect(b.judge(0.25).map((v) => v & VERDICT)).toEqual(slabs.map(() => STANDS));
});
