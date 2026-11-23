import { clamp } from "../math/scalar.ts";
import type { VehicleDefinition } from "./vehicle.ts";

/** How far open each door is, door d (VehicleDefinition.doors) in bits 8d to 8d + 7: up to MAX_VEHICLE_DOORS. */
export const vehicleDoor = (packed: number, door: number): number => ((packed >>> (door * 8)) & 255) / 255;
export function withVehicleDoor(packed: number, door: number, open: number): number {
  const shift = door * 8;
  return ((packed & ~(255 << shift)) | (Math.round(clamp(open, 0, 1) * 255) << shift)) >>> 0;
}

export function blendDoors(before: number, after: number, share: number): number {
  if (before === after) return after;
  let packed = 0;
  for (let shift = 0; shift < 32; shift += 8) {
    const a = (before >>> shift) & 255, b = (after >>> shift) & 255;
    packed |= Math.round(a + (b - a) * share) << shift;
  }
  return packed >>> 0;
}

const boxes = new WeakMap<VehicleDefinition, Float64Array>();

/** The panels' closed bounds, then bounds which include each door's full travel. */
export function panelBounds(def: VehicleDefinition): Float64Array {
  const known = boxes.get(def);
  if (known) return known;
  const bounds = Float64Array.from([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity,
    Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  for (const panel of def.breakablePanels ?? []) for (const face of panel.faces) for (const p of face) {
    const hinge = panel.hinge, door = panel.door === undefined ? undefined : def.doors[panel.door];
    const radius = hinge ? Math.hypot(p[0] - hinge[0], p[1] - hinge[1], p[2] - hinge[2]) : 0;
    for (let i = 0; i < 3; i++) {
      let low = p[i]!, high = low;
      bounds[i] = Math.min(bounds[i]!, low);
      bounds[i+3] = Math.max(bounds[i+3]!, high);
      if (door?.slide) {
        const travel = i === 0 ? door.slide.outward : i === 2 ? door.slide.along : 0;
        low += Math.min(0, travel); high += Math.max(0, travel);
      } else if (hinge) {
        low = hinge[i]! - radius; high = hinge[i]! + radius;
      }
      bounds[i+6] = Math.min(bounds[i+6]!, low);
      bounds[i+9] = Math.max(bounds[i+9]!, high);
    }
  }
  boxes.set(def, bounds);
  return bounds;
}
