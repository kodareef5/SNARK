// Blueprints (shared/world/blueprint.ts): the bytes and the text there and back, their size for a real base, what is
// refused and why, and the turns, mirror and moves against the lattice's own corners.

import { expect, test } from "bun:test";
import { FORMS, PLANNED_FORMS } from "../../content/building/forms.ts";
import { hashBytes } from "../../shared/hash.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import { Rng } from "../../shared/rng.ts";
import {
  BLUEPRINT_FORMAT,
  BLUEPRINT_PIECES_MOST,
  BLUEPRINT_PREFIX,
  TIER_ANY,
  blueprintFault,
  captureBlueprint,
  checkBlueprint,
  decodeBlueprint,
  decodeBlueprintText,
  encodeBlueprint,
  encodeBlueprintText,
  makeBlueprint,
  mirrorBlueprint,
  moveBlueprint,
  reanchorBlueprint,
  turnBlueprint,
  type Blueprint,
  type BlueprintForms,
  type BlueprintMoved,
  type BlueprintPiece,
} from "../../shared/world/blueprint.ts";
import { FORM_LAYERS, SLOT_CLASSES } from "../../shared/world/lattice/forms.ts";
import { CLS_DIRS, DIRS, canon, canonical, dirTurn, elementCorners, key0, key1, keyAnchor, keyDir, keyFlip, keyLvl, keyM0, keyM3, keyRot, tupleMirror, tupleTurn } from "../../shared/world/lattice/module.ts";

const ALL: BlueprintForms = { ...FORMS, ...PLANNED_FORMS };
const NAMES = Object.keys(ALL);
const THATCH = 0;
const WOOD = 1;
const STONE = 2;
const METAL = 3;

const S = new Int32Array(32);
const clsOf = (form: string): number => SLOT_CLASSES.indexOf(ALL[form]!.cls);
const wideOf = (form: string): number => 1 + Math.max(0, ...(ALL[form]!.cells ?? []).map((c) => c[0]));
const sideOf = (form: string): number => ALL[form]!.size ?? 2;

/** A piece of a form named from the corner `m` along `dir`, at its canonical key. */
function at(form: string, tier: number, m: readonly number[], lvl: number, dir: number, rot = 0, flip = 0): BlueprintPiece {
  S.set(m);
  canonical(clsOf(form), S, 0, dir, S, 4, sideOf(form) * wideOf(form));
  return { form, tier, k0: key0(clsOf(form), S[4]!, S[5]!, S[6]!), k1: key1(S[7]!, lvl, canon.dir, FORM_LAYERS.indexOf(ALL[form]!.layer), rot, flip) };
}

/** The corner of a square grid, `i` whole sides along +X and `j` along +Z. */
const grid = (i: number, j: number): number[] => [2 * i, 0, 0, 2 * j];

/**
 * A house of `wide` by `deep` squares: foundations, outside walls facing out with windows and a door, inside walls every
 * third line with doorways, pillars where those cross, a ceiling over every storey and stairs up through alternate corners.
 */
function house(wide: number, deep: number, storeys: number, tier: number): BlueprintPiece[] {
  const out: BlueprintPiece[] = [];
  for (let i = 0; i < wide; i++) for (let j = 0; j < deep; j++) out.push(at("foundation", tier, grid(i, j), 0, 0));
  for (let s = 0; s < storeys; s++) {
    const lvl = 4 * s;
    const outer = (n: number): string => (n % 4 === 2 ? "windowframe" : "wall");
    for (let i = 0; i < wide; i++) {
      const front = s === 0 && i === 1;
      out.push(at(front ? "doorframe" : outer(i), tier, grid(i, 0), lvl, 0, 1));
      if (front) out.push(at("door", tier, grid(i, 0), lvl, 0, 1));
      out.push(at(outer(i), tier, grid(i, deep), lvl, 0, 0));
    }
    for (let j = 0; j < deep; j++) {
      out.push(at(outer(j), tier, grid(0, j), lvl, 3, 0));
      out.push(at(outer(j), tier, grid(wide, j), lvl, 3, 1));
    }
    for (let i = 3; i < wide; i += 3) {
      for (let j = 0; j < deep; j++) {
        out.push(at(j % 3 === 1 ? "doorframe" : "wall", tier, grid(i, j), lvl, 3));
        if (j % 3 === 1) out.push(at("door", tier, grid(i, j), lvl, 3));
      }
    }
    for (let j = 3; j < deep; j += 3) {
      for (let i = 0; i < wide; i++) {
        out.push(at(i % 3 === 1 ? "doorframe" : "wall", tier, grid(i, j), lvl, 0));
        if (i % 3 === 1) out.push(at("door", tier, grid(i, j), lvl, 0));
      }
    }
    for (let i = 3; i < wide; i += 3) for (let j = 3; j < deep; j += 3) out.push(at("pillar", tier, grid(i, j), lvl, 0));
    // The stairs of one storey stand in one corner and the next storey's in the other, with no ceiling over a flight.
    const flight = s < storeys - 1 ? (s % 2 === 0 ? 0 : wide - 1) : -1;
    if (flight >= 0) out.push(at("stairs", tier, grid(flight, deep - 1), lvl, 0, s % 4));
    for (let i = 0; i < wide; i++) for (let j = 0; j < deep; j++) if (i !== flight || j !== deep - 1) out.push(at("ceiling", tier, grid(i, j), lvl + 4, 0));
  }
  return out;
}

/**
 * A tower of six triangles a floor about a centre, walled round, standing on the west wall of a house at square `j`: the
 * side it would share with the house is left to the house's wall.
 */
function tower(j: number, storeys: number, tier: number): BlueprintPiece[] {
  const centre = [0, -2, 0, 2 * j + 2];
  const out: BlueprintPiece[] = [];
  for (let s = 0; s <= storeys; s++) {
    for (let q = 0; q < 6; q++) {
      out.push(at(s === 0 ? "triangle_foundation" : "triangle_ceiling", tier, centre, 4 * s, 2 * q + 1));
      if (s === storeys || q === 5) continue;
      const e = 4 * (2 * q + 1);
      out.push(at("wall", tier, [centre[0]! + 2 * DIRS[e]!, centre[1]! + 2 * DIRS[e + 1]!, centre[2]! + 2 * DIRS[e + 2]!, centre[3]! + 2 * DIRS[e + 3]!], 4 * s, (2 * q + 5) % 12, 1));
    }
  }
  return out;
}

