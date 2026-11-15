// Adapter to existing terrain, placed structures and resource-node spatial indexes.
// Conservative swept chassis AABBs deliberately stop early at angled/narrow gaps.
// The VehicleWorld boundary allows a later oriented-body/contact solver without changing controls or seats.
import { detCos, detSin, TAU } from "../math/scalar.ts";
import type { VehicleSpec, VehicleState, VehicleSurface, VehicleWorld, WheelContact } from "../sim/vehicle.ts";
import type { CollisionWorld } from "./collide.ts";
import { frame, frameAxes, frameOf, HALF_SIDE, sixtyOf } from "./frame.ts";
import { castWorld, HIT_NONE, rayHit } from "./ray.ts";
import { Found, type PartTable, type StructureStore } from "./structures.ts";
import { capsuleKind } from "./collide.ts";
import { vehicleSurfaceAt } from "./vehicle-surface.ts";

export type VehicleSurfaceAt = (hit: number, ref: number, x: number, z: number) => VehicleSurface;

/**
 * Whether a structure of `kind` set at (sx, sy, sz) turned `syaw` would meet a vehicle's hull at (x, y, z) turned `yaw`
 * radians: the hull as upright capsules of its half width along its length, and small ones in its corners, so a piece
 * through its nose or boot is met as one through its middle.
 */
export function vehicleMeetsKind(parts: PartTable, kind: number, sx: number, sy: number, sz: number, syaw: number, spec: VehicleSpec, x: number, y: number, z: number, yaw: number, slack: number): boolean {
  const sn = detSin(yaw), cs = detCos(yaw), w = spec.halfWidth, l = spec.halfLength, corner = Math.min(0.3, w / 2);
  const along = Math.max(0, l - w), steps = Math.ceil(along / (w / 2));
  // A point on the hull's long axis or in a corner, in the world: +X the left (cos, -sin), +Z forward (sin, cos).
  const at = (lx: number, lz: number, r: number): boolean => capsuleKind(parts, kind, sx, sy, sz, syaw, x + cs * lx + sn * lz, y, z - sn * lx + cs * lz, r, spec.height, slack);
  for (let i = -steps; i <= steps; i++) if (at(0, steps === 0 ? 0 : (along * i) / steps, w)) return true;
  for (const lx of [w - corner, corner - w]) for (const lz of [l - corner, corner - l]) if (at(lx, lz, corner)) return true;
  return false;
}
interface Bounds { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }

function overlaps(a: Bounds, b: Bounds): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

/** How far into each other two boxes are: the shortest push across the ground that parts them, 0 if they do not meet.
 * Height is left out, as a hull's reach upward moves with its springs: a car rising on them goes no deeper into a wall. */
function shared(a: Bounds, b: Bounds): number {
  if (!overlaps(a, b)) return 0;
  return Math.min(a.maxX - b.minX, b.maxX - a.minX, a.maxZ - b.minZ, b.maxZ - a.minZ);
}

function bounds(s: Readonly<VehicleState>, p: VehicleSpec): Bounds {
  // Wheel-plane collision hull: suspension dive and body roll must not turn a flat
  // road into an obstacle. The roof envelope still includes chassis sway/heave.
  const pitch = s.grounded ? s.groundPitch : s.pitch, roll = s.grounded ? s.groundRoll : s.roll;
  const base = s.grounded ? s.y - s.rideOffset : s.y;
  const extra = s.grounded ? Math.max(0, s.rideOffset) + Math.abs(s.pitch - pitch) * p.halfLength + Math.abs(s.roll - roll) * p.halfWidth : 0;
  const sn = detSin(s.yaw), cs = detCos(s.yaw), sp = detSin(pitch), cp = detCos(pitch), sr = detSin(roll), cr = detCos(roll);
  const b: Bounds = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  // Rotate all corners, including the roof's overhang. Attitude is yaw * roll * nose-up pitch.
  for (const x of [-p.halfWidth, p.halfWidth]) for (const y of [p.clearance, p.height + extra]) for (const z of [-p.halfLength, p.halfLength]) {
    const py = cp * y + sp * z, pz = cp * z - sp * y;
    const rx = cr * x - sr * py, ry = sr * x + cr * py;
    const wx = s.x + cs * rx + sn * pz, wy = base + ry, wz = s.z + cs * pz - sn * rx;
    b.minX = Math.min(b.minX, wx); b.maxX = Math.max(b.maxX, wx);
    b.minY = Math.min(b.minY, wy); b.maxY = Math.max(b.maxY, wy);
    b.minZ = Math.min(b.minZ, wz); b.maxZ = Math.max(b.maxZ, wz);
  }
  return b;
}

