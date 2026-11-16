// Rotorcraft and boats as they are heard, from the state each snapshot carries: the engine's four layers faded across by
// rotor or engine speed, its start and stop, a rotor's downwash over ground or water and its cabin for whoever is inside,
// and the water at a hull. Each is asked of the vehicle's own id, which falls back to its family (core:helicopter,
// core:boat, by vehicleFamilies) before the shared car's, so a livery is heard as its vehicle is. Each loop is wanted only
// within its own range (Sounds.loop).

import { CUE_DEAD } from "../../../shared/anim/pose.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { cueKey } from "../../../shared/sound/cues.ts";
import { isBoatVehicle, isRotorVehicle } from "../../../shared/sim/vehicle.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { RemoteSample } from "../session.ts";
import type { Hear } from "./bodies.ts";

/** Plays a loop while `on`, keyed by `id`, at (x, y, z), or at the ear where `flat`. */
export type Place = (id: number, owner: number, key: number, x: number, y: number, z: number, level: number, on: boolean, flat: boolean) => void;

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
  /** By content index: the owner a vehicle is heard as (-1 for a kind this does not hear), how, and its full speed. */
  private readonly owner: Int32Array;
  private readonly how: Uint8Array;
  private readonly full: Float32Array;
  /** By entity: whether its engine ran when last heard, so a start or a stop is heard once. */
  private readonly running = new Map<number, boolean>();
  private readonly seen = new Set<number>();
  private readonly levels = [0, 0, 0, 0];

  constructor(reg: Registry, ownerOf: (id: string) => number) {
    const n = reg.defs.length;
    this.owner = new Int32Array(n).fill(-1);
    this.how = new Uint8Array(n);
    this.full = new Float32Array(n);
    for (let kind = 0; kind < n; kind++) {
      const v = reg.vehicle[kind];
      if (!v || !(isRotorVehicle(v) || isBoatVehicle(v))) continue;
      this.owner[kind] = ownerOf(reg.ids[kind]!);
      this.how[kind] = isRotorVehicle(v) ? ROTOR : BOAT;
      this.full[kind] = isRotorVehicle(v) ? v.spec.rotorRpm : v.spec.maxRpm;
    }
  }

  /** `inside` is the entity the ear sits in, or -1. `want` is told of what may be heard soon, and how far off it is. */
  update(remote: RemoteSample, hf: Heightfield, ex: number, ey: number, ez: number, inside: number, hear: Hear, place: Place, want: (owner: number, key: number, metres: number) => void): void {
    this.seen.clear();
    for (let i = 0; i < remote.count; i++) {
      const kind = remote.kind[i]!, owner = this.owner[kind] ?? -1;
      if (owner < 0 || (remote.flags[i]! & 8) !== 0 || (remote.cue[i]! & CUE_DEAD) !== 0) continue;
      const id = remote.id[i]!, x = remote.x[i]!, y = remote.y[i]!, z = remote.z[i]!, rotor = this.how[kind] === ROTOR;
      const d = id === inside ? 0 : Math.hypot(x - ex, y - ey, z - ez);
      if (d >= REACH) continue;
      if (d < NEAR) {
        want(owner, K_START, d);
        want(owner, K_STOP, d);
      }
      this.seen.add(id);
      const on = remote.vehicleEngineOn[i] !== 0, base = VEHICLE_LOOPS + id * 8;
      // A rotor turns on after its engine stops; a boat's engine is still once it is off.
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
      } else {
        const afloat = wet && Math.abs(y - water) < AFLOAT, fast = share >= HULL_FAST;
        place(base + 5, owner, K_HULL_SLOW, x, water, z, 1, afloat && !fast, false);
        place(base + 6, owner, K_HULL_FAST, x, water, z, Math.min(1, share), afloat && fast, false);
      }
    }
    for (const id of this.running.keys()) if (!this.seen.has(id)) this.running.delete(id);
  }
}
