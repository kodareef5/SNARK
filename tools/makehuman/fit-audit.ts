// Measures how a fitted MakeHuman body (fit.ts) and today's bodies agree with the hit capsules, and draws them.
// `bun tools/makehuman/fit-audit.ts [--out var/fit] [--no-posed]` prints the tables and writes PNG sheets.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { authoredClips } from "../../shared/anim/authored.ts";
import { Pose } from "../../shared/anim/clip.ts";
import { HUMAN, HUMAN_BONES, HUMAN_ZONE_COUNT, ZONE_HEAD, ZONE_NAMES } from "../../shared/anim/human.ts";
import { AnimState, HumanAnim } from "../../shared/anim/pose.ts";
import { Solved, rayZones, solve } from "../../shared/anim/skeleton.ts";
import { humanHitPose, zoneOfBone } from "../../shared/anim/zones.ts";
import { quatRotate } from "../../shared/math/quat.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { STANCE_CROUCH, STANCE_PRONE } from "../../shared/sim/character.ts";
import { RIGS } from "../../assets/source/core/humans/human-bodies/rigs.ts";
import { buildPack, unpackMeshes } from "../pack/write.ts";
import { encodePng } from "../snap/png.ts";
import { fitBody, MATERIAL_BROWS, MATERIAL_EYES, MATERIAL_MOUTH, type FittedBody } from "./fit.ts";

/** A body to measure: positions at rest on its rig, triangles, and up to four bones a vertex. */
export interface AuditBody {
  name: string;
  rest: readonly number[];
  positions: Float32Array;
  indices: Uint32Array;
  joints: Uint8Array;
  weights: Float32Array;
  /** The bone a triangle is picked by: its last corner's heaviest, as the software rasterizer picks. */
  triBone: Uint8Array;
  /** Shade a triangle: 0 skin, 1 eyes, 2 hair cards, 3 mouth. */
  triKind: Uint8Array;
}

export function fittedAudit(f: FittedBody): AuditBody {
  const tris = f.indices.length / 3;
  return {
    name: `new ${f.sex}`,
    rest: [...f.rest],
    positions: f.positions,
    indices: f.indices,
    joints: f.joints,
    weights: f.weights,
    triBone: Uint8Array.from({ length: tris }, (_, t) => f.bone[f.indices[t * 3 + 2]!]!),
    triKind: f.material.slice(),
  };
}

/** Today's body of `sex` (0 male, 1 female) from the human-bodies pack: its five slot meshes at level 0, one bone a vertex. */
export function todayAudit(sex: number, file = "assets/source/core/humans/human-bodies/human-bodies.snpk"): AuditBody {
  const pack = parsePack(new Uint8Array(readFileSync(file)));
  const id = sex === 0 ? "core:human_m" : "core:human_f";
  const parts = unpackMeshes(pack).filter((m) => ["head", "torso", "hands", "legs", "feet"].some((slot) => m.id === `${id}/${slot}`));
  const pos: number[] = [];
  const idx: number[] = [];
  const bones: number[] = [];
  for (const m of parts) {
    const l = m.lods[0]!;
    const base = pos.length / 3;
    pos.push(...l.positions);
    bones.push(...l.bones!);
    for (const i of l.indices) idx.push(base + i);
  }
  const n = pos.length / 3;
  const joints = new Uint8Array(n * 4);
  const weights = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    joints.fill(bones[v]!, v * 4, v * 4 + 4);
    weights[v * 4] = 1;
  }
  const indices = Uint32Array.from(idx);
  return {
    name: `today ${sex === 0 ? "male" : "female"}`,
    rest: RIGS[sex]!,
    positions: Float32Array.from(pos),
    indices,
    joints,
    weights,
    triBone: Uint8Array.from({ length: indices.length / 3 }, (_, t) => bones[indices[t * 3 + 2]!]!),
    triKind: new Uint8Array(indices.length / 3),
  };
}

// ---- Capsules -----------------------------------------------------------------------------------------------------

interface Capsule {
  bone: number;
  zone: number;
  a: [number, number, number];
  b: [number, number, number];
  r: number;
}

/** The hit capsules at rest, where the server takes hits for either sex. */
export const CAPSULES: readonly Capsule[] = Array.from({ length: HUMAN.zoneBones }, (_, b) => b)
  .filter((b) => HUMAN.zone[b]! > 0)
  .map((b) => ({
    bone: b,
    zone: HUMAN.zone[b]!,
    a: [0, 1, 2].map((k) => HUMAN.rest[b * 3 + k]! + HUMAN.capA[b * 3 + k]!) as [number, number, number],
    b: [0, 1, 2].map((k) => HUMAN.rest[b * 3 + k]! + HUMAN.capB[b * 3 + k]!) as [number, number, number],
    r: HUMAN.capR[b]!,
  }));

