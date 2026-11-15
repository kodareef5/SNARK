// Adapter to existing terrain, placed structures and resource-node spatial indexes.
// Conservative swept chassis AABBs deliberately stop early at angled/narrow gaps.
// The VehicleWorld boundary allows a later oriented-body/contact solver without changing controls or seats.
import { detCos, detSin, TAU } from "../math/scalar.ts";
import type { VehicleSpec, VehicleState, VehicleSurface, VehicleWorld, WheelContact } from "../sim/vehicle.ts";
import type { CollisionWorld } from "./collide.ts";
import { frame, frameAxes, frameOf, HALF_SIDE, sixtyOf } from "./frame.ts";
import { castWorld, HIT_NONE, rayHit } from "./ray.ts";
import { Found, type StructureStore } from "./structures.ts";

export type VehicleSurfaceAt = (hit: number, ref: number, x: number, z: number) => VehicleSurface;
interface Bounds { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }

function overlaps(a: Bounds, b: Bounds): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

function bounds(s: Readonly<VehicleState>, p: VehicleSpec): Bounds {
  const sn = detSin(s.yaw), cs = detCos(s.yaw), sp = detSin(s.pitch), cp = detCos(s.pitch), sr = detSin(s.roll), cr = detCos(s.roll);
  const b: Bounds = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  // Rotate all corners, including the roof's overhang. Attitude is yaw * roll * nose-up pitch.
  for (const x of [-p.halfWidth, p.halfWidth]) for (const y of [p.clearance, p.height]) for (const z of [-p.halfLength, p.halfLength]) {
    const py = cp * y + sp * z, pz = cp * z - sp * y;
    const rx = cr * x - sr * py, ry = sr * x + cr * py;
    const wx = s.x + cs * rx + sn * pz, wy = s.y + ry, wz = s.z + cs * pz - sn * rx;
    b.minX = Math.min(b.minX, wx); b.maxX = Math.max(b.maxX, wx);
    b.minY = Math.min(b.minY, wy); b.maxY = Math.max(b.maxY, wy);
    b.minZ = Math.min(b.minZ, wz); b.maxZ = Math.max(b.maxZ, wz);
  }
  return b;
}

function underside(s: Readonly<VehicleState>, clearance: number, x: number, z: number): number {
  const sn = detSin(s.yaw), cs = detCos(s.yaw), sp = detSin(s.pitch), cp = detCos(s.pitch), sr = detSin(s.roll), cr = detCos(s.roll);
  const nx = -cs * sr * cp - sn * sp, ny = cr * cp, nz = -cs * sp + sn * sr * cp;
  return s.y + (clearance - nx * (x - s.x) - nz * (z - s.z)) / ny;
}

export class StaticVehicleWorld implements VehicleWorld {
  readonly world: CollisionWorld;
  readonly surfaceAt: VehicleSurfaceAt;
  private readonly found = new Found();
  private readonly axes = new Int32Array(4);
  private readonly supportWorld: CollisionWorld;

  constructor(world: CollisionWorld, surfaceAt: VehicleSurfaceAt) {
    this.world = world;
    this.surfaceAt = surfaceAt;
    // Resource nodes obstruct the chassis but are not road support. Soft vegetation never becomes an elevated road.
    this.supportWorld = { hf: world.hf, structs: world.structs };
  }

  support(x: number, y: number, z: number, p: VehicleSpec): WheelContact | null {
    const hf = this.world.hf;
    if (x < 0 || z < 0 || x >= hf.sizeX || z >= hf.sizeZ) return null;
    const above = y + p.maxRise + 0.001;
    const kind = castWorld(this.supportWorld, x, above, z, 0, -1, 0, p.maxRise + p.maxDrop + 0.002, true);
    if (kind === HIT_NONE) return null;
    return { y: above - rayHit.t, normalY: rayHit.ny, surface: this.surfaceAt(kind, rayHit.ref, x, z) };
  }

  blocked(from: Readonly<VehicleState>, to: Readonly<VehicleState>, p: VehicleSpec): string | null {
    const a = bounds(from, p), b = bounds(to, p);
    let turn = to.yaw - from.yaw;
    turn -= Math.floor((turn + TAU / 2) / TAU) * TAU;
    // Include the corner arc between endpoints, even when translation is zero.
    const radius = Math.sqrt(p.halfWidth * p.halfWidth + p.halfLength * p.halfLength + p.height * p.height);
    const arc = radius * (Math.abs(turn) + Math.abs(to.pitch - from.pitch) + Math.abs(to.roll - from.roll));
    const sweep: Bounds = {
      minX: Math.min(a.minX, b.minX) - arc, maxX: Math.max(a.maxX, b.maxX) + arc,
      minY: Math.min(a.minY, b.minY) - arc, maxY: Math.max(a.maxY, b.maxY) + arc,
      minZ: Math.min(a.minZ, b.minZ) - arc, maxZ: Math.max(a.maxZ, b.maxZ) + arc,
    };
    const hf = this.world.hf;
    if (sweep.minX < 0 || sweep.minZ < 0 || sweep.maxX >= hf.sizeX || sweep.maxZ >= hf.sizeZ) return "map-edge";
    // Compare terrain with the supported underside plane, not the AABB's lowest corner: a smooth slope is drivable.
    // Every triangle touching the swept rectangle is bounded by these vertices. Boundary triangles remain conservative.
    const attitudeMargin = arc;
    for (let z = Math.floor(sweep.minZ / hf.cell); z <= Math.ceil(sweep.maxZ / hf.cell); z++) {
      for (let x = Math.floor(sweep.minX / hf.cell); x <= Math.ceil(sweep.maxX / hf.cell); x++) {
        const floor = Math.min(underside(from, p.clearance, x * hf.cell, z * hf.cell), underside(to, p.clearance, x * hf.cell, z * hf.cell)) - attitudeMargin;
        if (hf.sample(x, z) > floor) return "terrain";
      }
    }
    const structure = this.obstacle(this.world.structs, sweep);
    if (structure !== null) return `structure:${structure}`;
    const node = this.world.nodes ? this.obstacle(this.world.nodes, sweep) : null;
    return node === null ? null : `node:${node}`;
  }

  private obstacle(store: StructureStore, a: Bounds): number | null {
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
        if (overlaps(a, { minX: cx - hx, maxX: cx + hx, minY: cy - hy, maxY: cy + hy, minZ: cz - hz, maxZ: cz + hz })) hit = ref;
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
        if (overlaps(a, b)) hit = ref;
      }
    }
    return hit;
  }
}
