// What a real city's downtown draws on every tier (tools/bench/census.ts): counts, which load cannot move.

import { expect, test } from "bun:test";
import { SETUPS, SLICE_VIEWS, censusWorld } from "../../tools/bench/census.ts";
import { miamiSlice } from "../fixtures/cityslice.ts";
import { farPack } from "../fixtures/farworld.ts";
import { coreRegistry } from "../fixtures/world.ts";

test("a real city's downtown at its three views on each tier: the near city's draws, casts and triangles, and the far city's draws and triangles", () => {
  const slice = miamiSlice();
  const w = censusWorld(slice.map, slice.centre, coreRegistry(), farPack());
  const got = Object.fromEntries(SLICE_VIEWS.map((v) => [v.name, Object.fromEntries(SETUPS.map((s) => {
    const c = w.count(v, s);
    return [s.name, [c.near, c.cast, c.nearTriangles, c.far, c.farTriangles]];
  }))]));
  // Each view's near window lies whole in the slice, so the first three are what the built Miami draws there with the
  // grey boxes (equal when it was cut on 2026-11-17); the far city's are of the slice's ring of chunks round it, in tiles
  // of the slice's own from its corner. The near city's were 509, 742 and 104,248 at the street on high, 490, 673 and
  // 109,168 on the roof and 574, 635 and 120,588 in the air while each piece was an instance; with a chunk's statics
  // drawn flat as their form one mesh made in 16 m cells (client/core/render/nearcity.ts), what is left a draw is a
  // chunk's run of cells in view and the wrecks, its casters runs of cells, and its triangles the every-box form's, faces
  // held by another piece or the ground left out. The far city's were 15, 24, 11 and 14 draws and 48,382, 62,294, 62,790
  // and 78,520 triangles on the lit tiers while a chunk was in view by its pieces' box and 8 m round it at every level; by
  // the box its level's faces may reach, a box's their pieces' own, chunks at the view's edge drop out. Then they were
  // 22, 17 and 27 draws on the lit tiers and 13, 14 and 18 for touch in tiles of 3 by 3 chunks; in tiles of 4 by 4 there
  // are fewer runs, and the touch rule's every box ends short of more tiles' nearest points. Cut again on 2026-11-18 when
  // a building's bays came to wear their kind's facade modules (content/ruins.ts): the street on high was 41, 51 and
  // 67,608 near and 15 and 57,036 far, the roof 37, 46, 66,988, 19 and 77,014, the air 51, 45, 77,364, 13 and 73,184.
  // Cut again the same day when the door-to-curb kit and the street's walks came (content/ruins.ts, makeWalks in
  // tools/mapworld/ruins.ts): the street on high was 44, 51 and 126,242 near and 15 and 112,772 far, the roof 40, 48,
  // 131,204, 19 and 145,914, the air 54, 49, 145,540, 13 and 141,406. With them and before the ruins' broken tops,
  // rubble, leaning pieces, cut edges and vines it was 30, 38, 133,324, 15 and 117,186 at the street, 28, 36, 139,774, 19
  // and 151,618 on the roof and 36, 34, 152,584, 14 and 150,150 in the air. Before what the near meshes and the ground
  // wholly hide was left out (render/hide.ts) the street on high was 35, 48 and 159,006 near and 15 and 139,120 far, the
  // roof 32, 41, 164,622, 19 and 183,432, the air 42, 42, 181,608, 14 and 177,982; each is that again with `hide` off.
  expect(got).toEqual({
    "street-300": { lowpoly: [24, 0, 129666, 9, 86278], "medium, touch": [18, 12, 76330, 10, 45562], medium: [24, 21, 129666, 12, 125040], high: [24, 45, 129666, 12, 125040], ultra: [24, 50, 129666, 12, 125040] },
    "roof-300": { lowpoly: [28, 0, 155370, 13, 119984], "medium, touch": [18, 7, 91390, 14, 68710], medium: [28, 21, 155370, 19, 180824], high: [28, 41, 155370, 19, 183432], ultra: [28, 52, 155370, 19, 183432] },
    "air-300": { lowpoly: [42, 0, 181608, 11, 114700], "medium, touch": [22, 3, 112888, 9, 49820], medium: [42, 8, 181608, 14, 177982], high: [42, 42, 181608, 14, 177982], ultra: [42, 48, 181608, 14, 177982] },
  });
});
