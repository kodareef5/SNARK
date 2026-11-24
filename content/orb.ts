import type { Def, ShapeDef, StructureDef } from "../shared/content/defs.ts";
import { ORB_SIZES, orbShell } from "../shared/world/orb.ts";

// An orb's shell: a shape and a static for each shape of each size's, drawn as nothing and harmed by nothing.
export const ORBS: readonly Def[] = ORB_SIZES.flatMap((size) => orbShell(size.radius, size.centre).flatMap((s): [ShapeDef, StructureDef] => [
  { type: "shape", id: s.kind + "_shape", role: "thing", boxes: [], hulls: s.hulls },
  { type: "structure", class: "static", id: s.kind, shape: s.kind + "_shape", mesh: "none", color: 1, half: s.half, hp: 1000000 },
]));