/** Distance from a point to a capsule's surface: negative inside. */
function capsuleDistance(c: Capsule, x: number, y: number, z: number): number {
  const sx = c.b[0] - c.a[0], sy = c.b[1] - c.a[1], sz = c.b[2] - c.a[2];
  const l2 = sx * sx + sy * sy + sz * sz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - c.a[0]) * sx + (y - c.a[1]) * sy + (z - c.a[2]) * sz) / l2)) : 0;
  return Math.hypot(x - c.a[0] - t * sx, y - c.a[1] - t * sy, z - c.a[2] - t * sz) - c.r;
}

// ---- 3D surface ---------------------------------------------------------------------------------------------------

export interface SurfaceRow {
  zone: string;
  /** Square metres of the zone's surface, and the shares inside its own zone's capsules and outside every capsule. */
  area: number;
  inOwn: number;
  outside: number;
  /** Millimetres past the own zone's capsules, at the 95th percentile and at most, over the area outside them. */
  p95: number;
  most: number;
  /** Share of the zone's capsule surface with the body on it or over it (within 15 mm outside). */
  covered: number;
}

/** Area-weighted, at each triangle's middle, for the body at rest. Hair cards, eyes and the mouth are skipped. */
export function surfaceRows(body: AuditBody): SurfaceRow[] {
  const P = body.positions;
  const rows: { area: number; own: number; out: number; past: [number, number][] }[] = Array.from({ length: HUMAN_ZONE_COUNT }, () => ({ area: 0, own: 0, out: 0, past: [] }));
  for (let t = 0; t < body.indices.length / 3; t++) {
    if (body.triKind[t] !== 0) continue;
    const a = body.indices[t * 3]! * 3, b = body.indices[t * 3 + 1]! * 3, c = body.indices[t * 3 + 2]! * 3;
    const ux = P[b]! - P[a]!, uy = P[b + 1]! - P[a + 1]!, uz = P[b + 2]! - P[a + 2]!;
    const vx = P[c]! - P[a]!, vy = P[c + 1]! - P[a + 1]!, vz = P[c + 2]! - P[a + 2]!;
    const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    const x = (P[a]! + P[b]! + P[c]!) / 3, y = (P[a + 1]! + P[b + 1]! + P[c + 1]!) / 3, z = (P[a + 2]! + P[b + 2]! + P[c + 2]!) / 3;
    const zone = zoneOfBone(body.triBone[t]!);
    let own = Infinity;
    let any = Infinity;
    for (const cap of CAPSULES) {
      const d = capsuleDistance(cap, x, y, z);
      any = Math.min(any, d);
      if (cap.zone === zone) own = Math.min(own, d);
    }
    const row = rows[zone]!;
    row.area += area;
    if (own <= 0) row.own += area;
    else row.past.push([own, area]);
    if (any > 0) row.out += area;
  }
  const grid = vertexGrid(body);
  return rows.map((row, zone) => {
    row.past.sort((p, q) => p[0] - q[0]);
    let acc = 0;
    let p95 = 0;
    const outsideArea = row.area - row.own;
    for (const [d, a] of row.past) {
      acc += a;
      if (acc >= outsideArea * 0.95) {
        p95 = d;
        break;
      }
    }
    return {
      zone: ZONE_NAMES[zone]!,
      area: row.area,
      inOwn: row.area > 0 ? row.own / row.area : 0,
      outside: row.area > 0 ? row.out / row.area : 0,
      p95: p95 * 1000,
      most: (row.past.length > 0 ? row.past[row.past.length - 1]![0] : 0) * 1000,
      covered: zone === 0 ? 0 : coverage(body, grid, zone),
    };
  }).slice(1);
}

interface Grid {
  cell: number;
  map: Map<string, number[]>;
  normals: Float32Array;
}

function vertexGrid(body: AuditBody): Grid {
  const cell = 0.02;
  const map = new Map<string, number[]>();
  const P = body.positions;
  const normals = new Float32Array(P.length);
  for (let t = 0; t < body.indices.length / 3; t++) {
    if (body.triKind[t] !== 0) continue;
    const ids = [body.indices[t * 3]!, body.indices[t * 3 + 1]!, body.indices[t * 3 + 2]!];
    const [a, b, c] = ids.map((i) => i * 3) as [number, number, number];
    const ux = P[b]! - P[a]!, uy = P[b + 1]! - P[a + 1]!, uz = P[b + 2]! - P[a + 2]!;
    const vx = P[c]! - P[a]!, vy = P[c + 1]! - P[a + 1]!, vz = P[c + 2]! - P[a + 2]!;
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    for (const i of ids) for (let k = 0; k < 3; k++) normals[i * 3 + k]! += n[k]!;
    for (const i of ids) {
      const key = `${Math.floor(P[i * 3]! / cell)},${Math.floor(P[i * 3 + 1]! / cell)},${Math.floor(P[i * 3 + 2]! / cell)}`;
      const list = map.get(key);
      if (list) {
        if (list[list.length - 1] !== i) list.push(i);
      } else map.set(key, [i]);
    }
  }
  return { cell, map, normals };
}

