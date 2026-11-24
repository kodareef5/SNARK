// Where the forms past the first nine meet each other, measured on the wood recipe's own meshes: roof faces along the
// sides they share, a gable under a roof's sloped side, a triangle of floor beside a square, a hatch's leaf in its frame.
// Each piece is set down by its collider's origin and a turn, as a base's lattice would set it.

import { expect, test } from "bun:test";
import { FORMS, PLANNED_FORMS } from "../../content/building/forms.ts";
import type { FormDef } from "../../shared/world/lattice/forms.ts";
import { TEXTURED, levelsOf } from "../../tools/pack/pieces/lod.ts";
import { WOOD } from "../../tools/pack/pieces/wood.ts";

const ALL: Record<string, FormDef> = { ...FORMS, ...PLANNED_FORMS };
type Tri = readonly [number, number, number, number, number, number, number, number, number];
/** A piece where it stands: its form, its collider's origin on the plan, the height of its slot's level, and degrees it is turned from +X toward +Z. */
interface Set {
  form: string;
  x: number;
  z: number;
  turn: number;
  level?: number;
}

const cache = new Map<string, Tri[]>();
/** A piece's triangles in the world at `level`: x, y up, z. */
function standing(s: Set, level: number): Tri[] {
  const key = `${s.form},${s.x},${s.z},${s.turn},${s.level ?? 0},${level}`;
  let out = cache.get(key);
  if (out) return out;
  const form = ALL[s.form]!;
  const shapes = levelsOf(WOOD, s.form, form);
  const [c, sn] = [Math.cos((s.turn * Math.PI) / 180), Math.sin((s.turn * Math.PI) / 180)];
  // The recipe's frame has z up and its front at -y.
  const at = (p: readonly number[]): number[] => [s.x + c * p[0]! + sn * p[1]!, (s.level ?? 0) + form.at[1] + p[2]!, s.z + sn * p[0]! - c * p[1]!];
  const corners = shapes[Math.min(level, shapes.length - 1)]!.corners();
  out = [];
  for (let t = 0; t < corners.length; t += 3) out.push([...at(corners[t]!), ...at(corners[t + 1]!), ...at(corners[t + 2]!)] as unknown as Tri);
  cache.set(key, out);
  return out;
}

/** The highest and lowest a piece's surface stands over the plan point (x, z), or null where it does not. */
function over(tris: readonly Tri[], x: number, z: number): [low: number, high: number] | null {
  let [low, high] = [Infinity, -Infinity];
  for (const t of tris) {
    const d = (t[5] - t[8]) * (t[0] - t[6]) + (t[6] - t[3]) * (t[2] - t[8]);
    if (Math.abs(d) < 1e-12) continue;
    const a = ((t[5] - t[8]) * (x - t[6]) + (t[6] - t[3]) * (z - t[8])) / d;
    const b = ((t[8] - t[2]) * (x - t[6]) + (t[0] - t[6]) * (z - t[8])) / d;
    if (a < -1e-9 || b < -1e-9 || a + b > 1 + 1e-9) continue;
    const y = a * t[1] + b * t[4] + (1 - a - b) * t[7];
    low = Math.min(low, y);
    high = Math.max(high, y);
  }
  return high === -Infinity ? null : [low, high];
}

/**
 * How far apart two pieces' top surfaces stand along the side they share, from (x0, z0) to (x1, z1): at places 2.5 cm
 * apart along it, each piece's own top half a millimetre in from the side. The most, in metres. The last 10 cm at each
 * end are left out: a hip's roll ends in a point on its high corner, where a slope beside it has only the ridge's trim.
 */