/** A base of exactly 2,000 pieces: a stone house of six storeys, a metal tower on its west wall and a porch to the south. */
function realBase(mixed: boolean): Blueprint {
  const pieces = [...house(12, 12, 6, mixed ? WOOD : STONE), ...tower(5, 5, METAL)];
  if (mixed) for (const [i, p] of pieces.entries()) if (p.form === "foundation" || p.form === "pillar") pieces[i] = { ...p, tier: STONE };
  for (let r = 1; pieces.length < BLUEPRINT_PIECES_MOST; r++) for (let i = 0; i < 12 && pieces.length < BLUEPRINT_PIECES_MOST; i++) pieces.push(at("foundation", STONE, grid(i, -r), 0, 0));
  return makeBlueprint("Harbour keep", "Harbour builders", "Six storeys, a tower and a porch.", pieces);
}

/** A row of every piece that covers more than one edge or storey, shut in by walls a wrong anchor would land on. */
function gatehouse(tier: number): BlueprintPiece[] {
  const out: BlueprintPiece[] = [];
  for (let i = -1; i < 7; i++) out.push(at("foundation", tier, grid(i, 0), 0, 0));
  out.push(at("wall", tier, grid(-1, 0), 0, 0), at("double_doorway", tier, grid(0, 0), 0, 0, 1), at("wall", tier, grid(2, 0), 0, 0));
  out.push(at("gateway", tier, grid(3, 0), 0, 0), at("gate", tier, grid(3, 0), 0, 0), at("large_wall", tier, grid(5, 0), 0, 0, 1), at("wall", tier, grid(6, 0), 0, 0));
  out.push(at("wall", tier, grid(0, 0), 4, 0), at("wall", tier, grid(1, 0), 4, 0), at("wall", tier, grid(3, 0), 8, 0), at("wall", tier, grid(4, 0), 8, 0));
  out.push(at("quarter_foundation", tier, [14, 0, 0, 0], 0, 0), at("quarter_foundation", tier, [15, 0, 0, 1], 0, 0), at("roof_hip", tier, grid(0, 0), 8, 0, 3), at("triangle_roof", tier, grid(0, 1), 0, 0, 2));
  out.push(at("sloped_wall_left", tier, grid(1, 1), 0, 0, 1), at("door_open", tier, grid(2, 1), 0, 0, 0, 1), at("ramp", tier, grid(4, 0), 0, 0, 1));
  return out;
}

/** Pieces of every form at random keys within `reach` of the anchor, no two in one column of cells. */
function randomBlueprint(rng: Rng, count: number, reach: number, levels: number): Blueprint {
  const pieces: BlueprintPiece[] = [];
  const taken = new Set<string>();
  while (pieces.length < count) {
    const form = NAMES[pieces.length < NAMES.length ? pieces.length : rng.int(NAMES.length)]!;
    const f = ALL[form]!;
    const m = [0, 1, 2, 3].map(() => rng.int(2 * reach + 1) - reach);
    const dir = rng.int(CLS_DIRS[clsOf(form)]!);
    const columns: string[] = [];
    for (let e = 0; e < wideOf(form); e++) columns.push([f.cls, f.layer, dir, ...m.map((v, a) => v + e * sideOf(form) * DIRS[4 * dir + a]!)].join());
    if (columns.some((c) => taken.has(c))) continue;
    for (const c of columns) taken.add(c);
    pieces.push(at(form, rng.int(8), m, rng.int(2 * levels + 1) - levels, dir, rng.int(f.turns), rng.int(2)));
  }
  return makeBlueprint(`Base ${count} é`, "Ünsal 🦖", "A base of every form.", pieces);
}

const bytesOf = (bp: Blueprint, forms: BlueprintForms = ALL): Uint8Array => {
  const made = encodeBlueprint(bp, forms);
  if (!made.ok) throw new Error(`not written: ${made.fault.reason}`);
  return made.bytes;
};
const textOf = (bp: Blueprint): string => {
  const made = encodeBlueprintText(bp, ALL);
  if (!made.ok) throw new Error(`not written: ${made.fault.reason}`);
  return made.text;
};
const got = (moved: BlueprintMoved): Blueprint => {
  if (!moved.ok) throw new Error(`pieces lost: ${moved.pieces.join()}`);
  return moved.blueprint;
};
const sameAfter = (bp: Blueprint, moves: (b: Blueprint) => Blueprint): void => expect(moves(bp)).toEqual(bp);
const turn = (bp: Blueprint, k: number): Blueprint => got(turnBlueprint(bp, ALL, k));
const mirror = (bp: Blueprint): Blueprint => got(mirrorBlueprint(bp, ALL));
const faultOf = (bytes: Uint8Array, forms: BlueprintForms = ALL): unknown => {
  const read = decodeBlueprint(bytes, forms);
  return read.ok ? null : read.fault;
};
const textFault = (text: string): unknown => {
  const read = decodeBlueprintText(text, ALL);
  return read.ok ? null : read.fault;
};

/** Bytes written by hand as the format says: the head, the table, whatever `body` writes, and the sum. */
function craft(count: number, names: readonly string[], body: (w: BitWriter) => void = () => {}, strings: readonly string[] = ["", "", ""]): Uint8Array {
  const w = new BitWriter(4096);
  for (const c of "SNBP") w.u8(c.charCodeAt(0));
  w.u8(BLUEPRINT_FORMAT);
  for (const s of strings) w.string(s);
  w.varint(count);
  w.varint(names.length);
  for (const name of names) w.string(name);
  body(w);
  w.pos = (w.pos + 7) & ~7;
  w.u32(hashBytes(w.bytes()));
  return w.bytes().slice();
}

/** One piece's bits after its form: a far anchor, a level, a direction, no turn, and its tier. */
function far(w: BitWriter, m: readonly number[], lvl: number, dir: number, tier: number): void {
  w.bits(3, 2);
  for (const v of m) w.sbits(v, 10);
  w.bool(true);
  w.sbits(lvl, 10);
  w.bits(dir, 4);
  w.bool(false);
  w.bool(true);
  w.bits(tier, 3);
}

