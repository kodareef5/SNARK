// What stands in a city's streets besides its buildings and cars (content/street.ts), each a piece of its own and each
// as a ruin of itself: model.py makes them, in the piece's frame (origin on the ground at the middle of its foot, +Z
// toward the road), from kit.py's parts, laid on two atlases by layout.json. paint.py puts the atlases together from
// their painted parts in tex/parts (ref/SOURCES.md says how each was made). "street" is opaque; "street_cut" is drawn
// where its alpha is over half: chain-link, broken glass, torn vinyl. The script makes every level; the flat ones are
// in the colours of what their faces were laid on, the last the piece's masses in a dozen to seventy triangles. The
// crosswalk bars are laid on the atlas's road paint, their last level a flat patch of four triangles. curb.py makes the
// street's edge on the same atlas (EDGE below).

import type { PiecesAsset } from "../../../../../tools/art/spec.ts";

/**
 * Each piece's name after "core:zzstreet_" and the most triangles each of its levels may have, finest first, as model.py
 * makes them: the finest; fewer sides round; then flat, the small parts gone; then the masses alone; a level that
 * would keep more than four fifths of the one before is left out.
 */
const PIECES: Readonly<Record<string, readonly number[]>> = {
  lamp: [220, 152, 52, 28],
  lamp_lit: [220, 152, 52, 28],
  lamp_leaning: [220, 152, 52, 28],
  lamp_fallen: [256, 172, 64, 36],
  signal: [432, 40],
  signal_bent: [292, 28],
  stop: [76, 36],
  stop_bent: [76, 36],
  yield: [56, 32],
  yield_bent: [56, 32],
  street_name: [68],
  speed: [24],
  speed40: [24],
  speed30: [24],
  speed25: [24],
  speed35: [24],
  speed45: [24],
  noentry: [72, 40],
  oneway: [24],
  noparking: [24],
  crossing: [24],
  deadend: [24],
  post_bare: [36, 12],
  evacuation: [24],
  pole: [232, 176, 36, 28],
  pole_leaning: [232, 176, 36, 28],
  hydrant: [348, 204, 72, 12],
  bench: [168, 24],
  bench_broken: [132, 24],
  bin: [200, 132, 12, 8],
  bin_tipped: [244, 156, 24, 16],
  shelter: [236, 72],
  shelter_wrecked: [176, 72],
  mailbox: [92, 12],
  meter: [60, 24],
  meter_broken: [40, 32, 24, 16],
  paystation: [72, 12],
  paystation_broken: [84, 12],
  bollard: [92, 52, 12, 8],
  fence: [112, 24],
  fence_sagging: [220, 24],
  fence_down: [208, 24],
  rail: [100, 36],
  rail_bent: [296, 36],
  billboard: [320, 32],
  billboard_bare: [308, 68],
  billboard_low: [320, 32],
  billboard_low_bare: [308, 68],
  billboard_mid: [320, 32],
  billboard_mid_bare: [308, 68],
  billboard_small: [236, 36],
  billboard_small_bare: [224, 68],
  newsbox: [48, 12],
  // A bar is cut across every half metre of its length, as the ground under it may bend there (model.py STRIP).
  crosswalk1: [24, 4],
  crosswalk1_worn: [24, 4],
  crosswalk2: [48, 4],
  crosswalk2_worn: [36, 4],
  crosswalk4: [96, 4],
  crosswalk4_worn: [80, 4],
  crosswalk8: [192, 4],
  crosswalk8_worn: [176, 4],
  roof_ac: [48, 36],
  roof_ac_tipped: [48, 36],
  roof_rtu: [124, 24],
  roof_vent: [64, 36, 24, 16],
  roof_duct: [60],
  roof_tank: [180, 108],
  roof_solar: [96, 48],
  roof_solar_broken: [96, 48],
  roof_bulkhead: [36],
  roof_dish: [76, 52, 36, 28],
};

/**
 * A crosswalk's far patch is its bars blurred into the road between them, which no measure of points sees: its points lie
 * on the bars'. It is stated as 10 cm, so on medium it is first drawn about 350 m off, where a bar is 1.3 pixels wide.
 */
