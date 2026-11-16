import source from "./cruise-layout.json" with { type: "json" };
import { cruiseLayoutFaults, cruiseParts, type CruiseLayout } from "./cruise-layout.ts";
import { shapeHalf, type Def, type ShapeDef, type StructureDef } from "../../shared/content/defs.ts";
import { STRUCT_UNITS, YAW_UNITS } from "../../shared/coords.ts";
import { frameAxes, HALF_SIDE } from "../../shared/world/frame.ts";
import type { MapStatic } from "../../shared/world/mapfile.ts";

export const CRUISE_LAYOUT = source;
const layout: CruiseLayout = source;
const faults = cruiseLayoutFaults(layout);
if (faults.length) throw new Error(`cruise layout: ${faults.join("; ")}`);

/** One pair of definitions per prototype. Every cabin, rail and door placement reuses those native kinds. */
export const CRUISE_CONTENT: readonly Def[] = layout.prototypes.flatMap(prototype => {
  const collision = cruiseParts(prototype);
  const shape: ShapeDef = { type: "shape", id: `${prototype.id}_shape`, role: prototype.category === "door" ? "door" : "thing",
    boxes: collision.boxes ?? [], hulls: collision.hulls, ...(prototype.look ? { look: cruiseParts(prototype.look) } : {}) };
  const structure: StructureDef = { type: "structure", class: "static", id: prototype.id, mesh: prototype.mesh, shape: shape.id,
    half: shapeHalf(shape.boxes, shape.hulls, shape.look), color: prototype.color, hp: 10000,
    ...(prototype.opens ? { opens: prototype.opens } : {}) };
  return [shape, structure];
});

/** Ship-local metres to map metres, using exactly the native lattice yaw frame. */
export function cruisePoint(x: number, y: number, z: number, yaw: number, local: readonly number[]): readonly [number, number, number] {
  const axes = new Int32Array(4); frameAxes(yaw, axes);
  return [x + (local[0]! * axes[0]! + local[2]! * axes[2]!) / HALF_SIDE,
    y + local[1]!, z + (local[0]! * axes[1]! + local[2]! * axes[3]!) / HALF_SIDE];
}

/** `y` is waterline datum, `yaw` a native 65536-unit turn. Stable JSON order preserves individual saved refs. */
export function cruiseStatics(x: number, y: number, z: number, yaw = 0): MapStatic[] {
  if (![x, y, z].every(Number.isFinite) || !Number.isInteger(yaw)) throw new Error("cruise placement needs finite coordinates and integer native yaw");
  const snap = (v: number) => Math.round(v * STRUCT_UNITS) / STRUCT_UNITS;
  return layout.instances.filter(i => i.placed).map(i => {
    const p = cruisePoint(x, y, z, yaw, i.at);
    return { kind: i.prototype, x: snap(p[0]), y: snap(p[1]), z: snap(p[2]), yaw: (yaw + Math.round(i.yaw * YAW_UNITS / 360)) & (YAW_UNITS - 1) };
  });
}