function underside(s: Readonly<VehicleState>, p: VehicleSpec, x: number, z: number): number {
  // While airborne the wheel/base plane catches the landing. Cosmetic nose-down
  // attitude cannot repeatedly collide a metre above ground and suspend the car.
  const pitch = s.grounded ? s.groundPitch : 0, roll = s.grounded ? s.groundRoll : 0;
  const sn = detSin(s.yaw), cs = detCos(s.yaw), sp = detSin(pitch), cp = detCos(pitch), sr = detSin(roll), cr = detCos(roll);
  const nx = -cs * sr * cp - sn * sp, ny = cr * cp, nz = -cs * sp + sn * sr * cp;
  const dx = x - s.x, dz = z - s.z;
  // A car's bumpers rise beyond the wheelbase; treating the whole footprint as a
  // ground-scraping flat plate made ordinary ramp transitions impassable.
  const beyondAxle = Math.max(0, Math.min(p.halfLength, Math.abs(sn * dx + cs * dz)) - p.wheelbase / 2);
  const bumperRise = beyondAxle * 0.3;
  return s.y - (s.grounded ? s.rideOffset : 0) + (p.clearance + bumperRise - nx * dx - nz * dz) / Math.max(0.2, ny);
}

export class StaticVehicleWorld implements VehicleWorld {
  readonly world: CollisionWorld;
  readonly surfaceAt: VehicleSurfaceAt;
  private readonly found = new Found();
  private readonly axes = new Int32Array(4);
  private readonly supportWorld: CollisionWorld;

  constructor(world: CollisionWorld, surfaceAt: VehicleSurfaceAt = (hit, ref) => vehicleSurfaceAt(world, hit, ref)) {
    this.world = world;
    this.surfaceAt = surfaceAt;
    // Resource nodes obstruct the chassis but are not road support. Soft vegetation never becomes an elevated road.
    this.supportWorld = { hf: world.hf, structs: world.structs };
  }

  support(x: number, y: number, z: number, p: VehicleSpec): WheelContact | null {
    const hf = this.world.hf;
    if (x < 0 || z < 0 || x >= hf.sizeX || z >= hf.sizeZ) return null;
    // The caller predicts each wheel's height. Extra upward reach allows initial
    // contact on a legal slope; downward reach sees a landing before a fast fall
    // crosses the old maxDrop-sized probe. Neither range authorizes a chassis step.
    const slopeReach = Math.sqrt(p.wheelbase * p.wheelbase + p.track * p.track) * 0.5 * Math.sqrt(1 / (p.minGroundNormal * p.minGroundNormal) - 1);
    const rise = p.maxRise + slopeReach;
    const above = y + rise + 0.001;
    const kind = castWorld(this.supportWorld, x, above, z, 0, -1, 0, rise + Math.max(4, p.maxDrop) + 0.002, true);
    if (kind === HIT_NONE) return null;
    return { y: above - rayHit.t, normalY: rayHit.ny, surface: this.surfaceAt(kind, rayHit.ref, x, z) };
  }

  blocked(from: Readonly<VehicleState>, to: Readonly<VehicleState>, p: VehicleSpec): string | null {
    const a = bounds(from, p), b = bounds(to, p);
    let turn = to.yaw - from.yaw;
    turn -= Math.floor((turn + TAU / 2) / TAU) * TAU;
    // Include the corner arc between endpoints, even when translation is zero.
    const radius = Math.sqrt(p.halfWidth * p.halfWidth + p.halfLength * p.halfLength + p.height * p.height);
    const pitchChange = from.grounded === to.grounded ? Math.abs((to.grounded ? to.groundPitch : to.pitch) - (from.grounded ? from.groundPitch : from.pitch)) : 0;
    const rollChange = from.grounded === to.grounded ? Math.abs((to.grounded ? to.groundRoll : to.roll) - (from.grounded ? from.groundRoll : from.roll)) : 0;
    const arc = radius * (Math.abs(turn) + pitchChange + rollChange);
    const sweep: Bounds = {
      minX: Math.min(a.minX, b.minX) - arc, maxX: Math.max(a.maxX, b.maxX) + arc,
      minY: Math.min(a.minY, b.minY) - arc, maxY: Math.max(a.maxY, b.maxY) + arc,
      minZ: Math.min(a.minZ, b.minZ) - arc, maxZ: Math.max(a.maxZ, b.maxZ) + arc,
    };
    const hf = this.world.hf;
    if (sweep.minX < 0 || sweep.minZ < 0 || sweep.maxX >= hf.sizeX || sweep.maxZ >= hf.sizeZ) return "map-edge";
    // Clip grid samples to the actual swept footprint. The former neighbour-cell
    // vertices could lie metres beyond the chassis and stop a car beside a slope.
    // Terrain triangles are linear: rectangle corners, grid crossings and diagonal
    // crossings cover extrema without a fine unbounded sampling grid.
    const high = (x: number, z: number): boolean => {
      const floor = Math.min(underside(from, p, x, z), underside(to, p, x, z));
      return hf.heightAt(x, z) > floor + 0.01;
    };
    for (let gz = Math.floor(sweep.minZ / hf.cell); gz < Math.ceil(sweep.maxZ / hf.cell); gz++) {
      for (let gx = Math.floor(sweep.minX / hf.cell); gx < Math.ceil(sweep.maxX / hf.cell); gx++) {
        const x0 = Math.max(sweep.minX, gx * hf.cell), x1 = Math.min(sweep.maxX, (gx + 1) * hf.cell);
        const z0 = Math.max(sweep.minZ, gz * hf.cell), z1 = Math.min(sweep.maxZ, (gz + 1) * hf.cell);
        if (high(x0, z0) || high(x1, z0) || high(x0, z1) || high(x1, z1)) return "terrain";
        const diagonal = (gz - gx) * hf.cell;
        for (const x of [x0, x1]) { const z = x + diagonal; if (z >= z0 && z <= z1 && high(x, z)) return "terrain"; }
        for (const z of [z0, z1]) { const x = z - diagonal; if (x >= x0 && x <= x1 && high(x, z)) return "terrain"; }
      }
    }
    const structure = this.obstacle(this.world.structs, sweep, a, b);
    if (structure !== null) return `structure:${structure}`;
    const node = this.world.nodes ? this.obstacle(this.world.nodes, sweep, a, b) : null;
    return node === null ? null : `node:${node}`;
  }