const STATED: Readonly<Record<string, readonly number[]>> = Object.fromEntries(
  Object.entries(PIECES).filter(([name, levels]) => name.startsWith("crosswalk") && levels.length > 1).map(([name]) => [name, [0.1]]),
);

/**
 * The street's edge, under the walk kit's own ids (content/ruins.ts street()), and the curb returns a map sets down at
 * its corners (content/curbs.ts): curb.py makes them on the atlas's concrete strip. Each is its object, its triangles a
 * level and each coarser level's error, stated in metres, as a measure of points does not see a groove filled or an
 * arc's chord:
 * - A walk or a ramp's finest level has the curb's top edge rounded to 2.5 cm in four, its face leaning back 1.2 cm, the
 *   walk in 1.6 m panels with joints 4 cm wide and 6 mm deep, and a gutter pan before it where the content has one.
 *   Its second is its box with the face's lean: 12 triangles (20 with a gutter), fewer than the old boxes had before the
 *   near city left out their hidden faces. It stands 9 mm off the first, where the edge is squared, so on medium it is
 *   drawn from 32 m and on high from 50 m.
 * - The curb returns (content/curbs.ts), 4, 6 and 8 m at the face, with a ramp at the arc's middle and a straight end
 *   past each end for the walk's end to lie over. A quarter is in 20, 12, 8, 4 and 2 pieces at 4 m; 24, 16, 12, 6 and 3
 *   at 6 m; 28, 18, 12, 6 and 3 at 8 m, the ramp's ends always among them. Each coarser level's error is its chord's
 *   sagitta at the gutter's edge, (r + 0.45) (1 - cos(45 / n degrees)), rounded up, or its edge's where that is more
 *   (2 mm with the edge in two, 7 mm as a chamfer with the joints filled, 9 mm square). The fourth leaves out the
 *   straight ends, which leaves the 6 cm of each the walk does not cover open, about its chord's error; the last is the
 *   arc's mass alone, without the ramp's 14 cm fall or the pan, less than its chord's sagitta. 4 m: 10, 22, 86 and 339
 *   mm; 6 m: 8, 14, 56 and 220 mm; 8 m: 8, 19, 73 and 288 mm. On medium a level of 8 mm is first drawn at 28 m, of
 *   56 mm at 196 m; the last is past the near city's 288 m at 1080 rows on every tier.
 */
/** Each bent piece's triangles by level, as bent.py makes them. */
const BENT_TRIANGLES: Readonly<Record<string, number[]>> = {
  raised_s: [56, 44, 20], raised_c: [266, 116, 32], worn_s: [56, 44, 20], worn_c: [266, 116, 32], flush_s: [56, 44, 20], flush_c: [266, 116, 32],
  median_s: [52, 28, 16], median_c: [248, 76, 26],
  raised_flush: [86, 44, 20], flush_raised: [86, 44, 20], worn_flush: [86, 44, 20], flush_worn: [86, 44, 20], raised_worn: [86, 44, 20], worn_raised: [86, 44, 20],
};

const EDGE: readonly { id: string; object: string; triangles: number[]; errors: number[] }[] = [
  { id: "core:zruin_zwalk8_concrete", object: "zwalk8", triangles: [92, 12], errors: [0.009] },
  { id: "core:zruin_zwalk8g_concrete", object: "zwalk8g", triangles: [100, 20], errors: [0.009] },
  { id: "core:zruin_zcurbramp_concrete", object: "zcurbramp", triangles: [44, 12], errors: [0.009] },
  { id: "core:zruin_zcurbrampl_concrete", object: "zcurbrampl", triangles: [44, 12], errors: [0.009] },
  { id: "core:zzzcurb_r4", object: "curb_r4", triangles: [680, 444, 190, 86, 20], errors: [0.01, 0.022, 0.086, 0.339] },
  { id: "core:zzzcurb_r6", object: "curb_r6", triangles: [792, 540, 246, 106, 28], errors: [0.008, 0.014, 0.056, 0.22] },
  { id: "core:zzzcurb_r8", object: "curb_r8", triangles: [904, 492, 246, 86, 28], errors: [0.008, 0.019, 0.073, 0.288] },
];

