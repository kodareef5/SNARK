// Measures how building pieces meet at a junction: pixels that show through, pixels of an unfilled outside corner, and
// faces of two pieces lying in one plane. The picture is the scene's own frame, drawn by the software rasterizer.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { BUILDING_CONTENT } from "../../content/building.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { SOURCE } from "../art/source.ts";
import { grayboxMeshes, withArt } from "../pack/build.ts";
import { buildPack, unpackMeshes, type SourceMesh } from "../pack/write.ts";
import { PICK_SKY, PICK_STRUCTURE, Rasterizer } from "../snap/raster.ts";
import type { Junction, Placed, Prism } from "./layout.ts";

/** A ray shows through when it leaves a wall's middle sheet and goes on this far with nothing in its way. */
export const THROUGH = 0.1;
/** An outside corner is unfilled where a ray gets this far inside the faces a square joint would have. */
export const NOTCH = 0.03;
/** Two faces fight where they look the same way, lie within this of each other where they overlap and share more than `FIGHT_AREA`. */
export const COPLANAR = 0.0005;
export const FIGHT_AREA = 1e-4;
/** The cosine of two degrees: faces turned less than that from each other look the same way. A hewn face strays under one. */
const PARALLEL = 0.9994;
/** The picture's height in pixels, a third as wide: a storey's height and the metre round its vertex, 2 cm a pixel. */
export const SIDE = 192;
const FAR = 6;
const FOV = (35 * Math.PI) / 180;
/** Drawn as low poly draws: flat levels, which is the pieces' shape and costs a tenth of a lit frame. */
const TIER = "lowpoly";
/** Where a junction is looked at from: degrees round it and degrees above level. */
export const VIEWS: readonly (readonly [number, number])[] = [0, 1, 2, 3, 4, 5, 6, 7].flatMap((k) => [[7 + 45 * k, 5], [7 + 45 * k, 50]] as const);

/** The painted tiers' pieces as their packs hold them. Metal's are its recipe's, which needs no pictures (tools/pack/pieces/metal.ts bakeMetal). */
export function tierMeshes(tiers: readonly string[] = ["thatch", "wood", "stone"]): SourceMesh[] {
  return tiers.flatMap((tier) => unpackMeshes(parsePack(new Uint8Array(readFileSync(join(SOURCE, "core/structures", tier, `${tier}.snpk`))))));
}

/** A pack of the content's grey boxes with `art` in place of those of the same ids. */
export function piecesPack(art: readonly SourceMesh[]): Pack {
  return parsePack(buildPack(withArt(grayboxMeshes(BUILDING_CONTENT), art), defaultPalette()));
}

let core: Registry | null = null;
export function registry(): Registry {
  if (core) return core;
  const made = compileContent(CORE_CONTENT);
  if (!made.registry) throw new Error(made.errors.join("\n"));
  return (core = made.registry);
}

/** Where a ray from `o` along `r` is inside the prism, as distances along it, or null where it misses. */
export function through(p: Prism, o: readonly number[], r: readonly number[]): [number, number] | null {
  let [t0, t1] = [0, Infinity];
  const cut = (height: number, slope: number): boolean => {
    // Inside where height + slope t <= 0.
    if (Math.abs(slope) < 1e-12) return height <= 0;
    const t = -height / slope;
    if (slope > 0) t1 = Math.min(t1, t);
    else t0 = Math.max(t0, t);
    return t0 < t1;
  };
  if (!cut(o[1]! - p.y1, r[1]!) || !cut(p.y0 - o[1]!, -r[1]!)) return null;
  let area = 0;
  p.poly.forEach((a, k) => {
    const b = p.poly[(k + 1) % p.poly.length]!;
    area += a[0] * b[1] - a[1] * b[0];
  });
  const turn = area > 0 ? 1 : -1;
  for (let k = 0; k < p.poly.length; k++) {
    const a = p.poly[k]!, b = p.poly[(k + 1) % p.poly.length]!;
    const [nx, nz] = [(b[1] - a[1]) * turn, -(b[0] - a[0]) * turn];
    if (!cut(nx * (o[0]! - a[0]) + nz * (o[2]! - a[1]), nx * r[0]! + nz * r[2]!)) return null;
  }
  return [t0, t1];
}

