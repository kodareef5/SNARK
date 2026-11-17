// Koru, a landmark yacht, built by model.py from the layout author_layout.py writes. Each 16 m cell of the ship is one
// mesh, drawn by its anchor's static; the doors and the sail parts are meshes of their own.

import layout from "../../../../content/landmarks/koru-layout.json" with { type: "json" };
import { LANDMARK_TRIANGLES, PIECE_TRIANGLES } from "../../../../tools/art/check.ts";
import type { PieceSpec, PiecesAsset } from "../../../../tools/art/spec.ts";

const budget = (rule: readonly (readonly [number, number])[]): number[] => rule.map(([, n]) => n);
const name = (id: string): string => id.slice("koru:".length);
// A cell's four levels are model.py's: 0 and 1 drawn with the atlas, 2 and 3 flat. Levels 1 to 3 show what is seen from
// outside, the hull, decks, deckhouse walls with their windows, and rig, and leave the rooms behind the white walls and
// the glass, which is dark from outside. What they leave or thin that shows is under 2.5, 6 and 13 cm across (rail posts
// and port rims, then rails, rigging and the cove line, then the cap rail and the spars' facets), which a measure of
// points cannot judge: it counts the rooms.
const cell = (id: string): PieceSpec => ({ id, object: name(id), triangles: budget(LANDMARK_TRIANGLES).slice(1), errors: [0.025, 0.06, 0.13] });
const part = (id: string): PieceSpec => ({ id, object: name(id), triangles: budget(PIECE_TRIANGLES) });

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: [...layout.cells.map((c) => cell(c.id)), ...layout.modules.filter((m) => m.category === "door").map((m) => part(m.id)), ...layout.motion.parts.map((p) => part(p.mesh))],
  materials: {
    surfaces: { base: "tex/surfaces_base.png", normal: "tex/surfaces_normal.png", packed: "tex/surfaces_packed.png", height: "tex/surfaces_height.png" },
  },
  budgets: { triangles: budget(LANDMARK_TRIANGLES), texture: { top: 2048, megabytes: 64 } },
} satisfies PiecesAsset;
