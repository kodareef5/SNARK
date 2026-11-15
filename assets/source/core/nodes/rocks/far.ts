// The far level of every whole stone: eight triangles in flat colours, which the far layer draws from the hand-over
// band out to its reach (client/core/render/farnodes.ts). Each is fitted to the level the near store draws in the band
// (level 3 of the pack, a hundred triangles), so that at the band a stone keeps its outline, its height, its foot and
// its tones as one store hands it to the other:
//
// - its shape is the solid round six points, eight triangles: three on top, which make a face that takes the light, and
//   three buried. The points are moved until the solid's outline above the ground covers the near level's from every
//   side a player sees a stone from far off (low round it, higher from a flyer, and from above), the outline's top edge
//   follows the near level's, its top is as high, and its foot is as deep in the ground as the near level's, so a slope
//   does not show air under it. Tried first and seen in the game: six free points, which made tents and shards of
//   boulders; tops free to fall to half the height, which peaked;
// - each face takes the palette colour whose look is nearest what the near level shows in the same pixels, under the
//   game's light at 10:00, noon and 17:00, from every side. Tried first: matching the mean of the whole stone, which
//   gave pink and green faces that averaged to beige.
//
// It writes mesh/<name>_far.json, which model.py builds as the piece's last level (<name>_LOD1, see asset.ts). Run it
// when a stone's near levels change, then build the asset; --colours keeps each shape and fits its colours again.
//   bun assets/source/core/nodes/rocks/far.ts [--colours] [rock_1 ...]

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FRAME } from "../../../../../client/core/render/packet.ts";
import { skyFrame, theSky } from "../../../../../client/core/render/sky.ts";
import { linearToSrgb, lit, srgbToLinear, tone } from "../../../../../client/core/render/surface.ts";
import { parsePack } from "../../../../../shared/pack/pack.ts";
import { REGION_BASE, defaultPalette } from "../../../../../shared/pack/palette.ts";
import { unpackMeshes, type SourceLod } from "../../../../../tools/pack/write.ts";