/** Samples a zone's capsules about every 5 mm: covered where the nearest body vertex lies over it or within 15 mm. */
function coverage(body: AuditBody, grid: Grid, zone: number): number {
  let all = 0;
  let covered = 0;
  const P = body.positions;
  for (const cap of CAPSULES) {
    if (cap.zone !== zone) continue;
    const ax = [cap.b[0] - cap.a[0], cap.b[1] - cap.a[1], cap.b[2] - cap.a[2]];
    const len = Math.hypot(ax[0]!, ax[1]!, ax[2]!);
    const dir = len > 0 ? ax.map((c) => c / len) : [0, 1, 0];
    const helper = Math.abs(dir[1]!) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const e1 = cross(dir, helper), e1l = Math.hypot(...e1);
    const u = e1.map((c) => c / e1l);
    const w = cross(dir, u);
    const step = 0.005;
    const around = Math.max(12, Math.ceil((2 * Math.PI * cap.r) / step));
    const points: number[][] = [];
    for (let s = 0; s <= Math.ceil(len / step); s++) {
      const t = len > 0 ? Math.min(len, s * step) : 0;
      for (let k = 0; k < around; k++) {
        const ang = (2 * Math.PI * k) / around;
        points.push([0, 1, 2].map((i) => cap.a[i]! + dir[i]! * t + cap.r * (Math.cos(ang) * u[i]! + Math.sin(ang) * w[i]!)));
      }
    }
    // The two end caps, as rings of latitude.
    for (const [end, sign] of [[cap.a, -1], [cap.b, 1]] as const) {
      for (let lat = 1; lat <= Math.ceil((Math.PI / 2) * cap.r / step); lat++) {
        const phi = (lat * step) / cap.r;
        if (phi > Math.PI / 2) break;
        const ring = Math.max(6, Math.ceil((2 * Math.PI * cap.r * Math.cos(phi)) / step));
        for (let k = 0; k < ring; k++) {
          const ang = (2 * Math.PI * k) / ring;
          points.push([0, 1, 2].map((i) => end[i]! + sign * dir[i]! * cap.r * Math.sin(phi) + cap.r * Math.cos(phi) * (Math.cos(ang) * u[i]! + Math.sin(ang) * w[i]!)));
        }
      }
    }
    for (const p of points) {
      // Points inside another capsule of the same zone are not on the zone's outer surface.
      if (CAPSULES.some((o) => o !== cap && o.zone === zone && capsuleDistance(o, p[0]!, p[1]!, p[2]!) < -1e-4)) continue;
      all++;
      let best = Infinity;
      let at = -1;
      const cx = Math.floor(p[0]! / grid.cell), cy = Math.floor(p[1]! / grid.cell), cz = Math.floor(p[2]! / grid.cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        for (const i of grid.map.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
          const d = Math.hypot(P[i * 3]! - p[0]!, P[i * 3 + 1]! - p[1]!, P[i * 3 + 2]! - p[2]!);
          if (d < best) {
            best = d;
            at = i;
          }
        }
      }
      if (at < 0) continue;
      const over = (p[0]! - P[at * 3]!) * grid.normals[at * 3]! + (p[1]! - P[at * 3 + 1]!) * grid.normals[at * 3 + 1]! + (p[2]! - P[at * 3 + 2]!) * grid.normals[at * 3 + 2]!;
      if (over < 0 || best < 0.015) covered++;
    }
  }
  return all > 0 ? covered / all : 0;
}

const cross = (a: number[], b: number[]): number[] => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];

// ---- A rasterizer -------------------------------------------------------------------------------------------------

/** Where a camera puts a point: x and y in pixels and the depth along the view, or null behind it. */
type Project = (x: number, y: number, z: number) => [number, number, number] | null;

interface Frame {
  width: number;
  height: number;
  depth: Float64Array;
  tri: Int32Array;
}

function rasterize(width: number, height: number, positions: ArrayLike<number>, indices: Uint32Array, project: Project): Frame {
  const depth = new Float64Array(width * height).fill(Infinity);
  const tri = new Int32Array(width * height).fill(-1);
  const n = positions.length / 3;
  const sx = new Float64Array(n), sy = new Float64Array(n), sz = new Float64Array(n);
  const ok = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    const p = project(positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!);
    if (!p) continue;
    ok[v] = 1;
    sx[v] = p[0];
    sy[v] = p[1];
    sz[v] = p[2];
  }
  for (let t = 0; t < indices.length / 3; t++) {
    const a = indices[t * 3]!, b = indices[t * 3 + 1]!, c = indices[t * 3 + 2]!;
    if (!ok[a] || !ok[b] || !ok[c]) continue;
    const area = (sx[b]! - sx[a]!) * (sy[c]! - sy[a]!) - (sx[c]! - sx[a]!) * (sy[b]! - sy[a]!);
    if (area === 0) continue;
    const x0 = Math.max(0, Math.floor(Math.min(sx[a]!, sx[b]!, sx[c]!))), x1 = Math.min(width - 1, Math.ceil(Math.max(sx[a]!, sx[b]!, sx[c]!)));
    const y0 = Math.max(0, Math.floor(Math.min(sy[a]!, sy[b]!, sy[c]!))), y1 = Math.min(height - 1, Math.ceil(Math.max(sy[a]!, sy[b]!, sy[c]!)));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((sx[b]! - px) * (sy[c]! - py) - (sx[c]! - px) * (sy[b]! - py)) / area;
        const w1 = ((sx[c]! - px) * (sy[a]! - py) - (sx[a]! - px) * (sy[c]! - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        // Depth as its reciprocal, which is linear on the screen.
        const z = 1 / (w0 / sz[a]! + w1 / sz[b]! + w2 / sz[c]!);
        const at = y * width + x;
        if (z < depth[at]!) {
          depth[at] = z;
          tri[at] = t;
        }
      }
    }
  }
  return { width, height, depth, tri };
}

