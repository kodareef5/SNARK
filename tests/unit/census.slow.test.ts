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
  // 183,856, 14 and 180,302. Cut again the same evening from the 16 km map at the same downtown, which holds its lit
  // lamps, low buildings' attics and raised parapets, the flats' bare balcony bays, cut shop fronts, ivy and moss: on the
  // 8 km map the street on high was 52, 98, 130,970, 13 and 130,032, the roof 77, 95, 163,548, 19 and 186,210, the air
  // 115, 107, 185,144, 14 and 182,734 (163,542, 185,058 and 182,608 before the hanging slabs hung nearly sheer and
  // twisted, content/ruins.ts zdrape). Its attics' copings were bevelled: 135,482 and 140,694 at the street, 166,732 and
  // 191,006 on the roof, 187,692 and 186,144 in the air. Cut again when vines came to hang from bare balconies too: the
  // street on high was 84, 177, 134,942, 14 and 140,146, the roof 129, 176, 166,142, 19 and 190,306, the air 165, 171,
  // 187,138, 14 and 185,524. Cut again when every vine's anchor kept its strands and a balcony band ended only on the
  // storeys where the bay beside it is gone: 79, 170, 134,974, 14 and 140,226 at the street, 126, 164, 166,186, 19 and
  // 190,228 on the roof, 163, 171, 187,170, 14 and 185,632 in the air. Cut again when moss came to lie only along a
  // coping, which moves the roofs' plant (six moss strips fewer here, and the roof plant's kinds come out otherwise, each
  // kind a draw): 79, 193, 141,556, 14 and 144,018 at the street, 137, 185, 173,296, 19 and 195,360 on the roof, 175,
  // 182, 194,648, 14 and 190,202 in the air.
  expect(got).toEqual({
    "street-300": { lowpoly: [86, 0, 141820, 11, 100392], "medium, touch": [55, 47, 82694, 10, 48754], medium: [85, 100, 141724, 14, 143902], high: [85, 207, 141724, 14, 143902], ultra: [85, 243, 141724, 14, 143902] },
    "roof-300": { lowpoly: [148, 0, 173608, 13, 128528], "medium, touch": [84, 33, 103666, 14, 73136], medium: [147, 100, 173512, 19, 192348], high: [147, 197, 173512, 19, 195254], ultra: [147, 231, 173512, 19, 195254] },
    "air-300": { lowpoly: [184, 0, 194840, 11, 123334], "medium, touch": [80, 6, 120762, 9, 53104], medium: [183, 30, 194744, 14, 190114], high: [183, 194, 194744, 14, 190114], ultra: [183, 216, 194744, 14, 190114] },
  });
});
