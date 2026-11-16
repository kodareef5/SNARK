import layout from "../../../../content/landmarks/cruise-layout.json" with { type: "json" };
import { LANDMARK_TRIANGLES, PIECE_TRIANGLES } from "../../../../tools/art/check.ts";
import type { PiecesAsset } from "../../../../tools/art/spec.ts";

// The model owns six useful levels. The first two retain actual interiors and
// pictures; the flat levels retain the exterior and sparse structural surfaces
// visible along openings, omitting hidden room fittings. Point error alone
// counts those hidden fittings, so the documented visible-error limits below
// are stated and checked against the normal medium distance/triangle rules.
const cellBudgets = [LANDMARK_TRIANGLES[0]![1], LANDMARK_TRIANGLES[1]![1],
  LANDMARK_TRIANGLES[2]![1], LANDMARK_TRIANGLES[3]![1], LANDMARK_TRIANGLES[4]![1], 150];
const partBudgets = PIECE_TRIANGLES.map(([, triangles]) => triangles);
const standalone = layout.prototypes.filter(p => p.mesh !== "none" && !p.mesh.startsWith("cruise:cell_"));

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: [...layout.cells.map(cell => ({ id: cell.id, object: cell.id.slice(7), triangles: cellBudgets,
    errors: [.0125, .025, .06, .13, .25] })),
    ...standalone.map(p => ({ id: p.mesh, object: p.mesh.slice(7), triangles: partBudgets }))],
  materials: { surfaces: { base: "tex/surfaces_base.png", normal: "tex/surfaces_normal.png", packed: "tex/surfaces_packed.png", height: "tex/surfaces_height.png" },
    signs: { base: "tex/signs_base.png", packed: "tex/signs_packed.png" } },
  budgets: { triangles: cellBudgets, texture: { top: 2048, megabytes: 64 } },
} satisfies PiecesAsset;
