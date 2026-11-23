// The room each enclosed seat has, measured from its vehicle's finest level as built: bun tools/pack/cabin-room.ts writes
// content/vehicles/cabin-room.json from the core pack. Enclosed means a wheel vehicle with metal cabin panels
// (`shotPanels`), the same rule that makes its roof stop shots. From each seat's anchor, rays straight up from shoulder
// height find the roof over where the head goes, and rays straight down over where the feet go find the footwell floor
// and toe board. Each set of hits becomes a plane. A hit well inside the cabin from the plane fitted so far (a headrest
// under the roof, a pedal or the next row's seat on the floor) is dropped from it, and the plane is then moved to the
// cabin's side of every hit it kept: the roof no higher and the floor no lower than the mesh. The floor starts from the
// hits nearest the seat, so a step down past a firewall is not taken for the footwell.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Def } from "../../shared/content/defs.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import type { SeatRoom } from "../../shared/sim/seats.ts";
import { isWheelVehicle } from "../../shared/sim/vehicle.ts";
import { ART } from "../art/source.ts";
import { buildCorePack } from "./build.ts";
import { meshDistance } from "./mesh-ray.ts";
import { unpackMeshes, type SourceLod } from "./write.ts";

export const OUT = fileURLToPath(new URL("../../content/vehicles/cabin-room.json", import.meta.url));

/** Up rays start this far over the anchor, above the cushion and the arms, and below any roof a head fits under. */
const ROOF_FROM = .5;
/** Where the head can go, across and along from the anchor: upright, and leaning back. */
const ROOF_X = [-.12, -.06, 0, .06, .12], ROOF_Z = [-.5, -.4, -.3, -.2, -.1, 0, .1];
/** Where the feet can go, across and ahead of the anchor; down rays start at the anchor's height. */
const FLOOR_X = [-.15, 0, .15], FLOOR_Z = [.35, .45, .55, .65, .75, .85, .95];
/** A hit this far inside the cabin from the plane fitted so far is something in the cabin. */
const OUTLIER = .03;
/** Floor hits are kept within this of the middle height of those nearest the seat. */
const FLOOR_NEAR = .55, FLOOR_BAND = .05;
const FAR = 4;

/** Every wheel vehicle with an enclosed cabin, with its mesh's id and its seats. */
export function enclosedVehicles(defs: readonly Def[] = CORE_CONTENT): { id: string; mesh: string; seats: readonly { id: string; anchor: readonly [number, number, number] }[] }[] {
  const out = [];
  for (const d of defs) {
    if (d.type !== "species" || !d.vehicle || !isWheelVehicle(d.vehicle) || !(d.vehicle.shotPanels?.length)) continue;
    out.push({ id: d.id, mesh: d.mesh, seats: d.vehicle.seats });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * Least squares y = h + sx * x + sz * z (sx stays 0 without `across`), dropping the hit farthest inside the cabin from it
 * while one is past OUTLIER, then moved to the cabin's side of every hit kept: `inward` -1 under a roof, +1 over a floor.
 */
function plane(points: number[][], inward: number, across: boolean): [number, number, number] | null {
  const kept = [...points];
  for (;;) {
    if (kept.length < 4) return null;
    let n = 0, x = 0, z = 0, y = 0, xx = 0, zz = 0, xz = 0, xy = 0, zy = 0;
    for (const [px, py, pz] of kept) { n++; x += px!; z += pz!; y += py!; xx += px! * px!; zz += pz! * pz!; xz += px! * pz!; xy += px! * py!; zy += pz! * py!; }
    // Centred normal equations for the slopes, then the height through the mean.
    const cxx = xx - (x * x) / n, czz = zz - (z * z) / n, cxz = xz - (x * z) / n, cxy = xy - (x * y) / n, czy = zy - (z * y) / n;
    let sx = 0, sz: number;
    if (across) {
      const det = cxx * czz - cxz * cxz;
      if (!(Math.abs(det) > 1e-9)) return null;
      sx = (cxy * czz - czy * cxz) / det; sz = (czy * cxx - cxy * cxz) / det;
    } else {
      if (!(czz > 1e-9)) return null;
      sz = czy / czz;
    }
    let h = (y - sx * x - sz * z) / n, worst = -1, far = OUTLIER;
    kept.forEach(([px, py, pz], i) => { const off = (py! - (h + sx * px! + sz * pz!)) * inward; if (off > far) { far = off; worst = i; } });
    if (worst >= 0) { kept.splice(worst, 1); continue; }
    for (const [px, py, pz] of kept) { const off = (py! - (h + sx * px! + sz * pz!)) * inward; if (off > 0) h += off * inward; }
    return [h, sx, sz];
  }
}

const r4 = (v: number): number => Math.round(v * 1e4) / 1e4 || 0;

/** A seat's room in its vehicle's mesh level, or null where the rays find no roof or no floor around it. */
export function measureRoom(lod: SourceLod, anchor: readonly number[]): SeatRoom | null {
  const [ax, ay, az] = anchor as [number, number, number];
  const roof: number[][] = [], floor: number[][] = [];
  for (const dx of ROOF_X) for (const dz of ROOF_Z) {
    const t = meshDistance(lod, [ax + dx, ay + ROOF_FROM, az + dz], [0, 1, 0]);
    if (t < FAR) roof.push([dx, ROOF_FROM + t, dz]);
  }
  for (const dx of FLOOR_X) for (const dz of FLOOR_Z) {
    const t = meshDistance(lod, [ax + dx, ay, az + dz], [0, -1, 0]);
    if (t < FAR) floor.push([dx, -t, dz]);
  }
  const near = floor.filter((p) => p[2]! <= FLOOR_NEAR).map((p) => p[1]!).sort((a, b) => a - b);
  if (near.length < 3) return null;
  const middle = near[near.length >> 1]!;
  const top = plane(roof, -1, true), bottom = plane(floor.filter((p) => Math.abs(p[1]! - middle) <= FLOOR_BAND), 1, false);
  if (!top || !bottom || !(top[0] > 0) || !(bottom[0] < 0)) return null;
  // The cushion, or the floor where the seat has none under its anchor.
  const cushion = Math.min(meshDistance(lod, [ax, ay, az], [0, -1, 0]), -bottom[0]);
  return { roof: [r4(top[0]), r4(top[1]), r4(top[2])], floor: [r4(bottom[0]), r4(bottom[2])], seat: r4(-cushion) };
}

/** Every enclosed seat's room, by vehicle id and seat id, from each mesh's finest level. */
export function measureRooms(lods: ReadonlyMap<string, SourceLod>): Record<string, Record<string, SeatRoom>> {
  const out: Record<string, Record<string, SeatRoom>> = {};
  for (const vehicle of enclosedVehicles()) {
    const lod = lods.get(vehicle.mesh);
    if (!lod) continue;
    const seats: Record<string, SeatRoom> = {};
    for (const seat of vehicle.seats) {
      const room = measureRoom(lod, seat.anchor);
      if (room) seats[seat.id] = room;
    }
    if (Object.keys(seats).length > 0) out[vehicle.id] = seats;
  }
  return out;
}

if (import.meta.main) {
  if (!ART) throw new Error("the art is not installed here: bun run media art");
  const meshes = unpackMeshes(parsePack(buildCorePack()));
  const rooms = measureRooms(new Map(meshes.map((m) => [m.id, m.lods[0]!])));
  for (const [vehicle, seats] of Object.entries(rooms)) for (const [seat, room] of Object.entries(seats)) console.log(vehicle, seat, JSON.stringify(room));
  writeFileSync(OUT, `${JSON.stringify(rooms, null, 1)}\n`);
}
