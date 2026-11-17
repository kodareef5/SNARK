// A landmark's finishes: how its flat levels are lit where its art says, so that a flat level is its textured level
// without the picture, at every hour and from either side.
//
// - The art states each finish (tools/art/spec.ts PiecesAsset `finishes`), and the art build reads its pictures for its
//   colour, occlusion, roughness and metalness at a distance, gives it a palette colour no other of its finishes has, and
//   draws the finish's flat faces in that colour. The asset's pack carries the finishes, FINISH_NUMBERS a finish, and the
//   landmark's far row carries them on to its manifest (shared/pack/far.ts).
// - On a lit tier a flat draw of one of the landmark's meshes takes, for a vertex in a stated colour, the finish's own
//   colour, and its occlusion, roughness, metalness and sheet, and is lit as a textured draw is: the highlight mirrors
//   the sky as SURFACE's does. A colour no finish states is lit as every flat draw is, fully rough. Low poly draws the
//   palette colour, as ever.
// - `sheet` is how much of the light on one face of a thin sheet the other face shows (surface.ts `through`): sailcloth,
//   an awning, a flag. A textured material says it too (PackMaterial `sheet`).
// - A landmark that states none is drawn as it always was.

import type { LandmarkFarRow } from "./far.ts";

/**
 * The numbers of a finish: its palette colour, then its colour as red, green and blue of 255 (sRGB), its occlusion,
 * roughness and metalness of 255, and its sheet of 255.
 */
export const FINISH_NUMBERS = 8;

/**
 * The palette and every landmark's finishes as one RGBA8 picture 256 wide: row 0 the palette; for the landmark k of
 * those that state finishes, row 2k + 1 holds the colour of each palette colour it states, with alpha 255 where it
 * states one, and row 2k + 2 the finish's occlusion, roughness, metalness and sheet. `row` is k + 1 for each mesh of
 * that landmark, its id's namespace, and 0 for any other mesh.
 */
export interface FinishTable {
  readonly pixels: Uint8Array;
  readonly height: number;
  readonly row: Uint8Array;
}

export function finishTable(palette: Uint8Array, manifest: { readonly meshes: readonly { readonly id: string }[]; readonly landmarks?: readonly LandmarkFarRow[] }): FinishTable {
  const stating = (manifest.landmarks ?? []).filter((l) => (l.finishes?.length ?? 0) > 0);
  const height = 1 + 2 * stating.length;
  const pixels = new Uint8Array(256 * 4 * height);
  pixels.set(palette.subarray(0, 256 * 4));
  const rowOf = new Map<string, number>();
  stating.forEach((l, k) => {
    rowOf.set(l.name, k + 1);
    const f = l.finishes!;
    for (let at = 0; at + FINISH_NUMBERS <= f.length; at += FINISH_NUMBERS) {
      const colour = f[at]!, own = ((2 * k + 1) * 256 + colour) * 4, more = own + 256 * 4;
      pixels.set([f[at + 1]!, f[at + 2]!, f[at + 3]!, 255], own);
      pixels.set([f[at + 4]!, f[at + 5]!, f[at + 6]!, f[at + 7]!], more);
    }
  });
  const row = Uint8Array.from(manifest.meshes, (m) => rowOf.get(m.id.split(":")[0]!) ?? 0);
  return { pixels, height, row };
}