/** A camera looking along `forward` from `from`, its up near +Y, with `perspective` the tangent of half its view or 0 for a view `span` metres tall. */
function camera(from: number[], forward: number[], size: number, opts: { tanHalf?: number; span?: number; centre?: number[] }): { project: Project; ray: (px: number, py: number) => { o: number[]; d: number[] } } {
  const f = norm(forward);
  const r = norm(Math.abs(f[1]!) > 0.99 ? cross(f, [0, 0, -1]) : cross(f, [0, 1, 0]));
  const u = cross(r, f);
  if (opts.tanHalf) {
    const t = opts.tanHalf;
    return {
      project: (x, y, z) => {
        const d = [x - from[0]!, y - from[1]!, z - from[2]!];
        const zf = dot(d, f);
        if (zf <= 0.05) return null;
        return [((dot(d, r) / (zf * t) + 1) / 2) * size, ((1 - dot(d, u) / (zf * t)) / 2) * size, zf];
      },
      ray: (px, py) => {
        const rx = ((px + 0.5) / size) * 2 - 1, ry = 1 - ((py + 0.5) / size) * 2;
        return { o: from, d: norm([0, 1, 2].map((k) => f[k]! + r[k]! * rx * t + u[k]! * ry * t)) };
      },
    };
  }
  const span = opts.span!, c = opts.centre!;
  const scale = size / span;
  return {
    project: (x, y, z) => {
      const d = [x - c[0]!, y - c[1]!, z - c[2]!];
      return [size / 2 + dot(d, r) * scale, size / 2 - dot(d, u) * scale, dot(d, f) + 10];
    },
    ray: (px, py) => {
      const rx = (px + 0.5 - size / 2) / scale, ry = (size / 2 - py - 0.5) / scale;
      return { o: [0, 1, 2].map((k) => c[k]! + r[k]! * rx + u[k]! * ry - f[k]! * 10), d: f };
    },
  };
}

