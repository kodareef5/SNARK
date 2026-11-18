import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { FACADE_AT, RUIN_FACADES, RUIN_FINISHES } from "../../content/ruins.ts";
import { ELEMENTS, FACADE_COLOURS, FACADE_GLSL, FACADE_TIERS, FACADE_TOP, KIND, KINDS, MARKS, MARKS_PLACED, NO_FLOOD, PLACED, ROOM_MEANS, facadeDress, facadeKind, facadeMarks, facadeOut, facadeRoomBox, facadeSeed, facadeSurface, facadeVertex, type FacadeSample } from "../../client/core/render/facade.ts";
import { FLAT_MESH_VERTEX } from "../../client/core/render/glsl.ts";
import { TIERS } from "../../client/core/assets/tiers.ts";

test("each element's and each mark's variants lie in their atlas, 16 pixels apart", () => {
  expect(PLACED.length).toBe(ELEMENTS.reduce((n, e) => n + e[3], 0));
  expect(MARKS_PLACED.length).toBe(MARKS.reduce((n, e) => n + e[3], 0));
  for (const atlas of [PLACED, MARKS_PLACED]) for (const p of atlas) {
    expect(p.x).toBeGreaterThanOrEqual(16);
    expect(p.y).toBeGreaterThanOrEqual(16);
    expect(p.x + p.w).toBeLessThanOrEqual(FACADE_TOP - 16);
    expect(p.y + p.h).toBeLessThanOrEqual(FACADE_TOP - 16);
  }
  for (const atlas of [PLACED, MARKS_PLACED]) for (const a of atlas) for (const b of atlas) {
    if (a === b) continue;
    const apart = a.x + a.w + 16 <= b.x || b.x + b.w + 16 <= a.x || a.y + a.h + 16 <= b.y || b.y + b.h + 16 <= a.y;
    expect(apart).toBe(true);
  }
});

/** Every face of a box of half extents `half`: its width, its height and how far its normal looks up. */
const faces = (half: readonly number[]): [number, number, number][] => [[half[0]! * 2, half[1]! * 2, 0], [half[2]! * 2, half[1]! * 2, 0], [half[0]! * 2, half[2]! * 2, 1]];

test("a facade module's parts are known by their colour and the size of their faces, and nothing else in the core is", () => {
  const found = new Map<number, number>();
  for (const [name, shape] of Object.entries(RUIN_FACADES)) {
    for (const b of shape.look!.boxes!) {
      const colour = b.color === undefined ? undefined : FACADE_COLOURS[b.color];
      const kind = colour === undefined ? 0 : facadeKind(colour, b.half[0] * 2, b.half[1] * 2, 0);
      if (kind) found.set(kind, (found.get(kind) ?? 0) + 1);
      // A part is known by its face to the street alone.
      for (const [w, h, up] of faces(b.half).slice(1)) if (colour !== undefined) expect(`${name} ${facadeKind(colour, w, h, up)}`).toBe(`${name} 0`);
    }
  }
  for (const k of [KIND.window, KIND.slider, KIND.casement, KIND.strip, KIND.display, KIND.curtain, KIND.shutter, KIND.sign, KIND.bar]) expect(found.get(k) ?? 0).toBeGreaterThan(0);
  // Elsewhere in the core no face in a part's colour, nor a box in a finish's colour, is a part's size, and only the shop's door jamb is a jamb's.
  const finishes = [...new Set(Object.values(RUIN_FINISHES).map((f) => f.color))];
  const stray: string[] = [];
  for (const d of CORE_CONTENT) {
    if (d.type === "shape" && !(d.id.split("_")[1]! in RUIN_FACADES)) {
      for (const b of [...d.boxes, ...(d.look?.boxes ?? [])]) for (const c of b.color === undefined ? finishes : [b.color]) for (const [w, h, up] of faces(b.half)) if (facadeKind(FACADE_COLOURS[c] ?? 0, w, h, up)) stray.push(`${d.id} ${w}x${h}`);
    } else if (d.type === "structure" && d.mesh === "box") {
      for (const [w, h, up] of faces(d.half)) if (facadeKind(FACADE_COLOURS[d.color ?? 0] ?? 0, w, h, up)) stray.push(`${d.id} ${w}x${h}`);
    }
  }
  expect(stray).toEqual([]);
  const reveal = (kind: number): string[] => [...new Set(Object.entries(RUIN_FACADES).flatMap(([name, s]) => s.look!.boxes!.filter((b) => b.color === undefined).flatMap((b) => faces(b.half).filter(([w, h, up]) => facadeKind(0, w, h, up) === kind).map(() => name))))];
  expect(reveal(KIND.jamb)).toEqual(["zstore"]);
  expect(reveal(KIND.pier)).toEqual(["zdeck", "zdecktop", "zgate"]);
});