/** `p` with every side but those that pass through its first corner moved in by `by`. */
function shrunk(p: Prism, by: number): Prism {
  const n = p.poly.length;
  let area = 0;
  p.poly.forEach((a, k) => {
    const b = p.poly[(k + 1) % n]!;
    area += a[0] * b[1] - a[1] * b[0];
  });
  const turn = area > 0 ? 1 : -1;
  // Each side as a line, moved or not, and each corner again where its two sides now cross.
  const lines = p.poly.map((a, k) => {
    const b = p.poly[(k + 1) % n]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const [nx, nz] = [((b[1] - a[1]) * turn) / l, (-(b[0] - a[0]) * turn) / l];
    const move = k === 0 || k === n - 1 ? 0 : by;
    return { nx, nz, d: nx * a[0] + nz * a[1] - move };
  });
  const poly = p.poly.map((_, k): [number, number] => {
    const [u, v] = [lines[(k + n - 1) % n]!, lines[k]!];
    const det = u.nx * v.nz - u.nz * v.nx;
    return [(u.d * v.nz - v.d * u.nz) / det, (u.nx * v.d - v.nx * u.d) / det];
  });
  return { ...p, poly };
}

export interface Seen {
  /** Pixels where the background shows through a wall's middle near the vertex. */
  leak: number;
  /** Pixels of an outside corner nothing fills. */
  notch: number;
}

/** A flat world holding junctions, and the scene and rasterizer that draw it. */
export class JointBench {
  readonly reg = registry();
  readonly cam = new Camera();
  readonly raster: Rasterizer;
  readonly scene: Scene;
  private readonly forward = [0, 0, 0];
  private readonly ray = [0, 0, 0];

  readonly pack: Pack;

  /** `lay` sets down what `junctions` does not, as pieces with keys where the test needs them. */
  constructor(pack: Pack, junctions: readonly { pieces: readonly Placed[] }[], side = SIDE, lay?: (structs: StructureStore, reg: Registry) => void) {
    this.pack = pack;
    const dims = { chunksX: 8, chunksZ: 8 };
    const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 64);
    hf.heights.fill(32 * 64);
    const structs = new StructureStore(dims, this.reg.halfX, this.reg.halfY, this.reg.halfZ, null, this.reg.parts);
    for (const j of junctions) {
      for (const p of j.pieces) {
        const kind = this.reg.index.get(p.id);
        if (kind === undefined || structs.add(kind, p.x, p.y, p.z, p.yaw, 0, 1000) < 0) throw new Error(`could not place ${p.id}`);
      }
    }
    lay?.(structs, this.reg);
    this.scene = new Scene({ dims, hf, structs }, this.reg, pack);
    this.scene.viewHeight = side;
    // Its users read every chunk's instances after one frame, seen or not.
    this.scene.lazyLayout = false;
    const wide = Math.round(side / 3);
    this.raster = new Rasterizer(wide, side, pack, hf);
    [this.cam.aspect, this.cam.fovY] = [wide / side, FOV];
  }

  /** Draws the junction from `around` degrees round its vertex and `above` degrees up, at levels no finer than `finest`. */
  draw(j: Pick<Junction, "vertex">, look: number, around: number, above: number, finest = 0): void {
    const { cam, scene } = this;
    const [a, e] = [(around * Math.PI) / 180, (above * Math.PI) / 180];
    const out = [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)];
    [cam.x, cam.y, cam.z] = [j.vertex[0] + out[0]! * FAR, look + out[1]! * FAR, j.vertex[1] + out[2]! * FAR];
    [cam.yaw, cam.pitch] = [Math.atan2(-out[0]!, -out[2]!), -e];
    scene.assets.tier = { ...tierOf(TIER), split: 0, finest };
    // A frame to put the chunks on the card, and the one that is drawn.
    this.raster.take(scene.build(cam, null));
    this.raster.render(scene.build(cam, null));
    cam.ray(0.5, 0.5, this.forward);
  }

  /** Metres along the ray through pixel `at` to what was drawn there, and the ray, from the last picture. */
  private reach(at: number): number {
    const { cam, raster, ray, forward } = this;
    cam.ray(((at % raster.width) + 0.5) / raster.width, (Math.floor(at / raster.width) + 0.5) / raster.height, ray);
    if (raster.pickKind[at] === PICK_SKY) return Infinity;
    const a = (cam.far + cam.near) / (cam.near - cam.far), b = (2 * cam.far * cam.near) / (cam.near - cam.far);
    return b / (raster.depth[at]! + a) / (ray[0]! * forward[0]! + ray[1]! * forward[1]! + ray[2]! * forward[2]!);
  }

  /** Counts the last picture's pixels that show through `j` or show its unfilled corner. `mark` is told each, for a picture. */
  count(j: Junction, mark?: (at: number, what: keyof Seen) => void): Seen {
    const seen: Seen = { leak: 0, notch: 0 };
    const eye = [this.cam.x, this.cam.y, this.cam.z];
    const inner = j.mitres.map((m) => shrunk(m, NOTCH));
    for (let at = 0; at < this.raster.pickKind.length; at++) {
      const far = this.reach(at);
      let what: keyof Seen | null = null;
      for (const core of j.cores) {
        const hit = through(core, eye, this.ray);
        if (hit && (far > hit[1] + THROUGH || (this.raster.pickKind[at] !== PICK_STRUCTURE && far > hit[0]))) what = "leak";
      }
      if (!what) for (const m of inner) {
        const hit = through(m, eye, this.ray);
        if (hit && hit[1] - hit[0] > 1e-4 && far > hit[0] + 0.005) what = "notch";
      }
      if (!what) continue;
      seen[what]++;
      mark?.(at, what);
    }
    return seen;
  }

  /** The junction from every view of VIEWS, summed. */
  measure(j: Junction, finest = 0, views = VIEWS): Seen {
    const sum: Seen = { leak: 0, notch: 0 };
    for (const look of j.looks) {
      for (const [around, above] of views) {
        this.draw(j, look, around, above, finest);
        const seen = this.count(j);
        sum.leak += seen.leak;
        sum.notch += seen.notch;
      }
    }
    return sum;
  }
}