const HERE = import.meta.dir;
const STONES = ["rock_1", "rock_2", "rock_3", "rock_4", "rock_5", "rock_6", "metal_rock_1", "metal_rock_2", "metal_rock_3", "rubble_1", "rubble_2", "rubble_3"];
/** The level drawn in the band on medium, which the far one takes over from. */
const NEAR = 3;
/** Pixels across the stone in each view of the fit. */
const RES = 40;
/** How much the outline's top edge counts against its area; and how low a top point may stand, of the near level's height. */
const EDGE = 3;
const TOPS = 0.75;

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Seeded, so a stone's far level comes out the same each time. */
function random(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** A side the stone is seen from: the way the eye looks, two axes across the picture, and how much it counts. */
interface View {
  look: V3;
  right: V3;
  up: V3;
  weight: number;
  /** The picture's corner and pixel, in metres along right and up. */
  u0: number;
  v0: number;
  px: number;
  /** The ground the stone stands on, as a point is over it by its dot with this: (0, 1, 0) for level ground. */
  ground: V3;
}

const LEVEL: V3 = [0, 1, 0];
/** The slope the hillside views stand the stone on: 24 degrees, the scree's, about as steep as its footing lets it grow. */
const SLOPE = Math.tan((24 * Math.PI) / 180);

/**
 * Round it every 30 degrees just over the ground, as a stone is seen across a field from 150 m to a kilometre, and at
 * 6 degrees; less from 20 and 45 degrees, a flyer's view, and from straight above. And on a hillside of SLOPE, round
 * it every 45 degrees: from the valley, looking up 8 degrees at its downhill side and the foot the slope bares, and
 * from higher up the hill, looking down 25 degrees.
 */
function views(): View[] {
  const out: View[] = [];
  const add = (az: number, el: number, weight: number, downhill = 0): void => {
    const [a, e] = [(az * Math.PI) / 180, (el * Math.PI) / 180];
    const look: V3 = [-Math.cos(e) * Math.sin(a), -Math.sin(e), -Math.cos(e) * Math.cos(a)];
    const right = el >= 89 ? ([1, 0, 0] as V3) : unit(cross(look, [0, 1, 0]));
    // The ground falls away toward the eye (downhill 1) or away from it (-1).
    const ground: V3 = downhill === 0 ? LEVEL : [Math.sin(a) * SLOPE * downhill, 1, Math.cos(a) * SLOPE * downhill];
    out.push({ look, right, up: cross(right, look), weight, u0: 0, v0: 0, px: 0, ground });
  };
  for (let az = 0; az < 360; az += 30) {
    add(az, 1, 3);
    add(az + 15, 6, 2);
    add(az, 20, 1);
  }
  for (let az = 0; az < 360; az += 60) add(az + 30, 45, 0.7);
  add(0, 90, 2);
  for (let az = 0; az < 360; az += 45) {
    add(az + 10, -8, 3, 1);
    add(az + 30, 25, 2, -1);
  }
  return out;
}

/** Triangles as three corners each. */
type Tris = V3[][];

/** The part of a triangle at or above the ground `g` (View.ground), as triangles: none, one or two. */
function above(t: V3[], out: Tris, g: V3 = LEVEL): void {
  const f = t.map((p) => dot(p, g));
  const inside = f.map((h) => h >= 0);
  const n = inside.filter(Boolean).length;
  if (n === 3) {
    out.push(t);
    return;
  }
  if (n === 0) return;
  const poly: V3[] = [];
  for (let k = 0; k < 3; k++) {
    const [a, b] = [t[k]!, t[(k + 1) % 3]!];
    if (inside[k]) poly.push(a);
    if (inside[k] !== inside[(k + 1) % 3]) {
      const s = f[k]! / (f[k]! - f[(k + 1) % 3]!);
      poly.push([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s]);
    }
  }
  for (let k = 1; k + 1 < poly.length; k++) out.push([poly[0]!, poly[k]!, poly[k + 1]!]);
}

/** Marks in `mask` the pixels of view `v` the triangles cover. */
function cover(v: View, tris: Tris, mask: Uint8Array): void {
  mask.fill(0);
  for (const t of tris) {
    const p = t.map((q) => [(dot(q, v.right) - v.u0) / v.px, (dot(q, v.up) - v.v0) / v.px]);
    const [x0, x1] = [Math.max(0, Math.floor(Math.min(p[0]![0]!, p[1]![0]!, p[2]![0]!))), Math.min(RES - 1, Math.ceil(Math.max(p[0]![0]!, p[1]![0]!, p[2]![0]!)))];
    const [y0, y1] = [Math.max(0, Math.floor(Math.min(p[0]![1]!, p[1]![1]!, p[2]![1]!))), Math.min(RES - 1, Math.ceil(Math.max(p[0]![1]!, p[1]![1]!, p[2]![1]!)))];
    const area = (p[1]![0]! - p[0]![0]!) * (p[2]![1]! - p[0]![1]!) - (p[2]![0]! - p[0]![0]!) * (p[1]![1]! - p[0]![1]!);
    if (Math.abs(area) < 1e-9) continue;
    const s = area > 0 ? 1 : -1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const [cx, cy] = [x + 0.5, y + 0.5];
        const w0 = ((p[1]![0]! - cx) * (p[2]![1]! - cy) - (p[2]![0]! - cx) * (p[1]![1]! - cy)) * s;
        const w1 = ((p[2]![0]! - cx) * (p[0]![1]! - cy) - (p[0]![0]! - cx) * (p[2]![1]! - cy)) * s;
        const w2 = ((p[0]![0]! - cx) * (p[1]![1]! - cy) - (p[1]![0]! - cx) * (p[0]![1]! - cy)) * s;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) mask[y * RES + x] = 1;
      }
    }
  }
}

