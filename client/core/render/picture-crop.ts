// Where on a picture each point of a screen's face reads, for the screens on props (screens.ts) and the Screens page's
// preview (admin/screens-faces.ts) alike, so what the operator sees whole is whole in the game.

/**
 * The crop of a picture `aspect` wide to its height on a face `face` wide to its height, into `out`: s and t scale,
 * then offset. Filled, the picture's longer way is cut to cover the face; fitted, the face runs past its shorter way,
 * and what lies outside 0 to 1 is the dark bars.
 */
export function pictureCrop(aspect: number, face: number, fill: boolean, out: Float64Array): Float64Array {
  if (!(aspect > 0) || !(face > 0)) {
    out[0] = out[1] = 1;
    out[2] = out[3] = 0;
    return out;
  }
  const cut = aspect > face === fill;
  out[0] = cut ? face / aspect : 1;
  out[1] = cut ? 1 : aspect / face;
  out[2] = (1 - out[0]) / 2;
  out[3] = (1 - out[1]) / 2;
  return out;
}