function apart(a: Set, b: Set, edge: readonly [number, number, number, number], level: number, from = 4): number {
  const [x0, z0, x1, z1] = edge;
  const l = Math.hypot(x1 - x0, z1 - z0);
  const [nx, nz] = [-(z1 - z0) / l, (x1 - x0) / l];
  // Which side of the edge each piece lies on: toward its own origin, or for a triangle, toward its middle.
  const side = (s: Set): number => {
    const o = ALL[s.form]!.outline;
    const [c, sn] = [Math.cos((s.turn * Math.PI) / 180), Math.sin((s.turn * Math.PI) / 180)];
    const [mx, mz] = [o.reduce((sum, q) => sum + q[0], 0) / o.length - ALL[s.form]!.at[0], o.reduce((sum, q) => sum + q[1], 0) / o.length - ALL[s.form]!.at[2]];
    return Math.sign((s.x + c * mx - sn * mz - x0) * nx + (s.z + sn * mx + c * mz - z0) * nz);
  };
  const [sa, sb, ta, tb] = [side(a), side(b), standing(a, level), standing(b, level)];
  expect(sa * sb, "the two pieces lie either side of the edge").toBe(-1);
  let most = 0;
  for (let k = from; k < 116; k++) {
    // Off the courses' own lines, where a butt is an upright step and a top is two heights at once.
    const [x, z] = [x0 + ((x1 - x0) * (k + 0.37)) / 120, z0 + ((z1 - z0) * (k + 0.37)) / 120];
    const [ha, hb] = [over(ta, x + nx * sa * 0.0005, z + nz * sa * 0.0005), over(tb, x + nx * sb * 0.0005, z + nz * sb * 0.0005)];
    expect(ha !== null && hb !== null, `both pieces reach the edge at ${k}`).toBe(true);
    most = Math.max(most, Math.abs(ha![1] - hb![1]));
  }
  return most;
}

const ROOT3 = Math.sqrt(3);
const roofAt = (form: string, x: number, z: number, turn = 0): Set => ({ form, x, z, turn });
/** Roof faces that lie in one plane across the side they share, or fall away from it alike: every level must meet there. */
const FLUSH: [string, Set, Set, [number, number, number, number]][] = [
  ["two slopes side by side", roofAt("roof", 0, 0), roofAt("roof", 3, 0), [1.5, -1.5, 1.5, 1.5]],
  ["two slopes back to back at their ridge", roofAt("roof", 0, 0), roofAt("roof", 0, 3, 180), [-1.5, 1.5, 1.5, 1.5]],
  ["a slope and the hip that ends it", roofAt("roof", 0, 0), roofAt("roof_hip", 3, 0), [1.5, -1.5, 1.5, 1.5]],
  ["the two hips of a hipped end", roofAt("roof_hip", 3, 0), roofAt("roof_hip", 3, 3, 90), [1.5, 1.5, 4.5, 1.5]],
  ["a valley and the slope that runs into it", roofAt("roof_valley", -3, 0), roofAt("roof", 0, 0), [-1.5, -1.5, -1.5, 1.5]],
  ["a valley and the slope over its ridge", roofAt("roof_valley", -3, 0), roofAt("roof", -3, 3, 180), [-4.5, 1.5, -1.5, 1.5]],
];
/** Faces of two pieces that meet at a hip, where no trim caps them. */
const HIPPED: [string, Set, Set, [number, number, number, number]][] = [
  ["a triangle's face and a slope's sloped side", roofAt("triangle_roof", 0, 0), roofAt("roof", -1.5 * Math.cos(Math.PI / 6) + 1.5 * Math.sin(Math.PI / 6) - 0, 0, -30), [0, 0, 1.5, 1.5 * ROOT3]],
  ["two triangles' faces round a bay", roofAt("triangle_roof", 0, 0), roofAt("triangle_roof", -1.5, 1.5 * ROOT3, -60), [0, 0, 1.5, 1.5 * ROOT3]],
];
// The slope turned 30 degrees back so that its east side lies on the triangle's first side: its origin is that side's middle, 1.5 m to the left of it.
HIPPED[0]![2] = roofAt("roof", 0.75 - 1.5 * Math.cos(Math.PI / 6), 0.75 * ROOT3 + 1.5 * Math.sin(Math.PI / 6), -30);

test("roof faces that share a side in one plane, or a ridge, meet along it to a millimetre at every textured level", () => {
  const said: string[] = [];
  for (const [name, a, b, edge] of FLUSH) {
    for (let level = 0; level < TEXTURED; level++) {
      // A valley's courses stand back from its fold, where its lining board shows. For 0.35 m from each end of the fold
      // the board, not a course, meets the roof beside it: 1.5 cm over a ridge's last course at its high corner, and
      // up to 6 cm under a slope's eave board at its low one, where it has no eave of its own.
      const most = apart(a, b, edge, level, name.startsWith("a valley") ? 14 : 4);
      said.push(`${name}, level ${level}: ${(most * 1000).toFixed(2)} mm`);
      expect(most, `${name}, level ${level}`).toBeLessThanOrEqual(0.001);
    }
  }
  if (process.env.SNARK_MEETS) console.log(said.join("\n"));
});

