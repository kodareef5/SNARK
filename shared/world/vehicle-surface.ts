// Physical road properties travel with content and the normal replicated structure kind, never with a render color.
import type { VehicleSurface } from "../sim/vehicle.ts";
import type { CollisionWorld } from "./collide.ts";
import { HIT_STRUCTURE } from "./ray.ts";

export const OFFROAD: VehicleSurface = { id: "ground", grip: 5.5, rolling: .45, drag: .012 };

export function validVehicleSurface(value: unknown): value is VehicleSurface {
  if (!value || typeof value !== "object") return false;
  const s = value as VehicleSurface;
  return typeof s.id === "string" && s.id.length > 0 && s.id.length <= 96 &&
    Number.isFinite(s.grip) && s.grip > 0 && s.grip <= 30 &&
    Number.isFinite(s.rolling) && s.rolling >= 0 && s.rolling <= 10 &&
    Number.isFinite(s.drag) && s.drag >= 0 && s.drag <= 1;
}

/** Called for the actual supporting face; a road overhead or beside the wheel supplies no bonus. */
export function vehicleSurfaceAt(world: CollisionWorld, hit: number, ref: number): VehicleSurface {
  if (hit !== HIT_STRUCTURE) return OFFROAD;
  const chunk = world.structs.chunks[Math.floor(ref / 65536)], slot = ref & 65535;
  const kind = chunk?.kind[slot] ?? 0;
  return world.structs.parts.vehicleSurface?.[kind] ?? OFFROAD;
}