/**
 * The bent street sections (content/bends.ts), which bent.py makes on the concrete strip: each kerb a straight of one
 * length of rings and a curve of eight, and the joins between two kerbs. Each coarser level's error is stated, as a
 * measure of points does not see an edge's round or a curve's chord: a straight's is its top edge in one chamfer, then
 * square with its joints filled and its gutter's face gone, its outer edge 12 mm over the road (the raised kerb's 2.5 cm
 * round 8 mm off as a chamfer, 36 mm square with the gutter, as measured; the worn kerb's 6 cm round 18 and 38 mm; the
 * median's back 53 mm square); a curve's is its chords' sagitta at the walk's back of a walk
 * on the outside of a bend, its eight segments' being under 4 mm at the face (shared/world/bends.ts) and so under 7 mm
 * there, four times that in four segments and sixteen in two, or its edge's where that is more.
 */
const BENT: readonly { id: string; object: string; triangles: number[]; errors: number[] }[] = [
  ...(["raised", "worn", "flush", "median"] as const).flatMap((kerb) => {
    const edge = kerb === "worn" ? [0.018, 0.038] : kerb === "flush" ? [0.004, 0.036] : kerb === "median" ? [0.008, 0.053] : [0.008, 0.036];
    return [
      { id: `core:zzzzzbend_${kerb}_s`, object: `bent_${kerb}_s`, triangles: BENT_TRIANGLES[`${kerb}_s`]!, errors: edge },
      { id: `core:zzzzzbend_${kerb}_c`, object: `bent_${kerb}_c`, triangles: BENT_TRIANGLES[`${kerb}_c`]!, errors: [Math.max(edge[0]!, 0.028), 0.11] },
    ];
  }),
  ...["raised_flush", "flush_raised", "worn_flush", "flush_worn", "raised_worn", "worn_raised"].map((join) => ({ id: `core:zzzzzbend_${join}`, object: `bent_${join}`, triangles: BENT_TRIANGLES[join]!, errors: [0.018, 0.04] })),
];

/**
 * A marina's dock kit (content/docks.ts), which dock.py makes on the atlas's wood and galvanised strips: the walkway's
 * module, its ramp down from the bank, a finger's module and the mooring pile, each its triangles a level: boards and
 * cleats and the ramp's rails; a plain deck; flat, the small parts gone; the deck's mass. Their levels are measured.
 */
const DOCK: readonly { id: string; object: string; triangles: number[] }[] = Object.entries({
  walk: [470, 170, 90, 24], ramp: [720, 320, 90, 24], finger: [420, 150, 70, 24], pile: [150, 80, 40, 24],
}).map(([part, triangles]) => ({ id: `core:zzzzdock_${part}`, object: `dock_${part}`, triangles }));

export default {
  kind: "pieces",
  source: { scripts: ["model.py", "curb.py", "dock.py", "bent.py"] },
  pieces: [
    ...Object.entries(PIECES).map(([name, triangles]) => ({ id: `core:zzstreet_${name}`, object: name, triangles, ...(STATED[name] ? { errors: STATED[name] } : {}) })),
    ...EDGE,
    ...DOCK,
    ...BENT,
  ],
  materials: {
    street: { base: "tex/street_base.png", normal: "tex/street_normal.png", packed: "tex/street_packed.png", height: "tex/street_height.png" },
    // A working lamp's lens, which gives out light from dusk to dawn (paint.py; client/core/render/surface.ts `glow`).
    // Its emissive is light where the noon sun is 1, and by night the frame's exposure is 42,000 (midnight) to 108,000 (an
    // hour after sunset), so 0.000025 brings the sodium-orange glass to 1 to 2.7 after exposure: bright, and short of
    // where the tone curve whitens a colour much; it blooms a little only at its brightest. At 4 it was white.
    street_glow: { base: "tex/glow_base.png", emissive: 0.000025, night: true },
    street_cut: { base: "tex/cut_base.png", normal: "tex/cut_normal.png", packed: "tex/cut_packed.png", height: "tex/cut_height.png", cutout: true },
  },
  budgets: { triangles: [432, 320, 120, 72], texture: { top: 2048, megabytes: 40 } },
} satisfies PiecesAsset;
