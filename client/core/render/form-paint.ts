// How a broken form's convex parts are painted, for the near city's meshes: content says which faces a cut bared.

import { paintOf } from "../../../content/breaks/leaves.ts";
import { RUIN_FINISHES } from "../../../content/ruins.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import type { PartPaint } from "../../../shared/world/city.ts";

/** The paint of each form kind of `reg`, made when first asked for and kept. */
export function formPaint(reg: Registry): (kind: number) => PartPaint | null {
  const known = new Map<number, PartPaint | null>();
  return (kind) => {
    let paint = known.get(kind);
    if (paint === undefined) {
      const made = paintOf(reg, kind);
      known.set(kind, (paint = made ? { color: made.color, core: made.core, bare: RUIN_FINISHES.fracture.color } : null));
    }
    return paint;
  };
}
