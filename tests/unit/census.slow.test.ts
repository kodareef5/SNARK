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
  // Cut again on 2026-11-18 when the street's furniture came to stand on its walks (twice as many pieces in the slice:
  // each kind of them is a draw of its own) and tall buildings came to have tops: with hiding the street on high was 24,
  // 45, 129,666, 12 and 125,040, the roof 28, 41, 155,370, 19 and 183,432, the air 42, 42, 181,608, 14 and 177,982.
  expect(got).toEqual({
    "street-300": { lowpoly: [51, 0, 130946, 10, 91182], "medium, touch": [37, 18, 77090, 10, 45866], medium: [51, 51, 130946, 13, 130054], high: [51, 96, 130946, 13, 130054], ultra: [51, 113, 130946, 13, 130054] },
    "roof-300": { lowpoly: [74, 0, 163512, 13, 121858], "medium, touch": [46, 10, 97366, 14, 69438], medium: [74, 46, 163512, 19, 183252], high: [74, 91, 163512, 19, 186102], ultra: [74, 104, 163512, 19, 186102] },
    "air-300": { lowpoly: [111, 0, 183772, 11, 116586], "medium, touch": [46, 3, 113932, 9, 50026], medium: [111, 15, 183772, 14, 180304], high: [111, 103, 183772, 14, 180304], ultra: [111, 118, 183772, 14, 180304] },
  });
});
