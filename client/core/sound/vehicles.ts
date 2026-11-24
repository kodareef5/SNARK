// Vehicles as they are heard, from the state each snapshot carries: the engine's four layers faded across by rotor or
// engine speed, its start and stop, a rotor's downwash over ground or water and its cabin for whoever is inside, and the
// water at a hull. Each is asked of the vehicle's own id, which falls back to its family (core:helicopter, core:boat, by
// vehicleFamilies) before the shared car's, so a livery is heard as its vehicle is. Each loop is wanted only within its
// own range (Sounds.loop).

import { CUE_DEAD } from "../../../shared/anim/pose.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { cueKey } from "../../../shared/sound/cues.ts";
import { BAIL, FLIP, GRAB, GRIND, OLLIE, PUSH, REVERT, ROLL, SLIDE, SPECIAL } from "../../../shared/sim/skate-state.ts";
import { isBoatVehicle, isRotorVehicle } from "../../../shared/sim/vehicle.ts";
import { DEFAULT_DRIVETRAIN } from "../../../shared/sim/vehicle-drivetrain.ts";
import { FIRED_BOOST, thrustBurstTick, thrustersOf } from "../../../shared/sim/vehicle-thrusters.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { RemoteSample } from "../session.ts";
import type { Hear } from "./bodies.ts";

/** Plays a loop while `on`, keyed by `id`, at (x, y, z), or at the ear where `flat`. `fadeMs` is how long it takes to come up and go, where not the loops' own. */
export type Place = (id: number, owner: number, key: number, x: number, y: number, z: number, level: number, on: boolean, flat: boolean, fadeMs?: number) => void;

const LAYERS = ["idle", "low", "mid", "high"].map((r) => cueKey(`engine/${r}`));
/** The engine's speed, as a share of its full speed, at which each layer is loudest, and how far either side it fades out. */
const CENTRES = [0.12, 0.4, 0.7, 1];
const SPREAD = 0.3;
const K_START = cueKey("engine/start");
const K_STOP = cueKey("engine/stop");
const K_WASH = cueKey("vehicle/wash");
const K_WASH_WATER = cueKey("vehicle/wash/water");
const K_CABIN = cueKey("vehicle/cabin");
const K_HULL_SLOW = cueKey("vehicle/hull/slow");
const K_HULL_FAST = cueKey("vehicle/hull/fast");
const K_BOOST = cueKey("vehicle/thruster/boost");
const K_BURST = cueKey("vehicle/thruster/burst");
/** Downwash is heard from this height over what is under the rotor down to it, from this share of rotor speed. */
const WASH_HEIGHT = 15;
const WASH_SPIN = 0.6;
/** A hull is in the water within this of the surface, and runs fast above this share of its engine's speed. */
const AFLOAT = 2;
const HULL_FAST = 0.6;
/** Farther than this a vehicle is not followed: its loudest layer's reach. */
const REACH = 400;
/** Within this, or from inside, an engine's start and stop are held before they are heard. */
const NEAR = 40;
/** Inside, the engine is heard through the cabin and the outside layers this much quieter. */
const INSIDE = 0.35;
/** Loop ids from here: eight for each entity. */
export const VEHICLE_LOOPS = 1_000_000;
const ROTOR = 1;
const BOAT = 2;
const CAR = 3, BOARD = 4;
const skateRoll = cueKey("vehicle/roll/smooth"), skateRough = cueKey("vehicle/roll/rough");
const skateLand = cueKey("vehicle/land"), skatePush = cueKey("vehicle/push"), skatePop = cueKey("vehicle/ollie");
const skateGrind = cueKey("vehicle/grind"), skateCrash = cueKey("vehicle/crash/light");
const skateFlip = cueKey("vehicle/flip"), skateCatch = cueKey("vehicle/catch"), skateRevert = cueKey("vehicle/revert");
const skateGrindLoop = cueKey("vehicle/grind/loop"), skateSlideLoop = cueKey("vehicle/slide/loop");

/** The level of each engine layer at engine speed `share` (0 at rest, 1 at full). */
export function engineLayers(share: number, out: number[] = [0, 0, 0, 0]): number[] {
  const s = Math.max(0, Math.min(1, share));
  for (let i = 0; i < 4; i++) out[i] = Math.max(0, 1 - Math.abs(s - CENTRES[i]!) / SPREAD);
  // From rest the idle comes in with the engine, and at full speed the high layer is whole.
  if (s < CENTRES[0]!) out[0] = s / CENTRES[0]!;
  if (s >= 1) out[3] = 1;
  return out;
}