test("roof faces of two pieces that meet at a hip between them meet along it to a millimetre too", () => {
  const said: string[] = [];
  for (const [name, a, b, edge] of HIPPED) {
    for (let level = 0; level < TEXTURED; level++) {
      const most = apart(a, b, edge, level);
      said.push(`${name}, level ${level}: ${(most * 1000).toFixed(2)} mm`);
      // Courses lie at the same heights on both faces and are as thick measured upright, so they meet as flush faces do.
      expect(most, `${name}, level ${level}`).toBeLessThanOrEqual(0.001);
    }
  }
  if (process.env.SNARK_MEETS) console.log(said.join("\n"));
});

test("a roof that runs on down from another lies under its eave board, which laps it", () => {
  // The upper roof's low side is the lower one's high side, half a storey down.
  const [upper, lower] = [standing({ form: "roof", x: 0, z: 0, turn: 0, level: 1.5 }, 0), standing({ form: "roof", x: 0, z: -3, turn: 0 }, 0)];
  for (const x of [-1.2, -0.4, 0.3, 1.1]) for (const out of [0.05, 0.15, 0.28]) {
    const [hu, hl] = [over(upper, x, -1.5 - out)!, over(lower, x, -1.5 - out)!];
    // The eave board's top is over the lower roof's courses, and under them by no more than it is thick.
    expect(hu[1] - hl[1], `${x}, ${out} m down`).toBeGreaterThan(0.005);
    expect(hu[1] - hl[1], `${x}, ${out} m down`).toBeLessThan(0.07);
  }
});

/** Metres between a gable's top and the roof boards over it, as wood's recipe has them today. A change may lower it. */
const GABLE_GAP = 0.215;

test("a sloped wall's top lies in the plane of the roof's underside, under its boards, and its two hands meet the roof alike", () => {
  const roof = ALL.roof!;
  for (let level = 0; level < TEXTURED; level++) {
    for (const [hand, x, turn] of [["sloped_wall_left", 1.5, -90], ["sloped_wall_right", -1.5, 90]] as const) {
      // On the roof's east side its front looks east, and on the west side west: either way it is high where the roof is.
      const wall = standing({ form: hand, x, z: 0, turn }, level);
      const over0 = standing({ form: "roof", x: 0, z: 0, turn: 0 }, level);
      // The plane of the roof's underside, which its row's corner heights stand a slab over: from its slot's level at its low side to 1.5 m at its high one.
      const plane = (z: number): number => ((z + 1.5) / 3) * (roof.corner![0]! - roof.corner![2]!);
      let most = 0, tops = 0;
      for (const t of wall) for (let k = 0; k < 9; k += 3) {
        const off = t[k + 1]! - plane(t[k + 2]!);
        // Nothing of it stands over the plane, and its top's points are on it.
        expect(off, `${hand} level ${level}`).toBeLessThanOrEqual(0.002);
        if (off > -0.002) {
          tops++;
          most = Math.max(most, Math.abs(off));
        }
      }
      expect(tops, `${hand} level ${level}: points on the plane`).toBeGreaterThanOrEqual(4);
      expect(most).toBeLessThanOrEqual(0.002);
      // Under the roof's side, from its eave to its high side: nothing of the roof is under the wall's top. The roof
      // stands on its corner heights since 2026-11-24, and its rim timbers are 0.115 m in from its sides, so over the
      // wall only its boards run: they begin 0.21 m over the wall's top at the finest level, which is open to the day.
      for (const z of [-1.45, -1.2, -0.6, 0, 0.7, 1.3, 1.45]) for (const inward of [0.02, 0.05, 0.09]) {
        const px = x - Math.sign(x) * inward;
        const [w, r] = [over(wall, px, z), over(over0, px, z)!];
        if (!w) continue;
        expect(r[0], `${hand} level ${level} at ${z}: nothing of the roof in the wall`).toBeGreaterThanOrEqual(w[1] - 0.003);
        expect(r[0] - w[1], `${hand} level ${level} at ${z}: the gap under the boards`).toBeLessThanOrEqual(GABLE_GAP);
      }
    }
  }
});

