import type { PiecesAsset } from "../../../../../tools/art/spec.ts";
export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: [{ id: "core:box_trailer", object: "box_trailer" }],
  budgets: { triangles: [11000, 6200, 3000, 900] },
} satisfies PiecesAsset;