/** The faces of the solid round `pts`, each wound to look out: corners and normal. A point inside makes none. */
function hull(pts: V3[]): { idx: [number, number, number]; n: V3 }[] {
  const faces: { idx: [number, number, number]; n: V3 }[] = [];
  const centre: V3 = [0, 1, 2].map((k) => pts.reduce((s, p) => s + p[k]!, 0) / pts.length) as V3;
  for (let a = 0; a < pts.length; a++) {
    for (let b = a + 1; b < pts.length; b++) {
      for (let c = b + 1; c < pts.length; c++) {
        let n = cross(sub(pts[b]!, pts[a]!), sub(pts[c]!, pts[a]!));
        const l = Math.hypot(...n);
        if (l < 1e-9) continue;
        n = [n[0] / l, n[1] / l, n[2] / l];
        let [front, back] = [0, 0];
        for (let k = 0; k < pts.length; k++) {
          if (k === a || k === b || k === c) continue;
          const d = dot(sub(pts[k]!, pts[a]!), n);
          if (d > 1e-7) front++;
          else if (d < -1e-7) back++;
        }
        if (front > 0 && back > 0) continue;
        if (front === 0 && back === 0) continue;
        const out = front === 0;
        // Facing away from the middle: the side no point lies on.
        faces.push(out ? { idx: [a, b, c], n } : { idx: [a, c, b], n: [-n[0], -n[1], -n[2]] });
        void centre;
      }
    }
  }
  return faces;
}

/** How far `p` lies outside the solid round the faces, 0 inside. */
function outside(pts: V3[], faces: { idx: [number, number, number]; n: V3 }[], p: V3): number {
  let most = 0;
  for (const f of faces) most = Math.max(most, dot(sub(p, pts[f.idx[0]]!), f.n));
  return most;
}

interface Near {
  name: string;
  /** Its triangles and each one's palette colour. */
  tris: Tris;
  colours: number[];
  /** Its top, and points round its foot that the far level must hold: the near level's foot as deep. */
  top: number;
  feet: V3[];
  /** How far its outline at the ground reaches, 24 ways round from +x toward +z. */
  rim: number[];
  /** Per view, the pixels it covers above the ground, and the top of its outline in each column. */
  masks: Uint8Array[];
  tops: Int16Array[];
  /** The box its finest level fills: the far level stays inside it. */
  lo: V3;
  hi: V3;
  views: View[];
}

/** Per column of a mask, one more than the highest row it covers, 0 where none. */
function profile(mask: Uint8Array, out = new Int16Array(RES)): Int16Array {
  out.fill(0);
  for (let y = 0; y < RES; y++) for (let x = 0; x < RES; x++) if (mask[y * RES + x]) out[x] = y + 1;
  return out;
}

function near(name: string, lod: SourceLod, finest: SourceLod): Near {
  const tris: Tris = [];
  const colours: number[] = [];
  const at = (i: number): V3 => [lod.positions[i * 3]!, lod.positions[i * 3 + 1]!, lod.positions[i * 3 + 2]!];
  for (let t = 0; t < lod.indices.length; t += 3) {
    tris.push([at(lod.indices[t]!), at(lod.indices[t + 1]!), at(lod.indices[t + 2]!)]);
    // The flat renderer colours a triangle by its last corner.
    colours.push(lod.colors[lod.indices[t + 2]!]!);
  }
  const up: Tris = [];
  for (const t of tris) above(t, up);
  const pts = up.flat();
  const top = Math.max(...pts.map((p) => p[1]));
  // The foot: round the outline at the ground, 24 ways, the near level's lowest point under each, a little in.
  const low = Math.min(...tris.flat().map((p) => p[1]));
  const feet: V3[] = [];
  const rim: number[] = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const dir: V3 = [Math.cos(a), 0, Math.sin(a)];
    let reach = 0;
    for (const p of pts) if (p[1] < 0.15) reach = Math.max(reach, dot(p, dir) - 0 * Math.abs(dot(p, [-dir[2], 0, dir[0]])) * 0);
    // The ray's own reach: points within a narrow wedge either side.
    let r = 0;
    for (const p of pts) {
      if (p[1] > 0.15) continue;
      const along = dot(p, dir);
      const side = Math.abs(dot(p, [-dir[2], 0, dir[0]]));
      if (along > 0 && side < along * 0.27) r = Math.max(r, along);
    }
    r = r || reach;
    rim.push(r);
    feet.push([dir[0] * r * 0.85, low * 0.9, dir[2] * r * 0.85]);
  }
  const vs = views();
  const masks: Uint8Array[] = [];
  for (const v of vs) {
    const seen: Tris = [];
    for (const t of tris) above(t, seen, v.ground);
    const all = seen.flat();
    const u = all.map((p) => dot(p, v.right));
    const w = all.map((p) => dot(p, v.up));
    const [ulo, uhi, wlo, whi] = [Math.min(...u), Math.max(...u), Math.min(...w), Math.max(...w)];
    const span = Math.max(uhi - ulo, whi - wlo) * 1.3;
    v.px = span / RES;
    v.u0 = (ulo + uhi) / 2 - span / 2;
    v.v0 = (wlo + whi) / 2 - span / 2;
    const m = new Uint8Array(RES * RES);
    cover(v, seen, m);
    masks.push(m);
  }
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < finest.positions.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3]!, finest.positions[i]!);
    hi[i % 3] = Math.max(hi[i % 3]!, finest.positions[i]!);
  }
  return { name, tris, colours, top, feet, rim, masks, tops: masks.map((m) => profile(m)), lo, hi, views: vs };
}

