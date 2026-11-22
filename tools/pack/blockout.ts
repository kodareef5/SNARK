// The model of a thing that is blocked out (content/items/blockouts.ts): a plain box a hand's width across, held where
// the thing's own model will be. It is in the pack with or without the art, so a blocked-out thing is a box in every
// build until a modeller makes it, and its picture in the bag stays its swatch (tools/pack/icons.ts).

import { boxMesh, type SourceMesh } from "./write.ts";

/** The id blocked-out things name as their held mesh. */
export const BLOCKOUT_MESH = "core:blockout";
/** Palette index of the box: the grey of a thing not made yet. */
const GREY = 4;

export function blockoutMeshes(): SourceMesh[] {
  const b = boxMesh([0.09, 0.09, 0.09], GREY);
  return [{ id: BLOCKOUT_MESH, lods: [{ positions: Float32Array.from(b.positions), colors: Uint8Array.from(b.colors), indices: Uint32Array.from(b.indices) }] }];
}