const dot = (a: number[], b: number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const norm = (a: number[]): number[] => {
  const l = Math.hypot(a[0]!, a[1]!, a[2]!);
  return [a[0]! / l, a[1]! / l, a[2]! / l];
};

// ---- Drawn against hit --------------------------------------------------------------------------------------------

export interface AimCount {
  drawn: Uint32Array;
  agreed: Uint32Array;
  missed: number;
  phantom: number;
  /** Spill by the zone the ray hits. */
  spilt: Uint32Array;
  /** Pixels by drawn zone times HUMAN_ZONE_COUNT plus the zone hit. */
  confused: Uint32Array;
}

const emptyCount = (): AimCount => ({ drawn: new Uint32Array(HUMAN_ZONE_COUNT), agreed: new Uint32Array(HUMAN_ZONE_COUNT), missed: 0, phantom: 0, spilt: new Uint32Array(HUMAN_ZONE_COUNT), confused: new Uint32Array(HUMAN_ZONE_COUNT * HUMAN_ZONE_COUNT) });

export function shares(c: AimCount): { head: number; body: number; missed: number; spill: number; zones: number[]; spills: number[] } {
  let all = 0;
  let agreed = 0;
  const zones: number[] = [];
  for (let z = 1; z < HUMAN_ZONE_COUNT; z++) {
    all += c.drawn[z]!;
    agreed += c.agreed[z]!;
    zones.push(c.drawn[z]! > 0 ? c.agreed[z]! / c.drawn[z]! : NaN);
  }
  const spills = Array.from({ length: HUMAN_ZONE_COUNT - 1 }, (_, i) => c.spilt[i + 1]! / all);
  return { head: c.agreed[ZONE_HEAD]! / c.drawn[ZONE_HEAD]!, body: agreed / all, missed: c.missed / all, spill: c.phantom / all, zones, spills };
}

/** Counts one picture: each pixel's drawn zone against the zone a ray through it hits on `hit`. */
function countFrame(body: AuditBody, frame: Frame, ray: (px: number, py: number) => { o: number[]; d: number[] }, hit: Solved, out: AimCount): void {
  for (let py = 0; py < frame.height; py++) {
    for (let px = 0; px < frame.width; px++) {
      const at = py * frame.width + px;
      const { o, d } = ray(px, py);
      const z = rayZones(HUMAN, hit, o[0]!, o[1]!, o[2]!, d[0]!, d[1]!, d[2]!, 50);
      const t = frame.tri[at]!;
      if (t < 0) {
        if (z !== 0) {
          out.phantom++;
          out.spilt[z]!++;
        }
        continue;
      }
      const zone = zoneOfBone(body.triBone[t]!);
      out.drawn[zone]!++;
      out.confused[zone * HUMAN_ZONE_COUNT + z]!++;
      if (z === zone) out.agreed[zone]!++;
      else if (z === 0) out.missed++;
    }
  }
}

const REST_POSE = (): Solved => {
  const s = new Solved(HUMAN_BONES);
  for (let b = 0; b < HUMAN_BONES; b++) s.rot[b * 4 + 3] = 1;
  s.pos.set(HUMAN.rest);
  return s;
};

/** The body at rest seen straight on from the front, back, both sides and above, at 2.5 mm a pixel. */
export function restCount(body: AuditBody): AimCount {
  const out = emptyCount();
  const hit = REST_POSE();
  const size = 720;
  const views: [number[], number[]][] = [[[0, 0, -1], [0, 0.9, 0]], [[0, 0, 1], [0, 0.9, 0]], [[-1, 0, 0], [0, 0.9, 0]], [[1, 0, 0], [0, 0.9, 0]], [[0, -1, 0], [0, 0.9, 0]]];
  for (const [forward, centre] of views) {
    const cam = camera([0, 0, 0], forward, size, { span: 1.8, centre });
    countFrame(body, rasterize(size, size, body.positions, body.indices, cam.project), cam.ray, hit, out);
  }
  return out;
}

/** speed, direction, pitch, mode, stance, grounded: the nine motions of tests/fixtures/aim-audit.ts. */
const STATES: readonly (readonly [number, number, number, number, number, boolean])[] = [
  [0, 0, 0, 1, 0, true], [7, 0, 0, 1, 0, true], [12, 0, 10, 1, 0, true], [7, 5, -12, 1, 0, true], [7, 8, 0, 1, 0, true],
  [0, 0, 0, 1, 0, false], [2, 0, 0, 1, STANCE_CROUCH, true], [1, 0, 8, 1, STANCE_PRONE, true], [4, 0, 14, 2, 0, false],
];
/** The five sides of tests/fixtures/aim-audit.ts: the camera's turn about the body and its rise. */
const SIDES: readonly (readonly [number, number])[] = [[0, 0.1], [1.4, 0.2], [3.3, 0.05], [4.6, 0.9], [0.7, -0.25]];

/** Skins `body` onto `solved`, which was solved on the body's own rest. */
function skin(body: AuditBody, solved: Solved, out: Float64Array): void {
  const P = body.positions, R = body.rest;
  const tmp = [0, 0, 0];
  for (let v = 0; v < P.length / 3; v++) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) {
      const w = body.weights[v * 4 + k]!;
      if (w === 0) continue;
      const b = body.joints[v * 4 + k]!;
      quatRotate(solved.rot, b * 4, P[v * 3]! - R[b * 3]!, P[v * 3 + 1]! - R[b * 3 + 1]!, P[v * 3 + 2]! - R[b * 3 + 2]!, tmp, 0);
      x += w * (tmp[0]! + solved.pos[b * 3]!);
      y += w * (tmp[1]! + solved.pos[b * 3 + 1]!);
      z += w * (tmp[2]! + solved.pos[b * 3 + 2]!);
    }
    out[v * 3] = x;
    out[v * 3 + 1] = y;
    out[v * 3 + 2] = z;
  }
}

/** The posed audit of render-aim, in the body's own space: nine motions from five sides at 128 pixels. */
export function posedCount(body: AuditBody, anim: HumanAnim, size = 128): AimCount {
  const out = emptyCount();
  const st = new AnimState();
  const pose = new Pose(HUMAN_BONES);
  const drawn = new Solved(HUMAN_BONES);
  const hit = new Solved(HUMAN_BONES);
  const at = new Float64Array(body.positions.length);
  const rest = Float32Array.from(body.rest);
  STATES.forEach(([speed, dir, pitch, mode, stance, grounded], s) => {
    st.speed = speed;
    st.dir = dir;
    st.pitch = pitch;
    st.mode = mode;
    st.stance = stance;
    st.grounded = grounded;
    SIDES.forEach(([around, up], v) => {
      const shot = s * SIDES.length + v;
      const tick = shot * 7.3;
      const yawUnits = (shot * 9973) & 0xffc0;
      humanHitPose(anim, st, tick, 0, 0, 0, yawUnits, null, pose);
      solve(HUMAN, pose, hit);
      solve(HUMAN, pose, drawn, rest, null);
      skin(body, drawn, at);
      // The camera of aim-audit.ts, carried into the body's space by undoing its yaw.
      const a = (yawUnits / 65536) * Math.PI * 2, sa = Math.sin(a), ca = Math.cos(a);
      const toBody = (x: number, y: number, z: number): number[] => [ca * x - sa * z, y, sa * x + ca * z];
      const cam = toBody(Math.sin(around) * Math.cos(up) * 4, 0.9 + Math.sin(up) * 4, Math.cos(around) * Math.cos(up) * 4);
      const yaw = around + Math.PI, pt = -up;
      const fwd = toBody(Math.sin(yaw) * Math.cos(pt), Math.sin(pt), Math.cos(yaw) * Math.cos(pt));
      const c = camera(cam, fwd, size, { tanHalf: Math.tan(0.35) });
      countFrame(body, rasterize(size, size, at, body.indices, c.project), c.ray, hit, out);
    });
  });
  return out;
}

