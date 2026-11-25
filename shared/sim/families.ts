// The ways a vehicle moves. A family is one file under families/ and one line in `families()`: what its content must hold
// and how its body steps. Content picks one with `movement`; a vehicle with none is wheeled.

import type { CollisionWorld } from "../world/collide.ts";
import type { PartTable } from "../world/structures.ts";
import type { ContactGeometry, Shape, SolidFrame, SolidJoint } from "../world/vehicle-solid.ts";
import type { Body } from "./character.ts";
import { BOAT } from "./families/boat.ts";
import { ROTOR } from "./families/rotor.ts";
import { WHEELED } from "./families/wheeled.ts";
import type { VehicleDefinition, VehicleWorld } from "./vehicle.ts";
import type { VehicleFrame } from "./vehicle-frame.ts";

/** What a shape query met of a vehicle, and whether what it met was a spinning rotor or a propeller of another. */
export type VehicleMeeting = ContactGeometry & { otherRotor: boolean; otherPropeller: boolean; rotor?: boolean; propeller?: boolean };

export interface VehicleFamily<D extends VehicleDefinition = VehicleDefinition> {
  /** Its `movement` in content. */
  readonly name: string;
  /** Whether a definition is of this family. */
  is(d: VehicleDefinition): d is D;
  /** Its own checks of a definition, before the checks every vehicle shares. Throws on the first fault. */
  validateSpec(d: D): void;
  /** Its own checks of the rig, after the doors and wheels every vehicle shares. */
  validateRig(d: D): void;
  /**
   * One fixed tick of a body driven by `moveX`, `moveZ` and `buttons`, the ordinary signed bytes and buttons; each family
   * reads them its own way. `yaw` and `pitch` are the look the input holds, in 1/65536 turns, for a family that flies by
   * it. What happened is left in `vehicleStep` (vehicle-state.ts).
   */
  step(w: CollisionWorld, b: Body, moveX: number, moveZ: number, buttons: number, def: D, pilot: boolean, environment?: VehicleWorld, yaw?: number, pitch?: number): void;
  /** The parts it meets the world and other vehicles with, its hazard parts first. */
  parts(def: D): readonly Shape[];
  /** Where its jointed parts stand at `frame`, by joint (a boat's outboards); null where no part turns on a joint. */
  mounts(def: D, frame: VehicleFrame): readonly SolidFrame[] | null;
  /** Its jointed parts swept between two frames, for a block test; undefined where none turns. */
  joints(def: D, from: VehicleFrame, to: VehicleFrame): SolidJoint[] | undefined;
  /** Where joint `joint` turns, from the hull's origin, so a part swung about it is reached in full. */
  jointPivot(def: D, joint: number): readonly [number, number, number] | undefined;
  /** What a hazard part of it is to what it meets: a rotor, a propeller, or none. */
  readonly hazard: "rotor" | "propeller" | null;
  /** It at `frame` against an upright capsule of `radius`, `height` standing at `x`, `y`, `z`. */
  meetsCapsule(def: D, frame: VehicleFrame, x: number, y: number, z: number, radius: number, height: number): ContactGeometry & { rotor?: boolean; propeller?: boolean } | null;
  /** It at `frame` against another vehicle at `otherFrame`. The answer is scratch: copy it before the next query. */
  meetsVehicle(def: D, frame: VehicleFrame, other: VehicleDefinition, otherFrame: VehicleFrame): VehicleMeeting | null;
  /** It at `frame` against a structure of `kind` placed at `sx`, `sy`, `sz` facing `syaw`. */
  meetsKind(def: D, parts: PartTable, kind: number, sx: number, sy: number, sz: number, syaw: number, stw: number, frame: VehicleFrame, slack?: number): boolean;
  /** The slack it is met with when the world clears room for a structure among vehicles (server/wreck-clearance.ts). */
  readonly clearSlack: number;
  /** Whether the world holds it up at `x`, `y`, `z` facing `yaw`, as it would be set down: ground, a pad, or water. */
  supports(world: CollisionWorld, x: number, y: number, z: number, yaw: number, def: D): boolean;
  /** The boxes a ragdoll meets it as (vehicle-movers.ts): centre and half size, six numbers each, in its frame. */
  movers(def: D): number[];
}

