// The surface twins at the size a browser's canvas has (selfcheck-surfaces.test.ts holds them at a small one): a whole
// frame of 1280 by 577 through the software rasterizer with the finishes' maps, slow by nature.

import { artTest } from "../fixtures/needs-art.ts";
import { surfaceTwins } from "../fixtures/world-surfaces.ts";

artTest("surface twins hit the software scene's pixels, planes and mips, browser size", () => {
  surfaceTwins(1280, 577, 9);
});
