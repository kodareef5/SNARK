// The soul balls (planning/workstreams/soul-ball.md), built by model.py: the empty one and the full one, each on the right
// hand's prop bone, on the ground and in its inventory picture. They replace the boxes tools/pack/balls.ts draws under
// the same ids (withArt in tools/pack/build.ts).
//
// Nothing here is painted anew. Both wear the Meridian suit's finish, a sheet of sixteen tiles: the model lays every face
// inside one tile of it (model.py, TILE), so the material does not tile and is this asset's own, of the suit's pictures,
// which the game stores once (assets/source/README.md, "Materials"). The full ball's lens and ports are the same pictures
// drawn glowing. Nothing is dyed: neither has a colour region.

import { resolve } from "node:path";
import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";
import { HELD_TRIANGLES } from "../weapons/materials.ts";

const SUIT = resolve(import.meta.dir, "../../humans/human-bodies");
/** The suit's pictures as the suit stores them, so that they are the same textures. Flat, a ball is its ceramic's ivory. */
const FINISH: MaterialSpec = { base: "meridian/finish.png", normal: "meridian/normal.png", packed: "meridian/orm.png", dir: SUIT, flat: [236, 236, 229] };
/** From a little above its side, so the lens, a meridian and a port all show. */
const ICON = { around: 0.55, above: 0.5 };

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: [
    { id: "core:soul_ball", object: "ball", hold: "prop_r", dropped: "auto", icon: ICON },
    { id: "core:soul_ball_full", object: "ball_full", hold: "prop_r", dropped: "auto", icon: ICON },
  ],
  materials: {
    shell: FINISH,
    // The lamp's blue, lit: as bright as the suit's own indicators by day, and seen across a camp at night.
    lamp: { ...FINISH, emissive: 1.6, flat: [119, 229, 255] },
  },
  // The held item's budget (D416): levels 0 and 1 keep their materials, 2 and on are flat.
  flat: 2,
  budgets: { triangles: [...HELD_TRIANGLES], texture: { top: 2048, megabytes: 52 } },
} satisfies PiecesAsset;
