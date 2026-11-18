// Physical road properties travel with content and the normal replicated structure kind, never with a render color.
import type { VehicleSurface } from "../sim/vehicle.ts";
import type { CollisionWorld } from "./collide.ts";
import { HIT_STRUCTURE } from "./ray.ts";

export const OFFROAD: VehicleSurface = { id: "ground", grip: 5.5, rolling: .45, drag: .012 };
export const ASPHALT: VehicleSurface = { id: "asphalt", grip: 7, rolling: 0.15, drag: 0.009 };
export const PAVING: VehicleSurface = { id: "paving", grip: 6.5, rolling: 0.2, drag: 0.01 };
export const GRAVEL: VehicleSurface = { id: "gravel", grip: 3.5, rolling: 0.5, drag: 0.018 };
export const SAND: VehicleSurface = { id: "sand", grip: 2.6, rolling: 0.9, drag: 0.03 };
export const MUD: VehicleSurface = { id: "mud", grip: 1.8, rolling: 1.1, drag: 0.035 };

/**
 * The ground's surfaces by the class a map gives each 4 m of its ground (MapData.ground; the build sets it from what it
 * made each sample, tools/mapworld/ground.ts): what a wheel meets where it stands on the terrain, not on a structure.
 * A class the table has no row for is ground.
 */
export const GROUND_CLASS = { GROUND: 0, ASPHALT: 1, PAVING: 2, GRAVEL: 3, SAND: 4, MUD: 5 } as const;
const GROUND_SURFACES: readonly VehicleSurface[] = [OFFROAD, ASPHALT, PAVING, GRAVEL, SAND, MUD];

export function validVehicleSurface(value: unknown): value is VehicleSurface {
  if (!value || typeof value !== "object") return false;
  const s = value as VehicleSurface;
  return typeof s.id === "string" && s.id.length > 0 && s.id.length <= 96 &&
    Number.isFinite(s.grip) && s.grip > 0 && s.grip <= 30 &&
    Number.isFinite(s.rolling) && s.rolling >= 0 && s.rolling <= 10 &&
    Number.isFinite(s.drag) && s.drag >= 0 && s.drag <= 1;
}

/** Called for the actual supporting face; a road overhead or beside the wheel supplies no bonus. */
export function vehicleSurfaceAt(world: CollisionWorld, hit: number, ref: number, x = NaN, z = NaN): VehicleSurface {
  if (hit !== HIT_STRUCTURE) return Number.isNaN(x) ? OFFROAD : GROUND_SURFACES[world.hf.groundClassAt(x, z)] ?? OFFROAD;
  const chunk = world.structs.chunks[Math.floor(ref / 65536)], slot = ref & 65535;
  const kind = chunk?.kind[slot] ?? 0;
  return world.structs.parts.vehicleSurface?.[kind] ?? OFFROAD;
}