/** The level and views a junction is judged at again, as it is drawn from across a yard. */
export const COARSE = 2;
export const COARSE_VIEWS = VIEWS.filter(([, above], k) => above < 10 && k % 4 === 0);

/** What a junction is held to, in this order: leak, notch, both again at COARSE, fighting faces and their square centimetres. */
export const COUNTS = ["leak", "notch", "coarse leak", "coarse notch", "fights", "fight cm2"] as const;

export function countsOf(bench: JointBench, j: Junction, meshes: ReadonlyMap<string, SourceMesh>): number[] {
  const [near, far, fought] = [bench.measure(j), bench.measure(j, COARSE, COARSE_VIEWS), fights(j.pieces, meshes)];
  return [near.leak, near.notch, far.leak, far.notch, fought.faces, fought.area];
}

export type Tri = [number, number, number, number, number, number, number, number, number];

/** A piece's triangles in the world, and the box round them. */
export interface Standing {
  tris: Tri[];
  lo: number[];
  hi: number[];
}

/** A placed piece's finest triangles in the world, each with its normal. */
function worldTriangles(mesh: SourceMesh, p: Placed): Standing {
  const lod = mesh.lods[0]!;
  const yaw = (p.yaw / 65536) * Math.PI * 2, [s, c] = [Math.sin(yaw), Math.cos(yaw)];
  const at = (v: number): [number, number, number] => {
    const [x, y, z] = [lod.positions[v * 3]!, lod.positions[v * 3 + 1]!, lod.positions[v * 3 + 2]!];
    return [p.x + c * x + s * z, p.y + y, p.z - s * x + c * z];
  };
  const tris: Tri[] = [];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < lod.indices.length; t += 3) {
    const tri = [...at(lod.indices[t]!), ...at(lod.indices[t + 1]!), ...at(lod.indices[t + 2]!)] as Tri;
    tris.push(tri);
    for (let k = 0; k < 9; k++) {
      lo[k % 3] = Math.min(lo[k % 3]!, tri[k]!);
      hi[k % 3] = Math.max(hi[k % 3]!, tri[k]!);
    }
  }
  return { tris, lo, hi };
}