  /**
   * The lowest ref of a solid part the move meets, or null. A part the car's hull already overlaps where it starts (a
   * piece built against a car turned across the grid, a static the map set under it) holds it only from going deeper:
   * it may move so long as it overlaps that part no more, or it would be held there for good.
   */
  private obstacle(store: StructureStore, a: Bounds, from: Bounds, to: Bounds): number | null {
    const meets = (part: Bounds): boolean => overlaps(a, part) && (!overlaps(from, part) || shared(to, part) > shared(from, part) + 1e-9);
    const n = store.query(a.minX, a.minZ, a.maxX, a.maxZ, this.found, a.minY, a.maxY);
    let hit: number | null = null;
    for (let i = 0; i < n; i++) {
      const ref = this.found.refs[i]!;
      if (hit !== null && ref >= hit) continue;
      const row = store.chunks[Math.floor(ref / 65536)]!;
      const slot = ref & 0xffff, k = row.kind[slot]!;
      if (store.isSoft(k)) continue;
      const x = row.x[slot]!, y = row.y[slot]!, z = row.z[slot]!;
      frameOf(row.yaw[slot]!);
      const sn = frame.sin, cs = frame.cos, stretch = frame.stretch;
      const box = store.parts.box;
      for (let j = store.parts.start[k]! * 6, end = store.parts.start[k + 1]! * 6; j < end; j += 6) {
        const cx = x + (cs * box[j]! + sn * box[j + 2]!) * stretch;
        const cz = z + (cs * box[j + 2]! - sn * box[j]!) * stretch;
        const cy = y + box[j + 1]!;
        const hx = (Math.abs(cs) * box[j + 3]! + Math.abs(sn) * box[j + 5]!) * stretch;
        const hz = (Math.abs(sn) * box[j + 3]! + Math.abs(cs) * box[j + 5]!) * stretch;
        const hy = box[j + 4]!;
        if (meets({ minX: cx - hx, maxX: cx + hx, minY: cy - hy, maxY: cy + hy, minZ: cz - hz, maxZ: cz + hz })) hit = ref;
      }
      const hulls = store.parts.hulls;
      if (!hulls) continue;
      for (let j = hulls.start[k]!, end = hulls.start[k + 1]!; j < end; j++) {
        frameAxes(row.yaw[slot]!, this.axes);
        const ax = this.axes[0]!, az = this.axes[1]!;
        if (hulls.sixty[j]) sixtyOf(ax, az, this.axes, 2);
        const bx = this.axes[2]!, bz = this.axes[3]!;
        const b: Bounds = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
        for (let c = hulls.corner[j]!, end = hulls.corner[j + 1]!; c < end; c++) {
          const u = hulls.at[c * 3]!, v = hulls.at[c * 3 + 2]!;
          const vx = x + (u * ax + v * bx) / HALF_SIDE;
          const vy = y + hulls.at[c * 3 + 1]!;
          const vz = z + (u * az + v * bz) / HALF_SIDE;
          b.minX = Math.min(b.minX, vx); b.maxX = Math.max(b.maxX, vx);
          b.minY = Math.min(b.minY, vy); b.maxY = Math.max(b.maxY, vy);
          b.minZ = Math.min(b.minZ, vz); b.maxZ = Math.max(b.maxZ, vz);
        }
        if (meets(b)) hit = ref;
      }
    }
    return hit;
  }
}