test("bytes and text give back random blueprints of 1 to 2,000 pieces of every form", () => {
  const rng = new Rng(0xb1e);
  const counts = [1, 2, 7, 64, 500, BLUEPRINT_PIECES_MOST, ...Array.from({ length: 18 }, () => 1 + rng.int(BLUEPRINT_PIECES_MOST))];
  for (const [n, count] of counts.entries()) {
    const bp = randomBlueprint(rng, count, [4, 30, 500][n % 3]!, [3, 40, 230][n % 3]!);
    if (count >= NAMES.length) expect(new Set(bp.pieces.map((p) => p.form)).size).toBe(NAMES.length);
    expect(blueprintFault(bp, ALL)).toBeNull();
    const read = decodeBlueprint(bytesOf(bp), ALL);
    expect(read.ok && read.blueprint).toEqual(bp);
    const text = textOf(bp);
    expect(text.startsWith(BLUEPRINT_PREFIX)).toBe(true);
    expect(/^[A-Za-z0-9_-]+$/.test(text.slice(BLUEPRINT_PREFIX.length))).toBe(true);
    const back = decodeBlueprintText(text, ALL);
    expect(back.ok && back.blueprint).toEqual(bp);
  }
});

test("text is read through the spaces and line ends a message adds", () => {
  const bp = makeBlueprint("Hut", "", "", house(2, 2, 1, WOOD));
  const text = textOf(bp);
  const wrapped = `  ${text.slice(0, 9)}\n${text.slice(9, 40)}\r\n\t${text.slice(40)} \n`;
  const read = decodeBlueprintText(wrapped, ALL);
  expect(read.ok && read.blueprint).toEqual(bp);
});

test("strings are cut to their byte limits on a whole character", () => {
  const bp = makeBlueprint("é".repeat(20), "🦖".repeat(7), "x".repeat(200), [at("wall", WOOD, [0, 0, 0, 0], 0, 0)]);
  expect([bp.name, bp.author, bp.description]).toEqual(["é".repeat(16), "🦖".repeat(6), "x".repeat(120)]);
  const long = { ...bp, name: "n".repeat(40) };
  const read = decodeBlueprint(bytesOf(long), ALL);
  expect(read.ok && read.blueprint.name).toBe("n".repeat(32));
});

test("pieces are kept in order of level, anchor, direction and layer", () => {
  const pieces = [at("wall", WOOD, [0, 0, 0, 2], 0, 0), at("door", WOOD, [0, 0, 0, 0], 0, 0), at("doorframe", WOOD, [0, 0, 0, 0], 0, 0), at("wall", WOOD, [0, 0, 0, 0], 0, 3), at("foundation", WOOD, [-2, 0, 0, 0], 0, 0), at("ceiling", WOOD, [0, 0, 0, 0], -4, 0)];
  expect(makeBlueprint("", "", "", pieces).pieces.map((p) => p.form + keyM0(p.k0) + keyM3(p.k1) + keyDir(p.k1))).toEqual(["ceiling000", "foundation-200", "doorframe000", "door000", "wall003", "wall020"]);
});

test("a hand-written file is read, and written back bit for bit", () => {
  const bytes = craft(
    5,
    ["foundation", "wall", "stairs", "pillar"],
    (w) => {
      // A foundation at the anchor, of the tier before the first.
      w.bits(0, 2);
      w.bits(0, 2);
      w.bool(false);
      w.bits(0, 4);
      w.bool(false);
      w.bool(false);
      // A wall on the same corner, turned, of stone.
      w.bits(1, 2);
      w.bits(0, 2);
      w.bool(false);
      w.bits(3, 4);
      w.bool(true);
      w.bits(1, 2);
      w.bits(0, 1);
      w.bool(true);
      w.bits(STONE, 3);
      // Stairs a whole side on along direction 3, as the step before the first ran, flipped.
      w.bits(2, 2);
      w.bits(1, 2);
      w.bool(false);
      w.bool(false);
      w.bits(0, 4);
      w.bool(true);
      w.bits(2, 2);
      w.bits(1, 1);
      w.bool(false);
      // A wall four levels up, nearby, of any tier, turned as the last wall was.
      w.bits(1, 2);
      w.bits(2, 2);
      for (const d of [-64, 0, 3, 63]) {
        w.bool(d !== 0);
        if (d !== 0) w.sbits(d, 7);
      }
      w.bool(true);
      w.sbits(4, 10);
      w.bits(5, 4);
      w.bool(false);
      w.bool(true);
      w.bits(TIER_ANY, 3);
      // A pillar a whole side on along direction 0.
      w.bits(3, 2);
      w.bits(1, 2);
      w.bool(true);
      w.bits(0, 4);
      w.bool(false);
      w.bits(0, 4);
      w.bool(false);
      w.bool(false);
    },
    ["Hut", "me", "A hut."],
  );
  const want = makeBlueprint("Hut", "me", "A hut.", [at("foundation", THATCH, [0, 0, 0, 0], 0, 0), at("wall", STONE, [0, 0, 0, 0], 0, 3, 1), at("stairs", STONE, [0, 0, 0, 2], 0, 0, 2, 1), at("wall", TIER_ANY, [-64, 0, 3, 65], 4, 5, 1), at("pillar", TIER_ANY, [-62, 0, 3, 65], 4, 0)]);
  const read = decodeBlueprint(bytes, ALL);
  expect(read.ok && read.blueprint).toEqual(want);
  expect(bytesOf(want)).toEqual(bytes);
  // The head, the three strings, the two counts, the four names, pieces of 11, 17, 15, 49 and 16 bits, and the sum.
  expect(bytes.length).toBe(5 + (4 + 3 + 7) + 2 + (11 + 5 + 7 + 7) + Math.ceil((11 + 17 + 15 + 49 + 16) / 8) + 4);
});

test("a real base of 2,000 pieces takes under 2 bytes a piece, and its text under 2.7", () => {
  const bp = realBase(false);
  expect(bp.pieces.length).toBe(BLUEPRINT_PIECES_MOST);
  const check = checkBlueprint(bp, ALL);
  expect([check.clashes, check.overlaps, check.parts.length]).toEqual([[], [], 1]);
  // Measured: 3,876 bytes and 5,173 characters, the head and the ten form names among them.
  expect(bytesOf(bp).length / bp.pieces.length).toBeLessThan(2);
  expect(textOf(bp).length / bp.pieces.length).toBeLessThan(2.7);
  // Turned or mirrored it is at most 4,020, and with foundations and pillars of another tier at most 4,122.
  for (const moved of [...Array.from({ length: 11 }, (_, k) => turn(bp, k + 1)), mirror(bp)]) expect(bytesOf(moved).length / bp.pieces.length).toBeLessThan(2.05);
  for (const moved of [realBase(true), turn(realBase(true), 5)]) expect(bytesOf(moved).length / bp.pieces.length).toBeLessThan(2.1);
});


