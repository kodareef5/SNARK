// Rotorcraft as they are heard, from the state each snapshot carries (rotor speed, engine on, on the ground): the
// engine's four layers faded across by rotor speed, its start and stop, the downwash over ground or water, and the cabin
// for whoever is inside. Each is asked of the aircraft's own id, which falls back to its family (core:helicopter, by
// vehicleFamilies) before the shared car's, so a livery is heard as the helicopter is. The car's engine stays the
// shell's own (client/core/audio/vehicle.ts), which is silent for a rotor.

import { CUE_DEAD } from "../../../shared/anim/pose.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { cueKey } from "../../../shared/sound/cues.ts";
import { isRotorVehicle } from "../../../shared/sim/vehicle.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { RemoteSample } from "../session.ts";
import type { Hear } from "./bodies.ts";

/** Plays a loop while `on`, keyed by `id`, at (x, y, z), or at the ear where `flat`. */
export type Place = (id: number, owner: number, key: number, x: number, y: number, z: number, level: number, on: boolean, flat: boolean) => void;

const LAYERS = ["idle", "low", "mid", "high"].map((r) => cueKey(`engine/${r}`));
/** The rotor speed, as a share of its own, at which each layer is loudest, and how far either side it fades out. */
const CENTRES = [0.12, 0.4, 0.7, 1];
const SPREAD = 0.3;
const K_START = cueKey("engine/start");
const K_STOP = cueKey("engine/stop");
const K_WASH = cueKey("vehicle/wash");
const K_WASH_WATER = cueKey("vehicle/wash/water");
const K_CABIN = cueKey("vehicle/cabin");
/** Downwash is heard from this height over what is under the rotor down to it, from this share of rotor speed. */
const WASH_HEIGHT = 15;
const WASH_SPIN = 0.6;
/** Farther than this an aircraft is not followed: its loudest layer's reach. */
const REACH = 400;
/** Inside, the engine is heard through the cabin and the outside layers this much quieter. */
const INSIDE = 0.35;
/** Loop ids from here: eight for each entity. */
export const VEHICLE_LOOPS = 1_000_000;

/** The level of each engine layer at rotor speed `share` (0 at rest, 1 at its own speed). */
export function engineLayers(share: number, out: number[] = [0, 0, 0, 0]): number[] {
  const s = Math.max(0, Math.min(1, share));
  for (let i = 0; i < 4; i++) out[i] = Math.max(0, 1 - Math.abs(s - CENTRES[i]!) / SPREAD);
  // From rest the idle comes in with the rotor, and at its own speed the high layer is whole.
  if (s < CENTRES[0]!) out[0] = s / CENTRES[0]!;
  if (s >= 1) out[3] = 1;
  return out;
}

export class VehicleSounds {
  /** By content index: the owner a rotorcraft is heard as, and its rotor's own speed; -1 and 0 for any other kind. */
  private readonly owner: Int32Array;
  private readonly rpm: Float32Array;
  /** By entity: whether its engine ran when last heard, so a start or a stop is heard once. */
  private readonly running = new Map<number, boolean>();
  private readonly seen = new Set<number>();
  private readonly levels = [0, 0, 0, 0];

  constructor(reg: Registry, ownerOf: (id: string) => number) {
    this.owner = Int32Array.from(reg.defs, (_, kind) => {
      const v = reg.vehicle[kind];
      return v && isRotorVehicle(v) ? ownerOf(reg.ids[kind]!) : -1;
    });
    this.rpm = Float32Array.from(reg.defs, (_, kind) => {
      const v = reg.vehicle[kind];
      return v && isRotorVehicle(v) ? v.spec.rotorRpm : 0;
    });
  }

  /** `inside` is the entity the ear sits in, or -1. */
  update(remote: RemoteSample, hf: Heightfield, ex: number, ey: number, ez: number, inside: number, hear: Hear, place: Place): void {
    this.seen.clear();
    for (let i = 0; i < remote.count; i++) {
      const kind = remote.kind[i]!, owner = this.owner[kind] ?? -1;
      if (owner < 0 || (remote.flags[i]! & 8) !== 0 || (remote.cue[i]! & CUE_DEAD) !== 0) continue;
      const id = remote.id[i]!, x = remote.x[i]!, y = remote.y[i]!, z = remote.z[i]!;
      const within = id === inside || Math.hypot(x - ex, y - ey, z - ez) < REACH;
      if (!within) continue;
      this.seen.add(id);
      const share = remote.vehicleRotorRpm[i]! / Math.max(1, this.rpm[kind]!), on = remote.vehicleEngineOn[i] !== 0, base = VEHICLE_LOOPS + id * 8;
      const was = this.running.get(id);
      if (was !== undefined && was !== on) hear(owner, on ? K_START : K_STOP, id, x, y, z, 1, 1, id === inside);
      this.running.set(id, on);
      const heard = share > 0.01;
      const layers = engineLayers(share, this.levels);
      for (let l = 0; l < 4; l++) place(base + l, owner, LAYERS[l]!, x, y + 2, z, layers[l]! * (id === inside ? INSIDE : 1), heard && layers[l]! > 0.01, false);
      place(base + 4, owner, K_CABIN, 0, 0, 0, Math.max(0.2, Math.min(1, share)), heard && id === inside, true);
      // The rotor's wash lands on what is under it: the water's surface where that is higher than the ground.
      const ground = hf.heightAt(x, z), water = hf.waterAt(x, z), wet = water > ground, under = wet ? water : ground;
      const wash = share >= WASH_SPIN ? Math.max(0, 1 - (y - under) / WASH_HEIGHT) : 0;
      place(base + 5, owner, K_WASH, x, under, z, wash, wash > 0.01 && !wet, false);
      place(base + 6, owner, K_WASH_WATER, x, under, z, wash, wash > 0.01 && wet, false);
    }
    for (const id of this.running.keys()) if (!this.seen.has(id)) this.running.delete(id);
  }
}
