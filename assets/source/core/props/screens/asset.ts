// The screen props (content/screens.ts), built by model.py: the flat TVs on a wall and on a stand, the tube TV, the
// laptop, each with its broken form, and the tek workstation. The tube TV, the laptop, the desk and the console on it are
// Poly Haven's, CC0 (SOURCES.md); the flat panels are made in model.py. Each replaces the grey box of the structure with
// its id.
//
// Materials, two or three a piece: "kit", the four Poly Haven models' 1k sets in the quarters of one 2k set (tex.py);
// "panel" and "alu", painted by tex.py, for the flat panels; "screen", dark glass with no pictures, under the picture
// the client draws (shared/video/face.ts); and "cracked", tex.py's smashed glass, on every broken form.

import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";

/** A set tex.py painted under tex/: base colour and packed maps, its normal everywhere flat and so left out. */
const painted = (name: string, tiles?: number): MaterialSpec => ({ base: `tex/${name}_base.png`, packed: `tex/${name}_orm.png`, ...(tiles ? { tiles } : {}) });
const CREDIT = "Poly Haven (polyhaven.com) · CC0 1.0";
const MADE = "Made for SNARK · CC0 1.0";
const LAPTOP = [4000, 2400, 600, 120];

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  modelCredit: CREDIT,
  pieces: [
    { id: "core:tv_flat", object: "tv_flat", modelCredit: MADE },
    { id: "core:tv_flat_broken", object: "tv_flat_broken", modelCredit: MADE },
    { id: "core:tv_flat_stand", object: "tv_flat_stand", modelCredit: MADE },
    { id: "core:tv_flat_stand_broken", object: "tv_flat_stand_broken", modelCredit: MADE },
    { id: "core:tv_crt", object: "tv_crt", modelCredit: `Television 02 by Benny Weimer, ${CREDIT}` },
    { id: "core:tv_crt_broken", object: "tv_crt_broken", modelCredit: `Television 02 by Benny Weimer, ${CREDIT}` },
    // Its ninety keys are what keep it over the others' budget.
    { id: "core:laptop", object: "laptop", triangles: LAPTOP, modelCredit: `Classic Laptop by Arrangemonk, ${CREDIT}` },
    { id: "core:laptop_broken", object: "laptop_broken", triangles: LAPTOP, modelCredit: `Classic Laptop by Arrangemonk, ${CREDIT}` },
    // Three models in one, the laptop's keys among them.
    {
      id: "core:workstation", object: "workstation", triangles: [9600, 2400, 600, 160],
      modelCredit: `Metal Office Desk by Ulan Cabanilla, Classic Laptop by Arrangemonk and Vintage Spacecraft Instrument by Michał Wiśniewski, ${CREDIT}`,
    },
  ],
  materials: {
    // Its normal and packed maps are stored at 1,024, a quarter's 512.
    kit: { base: "tex/kit_base.png", normal: "tex/kit_normal.png", packed: "tex/kit_orm.png", tops: { normal: 1024, mro: 1024 } },
    panel: painted("panel", 0.6),
    alu: painted("alu", 0.4),
    cracked: painted("cracked"),
    screen: { tint: [0.012, 0.014, 0.018], flat: [10, 11, 14] },
  },
  // Levels 0 and 1 keep their materials, 2 and on are flat. A prop is drawn near only: a step away its finest, a room
  // away the next, and its far levels across a street.
  flat: 2,
  budgets: { triangles: [2400, 900, 240, 60], texture: { top: 2048, megabytes: 40 } },
} satisfies PiecesAsset;