/** A piece's corners, sorted, and the direction of its own +X where its form can turn. */
function shapeOf(p: BlueprintPiece, change: (m: Int32Array, o: number) => void, own: (d: number) => number, flips: boolean): string {
  const f = ALL[p.form]!;
  keyAnchor(p.k0, p.k1, S, 0);
  const n = elementCorners(clsOf(p.form), S, 0, keyDir(p.k1), S, 4, sideOf(p.form) * wideOf(p.form));
  const corners: string[] = [];
  for (let c = 0; c < n; c++) {
    change(S, 4 + 4 * c);
    corners.push(S.subarray(4 + 4 * c, 8 + 4 * c).join());
  }
  const facing = f.turns === 1 ? 0 : own(dirTurn(keyDir(p.k1), (-keyRot(p.k1) * 12) / f.turns));
  return [p.form, p.tier, keyLvl(p.k1), keyFlip(p.k1) ^ (flips ? 1 : 0), facing, ...corners.sort()].join(" ");
}
const shapes = (bp: Blueprint, change: (m: Int32Array, o: number) => void = () => {}, own: (d: number) => number = (d) => d, flips = false): string[] => bp.pieces.map((p) => shapeOf(p, change, own, flips)).sort();

const BASES: readonly [string, () => Blueprint][] = [
  ["a house of squares", () => makeBlueprint("House", "", "", house(7, 5, 3, WOOD))],
  ["a house and a triangle tower", () => makeBlueprint("Keep", "", "", [...house(6, 7, 2, STONE), ...tower(2, 4, METAL)])],
  ["a gatehouse of wide pieces", () => makeBlueprint("Gate", "", "", gatehouse(METAL))],
  ["random pieces", () => randomBlueprint(new Rng(77), 400, 6, 6)],
];

for (const [name, make] of BASES) {
  test(`turns and mirrors of ${name} close`, () => {
    const bp = make();
    let stepped = bp;
    for (let k = 1; k <= 12; k++) {
      stepped = turn(stepped, 1);
      expect(stepped).toEqual(turn(bp, k));
      sameAfter(bp, (b) => turn(turn(b, k), -k));
      // A mirror undoes a turn: mirrored, turned and mirrored back is turned the other way.
      expect(mirror(turn(mirror(bp), k))).toEqual(turn(bp, -k));
    }
    expect(stepped).toEqual(bp);
    sameAfter(bp, (b) => mirror(mirror(b)));
    expect(mirror(bp)).not.toEqual(bp);
  });

  test(`a turn or mirror of ${name} moves each corner exactly`, () => {
    const bp = make();
    for (let k = 0; k < 12; k++) {
      expect(shapes(turn(bp, k))).toEqual(shapes(bp, (m, o) => tupleTurn(m, o, k, m, o), (d) => dirTurn(d, k)));
      expect(blueprintFault(turn(bp, k), ALL)).toBeNull();
    }
    expect(shapes(mirror(bp))).toEqual(shapes(bp, (m, o) => tupleMirror(m, o, m, o), (d) => dirTurn(6, -d), true));
    expect(blueprintFault(mirror(bp), ALL)).toBeNull();
  });

  test(`a turn or a mirror of ${name} keeps its checks`, () => {
    const bp = make();
    const before = checkBlueprint(bp, ALL);
    const sizes = (parts: readonly (readonly number[])[]): number[] => parts.map((p) => p.length);
    if (!name.startsWith("random")) expect([before.clashes, before.overlaps, before.parts.length]).toEqual([[], [], 1]);
    for (const after of [...Array.from({ length: 11 }, (_, k) => turn(bp, k + 1)), mirror(bp)]) {
      const check = checkBlueprint(after, ALL);
      expect([check.clashes.length, check.overlaps.length, sizes(check.parts), check.counts]).toEqual([before.clashes.length, before.overlaps.length, sizes(before.parts), before.counts]);
    }
  });
}

test("a turned piece is renamed from its canonical corner, with its facing kept", () => {
  const one = (p: BlueprintPiece, k: number): number[] => {
    const q = turn(makeBlueprint("", "", "", [p]), k).pieces[0]!;
    keyAnchor(q.k0, q.k1, S, 0);
    return [...S.subarray(0, 4), keyDir(q.k1), keyRot(q.k1), keyFlip(q.k1)];
  };
  expect(one(at("wall", WOOD, [0, 0, 0, 0], 0, 0), 3)).toEqual([0, 0, 0, 0, 3, 0, 0]);
  // Half a turn names an edge from its other end, and the wall faces the other way.
  expect(one(at("wall", WOOD, [0, 0, 0, 0], 0, 0), 6)).toEqual([-2, 0, 0, 0, 0, 1, 0]);
  expect(one(at("double_doorway", WOOD, [0, 0, 0, 0], 0, 0), 6)).toEqual([-4, 0, 0, 0, 0, 1, 0]);
  expect(one(at("foundation", WOOD, [0, 0, 0, 0], 0, 0), 3)).toEqual([-2, 0, 0, 0, 0, 0, 0]);
  expect(one(at("stairs", WOOD, [0, 0, 0, 0], 0, 0), 3)).toEqual([-2, 0, 0, 0, 0, 3, 0]);
  expect(one(at("quarter_foundation", WOOD, [0, 0, 0, 0], 0, 0), 6)).toEqual([-1, 0, 0, -1, 0, 0, 0]);
  expect(one(at("triangle_roof", WOOD, [0, 0, 0, 0], 0, 0), 4)).toEqual([-2, 0, 0, 0, 0, 2, 0]);
  expect(one(at("pillar", WOOD, [2, 0, 0, 0], 0, 0), 1)).toEqual([0, 2, 0, 0, 0, 0, 0]);
});