test("a triangle of floor and a square share their side's two corners, and neither crosses it", () => {
  for (const [tri, square] of [["triangle_foundation", "foundation"], ["triangle_ceiling", "ceiling"]] as const) {
    for (let level = 0; level < 4; level++) {
      // The triangle's first side runs from its origin along +X, and the square lies on the other side of it.
      const [a, b] = [standing({ form: tri, x: 0, z: 0, turn: 0 }, level), standing({ form: square, x: 1.5, z: -1.5, turn: 0 }, level)];
      const top = Math.max(...a.map((t) => Math.max(t[1], t[4], t[7])));
      const corner = (tris: readonly Tri[], x: number): boolean => tris.some((t) => [0, 3, 6].some((k) => t[k] === x && t[k + 2] === 0 && Math.abs(t[k + 1]! - top) < 1e-9));
      // Past the finest level each has a vertex exactly on each corner of the side, at the floor's top.
      if (level > 0) expect([tri, level, corner(a, 0), corner(a, 3), corner(b, 0), corner(b, 3)]).toEqual([tri, level, true, true, true, true]);
      // On every level each keeps to its side of the line, but for the 2 mm its corner irons stand proud and the 5 mm a hewn beam strays.
      expect(Math.min(...a.map((t) => Math.min(t[2], t[5], t[8]))), `${tri} level ${level}`).toBeGreaterThanOrEqual(level === 0 ? -0.006 : -1e-9);
      expect(Math.max(...b.map((t) => Math.max(t[2], t[5], t[8]))), `${square} level ${level}`).toBeLessThanOrEqual(level === 0 ? 0.006 : 1e-9);
      expect(Math.abs(Math.max(...b.map((t) => Math.max(t[1], t[4], t[7]))) - top), `${tri} level ${level}: tops level`).toBeLessThanOrEqual(0.0026);
    }
  }
});

test("a hatch's leaf fills its frame's hole to 5 mm a side, and the frame keeps out of the hole", () => {
  const hole = ALL.trapdoor_frame!.openings![0]!;
  for (let level = 0; level < 4; level++) {
    const [leaf, frame] = [standing({ form: "trapdoor", x: 0, z: 0, turn: 0 }, level), standing({ form: "trapdoor_frame", x: 0, z: 0, turn: 0 }, level)];
    const reach = (tris: readonly Tri[], k: number, way: number): number => Math.max(...tris.map((t) => Math.max(way * t[k]!, way * t[k + 3]!, way * t[k + 6]!)));
    for (const [k, lo, hi] of [[0, hole.x0, hole.x1], [2, hole.y0, hole.y1]] as const) {
      for (const clear of [hi - reach(leaf, k, 1), lo * -1 - reach(leaf, k, -1)]) {
        expect(clear, `level ${level}`).toBeGreaterThan(0);
        expect(clear, `level ${level}`).toBeLessThanOrEqual(0.005);
      }
    }
    // No point of the frame lies inside the hole, and the leaf's top is at the floor's or a hair under it.
    for (const t of frame) for (let k = 0; k < 9; k += 3) expect(t[k]! > hole.x0 + 1e-6 && t[k]! < hole.x1 - 1e-6 && t[k + 2]! > hole.y0 + 1e-6 && t[k + 2]! < hole.y1 - 1e-6, `level ${level}`).toBe(false);
    const [leafTop, floor] = [Math.max(...leaf.map((t) => Math.max(t[1], t[4], t[7]))), Math.max(...frame.map((t) => Math.max(t[1], t[4], t[7])))];
    // Its boards lie 4 mm under the floor, and the ring it is lifted by 12 mm over it.
    expect(leafTop - floor, `level ${level}`).toBeLessThanOrEqual(level === 0 ? 0.013 : 0.004);
  }
});

// Thatch: its three roofs along the sides they share, a hip's and a valley's own fold, one roof's eave over the next
// roof down, and the gable's two hands under a roof. Measured on the thatch recipe's meshes, as wood's are above.

import { THATCH } from "../../tools/pack/pieces/thatch.ts";