test("no room is shown where a player may pass: every glazed part stands before a wall its module is walked as", () => {
  for (const [name, shape] of Object.entries(RUIN_FACADES)) {
    for (const b of shape.look!.boxes!) {
      const colour = b.color === undefined ? undefined : FACADE_COLOURS[b.color];
      const kind = colour === undefined ? 0 : facadeKind(colour, b.half[0] * 2, b.half[1] * 2, 0);
      if (!KINDS[kind]!.room) continue;
      // The glass's face, a little inside each edge, is within a walked box from the face back.
      const held = shape.boxes.some((w) => [0, 1].every((a) => w.at[a]! - w.half[a]! <= b.at[a]! - b.half[a]! + 0.01 && w.at[a]! + w.half[a]! >= b.at[a]! + b.half[a]! - 0.01) && w.at[2] - w.half[2] <= b.at[2] + b.half[2] && w.at[2] + w.half[2] >= b.at[2] - b.half[2]);
      expect(`${name} ${held}`).toBe(`${name} true`);
    }
  }
});

test("a balcony's door and window look into one room, which seeds them alike", () => {
  const boxes = RUIN_FACADES.zbalc.look!.boxes!, at = FACADE_AT.zbalc;
  const seeds = boxes.filter((b) => b.color === 83).map((b) => {
    const kind = facadeKind(1, b.half[0] * 2, b.half[1] * 2, 0);
    const [x0, x1, y0, y1] = facadeRoomBox(kind, 0.5, b.half[0] * 2, b.half[1] * 2);
    const corner = [b.at[0] - b.half[0], b.at[1] - b.half[1]];
    return { left: corner[0]! + at[0]! < 0, seed: facadeSeed(1000, 2000, corner[0]! + (x0 + x1) / 2, corner[1]! + (y0 + y1) / 2, 0.3) };
  });
  expect(seeds.length).toBe(4);
  for (const side of [true, false]) {
    const two = seeds.filter((s) => s.left === side);
    expect(two[0]!.seed).toBe(two[1]!.seed);
  }
  expect(seeds.find((s) => s.left)!.seed).not.toBe(seeds.find((s) => !s.left)!.seed);
});

/** A sampler whose rooms say in their channels which face is read (back red, side green, floor blue, ceiling red and green) and whose elements are all clean glass. */
const faceOf: FacadeSample = (texture, u, v, _lod, out) => {
  if (texture === 3) out.set([[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0]][(u % 0.25 >= 0.125 ? 1 : 0) + (v % 0.25 >= 0.125 ? 2 : 0)]!);
  else if (texture === 0) out.set([0.5, 0.5, 0.5, 0]);
  else if (texture === 1) out.fill(128 / 255);
  else out.set([1, 0.04, 0, 1]);
};
const FACE_COLOURS = ["1,0,0", "0,1,0", "0,0,1", "1,1,0"];

/** The face of a window's room a ray from `eye` through (x, y) on the glass meets, by a ray against the room's box: 0 back, 1 side, 2 floor, 3 ceiling. */
function faceMet(eye: readonly number[], x: number, y: number): number {
  const [x0, x1, y0, y1] = facadeRoomBox(KIND.window, x, 1.4, 2), depth = KINDS[KIND.window]!.room!.depth;
  const d = [x - eye[0]!, y - eye[1]!, -eye[2]!];
  const tx = d[0]! > 0 ? (x1 - x) / d[0]! : d[0]! < 0 ? (x0 - x) / d[0]! : Infinity;
  const ty = d[1]! > 0 ? (y1 - y) / d[1]! : d[1]! < 0 ? (y0 - y) / d[1]! : Infinity;
  const tz = depth / -d[2]!;
  return tz <= Math.min(tx, ty) ? 0 : tx <= ty ? 1 : d[1]! < 0 ? 2 : 3;
}