test("a mirror flips every piece and faces it the other way across +X", () => {
  const one = (p: BlueprintPiece): number[] => {
    const q = mirror(makeBlueprint("", "", "", [p])).pieces[0]!;
    keyAnchor(q.k0, q.k1, S, 0);
    return [...S.subarray(0, 4), keyDir(q.k1), keyRot(q.k1), keyFlip(q.k1)];
  };
  // A wall along +X stays on its edge and now fronts -Z.
  expect(one(at("wall", WOOD, [0, 0, 0, 0], 0, 0))).toEqual([0, 0, 0, 0, 0, 1, 1]);
  // Stairs that rose toward +Z fill the square across the axis and rise toward -Z.
  expect(one(at("stairs", WOOD, [0, 0, 0, 0], 0, 0))).toEqual([0, 0, 0, -2, 0, 2, 1]);
  // A triangle is named from the corner its canonical direction starts at, and a flipped piece comes back plain.
  expect(one(at("triangle_foundation", WOOD, [0, 0, 0, 0], 0, 0, 0, 1))).toEqual([2, 0, -2, 0, 2, 0, 0]);
});

test("a move or a turn says which pieces leave the key range", () => {
  const bp = makeBlueprint("", "", "", [at("pillar", WOOD, [0, 0, 0, 0], 0, 0), at("pillar", WOOD, [0, 300, 0, 300], 0, 0), at("large_wall", WOOD, [0, 0, 0, 0], 4, 0), at("double_doorway", WOOD, [400, 0, 0, 0], 8, 0)]);
  expect(turnBlueprint(bp, ALL, 1)).toEqual({ ok: false, pieces: [1] });
  expect(moveBlueprint(bp, ALL, [0, 212, 0, 0], 0)).toEqual({ ok: false, pieces: [1] });
  // A doorway of two edges needs its far edge in range, and a wall of four storeys its top one.
  expect(moveBlueprint(bp, ALL, [110, 0, 0, 0], 0)).toEqual({ ok: false, pieces: [3] });
  expect(moveBlueprint(bp, ALL, [109, 0, 0, 0], 0).ok).toBe(true);
  expect(moveBlueprint(bp, ALL, [0, 0, 0, 0], 240)).toEqual({ ok: false, pieces: [2] });
  expect(moveBlueprint(bp, ALL, [0, 0, 0, 0], 239).ok).toBe(true);
  expect(moveBlueprint(bp, ALL, [0, 0, 0, 0], -256)).toEqual({ ok: false, pieces: [0, 1] });
  expect(turnBlueprint({ ...bp, pieces: [...bp.pieces, { ...bp.pieces[0]!, form: "moat" }] }, ALL, 0)).toEqual({ ok: false, pieces: [4] });
  expect(shapes(got(moveBlueprint(bp, ALL, [5, -3, 2, 7], 0)))).toEqual(shapes(bp, (m, o) => m.set([m[o]! + 5, m[o + 1]! - 3, m[o + 2]! + 2, m[o + 3]! + 7], o)));
  expect(got(moveBlueprint(bp, ALL, [0, 0, 0, 0], 9)).pieces.map((p) => keyLvl(p.k1))).toEqual(bp.pieces.map((p) => keyLvl(p.k1) + 9));
  sameAfter(bp, (b) => got(moveBlueprint(got(moveBlueprint(b, ALL, [5, -3, 2, 7], 9)), ALL, [-5, 3, -2, -7], -9)));
});

test("a blueprint is anchored again at a chosen piece", () => {
  const bp = makeBlueprint("House", "a", "b", house(4, 3, 2, WOOD));
  const chosen = bp.pieces.findIndex((p) => p.form === "stairs");
  const moved = got(reanchorBlueprint(bp, ALL, chosen));
  const stairs = moved.pieces.find((p) => p.form === "stairs")!;
  keyAnchor(stairs.k0, stairs.k1, S, 0);
  expect([...S.subarray(0, 4), keyLvl(stairs.k1)]).toEqual([0, 0, 0, 0, 0]);
  expect([moved.name, moved.author, moved.description, moved.pieces.length]).toEqual(["House", "a", "b", bp.pieces.length]);
  // The foundation that was at the anchor is as far the other way, and anchoring there again is the blueprint as it was.
  const was = bp.pieces[chosen]!;
  const first = moved.pieces.findIndex((p) => p.form === "foundation" && keyM0(p.k0) === -keyM0(was.k0) && keyM3(p.k1) === -keyM3(was.k1) && keyLvl(p.k1) === -keyLvl(was.k1));
  expect(got(reanchorBlueprint(moved, ALL, first))).toEqual(bp);
  expect(reanchorBlueprint(bp, ALL, bp.pieces.length)).toEqual({ ok: false, pieces: [bp.pieces.length] });
});

test("rows keyed in a base's frame are captured about a chosen row", () => {
  const home = house(4, 3, 2, WOOD);
  const rows = got(moveBlueprint(makeBlueprint("", "", "", home), ALL, [10, 0, 0, 6], 8)).pieces.toReversed();
  const anchor = rows.findIndex((p) => p.form === "foundation" && keyM0(p.k0) === 10 && keyM3(p.k1) === 6);
  const captured = got(captureBlueprint(rows, anchor, ALL, "House", "me", "Taken from the shore."));
  expect(captured).toEqual(makeBlueprint("House", "me", "Taken from the shore.", home));
  expect(captureBlueprint(rows, -1, ALL)).toEqual({ ok: false, pieces: [-1] });
  const edge = [...rows, at("pillar", WOOD, [-505, 0, 0, 0], 0, 0)];
  expect(captureBlueprint(edge, anchor, ALL)).toEqual({ ok: false, pieces: [rows.length] });
});

