// Coarse geometry for a shared reflection. Shape coordinates and palette overrides come from
// the visual definition. Only convex detail is replaced by its bounding box.
import type { ShapeBox } from "../../../shared/content/defs.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { isWheelVehicle } from "../../../shared/sim/vehicle.ts";
import { hullPoint } from "../../../shared/world/convex.ts";

export function streetSilhouette(reg: Registry, kind: number): readonly ShapeBox[] | null {
  const vehicle = reg.vehicle[kind];
  if (vehicle && isWheelVehicle(vehicle) && vehicle.shotPanels?.length) {
    const { spec, beltline, shotPanels } = vehicle;
    let front = -Infinity,
      rear = Infinity,
      roof = beltline;
    for (const panel of shotPanels) {
      for (const point of panel) {
        front = Math.max(front, point[2]);
        rear = Math.min(rear, point[2]);
        roof = Math.max(roof, point[1]);
      }
    }
    const upper = (roof - beltline) * 0.5,
      z = (front + rear) * 0.5,
      length = (front - rear) * 0.5;
    const low = spec.wheelRadius * 0.85;
    const parts: ShapeBox[] = [
      { at: [0, (low + beltline) / 2, 0], half: [spec.halfWidth * 0.96, (beltline - low) / 2, spec.halfLength] },
      { at: [0, beltline + upper, z], half: [spec.halfWidth * 0.82, upper, length * 0.87], color: 83 },
      { at: [0, roof - 0.04, z], half: [spec.halfWidth * 0.81, 0.04, length * 0.83] },
    ];
    const axles = spec.axles ?? [
      { z: -spec.wheelbase / 2, track: spec.track },
      { z: spec.wheelbase / 2, track: spec.track },
    ];
    for (const axle of axles)
      for (const sign of [-1, 1]) {
        const r = spec.wheelRadius;
        parts.push({ at: [(sign * axle.track) / 2, r, axle.z], half: [r * 0.42, r, r * 0.91], color: 230 });
      }
    return parts;
  }
  const d = reg.defs[kind];
  if (d?.type !== "structure" || d.mesh !== "shape" || !d.shape) return null;
  const shape = reg.defs[reg.index.get(d.shape) ?? 0];
  if (shape?.type !== "shape" || !shape.look) return null;
  const look = shape.look;
  const parts: ShapeBox[] = [...(look.boxes ?? [])];
  for (const hull of look.hulls ?? []) {
    const lo = [Infinity, Infinity, Infinity],
      hi = [-Infinity, -Infinity, -Infinity];
    const point: [number, number, number] = [0, 0, 0];
    for (const corner of hull.corners) {
      const xyz = hullPoint(corner, hull.sixty === true, point);
      for (let c = 0; c < 3; c++) {
        lo[c] = Math.min(lo[c]!, xyz[c]!);
        hi[c] = Math.max(hi[c]!, xyz[c]!);
      }
    }
    parts.push({
      at: [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2],
      half: [(hi[0]! - lo[0]!) / 2, (hi[1]! - lo[1]!) / 2, (hi[2]! - lo[2]!) / 2],
    });
  }
  return parts.length > 0 && parts.length <= 64 ? parts : null;
}