test("glass shows the face of its room the eye's ray meets, so the room's perspective moves as the eye does; medium shows a dark recess", () => {
  const [x0, x1, y0, y1] = facadeRoomBox(KIND.window, 0.7, 1.4, 2);
  let place = 0;
  while (facadeDress(KIND.window, facadeSeed(place, 0, (x0 + x1) / 2, (y0 + y1) / 2, 0)) !== "clear") place += 4;
  // The window's foot is at height 0, so its middle's height is the room's middle up the face.
  const o = facadeOut();
  const met = new Set<number>();
  for (const eye of [[0.7, 1, 3], [-6, 1, 0.6], [8, 1.4, 0.7], [0.7, 6, 0.7], [0.7, -4, 0.7], [2, 2.5, 4]]) {
    const d = [0.7 - eye[0]!, 1 - eye[1]!, -eye[2]!].map((q) => -q), l = Math.hypot(...d);
    facadeSurface(o, KIND.window, 0.7, 1, 1.4, 2, [0, 0, 1], d.map((q) => q / l), [0, 0, 0], [1, 0, 0], place, 0, 1, 5, 0.0005, l, FACADE_TIERS.high!, faceOf);
    const face = faceMet(eye, 0.7, 1);
    met.add(face);
    expect([...o.room].map((c) => (c > 0.01 ? 1 : 0)).join(",")).toBe(FACE_COLOURS[face]!);
    expect(o.sharp).toBe(true);
  }
  expect(met.size).toBe(4);
  facadeSurface(o, KIND.window, 0.7, 1, 1.4, 2, [0, 0, 1], [0, 0, 1], [0, 0, 0], [1, 0, 0], place, 0, 1, 5, 0.002, 3, FACADE_TIERS.medium!, faceOf);
  expect([...o.room]).toEqual([0, 0, 0]);
  expect(o.sharp).toBe(false);
  expect(o.albedo[0]).toBeCloseTo(0.02, 6);
});

test("far off an element is its mean and its room its room's mean", () => {
  const o = facadeOut();
  facadeSurface(o, KIND.window, 0.7, 1, 1.4, 2, [0, 0, 1], [0, 0, 1], [0, 0, 0], [1, 0, 0], 0, 0, 1, 5, 50, 4000, FACADE_TIERS.high!, () => {
    throw new Error("nothing is read so far off");
  });
  expect(o.albedo.every((c) => Number.isFinite(c))).toBe(true);
  expect(Math.max(...o.room)).toBeLessThanOrEqual(Math.max(...ROOM_MEANS));
});

test("every lit tier draws facades, low poly none, and the text holds every element and kind", () => {
  for (const t of TIERS) expect(FACADE_TIERS[t.name] === null).toBe(!t.lit);
  expect(FACADE_GLSL).toContain(`const vec4 FP[${PLACED.length}]`);
  expect(FACADE_GLSL).toContain(`const vec4 KS[${KINDS.length}]`);
  const text = facadeVertex(FLAT_MESH_VERTEX);
  expect(text).toContain("flat out int vFacade;");
  expect(text).toContain("vFacade = FACADE_CLASS[int(i)];");
  expect(() => facadeVertex("void main() {}")).toThrow();
});

const plain: FacadeSample = (_texture, _u, _v, _lod, out) => out.fill(0);
/** A plain wall's pixel after its marks: the albedo of a wall of 0.5 grey, at (x, y) on a face w by h with outer edges `edges`. */
function marked(x: number, y: number, w: number, h: number, edges: number, place: number, flood = NO_FLOOD, height = y): number {
  const o = facadeOut();
  o.albedo.fill(0.5);
  o.orm.set([1, 0.8, 0]);
  o.normal.set([0, 0, 1]);
  facadeMarks(o, KIND.none, x, y, w, h, edges, [0, 0, 1], [0, 0, 0], [1, 0, 0], place, 0, height, y, flood, 0.001, FACADE_TIERS.high!, plain);
  return o.albedo[0]!;
}

test("cracks start only at a face's corners on an outer edge, and only some of them", () => {
  let cracked = 0;
  for (let place = 0; place < 400; place += 4) {
    // Along the corner's bisector, inside the face, where a crack from the corner runs near.
    let here = false;
    for (let s = 0.01; s < 0.3 && !here; s += 0.002) for (const [x, y] of [[s, s], [1 - s, s], [s, 1 - s], [1 - s, 1 - s]]) {
      expect(marked(x!, y!, 1, 1, 0, place)).toBe(0.5);
      if (marked(x!, y!, 1, 1, 15, place) < 0.5) here = true;
    }
    if (here) cracked++;
  }
  expect(cracked).toBeGreaterThan(20);
  expect(cracked).toBeLessThan(100);
});

test("the flood's line lies at one height across every face, with silt below it and nothing above", () => {
  for (const place of [0, 36, 1000]) {
    const at = (dh: number): number => marked(0.5, 1, 1, 1, 0, place, 2.4, 2.4 + dh);
    expect(at(0)).toBeLessThan(0.3);
    expect(at(-0.3)).toBeLessThan(0.5);
    expect(at(-0.3)).toBeGreaterThan(at(0));
    expect(at(0.05)).toBe(0.5);
  }
});
