import { FORMS } from "../../../../../content/building/forms.ts";
import { MADE_PIECE_TRIANGLES } from "../../../../../tools/art/check.ts";
import type { PiecesAsset } from "../../../../../tools/art/spec.ts";
import { statedErrors } from "../../../../../tools/pack/pieces/lod.ts";
import { bakeTekWall, TEK } from "../../../../../tools/pack/pieces/tek.ts";

export default {
  kind: "pieces",
  source: { bake: () => [bakeTekWall(FORMS.wall)] },
  pieces: [{ id: "core:wall_tek", object: "wall", errors: statedErrors(TEK, "wall", FORMS.wall) }],
  budgets: { triangles: MADE_PIECE_TRIANGLES.map(([, most]) => most) },
} satisfies PiecesAsset;