/** The one place a row is widened to take any definition: a family only ever gets definitions its `is` accepts. */
const family = <D extends VehicleDefinition>(row: VehicleFamily<D>): VehicleFamily => row as unknown as VehicleFamily;

/** A family whose code may come after the rest: its row answers as that code once it is given. */
export interface LaterFamily extends VehicleFamily {
  /** Whether its code has come. Until then a vehicle of it does not move, meets nothing, and is not checked. */
  readonly ready: boolean;
  give(code: VehicleFamily): void;
}

/**
 * Asked each time a row whose code has not come is wanted for more than a check: a browser fetches the code the first
 * time (client/core/jet-load.ts). The server and the tools load every family as they start.
 */
export const familyWanted: { ask: ((name: string) => void) | null } = { ask: null };

/** The row of a family whose code is given later (the jet's: families/jet.ts gives it as it loads). */
export function laterFamily(name: string): LaterFamily {
  let code: VehicleFamily | null = null;
  const want = (): VehicleFamily | null => {
    if (!code) familyWanted.ask?.(name);
    return code;
  };
  return {
    name,
    get ready() { return code !== null; },
    give(c) { code = c; },
    is: (d): d is VehicleDefinition => d.movement === name,
    // The server checks what it sends; a browser that has not the code yet takes it as checked.
    validateSpec: (d) => code?.validateSpec(d),
    validateRig: (d) => code?.validateRig(d),
    step: (w, b, moveX, moveZ, buttons, def, pilot, environment, yaw, pitch) => want()?.step(w, b, moveX, moveZ, buttons, def, pilot, environment, yaw, pitch),
    parts: (def) => want()?.parts(def) ?? [],
    mounts: (def, frame) => want()?.mounts(def, frame) ?? null,
    joints: (def, from, to) => want()?.joints(def, from, to),
    jointPivot: (def, joint) => want()?.jointPivot(def, joint),
    get hazard() { return code?.hazard ?? null; },
    get clearSlack() { return code?.clearSlack ?? 0; },
    meetsCapsule: (def, frame, x, y, z, radius, height) => want()?.meetsCapsule(def, frame, x, y, z, radius, height) ?? null,
    meetsVehicle: (def, frame, other, otherFrame) => want()?.meetsVehicle(def, frame, other, otherFrame) ?? null,
    meetsKind: (def, parts, kind, sx, sy, sz, syaw, stw, frame, slack) => want()?.meetsKind(def, parts, kind, sx, sy, sz, syaw, stw, frame, slack) ?? false,
    supports: (world, x, y, z, yaw, def) => want()?.supports(world, x, y, z, yaw, def) ?? false,
    movers: (def) => want()?.movers(def) ?? [],
  };
}

/** The jet's row: its flight and shapes are a browser's only once it has met a jet. */
export const JET_FAMILY: LaterFamily = laterFamily("jet");

/** Whether `f`'s code is here: false only for a later family whose code has not come, whose answers are not to be kept. */
export const familyReady = (f: VehicleFamily): boolean => (f as Partial<LaterFamily>).ready !== false;

let rows: readonly VehicleFamily[] | null = null;

/**
 * The families, in order. The list is made when first asked for, not as this file loads: a family's own file imports
 * code that leads back here, and may be the first a process loads.
 */
export function families(): readonly VehicleFamily[] {
  return rows ??= [
    family(WHEELED),
    family(ROTOR),
    family(BOAT),
    JET_FAMILY,
  ];
}

/** The family of `d`, or null for a movement no family has. */
export function familyOf(d: VehicleDefinition): VehicleFamily | null {
  const list = families();
  for (let i = 0; i < list.length; i++) if (list[i]!.is(d)) return list[i]!;
  return null;
}
