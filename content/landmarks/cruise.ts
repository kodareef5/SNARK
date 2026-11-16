import source from "./cruise-layout.json" with { type: "json" };
import { cruiseLayoutFaults, cruiseParts, cruiseTuple, type CruiseLayout } from "./cruise-layout.ts";
import { shapeHalf, type Def, type ShapeDef, type StructureDef } from "../../shared/content/defs.ts";
import { YAW_UNITS } from "../../shared/coords.ts";
import { landmarkPoint, placeLandmark, type Landmark } from "../../shared/world/landmark.ts";
import type { MapStatic } from "../../shared/world/mapfile.ts";

export const CRUISE_LAYOUT = source;
const layout: CruiseLayout = source;
export const CRUISE_COLLISION_PROTOTYPES = layout.collisionPrototypes ?? layout.prototypes;
export const CRUISE_COLLISION_INSTANCES = layout.collisionInstances ?? layout.instances;
const faults = cruiseLayoutFaults(layout);
if (faults.length) throw new Error(`cruise layout: ${faults.join("; ")}`);

/** One pair of definitions per prototype. Every cabin, rail and door placement reuses those native kinds. */
const defs: readonly Def[] = CRUISE_COLLISION_PROTOTYPES.flatMap(prototype => {
  const collision = cruiseParts(prototype);
  const shape: ShapeDef = { type: "shape", id: `${prototype.id}_shape`, role: prototype.category === "door" ? "door" : "thing",
    boxes: collision.boxes ?? [], hulls: collision.hulls, ...(prototype.look ? { look: cruiseParts(prototype.look) } : {}) };
  const structure: StructureDef = { type: "structure", class: "static", id: prototype.id, mesh: prototype.mesh, shape: shape.id,
    half: shapeHalf(shape.boxes, shape.hulls, shape.look), color: prototype.color, hp: 10000,
    ...(prototype.opens ? { opens: prototype.opens } : {}) };
  return [shape, structure];
});

/** Map-local architecture and its berth; neither definitions nor art are part of the core registry. */
export const CRUISE: Landmark = {
  name: "cruise", defs,
  pieces: CRUISE_COLLISION_INSTANCES.filter(i => i.placed).map(i => ({ kind: i.prototype, at: cruiseTuple(i.at), yaw: Math.round(i.yaw * YAW_UNITS / 360) & (YAW_UNITS - 1) })),
  vehicles: [],
  ground: [
    { from: [-layout.dimensions.bridgeBeam / 2 - 6, layout.dimensions.minZ - 8], to: [layout.dimensions.bridgeBeam / 2 + 6, layout.dimensions.maxZ + 8], y: source.dimensions.provisionalKeelY - 2, dig: true },
    { from: [layout.docking.shoreLanding[0]! - .4, layout.docking.shoreLanding[2]! - 16], to: [layout.docking.shoreLanding[0]! + 24, layout.docking.shoreLanding[2]! + 16], y: layout.docking.shoreLanding[1]! },
  ],
};

/** Ship-local metres to map metres, using exactly the native lattice yaw frame. */
export function cruisePoint(x: number, y: number, z: number, yaw: number, local: readonly number[]): readonly [number, number, number] {
  const p = [0, 0, 0]; landmarkPoint(x, y, z, yaw, cruiseTuple(local), p); return cruiseTuple(p);
}

/** `y` is waterline datum, `yaw` a native 65536-unit turn. Stable JSON order preserves individual saved refs. */
export function cruiseStatics(x: number, y: number, z: number, yaw = 0): MapStatic[] {
  if (![x, y, z].every(Number.isFinite) || !Number.isInteger(yaw)) throw new Error("cruise placement needs finite coordinates and integer native yaw");
  return placeLandmark(CRUISE, x, y, z, yaw).statics;
}
