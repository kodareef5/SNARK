// What stands in a city's streets besides its buildings and cars (content/street.ts), each a piece of its own and each
// as a ruin of itself: model.py makes them, in the piece's frame (origin on the ground at the middle of its foot, +Z
// toward the road), from kit.py's parts, laid on two atlases by layout.json. paint.py puts the atlases together from
// their painted parts in tex/parts (ref/SOURCES.md says how each was made). "street" is opaque; "street_cut" is drawn
// where its alpha is over half: chain-link, broken glass, torn vinyl. The script makes every level; the flat ones are
// in the colours of what their faces were laid on, the last the piece's masses in a dozen to seventy triangles.

import type { PiecesAsset } from "../../../../../tools/art/spec.ts";

/**
 * Each piece's name after "core:zzstreet_" and the most triangles each of its levels may have, finest first, as model.py
 * makes them: the finest; fewer sides round; then flat, the small parts gone; then the masses alone; a level that
 * would keep more than four fifths of the one before is left out.
 */
const PIECES: Readonly<Record<string, readonly number[]>> = {
  lamp: [220, 152, 52, 28],
  lamp_leaning: [220, 152, 52, 28],
  lamp_fallen: [256, 172, 64, 36],
  signal: [432, 40],
  signal_bent: [292, 28],
  stop: [76, 36],
  stop_bent: [76, 36],
  street_name: [68],
  speed: [24],
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
  bollard: [92, 52, 12, 8],
  fence: [112, 24],
  fence_sagging: [220, 24],
  fence_down: [208, 24],
  rail: [100, 36],
  rail_bent: [296, 36],
  billboard: [320, 32],
  billboard_bare: [308, 68],
  newsbox: [48, 12],
};

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: Object.entries(PIECES).map(([name, triangles]) => ({ id: `core:zzstreet_${name}`, object: name, triangles })),
  materials: {
    street: { base: "tex/street_base.png", normal: "tex/street_normal.png", packed: "tex/street_packed.png", height: "tex/street_height.png" },
    street_cut: { base: "tex/cut_base.png", normal: "tex/cut_normal.png", packed: "tex/cut_packed.png", height: "tex/cut_height.png", cutout: true },
  },
  budgets: { triangles: [432, 320, 120, 72], texture: { top: 2048, megabytes: 40 } },
} satisfies PiecesAsset;