/** What two triangles laid in one plane share, as a polygon in that plane, or null. */
function shared(a: number[], b: number[]): number[] | null {
  let poly = area(a) < 0 ? [a[4]!, a[5]!, a[2]!, a[3]!, a[0]!, a[1]!] : a;
  const clip = area(b) < 0 ? [b[4]!, b[5]!, b[2]!, b[3]!, b[0]!, b[1]!] : b;
  for (let e = 0; e < 6 && poly.length >= 6; e += 2) {
    const [ax, ay, bx, by] = [clip[e]!, clip[e + 1]!, clip[(e + 2) % 6]!, clip[(e + 3) % 6]!];
    poly = kept(poly, (x, y) => (bx - ax) * (y - ay) - (by - ay) * (x - ax));
  }
  return poly.length >= 6 ? poly : null;
}

/** A polygon's area, signed by the way it goes round. */
function area(q: number[]): number {
  let sum = 0;
  for (let i = 0; i < q.length; i += 2) sum += q[i]! * q[(i + 3) % q.length]! - q[(i + 2) % q.length]! * q[i + 1]!;
  return sum / 2;
}

/** The part of a convex polygon where `side`, which is linear, is not below 0. */
function kept(poly: number[], side: (x: number, y: number) => number): number[] {
  const out: number[] = [];
  for (let i = 0; i < poly.length; i += 2) {
    const [px, py, qx, qy] = [poly[i]!, poly[i + 1]!, poly[(i + 2) % poly.length]!, poly[(i + 3) % poly.length]!];
    const [sp, sq] = [side(px, py), side(qx, qy)];
    if (sp >= 0) out.push(px, py);
    if ((sp > 0 && sq < 0) || (sp < 0 && sq > 0)) out.push(px + ((qx - px) * sp) / (sp - sq), py + ((qy - py) * sp) / (sp - sq));
  }
  return out;
}

/** How many closed solids of `tris` hold the point: the faces a ray from it leaves by, less those it enters by. */
function holding(tris: readonly Tri[], o: readonly number[], d: readonly number[]): number {
  let inside = 0;
  for (const t of tris) {
    const [e1x, e1y, e1z, e2x, e2y, e2z] = [t[3] - t[0], t[4] - t[1], t[5] - t[2], t[6] - t[0], t[7] - t[1], t[8] - t[2]];
    const [px, py, pz] = [d[1]! * e2z - d[2]! * e2y, d[2]! * e2x - d[0]! * e2z, d[0]! * e2y - d[1]! * e2x];
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-14) continue;
    const [sx, sy, sz] = [o[0]! - t[0], o[1]! - t[1], o[2]! - t[2]];
    const u = (sx * px + sy * py + sz * pz) / det;
    if (u < 0 || u > 1) continue;
    const [qx, qy, qz] = [sy * e1z - sz * e1y, sz * e1x - sx * e1z, sx * e1y - sy * e1x];
    const v = (d[0]! * qx + d[1]! * qy + d[2]! * qz) / det;
    if (v < 0 || u + v > 1 || (e2x * qx + e2y * qy + e2z * qz) / det <= 0) continue;
    // det is the ray against the face's normal: above 0 it meets the face from behind, leaving a solid.
    inside += det < 0 ? -1 : 1;
  }
  return -inside;
}

/** Metres along the ray from `o` along `d` to its first crossing of `t`, from either side, or Infinity. */
function crossing(t: Tri, o: readonly number[], d: readonly number[]): number {
  const [e1x, e1y, e1z, e2x, e2y, e2z] = [t[3] - t[0], t[4] - t[1], t[5] - t[2], t[6] - t[0], t[7] - t[1], t[8] - t[2]];
  const [px, py, pz] = [d[1]! * e2z - d[2]! * e2y, d[2]! * e2x - d[0]! * e2z, d[0]! * e2y - d[1]! * e2x];
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-14) return Infinity;
  const [sx, sy, sz] = [o[0]! - t[0], o[1]! - t[1], o[2]! - t[2]];
  const u = (sx * px + sy * py + sz * pz) / det;
  if (u < 0 || u > 1) return Infinity;
  const [qx, qy, qz] = [sy * e1z - sz * e1y, sz * e1x - sx * e1z, sx * e1y - sy * e1x];
  const v = (d[0]! * qx + d[1]! * qy + d[2]! * qz) / det;
  if (v < 0 || u + v > 1) return Infinity;
  const far = (e2x * qx + e2y * qy + e2z * qz) / det;
  return far > 0 ? far : Infinity;
}