test("the checks find cells claimed twice, through a piece's height and its width", () => {
  const pairs = (pieces: BlueprintPiece[]): unknown => checkBlueprint({ name: "", author: "", description: "", pieces }, ALL).clashes;
  const o = [0, 0, 0, 0];
  expect(pairs([at("wall", WOOD, o, 0, 0), at("doorframe", WOOD, o, 0, 0, 1)])).toEqual([[0, 1]]);
  expect(pairs([at("wall", WOOD, o, 0, 0), at("wall", WOOD, o, 3, 0)])).toEqual([[0, 1]]);
  expect(pairs([at("wall", WOOD, o, 0, 0), at("wall", WOOD, o, 4, 0), at("door", WOOD, o, 0, 0), at("fence_foundation", WOOD, o, 0, 0)])).toEqual([]);
  expect(pairs([at("half_wall", WOOD, o, 0, 0), at("half_wall", WOOD, o, 2, 0), at("quarter_wall", WOOD, o, 1, 0)])).toEqual([[0, 2]]);
  expect(pairs([at("large_wall", WOOD, o, 0, 0), at("wall", WOOD, o, 12, 0), at("wall", WOOD, o, 16, 0)])).toEqual([[0, 1]]);
  expect(pairs([at("double_doorway", WOOD, o, 0, 0), at("wall", WOOD, [2, 0, 0, 0], 0, 0), at("wall", WOOD, [4, 0, 0, 0], 0, 0)])).toEqual([[0, 1]]);
  expect(pairs([at("foundation", WOOD, o, 0, 0), at("ceiling", WOOD, o, 0, 0), at("stairs", WOOD, o, 0, 0), at("triangle_foundation", WOOD, o, 0, 0)])).toEqual([[0, 1]]);
  const twice = makeBlueprint("", "", "", [at("wall", WOOD, o, 0, 0), at("wall", WOOD, o, 3, 0)]);
  expect(blueprintFault(twice, ALL)).toEqual({ reason: "duplicate cell", piece: 1, other: 0 });
  expect(encodeBlueprint(twice, ALL)).toEqual({ ok: false, fault: { reason: "duplicate cell", piece: 1, other: 0 } });
});

test("the checks find faces and edges that overlap without sharing a cell", () => {
  const pairs = (pieces: BlueprintPiece[]): unknown => checkBlueprint({ name: "", author: "", description: "", pieces }, ALL).overlaps;
  const o = [0, 0, 0, 0];
  expect(pairs([at("foundation", WOOD, o, 0, 0), at("foundation", WOOD, [2, 0, 0, 0], 0, 0), at("triangle_foundation", WOOD, o, 0, 6), at("triangle_foundation", WOOD, o, 0, 8)])).toEqual([]);
  expect(pairs([at("foundation", WOOD, o, 0, 0), at("foundation", WOOD, o, 0, 1), at("foundation", WOOD, o, 0, 6)])).toEqual([[0, 1]]);
  expect(pairs([at("foundation", WOOD, o, 0, 0), at("triangle_foundation", WOOD, o, 0, 1), at("quarter_foundation", WOOD, [1, 0, 0, 1], 0, 0)])).toEqual([[0, 1], [0, 2], [1, 2]]);
  // Another layer, or another level, is another place.
  expect(pairs([at("foundation", WOOD, o, 0, 0), at("ramp", WOOD, o, 0, 1), at("ceiling", WOOD, o, 1, 1), at("trapdoor", WOOD, o, 0, 2)])).toEqual([]);
  expect(pairs([at("wall", WOOD, o, 0, 0), at("wall", WOOD, [1, 0, 0, 0], 2, 0), at("wall", WOOD, [2, 0, 0, 0], 0, 0), at("wall", WOOD, [1, 0, 0, 0], 0, 3)])).toEqual([[0, 1], [1, 2]]);
  expect(pairs([at("double_doorway", WOOD, o, 0, 0), at("wall", WOOD, [3, 0, 0, 0], 0, 0), at("wall", WOOD, [3, 0, 0, 0], 4, 0)])).toEqual([[0, 1]]);
});

test("the checks name the parts of a blueprint that does not hold together", () => {
  const parts = (pieces: BlueprintPiece[]): unknown => checkBlueprint({ name: "", author: "", description: "", pieces }, ALL).parts;
  const o = [0, 0, 0, 0];
  expect(parts([])).toEqual([]);
  expect(parts([at("foundation", WOOD, o, 0, 0), at("wall", WOOD, o, 0, 0), at("ceiling", WOOD, o, 4, 0), at("pillar", WOOD, [1, 0, 0, 1], 0, 0)])).toEqual([[0, 1, 2, 3]]);
  // A ceiling over a half wall hangs free, and a foundation a square away touches nothing.
  expect(parts([at("foundation", WOOD, o, 0, 0), at("half_wall", WOOD, o, 0, 0), at("ceiling", WOOD, o, 4, 0), at("foundation", WOOD, [6, 0, 0, 0], 0, 0), at("wall", WOOD, [8, 0, 0, 0], 0, 3)])).toEqual([[0, 1], [3, 4], [2]]);
  expect(parts([at("foundation", WOOD, o, 0, 0), at("triangle_foundation", WOOD, [2, 0, 0, 0], 0, 11), at("quarter_foundation", WOOD, [-1, 0, 0, 1], 0, 0), at("double_doorway", WOOD, [-4, 0, 0, 2], 0, 0)])).toEqual([[0, 1, 2, 3]]);
  const two = makeBlueprint("", "", "", [...house(2, 2, 1, WOOD), ...got(moveBlueprint(makeBlueprint("", "", "", house(1, 1, 1, WOOD)), ALL, [8, 0, 0, 0], 0)).pieces]);
  expect(checkBlueprint(two, ALL).parts.map((p) => p.length)).toEqual([house(2, 2, 1, WOOD).length, house(1, 1, 1, WOOD).length]);
});

test("the checks count pieces by form and tier", () => {
  const o = [0, 0, 0, 0];
  const bp = makeBlueprint("", "", "", [at("wall", WOOD, o, 0, 0), at("wall", STONE, o, 4, 0), at("wall", WOOD, o, 8, 0), at("foundation", TIER_ANY, o, 0, 0), at("door", THATCH, o, 0, 0)]);
  expect(checkBlueprint(bp, ALL).counts).toEqual([
    { form: "door", tier: THATCH, count: 1 },
    { form: "foundation", tier: TIER_ANY, count: 1 },
    { form: "wall", tier: WOOD, count: 2 },
    { form: "wall", tier: STONE, count: 1 },
  ]);
});

test("an unknown form is refused by its name", () => {
  const forms: BlueprintForms = { ...ALL, moat: ALL.wall! };
  const bp = makeBlueprint("", "", "", [at("foundation", WOOD, [0, 0, 0, 0], 0, 0), { ...at("wall", WOOD, [0, 0, 0, 0], 0, 0), form: "moat" }]);
  const read = decodeBlueprint(bytesOf(bp, forms), forms);
  expect(read.ok && read.blueprint).toEqual(bp);
  expect(faultOf(bytesOf(bp, forms))).toEqual({ reason: "unknown form", name: "moat" });
  expect(encodeBlueprint(bp, ALL)).toEqual({ ok: false, fault: { reason: "unknown form", name: "moat" } });
  // A name every object has is still no form.
  for (const name of ["constructor", "__proto__", "toString", ""]) expect(faultOf(craft(1, [name], (w) => far(w, [0, 0, 0, 0], 0, 0, WOOD)))).toEqual({ reason: "unknown form", name });
});

