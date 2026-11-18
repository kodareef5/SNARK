// Regrowth checks actual occupied geometry, including cold chunks and the full bonnet/roof of parked vehicles.
import { CHUNK_SIZE } from "../shared/coords.ts";
import { capsuleKind } from "../shared/world/collide.ts";
import { Solid, boxSolid, partSolid, solidsCross } from "../shared/world/convex.ts";
import { frame, frameOf } from "../shared/world/frame.ts";
import type { NodeSpot } from "../shared/world/nodes.ts";
import { Found } from "../shared/world/structures.ts";
import { carMeetsKind } from "../shared/world/vehicle.ts";
import { boatMeetsKind } from "../shared/world/boat.ts";
import { helicopterMeetsKind } from "../shared/world/helicopter.ts";
import type { ServerWorld } from "./world.ts";

export class TreeClearance {
  private readonly world: ServerWorld;
  private readonly found = new Found();
  private readonly trunk = new Solid();
  private readonly other = new Solid();
  private readonly actorReach: number;
  private readonly pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, qx: 0, qy: 0, qz: 0, qw: 1, steering: 0 };
  constructor(world: ServerWorld) {
    this.world = world; let reach = 0;
    for (let kind = 1; kind < world.reg.defs.length; kind++) {
      reach = Math.max(reach, world.reg.move[kind]?.radius ?? 0);
      const spec = world.reg.vehicle[kind]?.spec;
      if (spec) reach = Math.max(reach, Math.hypot(spec.halfWidth, spec.halfLength, spec.height));
    }
    this.actorReach = reach;
  }

  blocked(spot: NodeSpot, crushed: boolean): boolean {
    const world = this.world, field = world.nodeField!, forms = field.forms, parts = forms.parts, box = parts.box;
    const reach = field.store.spread[spot.form]!, structures = world.structs, placed = structures.parts;
    const n = crushed ? structures.query(spot.x - reach, spot.z - reach, spot.x + reach, spot.z + reach, this.found) : 0;
    frameOf(spot.yaw); const cs = frame.cos, sn = frame.sin, stretch = frame.stretch;
    for (let i = parts.start[spot.form]! * 6, end = parts.start[spot.form + 1]! * 6; i < end; i += 6) {
      boxSolid(spot.x + (cs * box[i]! + sn * box[i + 2]!) * stretch, spot.y + box[i + 1]!, spot.z + (cs * box[i + 2]! - sn * box[i]!) * stretch,
        cs, sn, box[i + 3]! * stretch, box[i + 4]!, box[i + 5]! * stretch, this.trunk);
      for (let j = 0; j < n; j++) {
        const ref = this.found.refs[j]!, row = structures.chunks[Math.floor(ref / 65536)]!, at = ref & 65535, kind = row.kind[at]!;
        if (structures.isSoft(kind)) continue;
        frameOf(row.yaw[at]!); const c = frame.cos, s = frame.sin, scale = frame.stretch, boxes = placed.box;
        for (let k = placed.start[kind]! * 6, last = placed.start[kind + 1]! * 6; k < last; k += 6) {
          boxSolid(row.x[at]! + (c * boxes[k]! + s * boxes[k + 2]!) * scale, row.y[at]! + boxes[k + 1]!, row.z[at]! + (c * boxes[k + 2]! - s * boxes[k]!) * scale,
            c, s, boxes[k + 3]! * scale, boxes[k + 4]!, boxes[k + 5]! * scale, this.other);
          if (solidsCross(this.trunk, .002, .002, this.other, 0, 0, 0)) return true;
        }
        if (placed.hulls) for (let k = placed.hulls.start[kind]!; k < placed.hulls.start[kind + 1]!; k++) {
          partSolid(placed.hulls, k, row.yaw[at]!, row.x[at]!, row.y[at]!, row.z[at]!, this.other);
          if (solidsCross(this.trunk, .002, .002, this.other, 0, 0, 0)) return true;
        }
      }
    }
    const ents = world.ents, pad = reach + this.actorReach, dims = world.dims;
    const x0 = Math.max(0, Math.floor((spot.x - pad) / CHUNK_SIZE)), x1 = Math.min(dims.chunksX - 1, Math.floor((spot.x + pad) / CHUNK_SIZE));
    const z0 = Math.max(0, Math.floor((spot.z - pad) / CHUNK_SIZE)), z1 = Math.min(dims.chunksZ - 1, Math.floor((spot.z + pad) / CHUNK_SIZE));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) for (let e = ents.chunkHead[z * dims.chunksX + x]!; e >= 0; e = ents.next[e]!) {
      const kind = ents.kind[e]!, def = world.reg.vehicle[kind], move = world.reg.move[kind];
      if (def) {
        const v = ents.vrow[e]!, pose = this.pose;
        pose.x = ents.x[e]!; pose.y = ents.y[e]!; pose.z = ents.z[e]!; pose.yaw = ents.vehicleYaw[v]!; pose.pitch = ents.vehiclePitch[v]!; pose.roll = ents.vehicleRoll[v]!;
        pose.qx = ents.vehicleQx[v]!; pose.qy = ents.vehicleQy[v]!; pose.qz = ents.vehicleQz[v]!; pose.qw = ents.vehicleQw[v]!; pose.steering = ents.steering[v]!;
        const blocked = def.movement === "boat" ? boatMeetsKind(parts, spot.form, spot.x, spot.y, spot.z, spot.yaw, def, pose) :
          def.movement === "rotor" ? helicopterMeetsKind(parts, spot.form, spot.x, spot.y, spot.z, spot.yaw, def, pose) :
          carMeetsKind(parts, spot.form, spot.x, spot.y, spot.z, spot.yaw, def.spec, pose);
        if (blocked) return true;
      } else if (crushed && move && capsuleKind(parts, spot.form, spot.x, spot.y, spot.z, spot.yaw, ents.x[e]!, ents.y[e]!, ents.z[e]!, move.radius, move.height, .002)) return true;
    }
    return false;
  }
}