/** The far solid's faces, and its triangles above level ground or `g`. */
function solid(pts: V3[], g: V3 = LEVEL): { faces: ReturnType<typeof hull>; up: Tris } {
  const faces = hull(pts);
  const up: Tris = [];
  for (const f of faces) above(f.idx.map((i) => pts[i]!), up, g);
  return { faces, up };
}

/** The far solid's triangles above the ground of view `v`. */
function seenIn(faces: ReturnType<typeof hull>, pts: V3[], v: View): Tris {
  const out: Tris = [];
  for (const f of faces) above(f.idx.map((i) => pts[i]!), out, v.ground);
  return out;
}

const scratch = new Uint8Array(RES * RES);
const line = new Int16Array(RES);

/** How unlike the near level the solid round `pts` is: its outlines' unshared share, its top, and air under its foot. */
function cost(n: Near, pts: V3[]): number {
  const { faces, up } = solid(pts);
  if (faces.length < 4) return 1e9;
  let [miss, weights, edge] = [0, 0, 0];
  n.views.forEach((v, i) => {
    cover(v, v.ground === LEVEL ? up : seenIn(faces, pts, v), scratch);
    const m = n.masks[i]!;
    let [both, either] = [0, 0];
    for (let k = 0; k < m.length; k++) {
      both += m[k]! & scratch[k]!;
      either += m[k]! | scratch[k]!;
    }
    miss += v.weight * (1 - both / Math.max(1, either));
    weights += v.weight;
    // The outline's top edge, column by column: a peak where the near level is round shows here more than in the area.
    const want = n.tops[i]!;
    profile(scratch, line);
    let [d, cols, tall] = [0, 0, 1];
    for (let x = 0; x < RES; x++) {
      if (want[x] === 0 && line[x] === 0) continue;
      d += Math.abs(want[x]! - line[x]!);
      cols++;
      tall = Math.max(tall, want[x]!);
    }
    edge += v.weight * (d / Math.max(1, cols) / tall);
  });
  const top = Math.max(0, ...up.flat().map((p) => p[1]));
  let foot = 0;
  for (const p of n.feet) foot += outside(pts, faces, p) ** 2;
  // Past the near level's outline a point lies under ground that falls away from the origin at 32 degrees, as the near
  // level's buried foot does, so a stone on a slope shows nothing of the far one's below its own.
  for (const p of pts) {
    const r = Math.hypot(p[0], p[2]);
    const k = Math.round(((Math.atan2(p[2], p[0]) / (Math.PI * 2)) * 24 + 24) % 24) % 24;
    if (r > n.rim[k]!) foot += Math.max(0, p[1] + 0.6 * r) ** 2;
  }
  return miss / weights + EDGE * edge / weights + 0.6 * Math.abs(top - n.top) / Math.max(n.top, 0.3) + 4 * foot;
}

/**
 * Six points to start from: a triangle on top and one buried under it, turned half a side, as wide as the near level's
 * foot, the top ones at even places. They stay so (`kept`): three tops make a flat face that takes the light, where two
 * or one would make a ridge or a peak, which reads as a tent or a shard from far off.
 */
function start(n: Near, rnd: () => number): V3[] {
  const turn = rnd() * Math.PI * 2;
  const r = Math.max(...n.feet.map((p) => Math.hypot(p[0], p[2])));
  const low = Math.min(...n.feet.map((p) => p[1]));
  const pts: V3[] = [];
  for (let k = 0; k < 3; k++) {
    const a = turn + (k * 2 * Math.PI) / 3;
    pts.push([Math.cos(a) * r * 0.55, n.top * (0.8 + 0.2 * rnd()), Math.sin(a) * r * 0.55]);
    const b = a + Math.PI / 3;
    pts.push([Math.cos(b) * r * 1.15, low * 1.1, Math.sin(b) * r * 1.15]);
  }
  return pts;
}

