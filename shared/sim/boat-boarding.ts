// Where a body gets aboard a boat: anywhere along the hull it can reach, read from the hull's own boxes and its drives'
// rather than from one authored point (planning/workstreams/vehicle-boarding.md). A swimmer hauls itself over a part no higher than
// SWIM_CLIMB above the water, so a yacht's high side sends it to the low stern; a body standing on a dock or a shore
// steps onto a part from STEP_DOWN below its feet to STEP_UP above them; a body on the deck is already aboard. The server
// checks the route on from there (server/urban.ts), and the client's prompt asks the same question, so both agree.

import { quatRotate, quatUnrotate } from "../math/quat.ts";
import { len3 } from "../math/scalar.ts";
import { boatDrives, type BoatVehicleDefinition, type VehicleCollisionBox } from "./vehicle.ts";
import { vehicleRotation, type VehicleFrame } from "./vehicle-frame.ts";

/** Metres from a body's middle to the hull's side, across the water or a dock's edge, that it can reach aboard from. */
export const BOARD_REACH = 2;
/** Metres over the water a swimmer can haul itself up onto. */
export const SWIM_CLIMB = 1.2;
/** Metres a body on its feet steps up onto a part, or down onto one. */
export const STEP_UP = 1, STEP_DOWN = 1.6;
/** Feet this far under the water are in it, swimming or wading, and reach by the water's surface. */
export const IN_WATER = .3;

export const BOARD_OK = 0, BOARD_FAR = 1, BOARD_HIGH = 2;

/** Where on the hull a body climbs aboard: the world point at the top of the part, on its edge nearest the body. */
export interface BoatBoard { x: number; y: number; z: number; /** The part's top in the boat's frame. */ top: number }

const q = new Float64Array(4), p = new Float64Array(3), w = new Float64Array(3);
const partsOf = new WeakMap<BoatVehicleDefinition, readonly VehicleCollisionBox[]>();

/** What of a boat a body can climb onto: its hull and, at the stern, its drives' housings as they stand unsteered. */
function parts(def: BoatVehicleDefinition): readonly VehicleCollisionBox[] {
  let all = partsOf.get(def);
  if (!all) { all = [...def.spec.hullBoxes, ...boatDrives(def.spec).flatMap(d => d.outboard?.boxes ?? [])]; partsOf.set(def, all); }
  return all;
}

/**
 * Whether a body with its feet at (x, y, z), `water` the surface there, gets aboard `def` posed at `frame` from where it
 * is: BOARD_OK, with `out` where it climbs over, BOARD_FAR with no part near enough, or BOARD_HIGH with every near part
 * out of its reach above or below. A body `swimming`, or with its feet in the water, reaches by the water's surface. Out
 * of the water it climbs aboard from its `footing` (a dock, a shore) or from the hull it stands on, never from the air.
 */
export function boatBoarding(def: BoatVehicleDefinition, frame: VehicleFrame, x: number, y: number, z: number, water: number, swimming: boolean, footing: boolean, out: BoatBoard): number {
  vehicleRotation(frame, q);
  quatUnrotate(q, 0, x - frame.x, y - frame.y, z - frame.z, p, 0);
  const afloat = Number.isFinite(water) && (swimming || y < water - IN_WATER);
  if (!afloat && !footing && !onHull(def)) return BOARD_FAR;
  // The water's surface where the body is, in the boat's frame.
  quatUnrotate(q, 0, x - frame.x, (afloat ? water : y) - frame.y, z - frame.z, w, 0);
  let best = -1, gap = Infinity, top = Infinity, near = false;
  const boxes = parts(def);
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!, high = b.at[1] + b.half[1];
    const cx = Math.max(b.at[0] - b.half[0], Math.min(b.at[0] + b.half[0], p[0]!)), cz = Math.max(b.at[2] - b.half[2], Math.min(b.at[2] + b.half[2], p[2]!));
    const d = len3(p[0]! - cx, 0, p[2]! - cz);
    if (d > BOARD_REACH) continue;
    near = true;
    const reached = afloat ? high <= w[1]! + SWIM_CLIMB && high >= w[1]! - IN_WATER : high >= p[1]! - STEP_DOWN && high <= p[1]! + STEP_UP;
    if (!reached) continue;
    // The nearest part, and of parts as near the lowest: a deck before the rail round it.
    if (d < gap - .01 || (d < gap + .01 && high < top)) { best = i; gap = d; top = high; }
  }
  if (best < 0) return near ? BOARD_HIGH : BOARD_FAR;
  const b = boxes[best]!;
  // A body's width inside the part's edge, so the route over the side stands on the hull and not on what is beside it.
  const inset = (lo: number, hi: number, v: number): number => {
    const a = Math.max(lo, Math.min(hi, v)), m = (lo + hi) / 2;
    return a < m ? Math.min(m, a + .3) : Math.max(m, a - .3);
  };
  const lx = inset(b.at[0] - b.half[0], b.at[0] + b.half[0], p[0]!), lz = inset(b.at[2] - b.half[2], b.at[2] + b.half[2], p[2]!);
  quatRotate(q, 0, lx, top, lz, p, 0);
  out.x = p[0]! + frame.x; out.y = p[1]! + frame.y; out.z = p[2]! + frame.z; out.top = top;
  return BOARD_OK;
}

/** Whether the body, at `p` in the boat's frame, stands on one of its parts. */
function onHull(def: BoatVehicleDefinition): boolean {
  for (const b of parts(def)) {
    if (Math.abs(p[0]! - b.at[0]) <= b.half[0] && Math.abs(p[2]! - b.at[2]) <= b.half[2] && Math.abs(p[1]! - b.at[1] - b.half[1]) < .15) return true;
  }
  return false;
}
