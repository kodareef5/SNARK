// A fitted MakeHuman body as the human cook takes it: three materials, the teeth and tongue cut hard, the backs of the
// eyes dropped, and every texture coordinate on its material's sheet.

import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { artModule } from "../../tools/art/source.ts";
import { BROWS_SHEET, EYES_SHEET, scriptedBody, SECTION_BROWS, SECTION_EYES, SECTION_SKIN, COOK_PLAN } from "../../tools/makehuman/cooked.ts";
import { fitBody } from "../../tools/makehuman/fit.ts";
import { BASE_OBJ } from "../../tools/makehuman/index.ts";

const mirrorTest = existsSync(BASE_OBJ) ? test : test.skip;

mirrorTest("the cook's body has three materials, a hard-cut mouth and no eye backs", async () => {
  const { RIGS } = await artModule("core/humans/human-bodies/rigs.ts");
  const f = fitBody("female", RIGS[1]);
  const { body, kept } = scriptedBody(f);
  expect(kept.teeth).toBeLessThanOrEqual(COOK_PLAN.teeth);
  expect(kept.tongue).toBeLessThanOrEqual(COOK_PLAN.tongue);
  expect(kept.body).toBe(f.report.triangles.body!);
  expect(kept.eyes).toBeLessThan(f.report.triangles.eyes! * 0.75);
  expect(new Set(body.sections)).toEqual(new Set([SECTION_SKIN, SECTION_EYES, SECTION_BROWS]));
  // Each part's texture coordinates stay inside its place on the sheet.
  const inside = (section: number, places: readonly (readonly number[])[]): boolean => {
    for (let t = 0; t < body.sections.length; t++) {
      if (body.sections[t] !== section) continue;
      for (let k = 0; k < 3; k++) {
        const v = body.indices[t * 3 + k]!, u = body.uvs[v * 2]!, w = body.uvs[v * 2 + 1]!;
        if (!places.some(([pu, pv, pw, ph]) => u >= pu! - 1e-6 && u <= pu! + pw! + 1e-6 && w >= pv! - 1e-6 && w <= pv! + ph! + 1e-6)) return false;
      }
    }
    return true;
  };
  expect(inside(SECTION_EYES, Object.values(EYES_SHEET))).toBe(true);
  expect(inside(SECTION_BROWS, Object.values(BROWS_SHEET))).toBe(true);
  expect(inside(SECTION_SKIN, [[0, 0, 1, 1]])).toBe(true);
});