/**
 * The points held to their parts: the tops in the top quarter of the near level's height (TOPS) and inside its finest
 * level's box; the base under the ground, no deeper than 0.6 m under the finest level's foot and no more than half as
 * far out again, where the cone a slope leaves (`cost`) hides it.
 */
function kept(n: Near, pts: V3[]): V3[] {
  return pts.map((p, i) => {
    const out = i % 2 === 0 ? 1 : 1.5;
    const q = p.map((v, k) => (k === 1 ? v : Math.min(n.hi[k]! * out, Math.max(n.lo[k]! * out, v)))) as V3;
    q[1] = i % 2 === 0 ? Math.min(n.top, Math.max(TOPS * n.top, q[1])) : Math.min(-0.05, Math.max(n.lo[1] - 0.6, q[1]));
    return q;
  });
}

/** Moves the points while the cost falls: a step each way at random, its size grown on a gain and shrunk on a loss. */
function fit(n: Near, pts: V3[], rnd: () => number, steps: number): { pts: V3[]; cost: number } {
  let best = kept(n, pts);
  let c = cost(n, best);
  let size = 0.15;
  for (let s = 0; s < steps; s++) {
    const next = best.map((p) => [...p] as V3);
    const which = rnd() < 0.5 ? [Math.floor(rnd() * next.length)] : next.map((_, i) => i);
    for (const i of which) for (let k = 0; k < 3; k++) next[i]![k] += (rnd() * 2 - 1) * size;
    const held = kept(n, next);
    const nc = cost(n, held);
    if (nc < c) {
      [best, c] = [held, nc];
      size = Math.min(0.5, size * 1.3);
    } else size = Math.max(0.005, size * 0.97);
  }
  return { pts: best, cost: c };
}

/** The frame's light at an hour, as a lit tier has it. */
function frameAt(hour: number): Float32Array {
  const frame = new Float32Array(256);
  skyFrame(hour, theSky(), frame);
  return frame;
}

const palette = defaultPalette();
const linear = (c: number): V3 => [srgbToLinear(palette[c * 4]! / 255), srgbToLinear(palette[c * 4 + 1]! / 255), srgbToLinear(palette[c * 4 + 2]! / 255)];
/** The palette colours a stone's far level may take: the natural tones, not the loud ones or the regions. */
const TONES = Array.from({ length: REGION_BASE }, (_, i) => i).filter((i) => i >= 82 && i < 236);

/** Linear light as OKLab. */
function oklab(c: V3): V3 {
  const l = Math.cbrt(0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2]);
  const m = Math.cbrt(0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2]);
  const s = Math.cbrt(0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2]);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** A face's colour as shown: lit by `frame` facing `nrm`, seen along `look`. */
function shownAs(albedo: V3, nrm: V3, look: V3, frame: Float32Array, out: number[]): void {
  const light = [0, 0, 0];
  lit(light, albedo, [1, 1, 0], nrm, [-look[0], -look[1], -look[2]], frame, [0, 0, 0]);
  for (let k = 0; k < 3; k++) light[k] = light[k]! * frame[FRAME.exposure]!;
  tone(light, light);
  for (let k = 0; k < 3; k++) out[k] = 255 * linearToSrgb(Math.max(0, Math.min(1, light[k]!)));
}