/**
 * How many lines of sight from above first meet one of `front` at a point that has one of `under` straight below it: a
 * joint seen standing out of a roof's top. The lines come down on a grid `step` apart within `reach` of (x, z), straight
 * and leaning a third of a right angle each of four ways. A joint seen beside a roof, clear of its outline, is not counted.
 */
export function showsOver(front: readonly Standing[], under: readonly Standing[], x: number, z: number, reach = 0.5, step = 0.02): number {
  if (front.length === 0 || under.length === 0) return 0;
  const top = Math.max(...front.map((p) => p.hi[1]!), ...under.map((p) => p.hi[1]!)) + 1;
  const near = (p: Standing): Tri[] => p.tris.filter((t) => Math.min(t[0], t[3], t[6]) < x + reach + 3 && Math.max(t[0], t[3], t[6]) > x - reach - 3 && Math.min(t[2], t[5], t[8]) < z + reach + 3 && Math.max(t[2], t[5], t[8]) > z - reach - 3);
  const [fronts, unders, all] = [front.flatMap(near), under.flatMap(near), [...front, ...under].flatMap(near)];
  const lean = Math.tan(Math.PI / 6), down = [0, -1, 0];
  // Aimed at the grid's point at the joints' own height, so a leaning line still comes down by the corner.
  const drop = top - Math.max(...front.map((p) => p.hi[1]!));
  let seen = 0;
  for (const [lx, lz] of [[0, 0], [lean, 0], [-lean, 0], [0, lean], [0, -lean]] as const) {
    const d = [lx, -1, lz];
    // Half a step off the corner's own lines, so no line of sight lies in the plane of a piece's side.
    for (let gx = x - reach + step / 2; gx < x + reach; gx += step) {
      for (let gz = z - reach + step / 2; gz < z + reach; gz += step) {
        const o = [gx - lx * drop, top, gz - lz * drop];
        let first = Infinity, any = Infinity;
        for (const t of fronts) first = Math.min(first, crossing(t, o, d));
        if (first === Infinity) continue;
        for (const t of all) any = Math.min(any, crossing(t, o, d));
        if (any < first - 1e-6) continue;
        const at = [o[0]! + d[0]! * first, o[1]! + d[1]! * first, o[2]! + d[2]! * first];
        if (unders.some((t) => crossing(t, at, down) !== Infinity)) seen++;
      }
    }
  }
  return seen;
}

export interface Fights {
  /** Pairs of pieces and the ways their faces look in which they share more than FIGHT_AREA. */
  faces: number;
  /** All that they share, in square centimetres. */
  area: number;
}

/**
 * Faces of different pieces of `placed` that look the same way from one plane, with air in front of them: what a card
 * cannot order. Faces buried in another solid or in the ground are not counted, as wood's strips inside the next wall's end.
 */
export function fights(placed: readonly Placed[], meshes: ReadonlyMap<string, SourceMesh>, ground = 0, tell?: (group: string, area: number, at: number[]) => void): Fights {
  return fightsOf(placed.map((p) => worldTriangles(meshes.get(p.id)!, p)), ground, tell);
}

