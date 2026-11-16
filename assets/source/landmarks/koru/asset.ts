// Koru, a landmark yacht, built by model.py from the layout author_layout.py writes. Each 16 m cell of the ship is one
// mesh, drawn by its anchor's static; the doors and the sail parts are meshes of their own.

import layout from "../../../../content/landmarks/koru-layout.json" with { type: "json" };
import { LANDMARK_TRIANGLES, PIECE_TRIANGLES } from "../../../../tools/art/check.ts";
import type { PieceSpec, PiecesAsset } from "../../../../tools/art/spec.ts";

const piece = (id: string, triangles: readonly (readonly [number, number])[]): PieceSpec => ({ id, object: id.slice("koru:".length), triangles: triangles.map(([, n]) => n) });
const doors = layout.modules.filter((m) => m.category === "door").map((m) => m.id);
const sails = layout.motion.parts.map((p) => p.mesh);

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: [...layout.cells.map((c) => piece(c.id, LANDMARK_TRIANGLES)), ...[...doors, ...sails].map((id) => piece(id, PIECE_TRIANGLES))],
  materials: {
    surfaces: { base: "tex/surfaces_base.png", normal: "tex/surfaces_normal.png", packed: "tex/surfaces_packed.png", height: "tex/surfaces_height.png" },
  },
  flat: 3,
  budgets: { triangles: LANDMARK_TRIANGLES.map(([, n]) => n), texture: { top: 2048, megabytes: 64 } },
} satisfies PiecesAsset;