export class VehicleSounds {
  /** By content index: the owner a vehicle is heard as (-1 for none), how, its full speed, and its driver's seat slot. */
  private readonly owner: Int32Array;
  private readonly how: Uint8Array;
  private readonly full: Float32Array;
  private readonly driver: Uint8Array;
  /** By entity: whether its engine ran when last heard, so a start or a stop is heard once. */
  private readonly skating = new Map<number, { move: number; phase: number; ground: boolean; flipped: boolean }>();
  private readonly running = new Map<number, boolean>();
  private readonly seen = new Set<number>();
  /** Seats taken this frame, as host entity * 256 + seat slot. */
  private readonly taken = new Set<number>();
  private readonly levels = [0, 0, 0, 0];
  /** By content index, 1 for a car with thrusters; by entity, the burst tick last heard, so a burst is heard once. */
  private readonly thrusters: Uint8Array;
  private readonly burst = new Map<number, number>();

  constructor(reg: Registry, ownerOf: (id: string) => number) {
    const n = reg.defs.length;
    this.owner = new Int32Array(n).fill(-1);
    this.how = new Uint8Array(n);
    this.full = new Float32Array(n);
    this.driver = new Uint8Array(n);
    this.thrusters = new Uint8Array(n);
    for (let kind = 0; kind < n; kind++) {
      const v = reg.vehicle[kind];
      if (!v) continue;
      this.owner[kind] = ownerOf(reg.ids[kind]!);
      this.how[kind] = isRotorVehicle(v) ? ROTOR : isBoatVehicle(v) ? BOAT : v.frame === "skateboard" ? BOARD : CAR;
      this.full[kind] = isRotorVehicle(v) ? v.spec.rotorRpm : isBoatVehicle(v) ? v.spec.maxRpm : (v.spec.drivetrain ?? DEFAULT_DRIVETRAIN).redlineRpm;
      this.driver[kind] = v.seats.findIndex((s) => s.driver) + 1;
      this.thrusters[kind] = thrustersOf(v) ? 1 : 0;
    }
  }

