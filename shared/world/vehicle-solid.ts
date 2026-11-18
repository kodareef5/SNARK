// Shared full-attitude swept convex collision. Aircraft and boats supply their own physical parts.
import { WORLD_MAX_Y, WORLD_MIN_Y } from "../coords.ts";
import { quatNormalize, quatRotate } from "../math/quat.ts";
import { detCos, detSin, len3, TAU } from "../math/scalar.ts";
import { sortU32 } from "../sort.ts";
import type { CollisionWorld } from "./collide.ts";
import { boxSolid, partSolid, solidsCross, type Solid } from "./convex.ts";
import { frame, frameOf } from "./frame.ts";
import { Found, type StructureStore } from "./structures.ts";
import { faceSupports, terrainPatch, terrainSupports } from "./vehicle-support.ts";
export interface SolidFrame { readonly x: number; readonly y: number; readonly z: number; readonly qx: number; readonly qy: number; readonly qz: number; readonly qw: number }
export interface ContactGeometry { nx: number; ny: number; nz: number; x: number; y: number; z: number; depth: number }
export interface SolidContact extends ContactGeometry { reason: string; hazard: boolean; balanced?: boolean; points?: readonly { x: number; y: number; z: number }[] }
export interface Bounds { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }
export interface Shape { solid: Solid; hazard: boolean; radius: number; joint?: number }
export interface SolidJoint { from: SolidFrame; to: SolidFrame }
export interface Swept extends Shape { pad: number; bounds: Bounds; initial?: Swept; realFaces?: number; realEdges?: number }
export const makeSolid = (): Solid => ({ corners: 0, faces: 0, edges: 0, at: new Float64Array(384), face: new Float64Array(384), edge: new Float64Array(192) });
const square = (value: number): number => value * value;
export const bounds = (): Bounds => ({ minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity });
function include(b: Bounds, x: number, y: number, z: number): void {
  b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x);
  b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y);
  b.minZ = Math.min(b.minZ, z); b.maxZ = Math.max(b.maxZ, z);
}
function direction(to: Float64Array, count: number, x: number, y: number, z: number): number {
  const length = len3(x, y, z);
  if (length < 1e-9) return count;
  x /= length; y /= length; z /= length;
  for (let i = 0; i < count * 3; i += 3) if (Math.abs(x * to[i]! + y * to[i + 1]! + z * to[i + 2]!) > 1 - 1e-8) return count;
  if (count * 3 + 3 > to.length) return count; // Extra SAT directions only tighten a conservative overlap.
  to[count * 3] = x; to[count * 3 + 1] = y; to[count * 3 + 2] = z;
  return count + 1;
}
export function shape(solid: Solid, hazard = false): Shape {
  let radius = 0;
  for (let i = 0; i < solid.corners * 3; i += 3) radius = Math.max(radius, len3(solid.at[i]!, solid.at[i + 1]!, solid.at[i + 2]!));
  return { solid, hazard, radius };
}
export function box(at: readonly number[], half: readonly number[]): Shape {
  const s = makeSolid(); boxSolid(at[0]!, at[1]!, at[2]!, 1, 0, half[0]!, half[1]!, half[2]!, s); return shape(s);
}
/** Convex polygon extruded between two centres. For a hazard, its circumscribed 24-gon is within 4 cm of a 4.6 m disc. */
export function tube(a: readonly number[], b: readonly number[], u: readonly number[], v: readonly number[], radiusA: number, radiusB: number, sides: number): Solid {
  const out = makeSolid(), expand = 1 / detCos(Math.PI / sides);
  for (let end = 0; end < 2; end++) for (let i = 0; i < sides; i++) {
    const centre = end ? b : a, radius = (end ? radiusB : radiusA) * expand;
    const sn = detSin(i * TAU / sides), cs = detCos(i * TAU / sides), index = (end * sides + i) * 3;
    for (let d = 0; d < 3; d++) out.at[index + d] = centre[d]! + radius * (u[d]! * cs + v[d]! * sn);
  }
  out.corners = sides * 2;
  const nx = u[1]! * v[2]! - u[2]! * v[1]!, ny = u[2]! * v[0]! - u[0]! * v[2]!, nz = u[0]! * v[1]! - u[1]! * v[0]!;
  out.faces = direction(out.face, 0, nx, ny, nz);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides, at = i * 3, next = j * 3, other = (i + sides) * 3;
    const ex = out.at[next]! - out.at[at]!, ey = out.at[next + 1]! - out.at[at + 1]!, ez = out.at[next + 2]! - out.at[at + 2]!;
    const ax = out.at[other]! - out.at[at]!, ay = out.at[other + 1]! - out.at[at + 1]!, az = out.at[other + 2]! - out.at[at + 2]!;
    out.faces = direction(out.face, out.faces, ey * az - ez * ay, ez * ax - ex * az, ex * ay - ey * ax);
    out.edges = direction(out.edge, out.edges, ex, ey, ez); out.edges = direction(out.edge, out.edges, ax, ay, az);
  }
  return out;
}
const q0 = new Float64Array(4), q1 = new Float64Array(4), temp = new Float64Array(3);
export function sweep(source: Shape, from: Readonly<SolidFrame>, to: Readonly<SolidFrame>, out: Swept): void {
  const a = source.solid, b = out.solid;
  q0.set([from.qx, from.qy, from.qz, from.qw]); q1.set([to.qx, to.qy, to.qz, to.qw]); quatNormalize(q0, 0); quatNormalize(q1, 0);
  const norms = Math.sqrt((square(from.qx) + square(from.qy) + square(from.qz) + square(from.qw)) * (square(to.qx) + square(to.qy) + square(to.qz) + square(to.qw)));
  const dot = Math.min(1, Math.abs(from.qx * to.qx + from.qy * to.qy + from.qz * to.qz + from.qw * to.qw) / Math.max(1e-12, norms));
  // The hull of the actual endpoint vertices covers their chords. The rotation arc bows outside each chord by
  // at most r*(1-cos(angle/2)); a midpoint-orientation extrusion needed first-order padding and trapped tilted cars.
  const moving = from.x !== to.x || from.y !== to.y || from.z !== to.z || from.qx !== to.qx || from.qy !== to.qy || from.qz !== to.qz || from.qw !== to.qw;
  // Moving sweeps reserve a millimetre beyond the stationary query, including the final f32 persistence rounding.
  out.pad = source.radius * (1 - dot) + (moving ? .002 : .001);
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const box = out.bounds; box.minX = box.minY = box.minZ = Infinity; box.maxX = box.maxY = box.maxZ = -Infinity;
  for (let i = 0; i < a.corners * 3; i += 3) {
    for (let end = 0; end < 2; end++) {
      quatRotate(end ? q1 : q0, 0, a.at[i]!, a.at[i + 1]!, a.at[i + 2]!, temp, 0);
      const at = i + end * a.corners * 3, p = end ? to : from;
      b.at[at] = p.x + temp[0]!; b.at[at + 1] = p.y + temp[1]!; b.at[at + 2] = p.z + temp[2]!;
      include(box, b.at[at]!, b.at[at + 1]!, b.at[at + 2]!);
    }
  }
  b.corners = a.corners * 2; b.faces = b.edges = 0;
  for (const rotation of [q0, q1]) for (let i = 0; i < a.faces * 3; i += 3) {
    quatRotate(rotation, 0, a.face[i]!, a.face[i + 1]!, a.face[i + 2]!, temp, 0);
    b.faces = direction(b.face, b.faces, temp[0]!, temp[1]!, temp[2]!);
  }
  out.realFaces = b.faces;
  for (const rotation of [q0, q1]) for (let i = 0; i < a.edges * 3; i += 3) {
    quatRotate(rotation, 0, a.edge[i]!, a.edge[i + 1]!, a.edge[i + 2]!, temp, 0);
    b.edges = direction(b.edge, b.edges, temp[0]!, temp[1]!, temp[2]!);
    b.faces = direction(b.face, b.faces, temp[1]! * dz - temp[2]! * dy, temp[2]! * dx - temp[0]! * dz, temp[0]! * dy - temp[1]! * dx);
  }
  out.realEdges = b.edges;
  for (let i = 0; i < a.corners * 3; i += 3) {
    const end = i + a.corners * 3;
    b.edges = direction(b.edge, b.edges, b.at[end]! - b.at[i]!, b.at[end + 1]! - b.at[i + 1]!, b.at[end + 2]! - b.at[i + 2]!);
  }
  b.edges = direction(b.edge, b.edges, dx, dy, dz);
  box.minX -= out.pad; box.minY -= out.pad; box.minZ -= out.pad; box.maxX += out.pad; box.maxY += out.pad; box.maxZ += out.pad;
}
function triangle(a: readonly number[], b: readonly number[], c: readonly number[], bottom: number, out: Solid): void {
  const vertices = [a, b, c]; out.corners = 6; out.faces = out.edges = 0;
  for (let i = 0; i < 3; i++) {
    const p = vertices[i]!, j = (i + 1) % 3, next = vertices[j]!;
    out.at.set(p, i * 3); out.at.set([p[0]!, bottom, p[2]!], (i + 3) * 3);
    const dx = next[0]! - p[0]!, dy = next[1]! - p[1]!, dz = next[2]! - p[2]!;
    out.edges = direction(out.edge, out.edges, dx, dy, dz);
    out.faces = direction(out.face, out.faces, -dz, 0, dx);
  }
  const ax = b[0]! - a[0]!, ay = b[1]! - a[1]!, az = b[2]! - a[2]!;
  const bx = c[0]! - a[0]!, by = c[1]! - a[1]!, bz = c[2]! - a[2]!;
  out.faces = direction(out.face, out.faces, ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
  out.faces = direction(out.face, out.faces, 0, 1, 0); out.edges = direction(out.edge, out.edges, 0, 1, 0);
}

/** Contact patch centre from the two supporting features. A small post uses its own patch, not the whole car face. */
export function solidContactPoint(a: Solid, b: Solid, out: ContactGeometry, patch?: Float64Array): void {
  const { nx, ny, nz } = out;
  const length = Math.sqrt(nx * nx + nz * nz);
  const ux = length > 1e-8 ? nz / length : 1, uy = 0, uz = length > 1e-8 ? -nx / length : 0;
  const vx = ny * uz, vy = nz * ux - nx * uz, vz = -ny * ux;
  const support = (solid: Solid, sign: number): number => {
    let value = -Infinity;
    for (let i = 0; i < solid.corners * 3; i += 3) value = Math.max(value, sign * (solid.at[i]! * nx + solid.at[i + 1]! * ny + solid.at[i + 2]! * nz));
    return value * sign;
  };
  const aPlane = support(a, -1), bPlane = support(b, 1);
  const interval = (solid: Solid, plane: number, sign: number, x: number, y: number, z: number): [number, number] => {
    let low = Infinity, high = -Infinity;
    for (let i = 0; i < solid.corners * 3; i += 3) {
      if (sign * (solid.at[i]! * nx + solid.at[i + 1]! * ny + solid.at[i + 2]! * nz - plane) < -.015) continue;
      const value = solid.at[i]! * x + solid.at[i + 1]! * y + solid.at[i + 2]! * z;
      low = Math.min(low, value); high = Math.max(high, value);
    }
    return [low, high];
  };
  const au = interval(a, aPlane, -1, ux, uy, uz), bu = interval(b, bPlane, 1, ux, uy, uz);
  const av = interval(a, aPlane, -1, vx, vy, vz), bv = interval(b, bPlane, 1, vx, vy, vz);
  if (patch) { patch[0] = Math.max(au[0], bu[0]); patch[1] = Math.min(au[1], bu[1]); }
  const u = (Math.max(au[0], bu[0]) + Math.min(au[1], bu[1])) / 2;
  const v = (Math.max(av[0], bv[0]) + Math.min(av[1], bv[1])) / 2, normal = (aPlane + bPlane) / 2;
  out.x = ux * u + vx * v + nx * normal; out.y = uy * u + vy * v + ny * normal; out.z = uz * u + vz * v + nz * normal;
  out.depth = Math.max(0, bPlane - aPlane);
}

/** Exact stationary convex SAT; normal points from b toward a. Caller owns the output. */
export function solidContact(a: Solid, b: Solid, out: ContactGeometry, slack = 0): boolean {
  let depth = Infinity;
  const axis = (x: number, y: number, z: number): boolean => {
    const length = len3(x, y, z); if (length < 1e-8) return true;
    x /= length; y /= length; z /= length;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (let i = 0; i < a.corners * 3; i += 3) { const d = a.at[i]! * x + a.at[i + 1]! * y + a.at[i + 2]! * z; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (let i = 0; i < b.corners * 3; i += 3) { const d = b.at[i]! * x + b.at[i + 1]! * y + b.at[i + 2]! * z; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    const minus = a1 - b0, plus = b1 - a0, overlap = Math.min(minus, plus);
    if (overlap <= slack) return false;
    if (overlap < depth) { const sign = minus < plus ? -1 : 1; depth = overlap; out.nx = x * sign; out.ny = y * sign; out.nz = z * sign; }
    return true;
  };
  for (const source of [a, b]) for (let i = 0; i < source.faces * 3; i += 3) if (!axis(source.face[i]!, source.face[i + 1]!, source.face[i + 2]!)) return false;
  for (let i = 0; i < a.edges * 3; i += 3) for (let j = 0; j < b.edges * 3; j += 3) {
    if (!axis(a.edge[i + 1]! * b.edge[j + 2]! - a.edge[i + 2]! * b.edge[j + 1]!, a.edge[i + 2]! * b.edge[j]! - a.edge[i]! * b.edge[j + 2]!, a.edge[i]! * b.edge[j + 1]! - a.edge[i + 1]! * b.edge[j]!)) return false;
  }
  solidContactPoint(a, b, out); return true;
}

export class StaticVehicleSolids {
  private readonly found = new Found();
  private readonly swept: Swept[] = [];
  private readonly obstacle = makeSolid();
  private readonly hit: SolidContact = { reason: "", hazard: false, nx: 0, ny: 1, nz: 0, x: 0, y: 0, z: 0, depth: 0 };
  private readonly candidates = new Float64Array(384);
  private readonly patch = new Float64Array(2);
  private readonly obstacleHit: SolidContact = { reason: "", hazard: false, nx: 0, ny: 1, nz: 0, x: 0, y: 0, z: 0, depth: 0 };
  private readonly points = Array.from({ length: 4 }, () => ({ x: 0, y: 0, z: 0 }));
  private readonly contactPoints: { x: number; y: number; z: number }[] = [];
  private separating = false;
  private center: ArrayLike<number> | undefined;
  private manifold = false;
  private readonly terrain: SolidContact = { reason: "terrain", hazard: false, nx: 0, ny: 1, nz: 0, x: 0, y: 0, z: 0, depth: 0 };
  private skin = .008;
  readonly world: CollisionWorld;
  private readonly ignoreNode: ((ref: number) => boolean) | undefined;
  constructor(world: CollisionWorld, ignoreNode?: (ref: number) => boolean) { this.world = world; this.ignoreNode = ignoreNode; }
  blocked(from: Readonly<SolidFrame>, to: Readonly<SolidFrame>, shapes: readonly Shape[], joints?: readonly SolidJoint[], allowSeparating = false, skin = .008, center?: ArrayLike<number>, manifold = false): SolidContact | null {
    this.skin = skin; this.center = center; this.manifold = manifold; this.hit.balanced = false; this.hit.points = undefined; this.contactPoints.length = 0;
    let contacts = 0, weight = 0, blockedTerrain = false, blockedHazard = false, supportX = 0, supportY = 0, supportZ = 0, supportNX = 0, supportNY = 1, supportNZ = 0;
    const terrain = this.terrain; terrain.depth = 0; terrain.balanced = false; terrain.points = undefined;
    this.separating = allowSeparating && (from.x !== to.x || from.y !== to.y || from.z !== to.z || from.qx !== to.qx || from.qy !== to.qy || from.qz !== to.qz || from.qw !== to.qw);
    const all = bounds(), hf = this.world.hf;
    for (let i = 0; i < shapes.length; i++) {
      const local = shapes[i]!;
      if (!this.swept[i]) this.swept[i] = { ...local, solid: makeSolid(), pad: 0, bounds: bounds() };
      const out = this.swept[i]!, joint = local.joint === undefined ? undefined : joints?.[local.joint];
      out.hazard = local.hazard; sweep(local, joint?.from ?? from, joint?.to ?? to, out);
      if (allowSeparating && shapes.length === 1) out.pad = Math.max(out.pad, .002);
      if (skin === 0) out.pad = 0;
      if (this.separating) {
        out.initial ??= { ...local, solid: makeSolid(), pad: 0, bounds: bounds() };
        sweep(local, joint?.from ?? from, joint?.from ?? from, out.initial);
        out.initial.pad = .002;
      }
      const b = out.bounds;
      include(all, b.minX, b.minY, b.minZ); include(all, b.maxX, b.maxY, b.maxZ);
      if (b.minX < 0 || b.maxX >= hf.sizeX || b.minZ < 0 || b.maxZ >= hf.sizeZ || b.minY < WORLD_MIN_Y || b.maxY > WORLD_MAX_Y) {
        this.hit.reason = "map-edge"; this.hit.hazard = local.hazard;
        this.hit.nx = b.minX < 0 ? 1 : b.maxX >= hf.sizeX ? -1 : 0;
        this.hit.nz = b.minZ < 0 ? 1 : b.maxZ >= hf.sizeZ ? -1 : 0;
        this.hit.ny = b.maxY > WORLD_MAX_Y ? -1 : b.minY < WORLD_MIN_Y ? 1 : 0;
        const length = len3(this.hit.nx, this.hit.ny, this.hit.nz);
        this.hit.nx /= length; this.hit.ny /= length; this.hit.nz /= length;
        this.hit.x = to.x; this.hit.y = to.y; this.hit.z = to.z; this.hit.depth = 0; return this.hit;
      }
      // Exact native terrain triangles, extruded down. Crossing a thin crest is found even when no corner ends inside it.
      for (let z = Math.max(0, Math.floor(b.minZ / hf.cell)); z < Math.min(hf.nz - 1, Math.ceil(b.maxZ / hf.cell)); z++) {
        for (let x = Math.max(0, Math.floor(b.minX / hf.cell)); x < Math.min(hf.nx - 1, Math.ceil(b.maxX / hf.cell)); x++) {
          const h00 = hf.sample(x, z), h10 = hf.sample(x + 1, z), h01 = hf.sample(x, z + 1), h11 = hf.sample(x + 1, z + 1);
          if (Math.max(h00, h10, h01, h11) < b.minY - 0.008) continue;
          const a = [x * hf.cell, h00 - this.skin, z * hf.cell], d = [(x + 1) * hf.cell, h11 - this.skin, (z + 1) * hf.cell];
          const bottom = Math.min(b.minY, h00, h10, h01, h11) - 2;
          for (const middle of [[(x + 1) * hf.cell, h10 - this.skin, z * hf.cell], [x * hf.cell, h01 - this.skin, (z + 1) * hf.cell]]) {
            triangle(a, middle, d, bottom, this.obstacle);
            // Terrain's extrusion sides are internal seams, including during initial-overlap separation.
            const ax = middle[0]! - a[0]!, ay = middle[1]! - a[1]!, az = middle[2]! - a[2]!;
            const bx = d[0]! - a[0]!, by = d[1]! - a[1]!, bz = d[2]! - a[2]!;
            const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
            const scale = (ny < 0 ? -1 : 1) / len3(nx, ny, nz);
            const blocked = this.meets(out, this.obstacle, nx * scale, ny * scale, nz * scale);
            blockedTerrain ||= blocked; blockedHazard ||= blocked && out.hazard;
            this.hit.hazard = out.hazard;
            if (!blocked && !this.manifold && shapes.length === 1) continue;
            if (!blocked) {
              this.hit.nx = nx * scale; this.hit.ny = ny * scale; this.hit.nz = nz * scale;
              this.geometry(out.solid, this.obstacle);
            }
            {
              // Clip each actual triangle to the body and weight by patch area, so diagonal tessellation cannot
              // manufacture a lateral moment. Balanced support still requires one real face under the COM.
              const hit = this.hit, savedX = hit.x, savedY = hit.y, savedZ = hit.z;
              const area = terrainPatch(out.solid, a, middle, d, out.pad, hit);
              if (area < 1e-12 && !blocked) continue;
              const nextWeight = Math.max(1e-10, area);
              const similar = !contacts || terrain.nx * hit.nx + terrain.ny * hit.ny + terrain.nz * hit.nz > .95;
              if (hit.balanced && (!contacts || similar || hit.depth > terrain.depth)) {
                supportX = savedX; supportY = savedY; supportZ = savedZ; supportNX = hit.nx; supportNY = hit.ny; supportNZ = hit.nz;
              }
              if (!contacts || !similar && hit.depth > terrain.depth) {
                Object.assign(terrain, hit); weight = nextWeight; contacts = 1;
              } else if (similar) {
                const sum = weight + nextWeight;
                terrain.nx = (terrain.nx * weight + hit.nx * nextWeight) / sum;
                terrain.ny = (terrain.ny * weight + hit.ny * nextWeight) / sum;
                terrain.nz = (terrain.nz * weight + hit.nz * nextWeight) / sum;
                terrain.x = (terrain.x * weight + hit.x * nextWeight) / sum;
                terrain.y = (terrain.y * weight + hit.y * nextWeight) / sum;
                terrain.z = (terrain.z * weight + hit.z * nextWeight) / sum;
                terrain.balanced ||= hit.balanced; terrain.depth = Math.max(terrain.depth, hit.depth); weight = sum; contacts++;
              }
            }
          }
        }
      }
    }
    if (blockedTerrain && contacts) {
      const length = len3(terrain.nx, terrain.ny, terrain.nz); terrain.nx /= length; terrain.ny /= length; terrain.nz /= length;
      if (!terrain.balanced) {
        // Vertex contacts are shared by neighbouring terrain triangles. Their depth-weighted resultant keeps
        // a symmetric chassis symmetric even when an almost-zero triangle patch straddles a grid diagonal.
        let total = 0, px = 0, py = 0, pz = 0, candidates = 0, deepest = 0;
        for (let part = 0; part < shapes.length; part++) {
          const body = this.swept[part]!, vertices = body.solid;
          for (let i = 0; i < vertices.corners * 3; i += 3) {
            const x = vertices.at[i]!, y = vertices.at[i + 1]!, z = vertices.at[i + 2]!, ground = hf.heightAt(x, z) - this.skin;
            const depth = ground - y;
            deepest = Math.max(deepest, depth);
            if (depth < -body.pad - .001) continue;
            const weight = Math.max(.001, depth + body.pad);
            total += weight; px += x * weight; py += ground * weight; pz += z * weight;
            if (this.manifold && i >= vertices.corners * 3 / 2 && candidates < 128) {
              this.candidates[candidates * 3] = x; this.candidates[candidates * 3 + 1] = ground; this.candidates[candidates * 3 + 2] = z; candidates++;
            }
          }
        }
        if (total > 0) { terrain.x = px / total; terrain.y = py / total; terrain.z = pz / total; }
        // A triangle's plane extends beyond its finite footprint. On a quantized slope, using that extension
        // to depenetrate the whole chassis repeatedly lifts it clear and starts another fall.
        if (this.skin === 0 && terrain.ny > .8 && deepest > 0) terrain.depth = deepest * terrain.ny;
        // At most four actual hull contacts span the support patch. Points are pooled; the solver consumes a copy.
        for (let i = 0; i < 4 && i < candidates; i++) {
          let best = -1, distance = -Infinity;
          for (let j = 0; j < candidates; j++) {
            const x = this.candidates[j * 3]!, z = this.candidates[j * 3 + 2]!;
            let separation = i ? Infinity : square(x - terrain.x) + square(z - terrain.z);
            for (const p of this.contactPoints) separation = Math.min(separation, square(x - p.x) + square(z - p.z));
            if (separation > distance) { best = j; distance = separation; }
          }
          if (best < 0 || i > 0 && distance < 1e-8) break;
          const point = this.points[i]!; point.x = this.candidates[best * 3]!; point.y = this.candidates[best * 3 + 1]!; point.z = this.candidates[best * 3 + 2]!;
          this.contactPoints.push(point);
        }
        if (this.contactPoints.length > 1) terrain.points = this.contactPoints;
      }
      if (terrain.balanced) { terrain.x = supportX; terrain.y = supportY; terrain.z = supportZ; terrain.nx = supportNX; terrain.ny = supportNY; terrain.nz = supportNZ; }
      if (this.center && this.manifold) {
        terrain.balanced = false;
        for (let part = 0; part < shapes.length; part++) {
          if (!terrainSupports(this.swept[part]!.solid, hf, terrain.nx, terrain.ny, terrain.nz, this.center[0]!, this.center[2]!, this.skin)) continue;
          terrain.balanced = true; terrain.x = this.center[0]!; terrain.z = this.center[2]!; terrain.y = hf.heightAt(terrain.x, terrain.z);
          terrain.points = undefined; break;
        }
      }
      terrain.reason = "terrain"; terrain.hazard = blockedHazard; return terrain;
    }
    const structure = this.obstacles(this.world.structs, all, shapes.length, "structure");
    return structure ?? (this.world.nodes ? this.obstacles(this.world.nodes, all, shapes.length, "node") : null);
  }
  private meets(a: Swept, b: Solid, forcedX?: number, forcedY?: number, forcedZ?: number): boolean {
    const skin = forcedX === undefined ? this.skin : 0;
    if (!solidsCross(a.solid, -a.pad, -a.pad, b, 0, skin, 0)) return false;
    this.hit.hazard = a.hazard; this.hit.balanced = false;
    const initial = a.initial;
    if (this.separating && initial && forcedX !== undefined && forcedY! < .8660254) {
      // A continuous terrain face spans grid triangles. Entering its neighbouring triangle while sliding must
      // not become a new collision merely because that triangle did not overlap the starting hull.
      const nx = forcedX, ny = forcedY!, nz = forcedZ!; let before = Infinity, after = Infinity, plane = -Infinity;
      for (let i = 0; i < initial.solid.corners * 3; i += 3) before = Math.min(before, initial.solid.at[i]! * nx + initial.solid.at[i + 1]! * ny + initial.solid.at[i + 2]! * nz);
      for (let i = 0; i < a.solid.corners * 3; i += 3) after = Math.min(after, a.solid.at[i]! * nx + a.solid.at[i + 1]! * ny + a.solid.at[i + 2]! * nz);
      for (let i = 0; i < b.corners * 3; i += 3) plane = Math.max(plane, b.at[i]! * nx + b.at[i + 1]! * ny + b.at[i + 2]! * nz);
      if (Math.abs(before - plane) < .02 && after - a.pad >= before - initial.pad - 1e-8) {
        for (let i = 0; i < initial.solid.corners * 3; i += 3) {
          const x = initial.solid.at[i]!, y = initial.solid.at[i + 1]!, z = initial.solid.at[i + 2]!;
          if (x * nx + y * ny + z * nz > before + .008) continue;
          // Verify the starting hull really touches this terrain plane; do not extrapolate a new plateau over a drop.
          if (Math.abs(x * nx + (this.world.hf.heightAt(x, z) - this.skin) * ny + z * nz - plane) < .008) return false;
        }
      }
    }
    if (this.separating && initial && solidsCross(initial.solid, -initial.pad, -initial.pad, b, 0, skin, 0)) {
      this.normal(initial.solid, b, initial.realFaces, initial.realEdges);
      if (forcedX !== undefined) { this.hit.nx = forcedX; this.hit.ny = forcedY!; this.hit.nz = forcedZ!; }
      const { nx, ny, nz } = this.hit;
      const low = (solid: Solid): number => {
        let value = Infinity;
        for (let i = 0; i < solid.corners * 3; i += 3) value = Math.min(value, solid.at[i]! * nx + solid.at[i + 1]! * ny + solid.at[i + 2]! * nz);
        return value;
      };
      // Test this part against this obstacle, including the entire swept rotation envelope. Keeping or reducing
      // its original face penetration permits escape, but cannot authorize crossing another wall or its far side.
      if (low(a.solid) - a.pad >= low(initial.solid) - initial.pad - 1e-8) return false;
    }
    this.normal(a.solid, b, a.realFaces, a.realEdges);
    if (forcedX !== undefined) { this.hit.nx = forcedX; this.hit.ny = forcedY!; this.hit.nz = forcedZ!; }
    this.geometry(a.solid, b); return true;
  }
  private geometry(a: Solid, b: Solid): void {
    solidContactPoint(a, b, this.hit, this.patch);
    const hit = this.hit, center = this.center; hit.balanced = false;
    if (center && hit.ny > .4 && faceSupports(a, hit.nx, hit.ny, hit.nz, -1, center[0]!, center[2]!) &&
      faceSupports(b, hit.nx, hit.ny, hit.nz, 1, center[0]!, center[2]!)) {
      const plane = hit.x * hit.nx + hit.y * hit.ny + hit.z * hit.nz;
      hit.x = center[0]!; hit.z = center[2]!; hit.y = (plane - hit.x * hit.nx - hit.z * hit.nz) / hit.ny; hit.balanced = true;
    }
  }

  private normal(a: Solid, b: Solid, realFaces = 0, realEdges = 0): void {
    // Respond along a real obstacle face. The swept aircraft includes artificial slanted faces generated by its
    // motion; treating one as a floor normal can point along the motion and erase an otherwise legal edge slide.
    // All face/cross-edge axes remain in the exact native overlap test above.
    let penetration = Infinity, nx = 0, ny = 1, nz = 0;
    const axis = (x: number, y: number, z: number): void => {
      const length = len3(x, y, z); if (length < 1e-8) return; x /= length; y /= length; z /= length;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (let i = 0; i < a.corners * 3; i += 3) { const d = a.at[i]! * x + a.at[i + 1]! * y + a.at[i + 2]! * z; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
      for (let i = 0; i < b.corners * 3; i += 3) { const d = b.at[i]! * x + b.at[i + 1]! * y + b.at[i + 2]! * z; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
      const towardMinus = a1 - b0, towardPlus = b1 - a0, depth = Math.min(towardMinus, towardPlus);
      if (depth < penetration) { const sign = towardMinus < towardPlus ? -1 : 1; penetration = depth; nx = x * sign; ny = y * sign; nz = z * sign; }
    };
    for (let k = 0; k < (b.faces + realFaces) * 3; k += 3) {
      const source = k < b.faces * 3 ? b.face : a.face, at = k < b.faces * 3 ? k : k - b.faces * 3;
      axis(source[at]!, source[at + 1]!, source[at + 2]!);
    }
    for (let i = 0; i < realEdges * 3; i += 3) for (let j = 0; j < b.edges * 3; j += 3) {
      axis(a.edge[i + 1]! * b.edge[j + 2]! - a.edge[i + 2]! * b.edge[j + 1]!, a.edge[i + 2]! * b.edge[j]! - a.edge[i]! * b.edge[j + 2]!, a.edge[i]! * b.edge[j + 1]! - a.edge[i + 1]! * b.edge[j]!);
    }
    this.hit.nx = nx; this.hit.ny = ny; this.hit.nz = nz;
  }
  private obstacles(store: StructureStore, area: Bounds, count: number, name: string): SolidContact | null {
    const n = store.query(area.minX, area.minZ, area.maxX, area.maxZ, this.found, area.minY, area.maxY);
    // Replicated rows rebuild the grid in a different insertion order. Pick the same real contact on both peers.
    sortU32(this.found.refs, n);
    let retained = false, low = 0, high = 0, centre = 0;
    const take = (ref: number): boolean => {
      const hit = this.hit, saved = this.obstacleHit;
      hit.reason = `${name}:${ref}`;
      // Adjacent road pieces are one support patch. Join their actual contiguous supporting intervals;
      // choosing only the first plate would manufacture a roll impulse on an otherwise symmetric crossing.
      if (name !== "structure" || count !== 1 || hit.ny < .7 || hit.hazard || this.manifold) return false;
      if (!retained) {
        Object.assign(saved, hit); saved.points = undefined;
        low = this.patch[0]!; high = this.patch[1]!; centre = (low + high) / 2;
        retained = true;
      } else if (saved.nx * hit.nx + saved.ny * hit.ny + saved.nz * hit.nz < .999 ||
        Math.abs((hit.x - saved.x) * saved.nx + (hit.y - saved.y) * saved.ny + (hit.z - saved.z) * saved.nz) > .02) return true;
      // The lateral intervals must also share the transverse contact line. Two floor islands at the same
      // height but different fore/aft positions do not support the empty rectangle between them.
      const dx = hit.x - saved.x, dy = hit.y - saved.y, dz = hit.z - saved.z;
      const horizontal = Math.sqrt(saved.nx * saved.nx + saved.nz * saved.nz);
      const transverse = horizontal > 1e-8 ? horizontal * dy - saved.ny * (saved.nx * dx + saved.nz * dz) / horizontal : dz;
      if (Math.abs(transverse) > .02) return true;
      // Only join contiguous portions of the same supporting feature. Gaps and unrelated ledges stay separate.
      if (this.patch[0]! <= high + .02 && this.patch[1]! >= low - .02) {
        low = Math.min(low, this.patch[0]!); high = Math.max(high, this.patch[1]!);
      }
      return true;
    };
    for (let i = 0; i < n; i++) {
      const ref = this.found.refs[i]!, row = store.chunks[Math.floor(ref / 65536)]!, slot = ref & 65535, kind = row.kind[slot]!;
      if (store.isSoft(kind) || name === "node" && this.ignoreNode?.(ref)) continue;
      const x = row.x[slot]!, y = row.y[slot]!, z = row.z[slot]!, yaw = row.yaw[slot]!;
      frameOf(yaw); const cs = frame.cos, sn = frame.sin, stretch = frame.stretch, boxes = store.parts.box;
      for (let j = store.parts.start[kind]! * 6, end = store.parts.start[kind + 1]! * 6; j < end; j += 6) {
        boxSolid(x + (cs * boxes[j]! + sn * boxes[j + 2]!) * stretch, y + boxes[j + 1]!, z + (cs * boxes[j + 2]! - sn * boxes[j]!) * stretch,
          cs, sn, boxes[j + 3]! * stretch, boxes[j + 4]!, boxes[j + 5]! * stretch, this.obstacle);
        for (let part = 0; part < count; part++) if (this.meets(this.swept[part]!, this.obstacle) && !take(ref)) return retained ? this.obstacleHit : this.hit;
      }
      const hulls = store.parts.hulls;
      if (hulls) for (let j = hulls.start[kind]!, end = hulls.start[kind + 1]!; j < end; j++) {
        partSolid(hulls, j, yaw, x, y, z, this.obstacle);
        for (let part = 0; part < count; part++) if (this.meets(this.swept[part]!, this.obstacle) && !take(ref)) return retained ? this.obstacleHit : this.hit;
      }
    }
    if (retained) {
      const hit = this.obstacleHit;
      const length = Math.sqrt(hit.nx * hit.nx + hit.nz * hit.nz), shift = (low + high) / 2 - centre;
      hit.x += (length > 1e-8 ? hit.nz / length : 1) * shift;
      hit.z += (length > 1e-8 ? -hit.nx / length : 0) * shift;
      return hit;
    }
    return null;
  }
}
