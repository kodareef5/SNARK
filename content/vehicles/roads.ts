// Road surfaces for wheels: thin paving pieces with normal placement, ownership, demolition and chunk replication.
// ARK has no paving, so nothing crafts or learns them: a map, a fixture or `place` sets them down. The physical facet
// (`vehicleSurface`) is what a road is to a wheel; the shape and colour are replaceable art.
import type { Def, ShapeDef, StructureDef } from "../../shared/content/defs.ts";
import { ASPHALT, GRAVEL, MUD } from "./compact.ts";

const form: ShapeDef = { type: "shape", id: "core:shape_paving", role: "foundation", boxes: [{ at: [0, 0, 0], half: [1.5, 1 / 32, 1.5] }] };
const surfacePieces = [["asphalt", 4, ASPHALT], ["gravel", 15, GRAVEL], ["mud", 12, MUD]] as const;
export const ROAD_STRUCTURES: readonly StructureDef[] = surfacePieces.map(([name, color, vehicleSurface]) => ({
  type: "structure", class: "piece", id: `core:road_${name}`, mesh: "shape", shape: form.id,
  half: [1.5, 1 / 32, 1.5], color, hp: 1500, material: "core:mat_stone", vehicleSurface,
}));
export const ROADS: readonly Def[] = [form, ...ROAD_STRUCTURES];
