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
  // each kind of them is a draw of its own), its signals to face their traffic and tall buildings to have tops: with
  // hiding the street on high was 24, 45, 129,666, 12 and 125,040, the roof 28, 41, 155,370, 19 and 183,432, the air 42,
  // 42, 181,608, 14 and 177,982. Since a mass's cells under the air are cut to their pieces' tops (shared/world/city.ts)
  // the roof on low poly, which draws the mass past 600 m, has 62 far triangles more. Cut again when towers came to have
  // tops (tools/mapworld/ruin-crowns.ts): the roof on high was 77, 94, 163,572, 19 and 186,210, the air 115, 107,
  // 183,856, 14 and 180,302. Its hanging slabs were then 8 m wide and hung 62 degrees: hung nearly sheer and twisted
  // (content/ruins.ts zdrape) the roof's near triangles were 163,542 and the air's 185,058 near and 182,608 far.
  expect(got).toEqual({
    "street-300": { lowpoly: [52, 0, 130970, 10, 91182], "medium, touch": [38, 18, 77114, 10, 45888], medium: [52, 52, 130970, 13, 130032], high: [52, 98, 130970, 13, 130032], ultra: [52, 116, 130970, 13, 130032] },
    "roof-300": { lowpoly: [77, 0, 163548, 13, 121996], "medium, touch": [47, 10, 97390, 14, 69482], medium: [77, 49, 163548, 19, 183360], high: [77, 95, 163548, 19, 186210], ultra: [77, 110, 163548, 19, 186210] },
    "air-300": { lowpoly: [115, 0, 185144, 11, 119038], "medium, touch": [47, 3, 113956, 9, 50048], medium: [115, 15, 185144, 14, 182734], high: [115, 107, 185144, 14, 182734], ultra: [115, 122, 185144, 14, 182734] },
  });
});
