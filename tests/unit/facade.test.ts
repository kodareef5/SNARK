import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { FACADE_AT, RUIN_FACADES, RUIN_FINISHES } from "../../content/ruins.ts";
import { ELEMENTS, FACADE_COLOURS, FACADE_GLSL, FACADE_TIERS, FACADE_TOP, KIND, KINDS, PLACED, ROOM_MEANS, facadeDress, facadeKind, facadeOut, facadeRoomBox, facadeSeed, facadeSurface, facadeVertex, type FacadeSample } from "../../client/core/render/facade.ts";
import { FLAT_MESH_VERTEX } from "../../client/core/render/glsl.ts";
import { TIERS } from "../../client/core/assets/tiers.ts";

test("each element's variants lie in the atlas, 16 pixels apart", () => {
  expect(PLACED.length).toBe(ELEMENTS.reduce((n, e) => n + e[3], 0));
  for (const p of PLACED) {
    expect(p.x).toBeGreaterThanOrEqual(16);
    expect(p.y).toBeGreaterThanOrEqual(16);
    expect(p.x + p.w).toBeLessThanOrEqual(FACADE_TOP - 16);
    expect(p.y + p.h).toBeLessThanOrEqual(FACADE_TOP - 16);
  }
  for (const a of PLACED) for (const b of PLACED) {
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
  const jambs = Object.entries(RUIN_FACADES).flatMap(([name, s]) => s.look!.boxes!.filter((b) => b.color === undefined).flatMap((b) => faces(b.half).filter(([w, h, up]) => facadeKind(0, w, h, up) === KIND.jamb).map(() => name)));
  expect([...new Set(jambs)]).toEqual(["zstore"]);
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
