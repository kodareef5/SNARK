// Small paving pieces use normal placement, ownership, demolition and chunk replication.
// These deliberately simple native shapes are replaceable art; the physical facet is stable content.
import type { Def, ShapeDef, StructureDef } from "../../shared/content/defs.ts";
import { crafting } from "../craft.ts";
import { ASPHALT, GRAVEL, MUD } from "./compact.ts";

const form: ShapeDef = { type: "shape", id: "urban:shape_paving", role: "foundation", boxes: [{ at: [0, 0, 0], half: [1.5, 1 / 32, 1.5] }] };
const surfacePieces = [["asphalt", "Asphalt paving", 4, ASPHALT], ["gravel", "Gravel paving", 15, GRAVEL], ["mud", "Mud track", 12, MUD]] as const;
export const ROAD_STRUCTURES: readonly StructureDef[] = surfacePieces.map(([name, , color, vehicleSurface]) => ({
  type: "structure", class: "piece", id: `urban:road_${name}`, mesh: "shape", shape: form.id,
  half: [1.5, 1 / 32, 1.5], color, hp: 1500, material: "core:mat_stone", vehicleSurface,
}));
export const ROADS: readonly Def[] = [form, ...ROAD_STRUCTURES, ...surfacePieces.flatMap(([name, label, color]): Def[] => {
  const item = `urban:paving_${name}`;
  return [
    { type: "item", class: "structure", id: item, stack: 50, weight: 4, label, color, places: [`urban:road_${name}`] },
    crafting(item, { needs: [{ item: "core:stone", count: name === "asphalt" ? 12 : 6 }, { item: "core:fiber", count: 2 }], seconds: 2, xp: 1 }),
    { type: "engram", id: `urban:engram_paving_${name}`, label, level: 1, cost: 0, item },
  ];
})];
