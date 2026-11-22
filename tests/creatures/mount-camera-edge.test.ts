import { test } from "bun:test";
import { artTest } from "../fixtures/needs-art.ts";
import { corePack, frozenPack } from "../fixtures/pack.ts";
import { throughRoof } from "../fixtures/roof-edge.ts";

for (const fps of [20, 30, 60, 120]) for (const under of [2.75, 2.96]) test(`whole-client parasaur roof edge stays continuous at ${fps} fps under ${under} m`, () => throughRoof(frozenPack(), "parasaur", fps, under));
for (const under of [2.75, 2.96]) {
  test(`the opposite roof edge stays continuous under ${under} m`, () => throughRoof(frozenPack(), "parasaur", 60, under, true));
  test(`a remote saddle passenger keeps roof-edge continuity under ${under} m`, () => throughRoof(frozenPack(), "parasaur", 60, under, false, true));
  for (const pitch of [-1.2, 0, .8]) test(`roof-edge continuity follows look pitch ${pitch} under ${under} m`, () => throughRoof(frozenPack(), "parasaur", 60, under, false, false, pitch));
}
// Every frame rate and both heights on the current rigs are in mount-camera-edge.slow.test.ts.
artTest("current raptor and parasaur rigs keep roof-edge continuity at 60 fps", () => {
  for (const kind of ["raptor", "parasaur"]) throughRoof(corePack(), kind, 60, 2.75);
});
