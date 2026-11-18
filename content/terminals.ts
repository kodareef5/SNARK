import type { Def, ShapeDef, StructureDef } from "../shared/content/defs.ts";
import { EYE_DYE, HULLS } from "../shared/world/tide-eye.ts";

export const TERMINALS: readonly Def[] = [
  // Older map packages place three of these above an offset travel terminal.
  { type: "structure", class: "static", id: "core:obelisk", mesh: "box", color: 11, half: [3, 15, 3], hp: 1000000 },
  { type: "structure", class: "static", id: "core:travel_terminal", mesh: "core:travel_terminal", color: EYE_DYE.blue, half: [0.6, 0.6, 0.6], hp: 1000000 },
  ...Object.entries(HULLS).flatMap(([name, half]): [ShapeDef, StructureDef] => {
    const id = "core:zztide_eye_" + name;
    return [
      { type: "shape", id: id + "_shape", role: "thing", boxes: [{ at: [0, 0, 0], half }] },
      { type: "structure", class: "static", id, shape: id + "_shape", mesh: "none", color: 1, half, hp: 1000000 },
    ];
  }),
];
