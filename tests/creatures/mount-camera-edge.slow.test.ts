// The roof's edge under the current rigs of both saddled species at every frame rate and both ceiling heights: sixteen
// whole clients walked through, slow by nature. mount-camera-edge.test.ts holds the rule on the frozen rigs, and these at one rate.

import { artTest } from "../fixtures/needs-art.ts";
import { corePack } from "../fixtures/pack.ts";
import { throughRoof } from "../fixtures/roof-edge.ts";

artTest("current raptor and parasaur rigs keep roof-edge continuity at both ceiling heights", () => {
  for (const kind of ["raptor", "parasaur"]) for (const under of [2.75, 2.96]) for (const fps of [20, 30, 60, 120]) throughRoof(corePack(), kind, fps, under);
});
