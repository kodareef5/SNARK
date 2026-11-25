// What a session is told of the weapons of what it drives (OWN_ARMS), and of a seeker on what it drives or sits in
// (OWN_WARNED): server/vehicle-weapons.ts. Kept on the session as `arms`.

import { EVENT_NAME_BYTES, OWN_ARMS, OWN_WARNED } from "../../shared/net/protocol.ts";
import { ownKinds } from "./readers.ts";

/**
 * An armed vehicle's weapons: rounds and missiles left and their most, the lock (0 none, 1 seeking, 2 locked) and how far
 * it has come, 0 to 1, and what it is on: 1 an entity by handle, 2 a craft in the sky at (x, y, z) by name, 0 nothing.
 */
export interface VehicleArms {
  rounds: number; roundsMax: number; missiles: number; missilesMax: number;
  lock: number; progress: number; target: number; handle: number;
  x: number; y: number; z: number; name: string;
}

export const WARN_NONE = 0, WARN_SEEKING = 1, WARN_LOCKED = 2, WARN_MISSILE = 3;

export class ArmsState {
  /** The weapons of the armed vehicle this session drives, or null. */
  now: VehicleArms | null = null;
  /** A seeker on what this session drives or sits in: WARN_NONE to WARN_MISSILE. */
  warned = WARN_NONE;
}

ownKinds.add({
  kind: OWN_ARMS,
  read(s, r) {
    if (!r.bool()) { if (!r.overflow) s.arms.now = null; return; }
    const a: VehicleArms = { rounds: r.u16(), roundsMax: r.u16(), missiles: r.u8(), missilesMax: r.u8(), lock: r.bits(2), progress: r.u8() / 255, target: r.bits(2), handle: 0, x: 0, y: 0, z: 0, name: "" };
    if (a.target === 1) a.handle = r.u32();
    else if (a.target === 2) { a.x = r.f32(); a.y = r.f32(); a.z = r.f32(); a.name = r.string(EVENT_NAME_BYTES); }
    if (!r.overflow) s.arms.now = a;
  },
});

ownKinds.add({
  kind: OWN_WARNED,
  read(s, r) {
    const level = r.u8();
    if (!r.overflow) s.arms.warned = level;
  },
});
