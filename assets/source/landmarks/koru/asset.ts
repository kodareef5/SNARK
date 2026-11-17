// Koru, a landmark yacht, built by model.py from the layout author_layout.py writes. Each 16 m cell of the ship is one
// mesh, drawn by its anchor's static; the doors and the sail parts are meshes of their own.

import layout from "../../../../content/landmarks/koru-layout.json" with { type: "json" };
import { PIECE_TRIANGLES } from "../../../../tools/art/check.ts";
import type { FinishSpec, PieceSpec, PiecesAsset } from "../../../../tools/art/spec.ts";
import look from "./materials.json" with { type: "json" };

const budget = (rule: readonly (readonly [number, number])[]): number[] => rule.map(([, n]) => n);
const name = (id: string): string => id.slice("koru:".length);
// What a cell may draw from each distance on medium, in place of LANDMARK_TRIANGLES. Its far levels carry the deckhouse's
// windows, the ports and the boot stripe to the horizon, which five building pieces' worth cannot: from 250 m on the
// whole yacht is at most 20 thousand triangles, its far mesh, a sixth of the cruise ship's. Near it is at most 112
// thousand, a twentieth of medium's frame.
const CELLS = [[0, 22000], [50, 22000], [100, 4000], [250, 2500], [500, 2500]] as const;
// A cell's five levels are model.py's: 0 and 1 drawn with the atlas, 2 to 4 flat. Levels 1 to 3 show what is seen from
// outside, the hull, decks, deckhouse walls with their windows, and rig, and leave the rooms behind the white walls and
// the glass, which is dark from outside. What they leave or thin that shows is under 2.5, 8 and 13 cm across (rail posts
// and port rims; then the wires and rails, a third of a pixel where level 2 is first drawn, and the cove line; then the
// cap rail's face and the spars' facets), which a measure of points cannot judge: it counts the rooms. Level 4 is a
// stand-in of blocks for the boot file to hold, drawn only until the others come: no client is near enough a cell to
// want a level past 0.13 m, and the far mesh takes levels 2 and 3.
const cell = (id: string): PieceSpec => ({ id, object: name(id), triangles: [...budget(CELLS).slice(1), 400], errors: [0.025, 0.06, 0.13, 0.3] });
const part = (id: string): PieceSpec => ({ id, object: name(id), triangles: budget(PIECE_TRIANGLES) });
// Every finish of the pictures is one of the yacht's finishes: its flat faces are lit as its part of the pictures is, so
// a flat level is its textured level without the picture (shared/pack/finish.ts).
const finish = (f: { picture?: string; rect: number[] }): FinishSpec => ({ material: f.picture ?? "surfaces", rect: f.rect as unknown as FinishSpec["rect"] });
const pictures = (name: string, more: object = {}) => ({ base: `tex/${name}_base.png`, normal: `tex/${name}_normal.png`, packed: `tex/${name}_packed.png`, height: `tex/${name}_height.png`, ...more });

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: [...layout.cells.map((c) => cell(c.id)), ...layout.modules.filter((m) => m.category === "door").map((m) => part(m.id)), ...layout.motion.parts.map((p) => part(p.mesh))],
  materials: {
    surfaces: pictures("surfaces"),
    // Sailcloth passes light: from the side the sun is not on, a sail shows most of what its other side takes.
    sails: pictures("sails", { sheet: 0.7, tops: { normal: 128 } }),
    // The plaques and the name, twice as sharp as the atlas held them, so that medium's 1024 shows them as high did.
    signs: pictures("signs", { tops: { normal: 1024 } }),
  },
  finishes: Object.fromEntries(Object.entries(look.finishes).map(([n, f]) => [n, finish(f)])),
  budgets: { triangles: budget(CELLS), texture: { top: 2048, megabytes: 64 }, cells: CELLS },
} satisfies PiecesAsset;