const thatchCache = new Map<string, Tri[]>();
/** A thatch piece's triangles in the world at `level`. */
function thatchStanding(s: Set, level: number): Tri[] {
  const key = `${s.form},${s.x},${s.z},${s.turn},${s.level ?? 0},${level}`;
  let out = thatchCache.get(key);
  if (out) return out;
  const form = ALL[s.form]!;
  const shapes = levelsOf(THATCH, s.form, form);
  const [c, sn] = [Math.cos((s.turn * Math.PI) / 180), Math.sin((s.turn * Math.PI) / 180)];
  const at = (p: readonly number[]): number[] => [s.x + c * p[0]! + sn * p[1]!, (s.level ?? 0) + form.at[1] + p[2]!, s.z + sn * p[0]! - c * p[1]!];
  const corners = shapes[Math.min(level, shapes.length - 1)]!.corners();
  out = [];
  for (let t = 0; t < corners.length; t += 3) out.push([...at(corners[t]!), ...at(corners[t + 1]!), ...at(corners[t + 2]!)] as unknown as Tri);
  thatchCache.set(key, out);
  return out;
}

/** The most two thatch pieces' tops differ along the line from (x0, z0) to (x1, z1), each read half a millimetre to its own side of it: `a` to the line's left. */
function thatchApart(a: Tri[], b: Tri[], edge: readonly [number, number, number, number], from = 4): number {
  const [x0, z0, x1, z1] = edge;
  const l = Math.hypot(x1 - x0, z1 - z0);
  const [nx, nz] = [(-(z1 - z0) / l) * 0.0005, ((x1 - x0) / l) * 0.0005];
  let most = 0;
  for (let k = from; k < 120 - from; k++) {
    const [x, z] = [x0 + ((x1 - x0) * (k + 0.37)) / 120, z0 + ((z1 - z0) * (k + 0.37)) / 120];
    const [ha, hb] = [over(a, x + nx, z + nz), over(b, x - nx, z - nz)];
    expect(ha !== null && hb !== null, `both reach the line at ${k}`).toBe(true);
    most = Math.max(most, Math.abs(ha![1] - hb![1]));
  }
  return most;
}

/** Pairs of thatch roofs and the side they share, the first piece on the left of the way the side is given. */
const THATCH_FLUSH: [string, Set, Set, [number, number, number, number]][] = [
  ["two slopes side by side", roofAt("roof", 0, 0), roofAt("roof", 3, 0), [1.5, -1.5, 1.5, 1.5]],
  ["two slopes back to back at their ridge", roofAt("roof", 0, 3, 180), roofAt("roof", 0, 0), [-1.5, 1.5, 1.5, 1.5]],
  ["a slope and the hip that ends it", roofAt("roof", 0, 0), roofAt("roof_hip", 3, 0), [1.5, -1.5, 1.5, 1.5]],
  ["the two hips of a hipped end", roofAt("roof_hip", 3, 3, 90), roofAt("roof_hip", 3, 0), [1.5, 1.5, 4.5, 1.5]],
  ["a valley and the slope that runs into it", roofAt("roof_valley", -3, 0), roofAt("roof", 0, 0), [-1.5, -1.5, -1.5, 1.5]],
  ["a valley and the slope over its ridge", roofAt("roof", -3, 3, 180), roofAt("roof_valley", -3, 0), [-4.5, 1.5, -1.5, 1.5]],
];

test("thatch roofs that share a side meet along it to a millimetre at every textured level, eave to ridge", () => {
  const said: string[] = [];
  for (const [name, a, b, edge] of THATCH_FLUSH) {
    for (let level = 0; level < TEXTURED; level++) {
      // The whole side but its last 2.5 cm at each end, where a hip's faces come to a point.
      const most = thatchApart(thatchStanding(a, level), thatchStanding(b, level), edge, 1);
      said.push(`thatch: ${name}, level ${level}: ${(most * 1000).toFixed(2)} mm`);
      expect(most, `${name}, level ${level}`).toBeLessThanOrEqual(0.001);
    }
  }
  if (process.env.SNARK_MEETS) console.log(said.join("\n"));
});