/** The same of pieces given as they stand, however they were placed: as drawn, with their trims. */
export function fightsOf(pieces: readonly Standing[], ground = 0, tell?: (group: string, area: number, at: number[]) => void): Fights {
  const groups = new Map<string, number>();
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const [a, b] = [pieces[i]!, pieces[j]!];
      const lo = [0, 1, 2].map((k) => Math.max(a.lo[k]!, b.lo[k]!) - COPLANAR), hi = [0, 1, 2].map((k) => Math.min(a.hi[k]!, b.hi[k]!) + COPLANAR);
      if (lo.some((v, k) => v > hi[k]!)) continue;
      const near = (t: Tri): boolean => [0, 1, 2].every((k) => Math.min(t[k]!, t[k + 3]!, t[k + 6]!) <= hi[k]! && Math.max(t[k]!, t[k + 3]!, t[k + 6]!) >= lo[k]!);
      const faced = (list: Tri[]) => list.filter(near).flatMap((t) => {
        const [ux, uy, uz, vx, vy, vz] = [t[3] - t[0], t[4] - t[1], t[5] - t[2], t[6] - t[0], t[7] - t[1], t[8] - t[2]];
        const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx], l = Math.hypot(n[0]!, n[1]!, n[2]!);
        return l < 1e-10 ? [] : [{ t, n: n.map((v) => v / l) }];
      });
      const [fa, fb] = [faced(a.tris), faced(b.tris)];
      for (const p of fa) {
        // The plane's own axes, to lay both triangles flat.
        const axis = Math.abs(p.n[0]!) < 0.7 ? [1, 0, 0] : [0, 1, 0];
        const u = [p.n[1]! * axis[2]! - p.n[2]! * axis[1]!, p.n[2]! * axis[0]! - p.n[0]! * axis[2]!, p.n[0]! * axis[1]! - p.n[1]! * axis[0]!];
        const ul = Math.hypot(u[0]!, u[1]!, u[2]!);
        for (let k = 0; k < 3; k++) u[k]! /= ul;
        const v = [p.n[1]! * u[2]! - p.n[2]! * u[1]!, p.n[2]! * u[0]! - p.n[0]! * u[2]!, p.n[0]! * u[1]! - p.n[1]! * u[0]!];
        const flat = (t: Tri): number[] => [0, 3, 6].flatMap((k) => [t[k]! * u[0]! + t[k + 1]! * u[1]! + t[k + 2]! * u[2]!, t[k]! * v[0]! + t[k + 1]! * v[1]! + t[k + 2]! * v[2]!]);
        const height = p.t[0] * p.n[0]! + p.t[1] * p.n[1]! + p.t[2] * p.n[2]!;
        const mine = flat(p.t);
        for (const q of fb) {
          if (p.n[0]! * q.n[0]! + p.n[1]! * q.n[1]! + p.n[2]! * q.n[2]! < PARALLEL) continue;
          // A face wholly to one side of this one's plane, further off than COPLANAR, is nowhere within it.
          const off = [0, 3, 6].map((k) => q.t[k]! * p.n[0]! + q.t[k + 1]! * p.n[1]! + q.t[k + 2]! * p.n[2]! - height);
          if (off.every((d) => d > COPLANAR) || off.every((d) => d < -COPLANAR)) continue;
          const over = shared(mine, flat(q.t));
          if (!over) continue;
          // Of what they share, the part where the two lie within COPLANAR of each other: the gap between two planes is linear.
          const gap = (x: number, y: number): number => [0, 1, 2].reduce((sum, k) => sum + (u[k]! * x + v[k]! * y + p.n[k]! * height - q.t[k]!) * q.n[k]!, 0);
          const close = kept(kept(over, (x, y) => COPLANAR - gap(x, y)), (x, y) => COPLANAR + gap(x, y));
          const both = close.length >= 6 ? Math.abs(area(close)) : 0;
          if (both < 1e-7) continue;
          const mid = [0, 0];
          for (let k = 0; k < close.length; k++) mid[k % 2]! += (close[k]! / close.length) * 2;
          // The share of it with air in front: its middle and halfway to each corner, two millimetres off, along a ray no face is likely to lie along.
          const spots = [mid, ...Array.from({ length: close.length / 2 }, (_, k) => [(close[k * 2]! + mid[0]!) / 2, (close[k * 2 + 1]! + mid[1]!) / 2])];
          const along = [p.n[0]! + 0.0137, p.n[1]! + 0.0291, p.n[2]! + 0.0173];
          let open = 0;
          let at: number[] = [];
          for (const spot of spots) {
            const from = [0, 1, 2].map((k) => u[k]! * spot[0]! + v[k]! * spot[1]! + p.n[k]! * (height + 0.002));
            // Only a piece whose box holds the point can hold it in a solid.
            if (from[1]! < ground || pieces.reduce((sum, piece) => sum + (from.every((c, k) => c >= piece.lo[k]! && c <= piece.hi[k]!) ? holding(piece.tris, from, along) : 0), 0) > 0) continue;
            open++;
            at = from;
          }
          if (open === 0) continue;
          const seen = (both * open) / spots.length;
          const key = `${i},${j},${p.n.map((c) => Math.round(c * 10)).join()}`;
          groups.set(key, (groups.get(key) ?? 0) + seen);
          tell?.(key, seen, at);
        }
      }
    }
  }
  const over = [...groups.values()].filter((a) => a > FIGHT_AREA);
  return { faces: over.length, area: Math.round(over.reduce((sum, a) => sum + a, 0) * 1e4) };
}