test("each kind of bad bytes is refused with its reason", () => {
  const bp = makeBlueprint("House", "me", "", house(2, 2, 1, WOOD));
  const good = bytesOf(bp);
  const changed = (at: number, to: number): Uint8Array => {
    const out = good.slice();
    out[at] = to;
    return out;
  };
  expect(faultOf(good)).toBeNull();
  expect(faultOf(changed(0, 0x73))).toEqual({ reason: "bad magic" });
  expect(faultOf(new Uint8Array([0x53, 0x4e, 0x42, 0x51, 1]))).toEqual({ reason: "bad magic" });
  expect(faultOf(changed(4, 2))).toEqual({ reason: "unknown format", format: 2 });
  expect(faultOf(changed(good.length - 9, good[good.length - 9]! ^ 16))).toEqual({ reason: "bad checksum" });
  expect(faultOf(changed(good.length - 1, good[good.length - 1]! ^ 128))).toEqual({ reason: "bad checksum" });
  expect(faultOf(changed(6, good[6]! ^ 1))).toEqual({ reason: "bad checksum" });
  expect(faultOf(Uint8Array.of(...good, 0))).toEqual({ reason: "trailing bytes" });
  for (let n = 0; n < good.length; n++) expect(faultOf(good.subarray(0, n))).toEqual({ reason: "truncated" });

  expect(faultOf(craft(BLUEPRINT_PIECES_MOST + 1, []))).toEqual({ reason: "too many pieces", count: BLUEPRINT_PIECES_MOST + 1 });
  expect(faultOf(craft(0, []))).toBeNull();
  expect(faultOf(craft(0, [], undefined, ["n".repeat(33), "", ""]))).toEqual({ reason: "string too long" });
  expect(faultOf(craft(0, [], undefined, ["", "a".repeat(25), ""]))).toEqual({ reason: "string too long" });
  expect(faultOf(craft(0, [], undefined, ["", "", "d".repeat(121)]))).toEqual({ reason: "string too long" });
  expect(faultOf(craft(0, [], undefined, ["n".repeat(32), "a".repeat(24), "d".repeat(120)]))).toBeNull();
  expect(faultOf(craft(1, ["w".repeat(33)], (w) => far(w, [0, 0, 0, 0], 0, 0, WOOD)))).toEqual({ reason: "string too long" });
  expect(faultOf(craft(1, ["wall", "door"], (w) => far(w, [0, 0, 0, 0], 0, 0, WOOD)))).toEqual({ reason: "bad form table" });
  // Three names take two bits, and the fourth place is no name.
  const fourth = (w: BitWriter): void => {
    for (const form of [0, 1, 3]) {
      w.bits(form, 2);
      far(w, [0, 0, 0, 2 * form], 0, 0, WOOD);
    }
  };
  expect(faultOf(craft(3, ["wall", "door", "foundation"], fourth))).toEqual({ reason: "bad form table" });

  const one = (m: readonly number[], lvl: number, dir: number, form = "wall"): unknown => faultOf(craft(1, [form], (w) => far(w, m, lvl, dir, WOOD)));
  expect(one([511, -511, 0, 0], 255, 5)).toBeNull();
  expect(one([-512, 0, 0, 0], 0, 0)).toEqual({ reason: "key out of range", piece: 0 });
  expect(one([0, 0, 0, 0], 256, 0)).toEqual({ reason: "key out of range", piece: 0 });
  expect(one([0, 0, 0, 0], -256, 0)).toEqual({ reason: "key out of range", piece: 0 });
  // A wall's edge has six directions, a double doorway a second edge and a large wall three more storeys.
  expect(one([0, 0, 0, 0], 0, 6)).toEqual({ reason: "key out of range", piece: 0 });
  expect(one([510, 0, 0, 0], 0, 0, "double_doorway")).toEqual({ reason: "key out of range", piece: 0 });
  expect(one([0, 0, 0, 0], 244, 0, "large_wall")).toEqual({ reason: "key out of range", piece: 0 });
  expect(one([0, 0, 0, 0], 243, 0, "large_wall")).toBeNull();
  const body = (second: (w: BitWriter) => void) => (w: BitWriter) => {
    far(w, [0, 0, 0, 0], 0, 0, WOOD);
    second(w);
  };
  // A step along a thirteenth direction, and a turn a foundation does not have.
  expect(faultOf(craft(2, ["wall"], body((w) => [w.bits(1, 2), w.bool(true), w.bits(12, 4), w.bits(0, 7)])))).toEqual({ reason: "key out of range", piece: 1 });
  expect(faultOf(craft(2, ["wall"], body((w) => [w.bits(1, 2), w.bool(true), w.bits(11, 4), w.bits(0, 7)])))).toBeNull();
  expect(faultOf(craft(1, ["foundation"], (w) => [w.bits(0, 3), w.bits(0, 4), w.bool(true), w.bits(1, 2), w.bits(0, 2)]))).toEqual({ reason: "key out of range", piece: 0 });
  expect(faultOf(craft(2, ["wall"], body((w) => w.bits(0, 9))))).toEqual({ reason: "duplicate cell", piece: 1, other: 0 });
  expect(faultOf(craft(2, ["wall"], body((w) => [w.bits(0, 2), w.bool(true), w.sbits(3, 10), w.bits(0, 6)])))).toEqual({ reason: "duplicate cell", piece: 1, other: 0 });
  expect(faultOf(craft(2, ["wall"], body((w) => [w.bits(0, 2), w.bool(true), w.sbits(4, 10), w.bits(0, 6)])))).toBeNull();
});