export function clipsAnim(file = "assets/source/core/humans/human-clips/human-clips.snpk"): HumanAnim {
  const clips = parsePack(new Uint8Array(readFileSync(file))).clips.clips;
  return new HumanAnim(parsePack(buildPack([], defaultPalette(), [...clips, ...authoredClips()], [])).clips);
}

// ---- Pictures -----------------------------------------------------------------------------------------------------

const ZONE_RGB: readonly (readonly [number, number, number])[] = [
  [120, 120, 120], [230, 80, 80], [80, 140, 230], [240, 170, 50], [240, 120, 200], [120, 220, 120], [60, 200, 200], [170, 110, 240], [210, 210, 90], [150, 90, 60], [90, 160, 110],
];

interface View {
  label: string;
  forward: number[];
  centre: number[];
  span: number;
  /** Only triangles whose middle passes are drawn, so a close view is not hidden behind the rest of the body. */
  keep?: (x: number, y: number, z: number) => boolean;
}

/** Draws `body` at rest, shaded, with the capsules' outlines by zone and the rig's joints as dots. */
function picture(body: AuditBody, view: View, size: number, byZone: boolean): Uint8Array {
  const cam = camera([0, 0, 0], view.forward, size, { span: view.span, centre: view.centre });
  const P = body.positions;
  const keep = view.keep;
  const indices = keep ? Uint32Array.from(Array.from({ length: body.indices.length / 3 }, (_, t) => t).filter((t) => {
    const c = [0, 1, 2].map((k) => (P[body.indices[t * 3]! * 3 + k]! + P[body.indices[t * 3 + 1]! * 3 + k]! + P[body.indices[t * 3 + 2]! * 3 + k]!) / 3);
    return keep(c[0]!, c[1]!, c[2]!);
  }).flatMap((t) => [t * 3, t * 3 + 1, t * 3 + 2].map((i) => body.indices[i]!))) : body.indices;
  // Triangle numbers below index the full list, so a kept triangle maps back to its own.
  const kept = keep ? Array.from({ length: body.indices.length / 3 }, (_, t) => t).filter((t) => {
    const c = [0, 1, 2].map((k) => (P[body.indices[t * 3]! * 3 + k]! + P[body.indices[t * 3 + 1]! * 3 + k]! + P[body.indices[t * 3 + 2]! * 3 + k]!) / 3);
    return keep(c[0]!, c[1]!, c[2]!);
  }) : null;
  const frame = rasterize(size, size, body.positions, indices, cam.project);
  if (kept) for (let i = 0; i < frame.tri.length; i++) if (frame.tri[i]! >= 0) frame.tri[i] = kept[frame.tri[i]!]!;
  const rgba = new Uint8Array(size * size * 4);
  const f = norm(view.forward);
  const right = norm(Math.abs(f[1]!) > 0.99 ? cross(f, [0, 0, -1]) : cross(f, [0, 1, 0]));
  // A light over the camera's shoulder, so every side is lit.
  const l = norm([0, 1, 2].map((k) => -f[k]! + 0.5 * (k === 1 ? 1 : 0) + 0.35 * right[k]!));
  for (let at = 0; at < size * size; at++) {
    const t = frame.tri[at]!;
    let rgb = [245, 245, 248];
    if (t >= 0) {
      const a = body.indices[t * 3]! * 3, b = body.indices[t * 3 + 1]! * 3, c = body.indices[t * 3 + 2]! * 3;
      let n = norm(cross([P[b]! - P[a]!, P[b + 1]! - P[a + 1]!, P[b + 2]! - P[a + 2]!], [P[c]! - P[a]!, P[c + 1]! - P[a + 1]!, P[c + 2]! - P[a + 2]!]));
      if (dot(n, f) > 0) n = n.map((x) => -x);
      const shade = 0.35 + 0.65 * Math.max(0, dot(n, l));
      const kind = body.triKind[t]!;
      const base = byZone ? ZONE_RGB[zoneOfBone(body.triBone[t]!)]! : kind === MATERIAL_EYES ? [235, 235, 240] : kind === MATERIAL_BROWS ? [70, 50, 40] : kind === MATERIAL_MOUTH ? [230, 200, 190] : [214, 170, 140];
      rgb = base.map((x) => x * shade);
    }
    rgba.set([rgb[0]!, rgb[1]!, rgb[2]!, 255], at * 4);
  }
  // Capsule outlines: an orthographic capsule is a stadium of its projected axis.
  for (const cap of CAPSULES) {
    const pa = cam.project(...cap.a)!, pb = cam.project(...cap.b)!;
    const r = (cap.r * size) / view.span;
    const col = ZONE_RGB[cap.zone]!.map((x) => x * 0.6);
    const x0 = Math.max(0, Math.floor(Math.min(pa[0], pb[0]) - r - 2)), x1 = Math.min(size - 1, Math.ceil(Math.max(pa[0], pb[0]) + r + 2));
    const y0 = Math.max(0, Math.floor(Math.min(pa[1], pb[1]) - r - 2)), y1 = Math.min(size - 1, Math.ceil(Math.max(pa[1], pb[1]) + r + 2));
    const sx = pb[0] - pa[0], sy = pb[1] - pa[1], l2 = sx * sx + sy * sy;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const tt = l2 > 0 ? Math.min(1, Math.max(0, ((x + 0.5 - pa[0]) * sx + (y + 0.5 - pa[1]) * sy) / l2)) : 0;
      const d = Math.hypot(x + 0.5 - pa[0] - tt * sx, y + 0.5 - pa[1] - tt * sy);
      if (Math.abs(d - r) < Math.max(0.7, size / 900)) rgba.set([col[0]!, col[1]!, col[2]!, 255], (y * size + x) * 4);
    }
  }
  for (let b = 0; b < HUMAN_BONES; b++) {
    const p = cam.project(body.rest[b * 3]!, body.rest[b * 3 + 1]!, body.rest[b * 3 + 2]!)!;
    const rad = Math.max(1.5, size / 400);
    for (let y = Math.floor(p[1] - rad); y <= Math.ceil(p[1] + rad); y++) for (let x = Math.floor(p[0] - rad); x <= Math.ceil(p[0] + rad); x++) {
      if (x < 0 || y < 0 || x >= size || y >= size || Math.hypot(x + 0.5 - p[0], y + 0.5 - p[1]) > rad) continue;
      rgba.set([20, 20, 20, 255], (y * size + x) * 4);
    }
  }
  return rgba;
}

