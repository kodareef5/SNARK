import { ALL_FORMS } from "../../../../../content/building/forms.ts";
import { MADE_PIECE_TRIANGLES, TRIM_TRIANGLES } from "../../../../../tools/art/check.ts";
import type { PiecesAsset } from "../../../../../tools/art/spec.ts";
import { errorOf, statedErrors } from "../../../../../tools/pack/pieces/lod.ts";
import { bakeTek, TEK } from "../../../../../tools/pack/pieces/tek.ts";

export default {
  kind: "pieces",
  source: { bake: () => bakeTek(ALL_FORMS) },
  pieces: [
    ...Object.entries(ALL_FORMS).map(([name, form]) => ({ id: `core:${name}_tek`, object: name, errors: statedErrors(TEK, name, form) })),
    ...Object.entries(TEK.trims!()).map(([name, levels]) => ({
      id: `core:${name}_tek`, object: name, errors: levels.slice(1).map((shape, i) => errorOf(shape, i + 1)),
      triangles: TRIM_TRIANGLES[name]!, ...(levels[3]!.triangles < 4 ? { open: 3 } : {}),
    })),
  ],
  budgets: { triangles: MADE_PIECE_TRIANGLES.map(([, most]) => most) },
} satisfies PiecesAsset;