test("a thatch hip turns each course round its fold at one height, and a valley gathers them at one", () => {
  const said: string[] = [];
  // A hip is folded from its high corner at (-1.5, 1.5) to (1.5, -1.5), and a valley from its low one at (1.5, -1.5).
  for (const form of ["roof_hip", "roof_valley"]) {
    for (let level = 0; level < TEXTURED; level++) {
      const tris = thatchStanding(roofAt(form, 0, 0), level);
      const most = thatchApart(tris, tris, [-1.5, 1.5, 1.5, -1.5], 1);
      said.push(`thatch: ${form} across its fold, level ${level}: ${(most * 1000).toFixed(2)} mm`);
      expect(most, `${form} level ${level}`).toBeLessThanOrEqual(0.001);
    }
  }
  if (process.env.SNARK_MEETS) console.log(said.join("\n"));
});

test("a thatch roof that runs on down from another lies under its eave course, which laps it", () => {
  const [upper, lower] = [thatchStanding({ form: "roof", x: 0, z: 0, turn: 0, level: 1.5 }, 0), thatchStanding({ form: "roof", x: 0, z: -3, turn: 0 }, 0)];
  const said: string[] = [];
  // Out to where the shortest bundle's reed ends: past it the tips hang, a sheet to a bundle.
  for (const x of [-1.2, -0.4, 0.3, 1.1]) for (const out of [0.03, 0.09, 0.16]) {
    const [hu, hl] = [over(upper, x, -1.5 - out)!, over(lower, x, -1.5 - out)!];
    said.push(`thatch: the upper eave over the lower roof at ${x}, ${out} m down: ${((hu[1] - hl[1]) * 1000).toFixed(1)} mm`);
    expect(hu[1] - hl[1], `${x}, ${out} m down`).toBeGreaterThan(0.005);
    expect(hu[1] - hl[1], `${x}, ${out} m down`).toBeLessThan(0.08);
  }
  if (process.env.SNARK_MEETS) console.log(said.join("\n"));
});

test("a thatch gable's top lies in the plane of the roof's corner heights to 2 mm, with no gap under the roof and nothing through it", () => {
  const roof = ALL.roof!;
  const said: string[] = [];
  for (let level = 0; level < TEXTURED; level++) {
    for (const [hand, x, turn] of [["sloped_wall_left", 1.5, -90], ["sloped_wall_right", -1.5, 90]] as const) {
      const wall = thatchStanding({ form: hand, x, z: 0, turn }, level);
      const over0 = thatchStanding({ form: "roof", x: 0, z: 0, turn: 0 }, level);
      // The plane through the roof row's corner heights: its top where the slab hangs under them, its underside where it stands on them.
      const plane = (z: number): number => ((z + 1.5) / 3) * (roof.corner![0]! - roof.corner![2]!);
      let most = 0, tops = 0, over1 = -Infinity;
      for (const t of wall) for (let k = 0; k < 9; k += 3) {
        const off = t[k + 1]! - plane(t[k + 2]!);
        over1 = Math.max(over1, off);
        if (off > -0.002) {
          tops++;
          most = Math.max(most, Math.abs(off));
        }
      }
      // Nothing of it stands over the plane, and the points of its cut top are on it.
      expect(over1, `${hand} level ${level}`).toBeLessThanOrEqual(0.002);
      expect(tops, `${hand} level ${level}: points on the plane`).toBeGreaterThanOrEqual(4);
      expect(most).toBeLessThanOrEqual(0.002);
      let [gap, through] = [0, 0];
      for (const z of [-1.45, -1.2, -0.6, 0, 0.7, 1.3, 1.45]) for (const inward of [0.02, 0.05, 0.09]) {
        const px = x - Math.sign(x) * inward;
        const [w, r] = [over(wall, px, z), over(over0, px, z)!];
        if (!w) continue;
        // The wall's top is no lower than the lowest of the roof over it, and no higher than its thatch.
        gap = Math.max(gap, r[0] - w[1]);
        through = Math.max(through, w[1] - r[1]);
      }
      said.push(`thatch: ${hand} level ${level}: top within ${(most * 1000).toFixed(2)} mm of the plane, gap under the roof ${(Math.max(0, gap) * 1000).toFixed(2)} mm, through it ${(Math.max(0, through) * 1000).toFixed(2)} mm`);
      expect(gap, `${hand} level ${level}: no gap under the roof`).toBeLessThanOrEqual(1e-6);
      expect(through, `${hand} level ${level}: nothing through the roof`).toBeLessThanOrEqual(1e-6);
    }
  }
  if (process.env.SNARK_MEETS) console.log(said.join("\n"));
});