/** Views side by side in one PNG. */
export function sheet(body: AuditBody, views: readonly View[], size: number, byZone: boolean): Uint8Array {
  const width = size * views.length;
  const rgba = new Uint8Array(width * size * 4);
  views.forEach((v, i) => {
    const one = picture(body, v, size, byZone);
    for (let y = 0; y < size; y++) rgba.set(one.subarray(y * size * 4, (y + 1) * size * 4), (y * width + i * size) * 4);
  });
  return encodePng(width, size, rgba);
}

const FRONT = [0, 0, -1], BACK = [0, 0, 1], LEFT = [-1, 0, 0], ABOVE = [0, -1, 0], BELOW = [0, 1, 0];
const WHOLE: readonly View[] = [
  { label: "front", forward: FRONT, centre: [0, 0.88, 0], span: 1.8 },
  { label: "side", forward: LEFT, centre: [0, 0.88, 0], span: 1.8 },
  { label: "back", forward: BACK, centre: [0, 0.88, 0], span: 1.8 },
];

export function closeViews(rest: readonly number[]): View[] {
  const j = (name: string): number[] => {
    const b = HUMAN.names.indexOf(name);
    return [rest[b * 3]!, rest[b * 3 + 1]!, rest[b * 3 + 2]!];
  };
  const sh = j("upperArm.L"), hand = j("hand.L"), foot = j("foot.L"), head = j("head"), hips = j("hips");
  return [
    { label: "face front", forward: FRONT, centre: [0, head[1]! + 0.1, 0], span: 0.32 },
    { label: "face side", forward: LEFT, centre: [0, head[1]! + 0.1, 0], span: 0.32 },
    { label: "shoulder front", forward: FRONT, centre: [sh[0]! - 0.02, sh[1]! - 0.05, 0], span: 0.42 },
    { label: "shoulder back", forward: BACK, centre: [sh[0]! - 0.02, sh[1]! - 0.05, 0], span: 0.42 },
    { label: "shoulder above", forward: ABOVE, centre: [sh[0]! - 0.02, 1.4, -0.03], span: 0.42, keep: (x) => x > 0.04 },
    { label: "armpit below", forward: BELOW, centre: [sh[0]! - 0.02, 1.2, -0.03], span: 0.42, keep: (_, y) => y > 1.05 },
    { label: "hand above", forward: ABOVE, centre: [hand[0]! + 0.08, 1.4, hand[2]!], span: 0.28, keep: (x) => x > hand[0]! - 0.12 },
    { label: "hand below", forward: BELOW, centre: [hand[0]! + 0.08, 1.4, hand[2]!], span: 0.28, keep: (x) => x > hand[0]! - 0.12 },
    { label: "foot side", forward: LEFT, centre: [foot[0]!, 0.1, foot[2]! + 0.05], span: 0.32, keep: (x) => x > 0 },
    { label: "foot below", forward: BELOW, centre: [foot[0]!, 0.1, foot[2]! + 0.05], span: 0.32, keep: (x, y) => x > 0 && y < 0.3 },
    { label: "crotch front", forward: FRONT, centre: [0, hips[1]! - 0.1, 0], span: 0.5 },
    { label: "hips back", forward: BACK, centre: [0, hips[1]! - 0.05, 0], span: 0.5 },
    { label: "crotch below", forward: BELOW, centre: [0, hips[1]! - 0.1, 0], span: 0.5, keep: (_, y) => y > 0.6 },
  ];
}