  /** `inside` is the entity the ear sits in, or -1. `want` is told of what may be heard soon, and how far off it is. */
  update(remote: RemoteSample, hf: Heightfield, ex: number, ey: number, ez: number, inside: number, hear: Hear, place: Place, want: (owner: number, key: number, metres: number) => void): void {
    this.seen.clear();
    this.taken.clear();
    for (let i = 0; i < remote.count; i++) if (remote.seat[i]! > 0) this.taken.add((remote.seat[i]! - 1) * 256 + remote.seatSlot[i]!);
    for (let i = 0; i < remote.count; i++) {
      const kind = remote.kind[i]!, owner = this.owner[kind] ?? -1;
      if (owner < 0 || (remote.flags[i]! & 8) !== 0 || (remote.cue[i]! & CUE_DEAD) !== 0) continue;
      const id = remote.id[i]!, x = remote.x[i]!, y = remote.y[i]!, z = remote.z[i]!, rotor = this.how[kind] === ROTOR;
      const d = id === inside ? 0 : Math.hypot(x - ex, y - ey, z - ez);
      if (d >= REACH) continue;
      if (this.how[kind] === BOARD) {
        const move = remote.vehicleGear[i]!, phase = remote.wheelAngle[i]!, ground = !!remote.vehicleGrounded[i];
        const was = this.skating.get(id), speed = remote.vehicleRpm[i]! / 100, flat = id === inside;
        if (was) {
          let event = 0, after = 0;
          const edge = move === GRIND || move === SLIDE, wasEdge = was.move === GRIND || was.move === SLIDE;
          if (move === BAIL && was.move !== BAIL) event = skateCrash;
          else if (edge && !wasEdge) event = skateGrind;
          else if (!was.ground && ground) {
            // The wheels come down, and after a trick the feet catch the deck.
            event = skateLand;
            if (was.flipped) after = skateCatch;
          } else if (was.ground && !ground && (move === OLLIE || move === FLIP || move === GRAB || move === SPECIAL)) event = skatePop;
          else if (move === FLIP && was.move !== FLIP) event = skateFlip;
          else if (move === REVERT && was.move !== REVERT) event = skateRevert;
          else if (move === PUSH && (was.move !== PUSH || phase + 1 < was.phase)) event = skatePush;
          if (event) hear(owner, event, id, x, y, z, 1, Math.min(1, .55 + speed * .05), flat);
          if (after) hear(owner, after, id, x, y, z, 1, .7, flat);
        }
        // The wheels' roar rises with speed; an edge has a grind or a slide of its own in its place.
        const cls = hf.groundClassAt(x,z), rough = cls !== 1 && cls !== 2;
        place(VEHICLE_LOOPS + id*8, owner, rough ? skateRough : skateRoll, x, y, z, Math.min(1, .15 + speed/9), ground && move !== GRIND && move !== SLIDE && speed > .3, flat);
        place(VEHICLE_LOOPS + id*8 + 1, owner, skateGrindLoop, x, y, z, Math.min(1, .5 + speed/12), move === GRIND, flat);
        place(VEHICLE_LOOPS + id*8 + 2, owner, skateSlideLoop, x, y, z, Math.min(1, .45 + speed/12), move === SLIDE, flat);
        const flipped = !ground && (move === FLIP || move === SPECIAL || was?.flipped === true && move !== ROLL);
        this.skating.set(id, { move, phase, ground, flipped }); this.seen.add(id);
        continue;
      }
      if (d < NEAR) {
        want(owner, K_START, d);
        want(owner, K_STOP, d);
      }
      this.seen.add(id);
      // A car has no switch: its engine runs while it has fuel and its driver's seat is taken.
      const car = this.how[kind] === CAR, base = VEHICLE_LOOPS + id * 8;
      const on = car ? remote.vehicleFuel[i]! > 0 && this.taken.has(id * 256 + this.driver[kind]!) : remote.vehicleEngineOn[i] !== 0;
      // A rotor turns on after its engine stops; a boat's or a car's engine is still once it is off.
      const share = (rotor ? remote.vehicleRotorRpm[i]! : on ? remote.vehicleRpm[i]! : 0) / Math.max(1, this.full[kind]!);
      const was = this.running.get(id);
      if (was !== undefined && was !== on) hear(owner, on ? K_START : K_STOP, id, x, y, z, 1, 1, id === inside);
      this.running.set(id, on);
      const heard = share > 0.01;
      const layers = engineLayers(share, this.levels);
      for (let l = 0; l < 4; l++) place(base + l, owner, LAYERS[l]!, x, y + (rotor ? 2 : 0), z, layers[l]! * (rotor && id === inside ? INSIDE : 1), heard && layers[l]! > 0.01, false);
      const ground = hf.heightAt(x, z), water = hf.waterAt(x, z), wet = water > ground;
      if (rotor) {
        place(base + 4, owner, K_CABIN, 0, 0, 0, Math.max(0.2, Math.min(1, share)), heard && id === inside, true);
        // The rotor's wash lands on what is under it: the water's surface where that is higher than the ground.
        const under = wet ? water : ground, wash = share >= WASH_SPIN ? Math.max(0, 1 - (y - under) / WASH_HEIGHT) : 0;
        place(base + 5, owner, K_WASH, x, under, z, wash, wash > 0.01 && !wet, false);
        place(base + 6, owner, K_WASH_WATER, x, under, z, wash, wash > 0.01 && wet, false);
      } else if (this.thrusters[kind]) {
        // A thruster car: its boost roars while it fires, and a burst is heard once as it begins, from where it is.
        const thrust = remote.vehicleThrust[i]!, burst = thrustBurstTick(thrust);
        place(base + 7, owner, K_BOOST, x, y, z, 1, (thrust & FIRED_BOOST) !== 0, false);
        if (d < NEAR * 4) want(owner, K_BURST, d);
        if (burst > 0 && burst <= 3 && (this.burst.get(id) ?? 0) === 0) hear(owner, K_BURST, id, x, y, z, 1, 1, id === inside);
        this.burst.set(id, burst);
      } else if (!car) {
        const afloat = wet && Math.abs(y - water) < AFLOAT, fast = share >= HULL_FAST;
        place(base + 5, owner, K_HULL_SLOW, x, water, z, 1, afloat && !fast, false);
        place(base + 6, owner, K_HULL_FAST, x, water, z, Math.min(1, share), afloat && fast, false);
      }
    }
    for (const id of this.skating.keys()) if (!this.seen.has(id)) this.skating.delete(id);
    for (const id of this.running.keys()) if (!this.seen.has(id)) this.running.delete(id);
    for (const id of this.burst.keys()) if (!this.seen.has(id)) this.burst.delete(id);
  }
}