/** Per view, the triangle each pixel shows above the ground, the nearer over the farther, -1 for none. */
function owners(views: View[], tris: Tris): Int32Array[] {
  const depth = new Float32Array(RES * RES);
  return views.map((v) => {
    const owner = new Int32Array(RES * RES);
    depth.fill(Infinity);
    owner.fill(-1);
    tris.forEach((t, ti) => {
      const p = t.map((q) => [(dot(q, v.right) - v.u0) / v.px, (dot(q, v.up) - v.v0) / v.px, dot(q, v.look), dot(q, v.ground)]);
      const area = (p[1]![0]! - p[0]![0]!) * (p[2]![1]! - p[0]![1]!) - (p[2]![0]! - p[0]![0]!) * (p[1]![1]! - p[0]![1]!);
      if (Math.abs(area) < 1e-9) return;
      const [x0, x1] = [Math.max(0, Math.floor(Math.min(p[0]![0]!, p[1]![0]!, p[2]![0]!))), Math.min(RES - 1, Math.ceil(Math.max(p[0]![0]!, p[1]![0]!, p[2]![0]!)))];
      const [y0, y1] = [Math.max(0, Math.floor(Math.min(p[0]![1]!, p[1]![1]!, p[2]![1]!))), Math.min(RES - 1, Math.ceil(Math.max(p[0]![1]!, p[1]![1]!, p[2]![1]!)))];
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const [cx, cy] = [x + 0.5, y + 0.5];
          const w0 = ((p[1]![0]! - cx) * (p[2]![1]! - cy) - (p[2]![0]! - cx) * (p[1]![1]! - cy)) / area;
          const w1 = ((p[2]![0]! - cx) * (p[0]![1]! - cy) - (p[0]![0]! - cx) * (p[2]![1]! - cy)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          // Under the ground the ground is drawn.
          const z = w0 * p[0]![2]! + w1 * p[1]![2]! + w2 * p[2]![2]!;
          const h = w0 * p[0]![3]! + w1 * p[1]![3]! + w2 * p[2]![3]!;
          if (z < depth[y * RES + x]!) {
            depth[y * RES + x] = z;
            owner[y * RES + x] = h >= 0 ? ti : -1;
          }
        }
      }
    });
    return owner;
  });
}

/** Per view, the pixels each triangle shows. */
function shows(owned: Int32Array[]): Map<number, number>[] {
  return owned.map((owner) => {
    const count = new Map<number, number>();
    for (const o of owner) if (o >= 0) count.set(o, (count.get(o) ?? 0) + 1);
    return count;
  });
}

/** Per view and hour, the mean colour shown of what `seen` says each triangle shows, coloured by `colourOf`. */
function looks(views: View[], tris: Tris, seen: Map<number, number>[], colourOf: (t: number) => number, frames: Float32Array[]): number[][] {
  const out: number[][] = [];
  const shown = [0, 0, 0];
  const normals = tris.map((t) => unit(cross(sub(t[1]!, t[0]!), sub(t[2]!, t[0]!))));
  views.forEach((v, vi) => {
    let all = 0;
    for (const n of seen[vi]!.values()) all += n;
    for (const frame of frames) {
      const sum = [0, 0, 0];
      for (const [ti, n] of seen[vi]!) {
        shownAs(linear(colourOf(ti)), normals[ti]!, v.look, frame, shown);
        for (let k = 0; k < 3; k++) sum[k]! += shown[k]! * n;
      }
      out.push(sum.map((s) => s / Math.max(1, all)));
    }
  });
  return out;
}

const pack = parsePack(new Uint8Array(readFileSync(join(HERE, "rocks.snpk"))));
const meshes = new Map(unpackMeshes(pack).map((m) => [m.id, m]));
const frames = [10, 12, 17].map(frameAt);
// --colours keeps each far level's shape as it was written and fits its colours again.
const coloursOnly = process.argv.includes("--colours");
const asked = process.argv.slice(2).filter((a) => !a.startsWith("--"));