// ---- Tables -------------------------------------------------------------------------------------------------------

const pc = (v: number): string => (Number.isNaN(v) ? "   -  " : `${(v * 100).toFixed(1).padStart(5)}%`);

function printCounts(title: string, rows: [string, AimCount][]): void {
  console.log(`\n${title}`);
  console.log(`${"".padEnd(16)} head    body    missed  spill   | ${ZONE_NAMES.slice(1, HUMAN_ZONE_COUNT).map((z) => z.padEnd(7).slice(0, 7)).join(" ")}`);
  for (const [name, c] of rows) {
    const s = shares(c);
    console.log(`${name.padEnd(16)} ${pc(s.head)}  ${pc(s.body)}  ${pc(s.missed)}  ${pc(s.spill)}  | ${s.zones.map(pc).join("  ")}`);
  }
  console.log("head pixels by the zone hit");
  for (const [name, c] of rows) console.log(`${name.padEnd(16)} ${"".padEnd(32)}  | ${Array.from({ length: HUMAN_ZONE_COUNT }, (_, z) => pc(c.confused[ZONE_HEAD * HUMAN_ZONE_COUNT + z]! / c.drawn[ZONE_HEAD]!)).join("  ")}`);
  console.log("spill by the zone hit, as a share of all body pixels");
  for (const [name, c] of rows) console.log(`${name.padEnd(16)} ${"".padEnd(32)}  | ${shares(c).spills.map(pc).join("  ")}`);
}

function main(): void {
  const args = process.argv.slice(2);
  const outDir = resolve(args.includes("--out") ? args[args.indexOf("--out") + 1]! : "var/fit");
  mkdirSync(outDir, { recursive: true });
  const bodies: AuditBody[] = [];
  const num = (name: string): number | undefined => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : undefined);
  const macro = { muscle: num("--muscle"), weight: num("--weight"), age: num("--age") };
  for (const k of Object.keys(macro) as (keyof typeof macro)[]) if (macro[k] === undefined) delete macro[k];
  for (const sex of ["male", "female"] as const) bodies.push(fittedAudit(fitBody(sex, { macro })));
  bodies.push(todayAudit(0), todayAudit(1));
  for (const body of bodies) {
    const file = body.name.replace(" ", "-");
    writeFileSync(join(outDir, `${file}.png`), sheet(body, WHOLE, 900, false));
    writeFileSync(join(outDir, `${file}-zones.png`), sheet(body, WHOLE, 900, true));
    const close = closeViews(body.rest);
    writeFileSync(join(outDir, `${file}-close-1.png`), sheet(body, close.slice(0, 6), 600, false));
    writeFileSync(join(outDir, `${file}-close-2.png`), sheet(body, close.slice(6), 600, false));
    writeFileSync(join(outDir, `${file}-close-zones.png`), sheet(body, close.slice(0, 2), 600, true));
  }
  console.log(`pictures in ${outDir}`);

  console.log("\nSurface at rest: share of each zone's skin inside its own capsules, outside every capsule, mm past its own (95th, most), capsule surface covered");
  for (const body of bodies) {
    console.log(`  ${body.name}`);
    for (const r of surfaceRows(body)) console.log(`    ${r.zone.padEnd(11)} ${(r.area * 1e4).toFixed(0).padStart(6)} cm2  own ${pc(r.inOwn)}  outside ${pc(r.outside)}  past ${r.p95.toFixed(0).padStart(3)} / ${r.most.toFixed(0).padStart(3)} mm  covered ${pc(r.covered)}`);
  }
  printCounts("At rest, straight on from five sides (2.5 mm a pixel)", bodies.map((b) => [b.name, restCount(b)]));
  if (!args.includes("--no-posed")) {
    const anim = clipsAnim();
    printCounts("Posed as render-aim poses them: nine motions, five sides, 128 pixels", bodies.map((b) => [b.name, posedCount(b, anim)]));
  }
}

if (import.meta.main) main();
