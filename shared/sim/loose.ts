// A loose thing: a knife, a pistol, anything let go of, as one rigid capsule that tumbles, strikes walls and floors,
// slides and comes to rest. It is the corpse ragdoll (shared/anim/ragdoll.ts) with a single body, so it has that solver's
// contacts with the terrain, structures and resource nodes, its friction and rolling resistance and its sleep, and is
// stepped as exactly on every engine as a corpse is (D20).
//
// The capsule lies along the thing's own +Z, its length, and is centred on its middle. Thrown, it starts along the throw
// with the throw's speed and a spin end over end about the thrower's right, as a thing flicked from the hand turns.

import { ANIM_ACTION_SHIFT } from "../anim/pose.ts";
import { Ragdoll, type RagdollDef } from "../anim/ragdoll.ts";
import { Solved, type Skeleton } from "../anim/skeleton.ts";
import { detAtan2, detCos, detSin } from "../math/scalar.ts";
import { quatRotate } from "../math/quat.ts";
import type { CollisionWorld } from "../world/collide.ts";
import { TICK_DT } from "../coords.ts";

/**
 * A thing in flight is a bag whose hold is this (shared/anim/pose.ts AnimState.setAction), so that a client draws it
 * along the way its length points, as a stuck arrow is drawn, and not lying flat.
 */
export const LOOSE_FLIGHT = 1;

/** Whether a body's packed anim word (EntityStore.pose) says a thing in flight. */
export function inFlight(anim: number): boolean {
  return ((anim >>> ANIM_ACTION_SHIFT) >>> 3 & 7) === LOOSE_FLIGHT;
}

/** How far a bag lying is drawn turned from its yaw by its entity `id`, in 65536ths of a turn, so things dropped together do not lie in line. */
export function droppedTurn(id: number): number {
  return Math.imul(id, 0x9e3779b1) >>> 16;
}

/** Half its length along +Z, its radius, and its mass in kg. */
export interface LooseShape {
  readonly half: number;
  readonly radius: number;
  readonly mass: number;
}

/**
 * What a thing of `weight` (its weight in the inventory, ARK's units, about four to a kilogram held) is thrown as: the
 * heavier, the longer, thicker and heavier. A pistol of 5 is about 30 cm long, 6.6 cm thick and 1.25 kg; a stone of 0.5
 * a 23 cm stub; a rifle of 12 is held to 3 kg and 50 cm.
 */
export function looseShape(weight: number): LooseShape {
  const mass = weight * 0.25 < 0.2 ? 0.2 : weight * 0.25 > 3 ? 3 : weight * 0.25;
  const half = 0.11 + mass * 0.03;
  const radius = 0.018 + mass * 0.012;
  return { half: half > 0.25 ? 0.25 : half, radius: radius > 0.055 ? 0.055 : radius, mass };
}

/** A one-bone skeleton for `shape`: its capsule along +Z about the joint. */
function looseSkeleton(shape: LooseShape): Skeleton {
  return {
    id: "loose",
    bones: 1,
    names: ["thing"],
    parent: Int8Array.of(-1),
    rest: new Float32Array(3),
    zoneBones: 1,
    zone: new Uint8Array(1),
    capA: Float32Array.of(0, 0, -shape.half),
    capB: Float32Array.of(0, 0, shape.half),
    capR: Float32Array.of(shape.radius),
  };
}

function looseDef(shape: LooseShape): RagdollDef {
  return {
    limp: 0,
    bone: Int16Array.of(0),
    mass: Float64Array.of(shape.mass),
    swing: Float64Array.of(Math.PI),
    twist: Float64Array.of(Math.PI),
  };
}

const along = new Float64Array(3);
/** Of the spin end over end, the share about the vertical. */
const WOBBLE = 0.15;

export class LooseBody {
  readonly shape: LooseShape;
  readonly doll: Ragdoll;
  private readonly now = new Solved(1);
  /** Seconds since it was let go of. */
  age = 0;

  constructor(shape: LooseShape) {
    this.shape = shape;
    this.doll = new Ragdoll(looseSkeleton(shape), looseDef(shape));
  }

  /**
   * Lets it go at (x, y, z), its length along the unit direction (dx, dy, dz), moving at `speed` along it, plus the
   * velocity (vx, vy, vz) of the hand, and turning end over end at `spin` radians a second.
   */
  throw(x: number, y: number, z: number, dx: number, dy: number, dz: number, speed: number, vx: number, vy: number, vz: number, spin: number): void {
    const flat = Math.sqrt(dx * dx + dz * dz);
    const yaw = flat > 1e-9 ? detAtan2(dx, dz) : 0;
    const pitch = detAtan2(dy, flat);
    // Pitched up by `pitch`: a turn of -pitch about +X takes +Z to (0, sin pitch, cos pitch).
    const rot = this.now.rot;
    rot[0] = detSin(-pitch / 2);
    rot[1] = 0;
    rot[2] = 0;
    rot[3] = detCos(-pitch / 2);
    this.now.pos[0] = this.now.pos[1] = this.now.pos[2] = 0;
    this.doll.start(this.now, this.now, x, y, z, yaw, 1);
    // End over end: about the thrower's right, (cos yaw, 0, -sin yaw), the tip going down ahead.
    const rx = flat > 1e-9 ? dz / flat : 1, rz = flat > 1e-9 ? -dx / flat : 0;
    // A hand never flicks a thing in one plane: a little wobble about the vertical, so it does not fall flat down a wall
    // and come to rest standing on its point.
    this.doll.launch(dx * speed + vx, dy * speed + vy, dz * speed + vz, rx * spin, spin * WOBBLE, rz * spin);
    this.age = 0;
  }

  /** Steps one tick. Whether it still moves. */
  step(world: CollisionWorld): boolean {
    this.age += TICK_DT;
    return this.doll.step(world, TICK_DT);
  }

  get awake(): boolean {
    return this.doll.awake;
  }

  /** Its middle. */
  get x(): number { return this.doll.x[0]!; }
  get y(): number { return this.doll.x[1]!; }
  get z(): number { return this.doll.x[2]!; }

  /** Its velocity, which a hit may change. */
  get v(): Float64Array { return this.doll.v; }

  /** The unit direction of its length, into `out`. */
  axis(out: Float64Array): void {
    quatRotate(this.doll.q, 0, 0, 0, 1, along, 0);
    out[0] = along[0]!;
    out[1] = along[1]!;
    out[2] = along[2]!;
  }

  /** Its speed, metres a second. */
  speed(): number {
    const v = this.doll.v;
    return Math.sqrt(v[0]! * v[0]! + v[1]! * v[1]! + v[2]! * v[2]!);
  }
}
