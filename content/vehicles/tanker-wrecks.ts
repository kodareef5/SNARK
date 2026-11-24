import { shapeHalf, type Def, type ShapeBox } from "../../shared/content/defs.ts";
import { rungsOf, wreckFormDef, wreckSalvage, wreckWhole } from "./salvage.ts";
import bounds from "./tanker-wreck-bounds.json" with { type: "json" };

/** What is left to salvage of each state: all of one that stopped or crashed, the body alone of one rolled or in parts. */
const LEFT: Readonly<Record<string, Parameters<typeof rungsOf>[0]>> = { abandoned: "stopped", impact: "stopped", stripped: "stripped", burnout: "burnt" };
const triple = (v: number[]): [number, number, number] => [v[0]!, v[1]!, v[2]!];
const boxesOf = (state: string): ShapeBox[] => (bounds as Record<string, { at: number[]; half: number[] }[]>)[state]!.map((b) => ({ at: triple(b.at), half: triple(b.half) }));

export const TANKER_WRECKS: Def[] = Object.keys(bounds).flatMap((state): Def[] => {
  const id = `core:tanker_${state}`,
    shape = `core:shape_tanker_${state}`;
  const boxes = boxesOf(state);
  return [
    { type: "shape", id: shape, role: "thing", boxes },
    {
      type: "structure",
      class: "static",
      id,
      mesh: id,
      shape,
      half: shapeHalf(boxes),
      hp: 8000,
      material: "core:mat_metal",
      color: state === "burnout" ? 230 : 28,
      breaks: wreckWhole(id),
      // Only the abandoned one has a lesser look to show: every other is salvaged in one rung.
      salvage: wreckSalvage(rungsOf(LEFT[state] ?? "roof"), "heavy", state === "abandoned" ? 2 : 1),
    },
  ];
});
// Stripped, the abandoned tanker is drawn as the stripped one.
TANKER_WRECKS.push(wreckFormDef("core:tanker_abandoned", "stripped", { mesh: "core:tanker_stripped", shape: "core:shape_tanker_stripped", half: shapeHalf(boxesOf("stripped")), color: 28, hp: 8000 }));