test("a blueprint that would not be read back is not written", () => {
  const wall = at("wall", WOOD, [0, 0, 0, 0], 0, 0);
  const many = { name: "", author: "", description: "", pieces: Array.from({ length: BLUEPRINT_PIECES_MOST + 1 }, (_, i) => at("pillar", WOOD, [i % 100, 0, 0, Math.floor(i / 100)], 0, 0)) };
  expect(encodeBlueprint(many, ALL)).toEqual({ ok: false, fault: { reason: "too many pieces", count: BLUEPRINT_PIECES_MOST + 1 } });
  expect(encodeBlueprintText(many, ALL).ok).toBe(false);
  expect(encodeBlueprint({ ...many, pieces: many.pieces.slice(1) }, ALL).ok).toBe(true);
  const bad = (p: BlueprintPiece): unknown => blueprintFault({ name: "", author: "", description: "", pieces: [wall, p] }, ALL);
  for (const tier of [-1, 8, 1.5, NaN]) expect(bad({ ...wall, tier, k1: key1(0, 4, 0, 2, 0, 0) })).toEqual({ reason: "bad tier", piece: 1 });
  // A wall's key with a square's class, a slab's layer, a third turn, a seventh direction, a spare bit or a fraction.
  const k1 = key1(0, 4, 0, 2, 0, 0);
  for (const [k0, k] of [[key0(2, 0, 0, 0), k1], [wall.k0, key1(0, 4, 0, 0, 0, 0)], [wall.k0, key1(0, 4, 0, 2, 2, 0)], [wall.k0, key1(0, 4, 6, 2, 0, 0)], [wall.k0, k1 + 2 ** 29], [wall.k0 + 0.5, k1], [-1, k1], [wall.k0, NaN]]) {
    expect(bad({ form: "wall", tier: WOOD, k0: k0!, k1: k! })).toEqual({ reason: "key out of range", piece: 1 });
  }
  expect(bad({ form: "wall", tier: WOOD, k0: wall.k0, k1 })).toBeNull();
});

test("each kind of bad text is refused with its reason", () => {
  const text = textOf(makeBlueprint("House", "me", "", house(2, 2, 1, WOOD)));
  const body = text.slice(BLUEPRINT_PREFIX.length);
  expect(textFault(text)).toBeNull();
  expect(textFault(body)).toEqual({ reason: "bad text" });
  expect(textFault(`SNBP:${body}`)).toEqual({ reason: "bad text" });
  expect(textFault("")).toEqual({ reason: "bad text" });
  expect(textFault(`${text}=`)).toEqual({ reason: "bad text" });
  expect(textFault(`${text.slice(0, 30)}+${text.slice(31)}`)).toEqual({ reason: "bad text" });
  expect(textFault(`${text.slice(0, 30)}é${text.slice(31)}`)).toEqual({ reason: "bad text" });
  expect(textFault(BLUEPRINT_PREFIX)).toEqual({ reason: "truncated" });
  expect(textFault(`${BLUEPRINT_PREFIX}U05CUAE`)).toEqual({ reason: "truncated" });
  // Five digits hold three bytes and six spare bits: a digit alone holds no byte, and spare bits are zero.
  expect(textFault(`${BLUEPRINT_PREFIX}U05CU`)).toEqual({ reason: "bad text" });
  expect(textFault(`${BLUEPRINT_PREFIX}U05CUAF`)).toEqual({ reason: "bad text" });
  expect(textFault(`${BLUEPRINT_PREFIX}AAAAAAAA`)).toEqual({ reason: "bad magic" });
  expect(textFault(text.slice(0, BLUEPRINT_PREFIX.length + 4 * Math.floor((body.length - 4) / 4)))).toEqual({ reason: "truncated" });
  expect(textFault(`${text.slice(0, -1)}${text.endsWith("A") ? "B" : "A"}`)).not.toBeNull();
  expect(textFault(`${text}${"A".repeat(400_000)}`)).toEqual({ reason: "too long" });
});

test("10,000 random byte strings and texts are refused and none throws", () => {
  const rng = new Rng(0x5eed);
  const head = bytesOf(makeBlueprint("", "", "", [])).subarray(0, 8);
  const digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_ =+é\n";
  for (let n = 0; n < 10_000; n++) {
    const bytes = new Uint8Array(rng.int(200));
    for (let i = 0; i < bytes.length; i++) bytes[i] = rng.u32();
    // Half start as a blueprint does, some with a count and a table that read on into the noise.
    if (n % 2 === 1) bytes.set(head.subarray(0, Math.min(bytes.length, 5 + rng.int(4))));
    if (n % 8 === 7 && bytes.length > 16) bytes.set([1 + rng.int(60), 1, 4, 0x77, 0x61, 0x6c, 0x6c], 8);
    expect(decodeBlueprint(bytes, ALL).ok).toBe(false);
    let text = n % 3 === 0 ? "" : BLUEPRINT_PREFIX;
    for (let i = rng.int(120); i > 0; i--) text += n % 5 === 0 ? String.fromCharCode(rng.int(0x10000)) : digits[rng.int(digits.length)];
    expect(decodeBlueprintText(text, ALL).ok).toBe(false);
  }
});

test("10,000 single-bit changes to a blueprint's bytes are all refused", () => {
  const rng = new Rng(0xf11b);
  const bp = randomBlueprint(rng, 700, 12, 8);
  const good = bytesOf(bp);
  expect(good.length * 8).toBeGreaterThan(10_000);
  const reasons = new Set<string>();
  const bytes = good.slice();
  for (let n = 0; n < 10_000; n++) {
    // The first 2,000 walk the head and the table, and the rest fall anywhere.
    const bit = n < 2_000 ? n : rng.int(good.length * 8);
    bytes[bit >> 3]! ^= 1 << (bit & 7);
    const read = decodeBlueprint(bytes, ALL);
    expect(read.ok).toBe(false);
    if (!read.ok) reasons.add(read.fault.reason);
    bytes[bit >> 3]! ^= 1 << (bit & 7);
  }
  expect(reasons.has("bad checksum")).toBe(true);
  const read = decodeBlueprint(bytes, ALL);
  expect(read.ok && read.blueprint).toEqual(bp);
});

test("10,000 single-character changes to a blueprint's text are all refused", () => {
  const rng = new Rng(0x7e47);
  const text = textOf(randomBlueprint(rng, 300, 12, 8));
  const digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  for (let n = 0; n < 10_000; n++) {
    const i = rng.int(text.length);
    let c = digits[rng.int(64)]!;
    while (c === text[i]) c = digits[rng.int(64)]!;
    expect(decodeBlueprintText(text.slice(0, i) + c + text.slice(i + 1), ALL).ok).toBe(false);
  }
});
