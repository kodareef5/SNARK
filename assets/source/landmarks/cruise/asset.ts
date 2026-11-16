import layout from "../../../../content/landmarks/cruise-layout.json" with { type: "json" };
import census from "./ref/cell-levels.json" with { type: "json" };
import { LANDMARK_TRIANGLES, PIECE_TRIANGLES } from "../../../../tools/art/check.ts";
import type { PiecesAsset } from "../../../../tools/art/spec.ts";

// Six authored candidates become only their distinct geometry/material levels.
// Both near candidates preserve fitted rooms and inward-clear/outward-dark
// panes. Distant candidates keep exterior structure while omitting fittings
// behind the glazed enclosure. Their stated visible errors are reviewed against
// actual native transition views; the normal distance budgets remain unchanged.
const cellBudgets = [LANDMARK_TRIANGLES[0]![1], LANDMARK_TRIANGLES[1]![1],
  LANDMARK_TRIANGLES[2]![1], LANDMARK_TRIANGLES[3]![1], LANDMARK_TRIANGLES[4]![1], LANDMARK_TRIANGLES[4]![1]];
// Tiny door leaves and port plaques need a textured close form and one flat
// distant form, not six duplicate levels with meaningless distance slivers.
const partBudgets = [PIECE_TRIANGLES[0][1], PIECE_TRIANGLES[4][1]];
const standalone = layout.prototypes.filter(p => p.mesh !== "none" && !p.mesh.startsWith("cruise:cell_"));
const authored = new Map(census.cells.map(c => [c.id, c]));
const cells = layout.cells.map(cell => {
  const record = authored.get(cell.id)!;
  const levels = record.retained;
  return { id: cell.id, object: cell.id.slice(7),
    triangles: levels.map((candidate, i) => Math.min(...cellBudgets.slice(candidate, levels[i + 1] ?? 6))),
    errors: levels.slice(1).map(candidate => record.errors[candidate]!) };
});

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: [...cells,
    ...standalone.map(p => ({ id: p.mesh, object: p.mesh.slice(7), triangles: partBudgets, errors: [.025] }))],
  materials: { surfaces: { base: "tex/surfaces_base.png", normal: "tex/surfaces_normal.png", packed: "tex/surfaces_packed.png", height: "tex/surfaces_height.png", cutout: true },
    signs: { base: "tex/signs_base.png", packed: "tex/signs_packed.png" } },
  budgets: { triangles: cellBudgets, texture: { top: 2048, megabytes: 64 } },
} satisfies PiecesAsset;
