// Aircraft collision uses the native convex separating-axis test. Cabin, skids, tapered tail, fins and rotor discs
// are independent shapes, so the empty space beneath a rotor is not treated as a solid building-sized box.
import { WORLD_MAX_Y, WORLD_MIN_Y } from "../coords.ts";
import { quatNlerp, quatRotate } from "../math/quat.ts";
import { detAtan2, detCos, detSin, len3, TAU } from "../math/scalar.ts";
import { createHelicopter, type HelicopterContact, type HelicopterState, type HelicopterSupport, type HelicopterWorld } from "../sim/helicopter.ts";
import { vehicleRotation } from "../sim/vehicle-frame.ts";
import type { HelicopterSpec, RotorVehicleDefinition, VehicleDefinition } from "../sim/vehicle.ts";
import type { CollisionWorld } from "./collide.ts";
import { boxSolid, partSolid, solidsCross, type Solid } from "./convex.ts";
import { frame, frameOf } from "./frame.ts";
import { castWorld, HIT_NONE, rayHit } from "./ray.ts";
import { Found, type PartTable, type StructureStore } from "./structures.ts";

interface Bounds { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }
interface Shape { solid: Solid; rotor: boolean; radius: number }
interface Swept extends Shape { pad: number; bounds: Bounds }
const makeSolid = (): Solid => ({ corners: 0, faces: 0, edges: 0, at: new Float64Array(384), face: new Float64Array(384), edge: new Float64Array(192) });
const square = (value: number): number => value * value;
const bounds = (): Bounds => ({ minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity });
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
  to[count * 3] = x; to[count * 3 + 1] = y; to[count * 3 + 2] = z;
  return count + 1;
}
function shape(solid: Solid, rotor = false): Shape {
  let radius = 0;
  for (let i = 0; i < solid.corners * 3; i += 3) radius = Math.max(radius, len3(solid.at[i]!, solid.at[i + 1]!, solid.at[i + 2]!));
  return { solid, rotor, radius };
}
function box(at: readonly number[], half: readonly number[]): Shape {
  const s = makeSolid(); boxSolid(at[0]!, at[1]!, at[2]!, 1, 0, half[0]!, half[1]!, half[2]!, s); return shape(s);
}
/** Convex polygon extruded between two centres. For a rotor, its circumscribed 24-gon is within 4 cm of a 4.6 m disc. */
function tube(a: readonly number[], b: readonly number[], u: readonly number[], v: readonly number[], radiusA: number, radiusB: number, sides: number): Solid {
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
function localShapes(def: RotorVehicleDefinition): Shape[] {
  const p = def.spec, parts: Shape[] = [];
  for (const r of def.rotors) {
    const n = r.axis, initial = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = [n[1] * initial[2]! - n[2] * initial[1]!, n[2] * initial[0]! - n[0] * initial[2]!, n[0] * initial[1]! - n[1] * initial[0]!];
    const l = len3(u[0]!, u[1]!, u[2]!); for (let i = 0; i < 3; i++) u[i] = u[i]! / l;
    const v = [n[1] * u[2]! - n[2] * u[1]!, n[2] * u[0]! - n[0] * u[2]!, n[0] * u[1]! - n[1] * u[0]!];
    parts.push(shape(tube(r.at.map((c, i) => c - n[i]! * 0.035), r.at.map((c, i) => c + n[i]! * 0.035), u, v, r.radius, r.radius, 24), true));
  }
  parts.push(box([0, (p.clearance + p.height) / 2, 0], [p.halfWidth, (p.height - p.clearance) / 2, p.halfLength]));
  for (const side of [-1, 1]) parts.push(box([side * p.skidHalfWidth, 0.1, 0.05], [0.075, 0.075, p.skidHalfLength + 0.2]));
  parts.push(shape(tube(p.tail.from, p.tail.to, [1, 0, 0], [0, 1, 0], p.tail.radius, p.tail.tipRadius ?? p.tail.radius, 8)));
  for (const part of p.tail.boxes ?? []) parts.push(box(part.at, part.half));
  return parts;
}
const q0 = new Float64Array(4), q1 = new Float64Array(4), q = new Float64Array(4), temp = new Float64Array(3);
function sweep(source: Shape, from: Readonly<HelicopterState>, to: Readonly<HelicopterState>, out: Swept): void {
  const a = source.solid, b = out.solid;
  q0.set([from.qx, from.qy, from.qz, from.qw]); q1.set([to.qx, to.qy, to.qz, to.qw]); quatNlerp(q, 0, q0, 0, q1, 0, 0.5);
  const norms = Math.sqrt((square(from.qx) + square(from.qy) + square(from.qz) + square(from.qw)) * (square(to.qx) + square(to.qy) + square(to.qz) + square(to.qw)));
  const dot = Math.min(1, Math.abs(from.qx * to.qx + from.qy * to.qy + from.qz * to.qz + from.qw * to.qw) / Math.max(1e-12, norms));
  const angle = 2 * detAtan2(Math.sqrt(Math.max(0, 1 - dot * dot)), dot);
  out.pad = source.radius * angle / 2 + 0.001;
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const box = out.bounds; box.minX = box.minY = box.minZ = Infinity; box.maxX = box.maxY = box.maxZ = -Infinity;
  for (let i = 0; i < a.corners * 3; i += 3) {
    quatRotate(q, 0, a.at[i]!, a.at[i + 1]!, a.at[i + 2]!, temp, 0);
    for (let end = 0; end < 2; end++) {
      const at = i + end * a.corners * 3, p = end ? to : from;
      b.at[at] = p.x + temp[0]!; b.at[at + 1] = p.y + temp[1]!; b.at[at + 2] = p.z + temp[2]!;
      include(box, b.at[at]!, b.at[at + 1]!, b.at[at + 2]!);
    }
  }
  b.corners = a.corners * 2; b.faces = b.edges = 0;
  for (let i = 0; i < a.faces * 3; i += 3) {
    quatRotate(q, 0, a.face[i]!, a.face[i + 1]!, a.face[i + 2]!, temp, 0);
    b.faces = direction(b.face, b.faces, temp[0]!, temp[1]!, temp[2]!);
  }
  for (let i = 0; i < a.edges * 3; i += 3) {
    quatRotate(q, 0, a.edge[i]!, a.edge[i + 1]!, a.edge[i + 2]!, temp, 0);
    b.edges = direction(b.edge, b.edges, temp[0]!, temp[1]!, temp[2]!);
    b.faces = direction(b.face, b.faces, temp[1]! * dz - temp[2]! * dy, temp[2]! * dx - temp[0]! * dz, temp[0]! * dy - temp[1]! * dx);
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

export class StaticHelicopterWorld implements HelicopterWorld {
  private readonly found = new Found();
  private readonly supportWorld: CollisionWorld;
  private readonly definitions = new WeakMap<RotorVehicleDefinition, Shape[]>();
  private readonly swept: Swept[] = [];
  private readonly obstacle = makeSolid();
  private readonly hit: HelicopterContact = { reason: "", rotor: false, nx: 0, ny: 1, nz: 0 };
  private readonly supportHit: HelicopterSupport = { y: 0, pitch: 0, roll: 0 };
  readonly world: CollisionWorld;
  constructor(world: CollisionWorld) { this.world = world; this.supportWorld = { hf: world.hf, structs: world.structs }; }
  waterAt(x: number, z: number): number { return this.world.hf.waterAt(x, z); }
  support(x: number, y: number, z: number, yaw: number, reach: number, p: HelicopterSpec): HelicopterSupport | null {
    const heights: number[] = [], sn = detSin(yaw), cs = detCos(yaw), hf = this.world.hf;
    for (const localZ of [-p.skidHalfLength, p.skidHalfLength]) for (const localX of [-p.skidHalfWidth, p.skidHalfWidth]) {
      const px = x + cs * localX + sn * localZ, pz = z - sn * localX + cs * localZ;
      if (px < 0 || pz < 0 || px >= hf.sizeX || pz >= hf.sizeZ) return null;
      if (castWorld(this.supportWorld, px, y, pz, 0, -1, 0, reach, true) === HIT_NONE || rayHit.ny < p.minGroundNormal) return null;
      heights.push(y - rayHit.t);
    }
    const pitch = detAtan2((heights[2]! + heights[3]! - heights[0]! - heights[1]!) / 2, p.skidHalfLength * 2);
    const roll = detAtan2((heights[1]! + heights[3]! - heights[0]! - heights[2]!) / 2, p.skidHalfWidth * 2);
    if (detCos(pitch) * detCos(roll) < p.minGroundNormal || Math.abs(heights[0]! + heights[3]! - heights[1]! - heights[2]!) > 0.12) return null;
    this.supportHit.y = (heights[0]! + heights[1]! + heights[2]! + heights[3]!) / 4;
    this.supportHit.pitch = pitch; this.supportHit.roll = roll; return this.supportHit;
  }
  blocked(from: Readonly<HelicopterState>, to: Readonly<HelicopterState>, def: RotorVehicleDefinition): HelicopterContact | null {
    let shapes = this.definitions.get(def);
    if (!shapes) { shapes = localShapes(def); this.definitions.set(def, shapes); }
    const all = bounds(), hf = this.world.hf;
    for (let i = 0; i < shapes.length; i++) {
      const local = shapes[i]!;
      if (!this.swept[i]) this.swept[i] = { ...local, solid: makeSolid(), pad: 0, bounds: bounds() };
      const out = this.swept[i]!; out.rotor = local.rotor; sweep(local, from, to, out);
      const b = out.bounds;
      include(all, b.minX, b.minY, b.minZ); include(all, b.maxX, b.maxY, b.maxZ);
      if (b.minX < 0 || b.maxX >= hf.sizeX || b.minZ < 0 || b.maxZ >= hf.sizeZ || b.minY < WORLD_MIN_Y || b.maxY > WORLD_MAX_Y) {
        this.hit.reason = "map-edge"; this.hit.rotor = local.rotor;
        this.hit.nx = b.minX < 0 ? 1 : b.maxX >= hf.sizeX ? -1 : 0;
        this.hit.nz = b.minZ < 0 ? 1 : b.maxZ >= hf.sizeZ ? -1 : 0;
        this.hit.ny = b.maxY > WORLD_MAX_Y ? -1 : b.minY < WORLD_MIN_Y ? 1 : 0; return this.hit;
      }
      // Exact native terrain triangles, extruded down. Crossing a thin crest is found even when no corner ends inside it.
      for (let z = Math.max(0, Math.floor(b.minZ / hf.cell)); z < Math.min(hf.nz - 1, Math.ceil(b.maxZ / hf.cell)); z++) {
        for (let x = Math.max(0, Math.floor(b.minX / hf.cell)); x < Math.min(hf.nx - 1, Math.ceil(b.maxX / hf.cell)); x++) {
          const h00 = hf.sample(x, z), h10 = hf.sample(x + 1, z), h01 = hf.sample(x, z + 1), h11 = hf.sample(x + 1, z + 1);
          if (Math.max(h00, h10, h01, h11) < b.minY - 0.008) continue;
          const a = [x * hf.cell, h00, z * hf.cell], d = [(x + 1) * hf.cell, h11, (z + 1) * hf.cell];
          const bottom = Math.min(b.minY, h00, h10, h01, h11) - 2;
          for (const middle of [[(x + 1) * hf.cell, h10, z * hf.cell], [x * hf.cell, h01, (z + 1) * hf.cell]]) {
            triangle(a, middle, d, bottom, this.obstacle);
            if (this.meets(out, this.obstacle)) { this.hit.reason = "terrain"; return this.hit; }
          }
        }
      }
    }
    const structure = this.obstacles(this.world.structs, all, shapes.length, "structure");
    return structure ?? (this.world.nodes ? this.obstacles(this.world.nodes, all, shapes.length, "node") : null);
  }
  private meets(a: Swept, b: Solid): boolean {
    if (!solidsCross(a.solid, -a.pad, -a.pad, b, 0, 0.008, 0)) return false;
    this.hit.rotor = a.rotor;
    // The least penetrating SAT face gives a useful contact normal for wall sliding. Cross-edge axes remain in the
    // actual native overlap test above; the face normal is deliberately stable at corners and between adjacent pieces.
    let penetration = Infinity, nx = 0, ny = 1, nz = 0;
    for (const shape of [a.solid, b]) for (let k = 0; k < shape.faces * 3; k += 3) {
      const x = shape.face[k]!, y = shape.face[k + 1]!, z = shape.face[k + 2]!;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (let i = 0; i < a.solid.corners * 3; i += 3) { const d = a.solid.at[i]! * x + a.solid.at[i + 1]! * y + a.solid.at[i + 2]! * z; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
      for (let i = 0; i < b.corners * 3; i += 3) { const d = b.at[i]! * x + b.at[i + 1]! * y + b.at[i + 2]! * z; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
      const towardMinus = a1 - b0, towardPlus = b1 - a0, depth = Math.min(towardMinus, towardPlus);
      if (depth < penetration) { const sign = towardMinus < towardPlus ? -1 : 1; penetration = depth; nx = x * sign; ny = y * sign; nz = z * sign; }
    }
    this.hit.nx = nx; this.hit.ny = ny; this.hit.nz = nz; return true;
  }
  private obstacles(store: StructureStore, area: Bounds, count: number, name: string): HelicopterContact | null {
    const n = store.query(area.minX, area.minZ, area.maxX, area.maxZ, this.found, area.minY, area.maxY);
    for (let i = 0; i < n; i++) {
      const ref = this.found.refs[i]!, row = store.chunks[Math.floor(ref / 65536)]!, slot = ref & 65535, kind = row.kind[slot]!;
      if (store.isSoft(kind)) continue;
      const x = row.x[slot]!, y = row.y[slot]!, z = row.z[slot]!, yaw = row.yaw[slot]!;
      frameOf(yaw); const cs = frame.cos, sn = frame.sin, stretch = frame.stretch, boxes = store.parts.box;
      for (let j = store.parts.start[kind]! * 6, end = store.parts.start[kind + 1]! * 6; j < end; j += 6) {
        boxSolid(x + (cs * boxes[j]! + sn * boxes[j + 2]!) * stretch, y + boxes[j + 1]!, z + (cs * boxes[j + 2]! - sn * boxes[j]!) * stretch,
          cs, sn, boxes[j + 3]! * stretch, boxes[j + 4]!, boxes[j + 5]! * stretch, this.obstacle);
        for (let part = 0; part < count; part++) if (this.meets(this.swept[part]!, this.obstacle)) { this.hit.reason = `${name}:${ref}`; return this.hit; }
      }
      const hulls = store.parts.hulls;
      if (hulls) for (let j = hulls.start[kind]!, end = hulls.start[kind + 1]!; j < end; j++) {
        partSolid(hulls, j, yaw, x, y, z, this.obstacle);
        for (let part = 0; part < count; part++) if (this.meets(this.swept[part]!, this.obstacle)) { this.hit.reason = `${name}:${ref}`; return this.hit; }
      }
    }
    return null;
  }
}
const adapters = new WeakMap<CollisionWorld, StaticHelicopterWorld>();
export function helicopterWorld(world: CollisionWorld): StaticHelicopterWorld {
  let adapter = adapters.get(world); if (!adapter) { adapter = new StaticHelicopterWorld(world); adapters.set(world, adapter); } return adapter;
}
/** Exact placement check used by map parking and item deployment. It never snaps an authored roof position to terrain. */
export function helicopterPlacement(world: CollisionWorld, x: number, y: number, z: number, yaw: number, def: RotorVehicleDefinition): boolean {
  if (![x, y, z, yaw].every(Number.isFinite)) return false;
  const adapter = helicopterWorld(world), p = def.spec;
  const support = adapter.support(x, y + 0.08, z, yaw, 0.16, p);
  if (!support || Math.abs(support.y - y) > 0.06 || y + p.clearance < adapter.waterAt(x, z)) return false;
  const state = createHelicopter(p, x, support.y, z, yaw);
  state.pitch = support.pitch; state.roll = support.roll;
  vehicleRotation({ x, y, z, yaw, pitch: support.pitch, roll: support.roll }, q);
  state.qx = q[0]!; state.qy = q[1]!; state.qz = q[2]!; state.qw = q[3]!;
  return adapter.blocked(state, state, def) === null;
}


export interface HelicopterFrame {
  readonly x: number; readonly y: number; readonly z: number; readonly yaw: number;
  readonly pitch: number; readonly roll: number;
  readonly qx?: number; readonly qy?: number; readonly qz?: number; readonly qw?: number;
}
const interactionShapes = new WeakMap<RotorVehicleDefinition, Shape[]>();
const interactionSweep: Swept = { solid: makeSolid(), rotor: false, radius: 0, pad: 0, bounds: bounds() };
const interactionSolid = makeSolid();
const interactionHit = { rotor: false, nx: 0, ny: 0, nz: 0 };
function frameState(def: RotorVehicleDefinition, frame: HelicopterFrame): HelicopterState {
  const state = createHelicopter(def.spec, frame.x, frame.y, frame.z, frame.yaw);
  state.pitch = frame.pitch; state.roll = frame.roll;
  vehicleRotation({ ...frame }, q);
  state.qx = q[0]!; state.qy = q[1]!; state.qz = q[2]!; state.qw = q[3]!;
  return state;
}
function interaction(def: RotorVehicleDefinition, state: HelicopterState, obstacle: Solid, slack: number): {rotor:boolean;nx:number;ny:number;nz:number}|null {
  let shapes = interactionShapes.get(def); if (!shapes) { shapes = localShapes(def); interactionShapes.set(def, shapes); }
  for (const part of shapes) {
    sweep(part, state, state, interactionSweep);
    if (!solidsCross(interactionSweep.solid, slack, slack, obstacle, 0, 0, 0)) continue;
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < obstacle.corners * 3; i += 3) { x += obstacle.at[i]!; y += obstacle.at[i + 1]!; z += obstacle.at[i + 2]!; }
    // Contact normal points from the other body toward the aircraft, as the static collision adapter does.
    x = state.x - x / obstacle.corners; y = state.y + def.spec.height / 2 - y / obstacle.corners; z = state.z - z / obstacle.corners;
    const length = len3(x, y, z) || 1;
    interactionHit.rotor = part.rotor; interactionHit.nx = x / length; interactionHit.ny = y / length; interactionHit.nz = z / length; return interactionHit;
  }
  return null;
}
/** Full oriented vehicle envelope against a would-be structure, so building cannot intersect a tilted rotor or tail. */
export function helicopterMeetsKind(parts: PartTable, kind: number, sx: number, sy: number, sz: number, syaw: number, def: RotorVehicleDefinition, frameAt: HelicopterFrame, slack = 0): boolean {
  const state = frameState(def, frameAt), boxes = parts.box;
  frameOf(syaw); const cs = frame.cos, sn = frame.sin, stretch = frame.stretch;
  for (let i = parts.start[kind]! * 6, end = parts.start[kind + 1]! * 6; i < end; i += 6) {
    boxSolid(sx + (cs * boxes[i]! + sn * boxes[i + 2]!) * stretch, sy + boxes[i + 1]!, sz + (cs * boxes[i + 2]! - sn * boxes[i]!) * stretch,
      cs, sn, boxes[i + 3]! * stretch, boxes[i + 4]!, boxes[i + 5]! * stretch, interactionSolid);
    if (interaction(def, state, interactionSolid, slack)) return true;
  }
  if (parts.hulls) for (let i = parts.hulls.start[kind]!, end = parts.hulls.start[kind + 1]!; i < end; i++) {
    partSolid(parts.hulls, i, syaw, sx, sy, sz, interactionSolid);
    if (interaction(def, state, interactionSolid, slack)) return true;
  }
  return false;
}
/** Conservative circumscribed capsule cylinder. Server sweeps this query between authoritative frames; no particle decides a hit. */
export function helicopterMeetsCapsule(def: RotorVehicleDefinition, frame: HelicopterFrame, x: number, y: number, z: number, radius: number, height: number): {rotor:boolean;nx:number;ny:number;nz:number}|null {
  const capsule = tube([x, y, z], [x, y + Math.max(height, radius * 2), z], [1, 0, 0], [0, 0, 1], radius, radius, 12);
  return interaction(def, frameState(def, frame), capsule, 0);
}

const otherSweep: Swept = { solid: makeSolid(), rotor: false, radius: 0, pad: 0, bounds: bounds() };
/** The same shapes against another vehicle. Callers sweep relative motion and own authority, impulses and damage. */
export function helicopterMeetsVehicle(def: RotorVehicleDefinition, frame: HelicopterFrame, other: VehicleDefinition, otherFrame: HelicopterFrame): {rotor:boolean;nx:number;ny:number;nz:number}|null {
  const source = frameState(def, frame), target = frameState(def, otherFrame);
  let parts: Shape[];
  if (other.movement === "rotor") {
    parts = interactionShapes.get(other) ?? localShapes(other); interactionShapes.set(other, parts);
  } else {
    const p = other.spec;
    parts = [box([0, (p.clearance + p.height) / 2, 0], [p.halfWidth, (p.height - p.clearance) / 2, p.halfLength])];
  }
  for (const part of parts) {
    sweep(part, target, target, otherSweep);
    const hit = interaction(def, source, otherSweep.solid, 0);
    if (hit) return hit;
  }
  return null;
}
