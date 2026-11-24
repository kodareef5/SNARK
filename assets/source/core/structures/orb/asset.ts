import type { PiecesAsset } from "../../../../../tools/art/spec.ts";

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  // Both are drawn flat. The shell's own program paints it (client/core/render/passes/orb.ts); the plinth is lit as any flat mesh.
  pieces: [
    { id: "core:orb/shell", object: "shell" },
    { id: "core:orb/plinth", object: "plinth", triangles: [600, 240, 80] },
  ],
  budgets: { triangles: [6000, 1400, 400] },
} satisfies PiecesAsset;