for (const name of asked.length > 0 ? asked : STONES) {
  const t0 = performance.now();
  const mesh = meshes.get(`core:${name}`)!;
  const n = near(name, mesh.lods[NEAR]!, mesh.lods[0]!);
  const rnd = random(name.length * 977 + [...name].reduce((s, c) => s + c.charCodeAt(0), 0));
  let pts: V3[];
  if (coloursOnly) pts = JSON.parse(readFileSync(join(HERE, "mesh", `${name}_far.json`), "utf8")).positions;
  else {
    // A few starts, each fitted a while; the best fitted on.
    let best = { pts: start(n, rnd), cost: Infinity };
    for (let k = 0; k < 6; k++) {
      const made = fit(n, start(n, rnd), rnd, 900);
      if (made.cost < best.cost) best = made;
    }
    pts = fit(n, best.pts, rnd, 4000).pts;
  }
  const { faces } = solid(pts);

  // Colours: per face, view and hour, how many pixels it shows over the near level, and the near level's light there.
  const farTris: Tris = faces.map((f) => f.idx.map((i) => pts[i]!));
  const nearOwn = owners(n.views, n.tris);
  const farOwn = owners(n.views, farTris);
  const nearSeen = shows(nearOwn);
  const farSeen = shows(farOwn);
  const nearLook = looks(n.views, n.tris, nearSeen, (t) => n.colours[t]!, frames);
  const nearNormals = n.tris.map((t) => unit(cross(sub(t[1]!, t[0]!), sub(t[2]!, t[0]!))));
  const shown = [0, 0, 0];
  const under = faces.map(() => n.views.map(() => frames.map(() => [0, 0, 0, 0])));
  n.views.forEach((v, vi) => {
    frames.forEach((frame, hi) => {
      const colourOf = new Map<number, number[]>();
      for (let k = 0; k < RES * RES; k++) {
        const [f, t] = [farOwn[vi]![k]!, nearOwn[vi]![k]!];
        if (f < 0 || t < 0) continue;
        let c = colourOf.get(t);
        if (!c) {
          shownAs(linear(n.colours[t]!), nearNormals[t]!, v.look, frame, shown);
          colourOf.set(t, (c = [...shown]));
        }
        // Summed as light, as the eye sums the near level's fine faces into one colour from afar.
        const u = under[f]![vi]![hi]!;
        for (let q = 0; q < 3; q++) u[q]! += srgbToLinear(c[q]! / 255);
        u[3]!++;
      }
    });
  });
  // Each face's tone: those whose look, in OKLab, lies nearest that mean from every view at every hour, a step of hue
  // or greyness counted twice a step of lightness; then of each face's three nearest, the eight that together keep
  // the whole stone's look, view by view and hour by hour, nearest the near level's. A face that shows nowhere takes
  // the tone of the face that shows most.
  const want = under.map((f) => f.map((v) => v.map((u) => (u[3]! > 0 ? oklab([u[0]! / u[3]!, u[1]! / u[3]!, u[2]! / u[3]!]) : null))));
  /** Per face, view and hour, a tone's look as light. */
  const lightOf = (c: number, f: (typeof faces)[number], v: View, frame: Float32Array): V3 => {
    shownAs(linear(c), f.n, v.look, frame, shown);
    return shown.map((x) => srgbToLinear(x / 255)) as V3;
  };
  const ranked = faces.map((f, fi) => {
    const scored: [number, number][] = [];
    for (const c of TONES) {
      let e = 0;
      n.views.forEach((v, vi) => {
        frames.forEach((frame, hi) => {
          const w = want[fi]![vi]![hi];
          if (!w) return;
          const o = oklab(lightOf(c, f, v, frame));
          e += v.weight * under[fi]![vi]![hi]![3]! * ((o[0] - w[0]) ** 2 + 2 * ((o[1] - w[1]) ** 2 + (o[2] - w[2]) ** 2));
        });
      });
      scored.push([c, e]);
    }
    return scored.sort((a, b) => a[1] - b[1]).slice(0, 3);
  });
  const pixels = faces.map((_, fi) => under[fi]!.reduce((s, v) => s + v.reduce((t, u) => t + u[3]!, 0), 0));
  const most = pixels.indexOf(Math.max(...pixels));
  for (let fi = 0; fi < faces.length; fi++) if (pixels[fi] === 0) ranked[fi] = [ranked[most]![0]!];
  // The near level's mean look per view and hour, and per face, view, hour and candidate its share of the far one's.
  const nearMean = nearLook.map((c) => oklab(c.map((x) => srgbToLinear(x / 255)) as V3));
  const share = faces.map((f, fi) => ranked[fi]!.map(([c]) => n.views.flatMap((v, vi) => frames.map((frame) => {
    const k = farSeen[vi]!.get(fi) ?? 0;
    const l = lightOf(c, f, v, frame);
    return [l[0] * k, l[1] * k, l[2] * k, k];
  }))));
  let best: number[] = ranked.map(() => 0);
  let least = Infinity;
  const pick = new Array<number>(faces.length).fill(0);
  const total = ranked.reduce((p, r) => p * r.length, 1);
  for (let combo = 0; combo < total; combo++) {
    let [rest, e] = [combo, 0];
    for (let fi = 0; fi < faces.length; fi++) {
      pick[fi] = rest % ranked[fi]!.length;
      rest = Math.floor(rest / ranked[fi]!.length);
      e += ranked[fi]![pick[fi]!]![1];
    }
    let whole = 0;
    nearMean.forEach((m, i) => {
      const sum = [0, 0, 0, 0];
      for (let fi = 0; fi < faces.length; fi++) {
        const s4 = share[fi]![pick[fi]!]![i]!;
        for (let q = 0; q < 4; q++) sum[q]! += s4[q]!;
      }
      if (sum[3] === 0) return;
      const o = oklab([sum[0]! / sum[3]!, sum[1]! / sum[3]!, sum[2]! / sum[3]!]);
      whole += n.views[Math.floor(i / frames.length)]!.weight * sum[3]! * ((o[0] - m[0]) ** 2 + 2 * ((o[1] - m[1]) ** 2 + (o[2] - m[2]) ** 2));
    });
    // The whole stone's look counts as much again as its faces' own.
    e += 2 * whole;
    if (e < least) [least, best] = [e, [...pick]];
  }
  const colours = ranked.map((r, fi) => r[best[fi]!]![0]);
  const farLook = looks(n.views, farTris, farSeen, (t) => colours[t]!, frames);
  const meanOf = (ls: number[][]): string => [0, 1, 2].map((k) => (ls.reduce((s, c) => s + c[k]!, 0) / ls.length).toFixed(0)).join(",");

  // How it fits: its outline against the near level's from low round it, from above and on the hillside, its top and its foot.
  const { up } = solid(pts);
  const low = (v: View): boolean => v.ground === LEVEL && v.look[1] > -0.2;
  const hillside = (v: View): boolean => v.ground !== LEVEL;
  const iou = (pick: (v: View) => boolean): number => {
    let [s, w] = [0, 0];
    n.views.forEach((v, i) => {
      if (!pick(v)) return;
      cover(v, seenIn(faces, pts, v), scratch);
      let [both, either] = [0, 0];
      for (let k = 0; k < scratch.length; k++) {
        both += n.masks[i]![k]! & scratch[k]!;
        either += n.masks[i]![k]! | scratch[k]!;
      }
      s += both / either;
      w++;
    });
    return s / w;
  };
  const area = (pick: (v: View) => boolean): number => {
    let [a, b] = [0, 0];
    n.views.forEach((v, i) => {
      if (!pick(v)) return;
      cover(v, seenIn(faces, pts, v), scratch);
      for (let k = 0; k < scratch.length; k++) [a, b] = [a + scratch[k]!, b + n.masks[i]![k]!];
    });
    return a / b;
  };
  const top = Math.max(...up.flat().map((p) => p[1]));
  const lowest = Math.min(...pts.map((p) => p[1]));
  const air = Math.max(...n.feet.map((p) => outside(pts, faces, p)));
  const fact = {
    triangles: faces.length,
    outline: { low: +iou(low).toFixed(3), above: +iou((v) => v.look[1] < -0.9).toFixed(3), slope: +iou(hillside).toFixed(3), all: +iou(() => true).toFixed(3) },
    pixels: { low: +area(low).toFixed(3), slope: +area(hillside).toFixed(3), all: +area(() => true).toFixed(3) },
    top: [+top.toFixed(2), +n.top.toFixed(2)],
    lowest: +lowest.toFixed(2),
    footAir: +air.toFixed(3),
    look: { near: meanOf(nearLook), far: meanOf(farLook) },
  };
  const json = {
    positions: pts.map((p) => p.map((v) => +v.toFixed(4))),
    faces: faces.map((f, i) => [...f.idx, [palette[colours[i]! * 4]!, palette[colours[i]! * 4 + 1]!, palette[colours[i]! * 4 + 2]!].map((v) => v.toString(16).padStart(2, "0")).join("")]),
    fit: fact,
  };
  writeFileSync(join(HERE, "mesh", `${name}_far.json`), `${JSON.stringify(json)}\n`);
  console.log(`${name}: ${JSON.stringify(fact)} in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
}
