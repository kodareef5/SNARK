// A near chunk's mesh says of each face the piece it is of and the piece that hid it (shared/world/city.ts KeyedFaces), and
// a small texture says of each piece of each near chunk whether its mesh draws it. So a piece leaves a mesh by one texel:
// its faces fall to a point in the vertex stage, and the faces it hid, kept at the end of the mesh, show. The same rule is
// here as text for the flat and depth programs and as a function for the software rasterizer.
//
// The texture is PIECE_KEYS texels wide, a key each, and a row a chunk. Row 0 is no chunk's: every piece of it stands.
// A texel, four bytes:
//   R  bit 0: the chunk's mesh draws the piece (PIECE_IN_MESH), or where the chunk has no mesh, the piece stands as the
//      map set it down. Bits 1 to 3: its damage stage. Bit 4: scorched. Bits 5 to 7: what broke it.
//   G  its damage, 0 to 255.
//   B  where it was hit across its face in the low four bits, and up it in the high four.
//   A  bits 0 to 4: the material made from a recipe it wears (PIECE_MADE). Bits 5 to 7: the face that was hit.
// Only bit 0 and the material are written yet.

import { NEIGHBOUR_HOLDER, PIECE_KEY_BITS, PIECE_SLOTS } from "../../../shared/world/city.ts";

/** Texels in a row: a chunk's slots, then its merge groups. */
export const PIECE_KEYS = 2 * PIECE_SLOTS;
/** Rows: chunks drawn near and those round them, and row 0. */
export const PIECE_ROWS = 128;
export const PIECE_IN_MESH = 1;
export const PIECE_MADE = 31;
/** Set in the word of every face of a mesh made with keys: a word of 0 is a vertex of any other mesh. */
export const PIECE_KEYED = 0x80000000;
/** The bits of a face's word that hold its holder, over its own key; the four over them are a facade element's, not yet used. */
export const HOLDER_BITS = 15;
/** The place among the nine rows a draw is given (its chunk's row and the eight round it) of neighbour `n`: a row of three, then the next. */
export const rowPlace = (n: number): number => (n < 4 ? n : n + 1);

/**
 * Whether a face of word `word` is drawn: its own key is in its chunk's mesh, and its holder is none or is not in its.
 * `state` is the texture's bytes and `rows` the nine rows the face's chunk is drawn with, from `at`.
 */
export function pieceShown(state: Uint8Array, rows: ArrayLike<number>, at: number, word: number): boolean {
  if ((state[(rows[at + 4]! * PIECE_KEYS + (word & (PIECE_KEYS - 1))) * 4]! & PIECE_IN_MESH) === 0) return false;
  const holder = (word >>> PIECE_KEY_BITS) & ((1 << HOLDER_BITS) - 1);
  if (holder === 0) return true;
  let key = holder - 1, place = 4;
  if (holder >= NEIGHBOUR_HOLDER) {
    key = (holder - NEIGHBOUR_HOLDER) & (PIECE_SLOTS - 1);
    place = rowPlace((holder - NEIGHBOUR_HOLDER) >>> (PIECE_KEY_BITS - 1));
  }
  return (state[(rows[at + place]! * PIECE_KEYS + key) * 4]! & PIECE_IN_MESH) === 0;
}

/** The material made from a recipe the face of word `word` wears, from its own key's texel. */
export function pieceMade(state: Uint8Array, rows: ArrayLike<number>, at: number, word: number): number {
  return state[(rows[at + 4]! * PIECE_KEYS + (word & (PIECE_KEYS - 1))) * 4 + 3]! & PIECE_MADE;
}

/** What a vertex text declares to apply the rule: the face's word, the states, the draw's nine rows, and the rule. */
export const PIECE_GLSL = `layout(location=15) in uint aPiece;
uniform highp usampler2D uPieces;
uniform vec3 uPieceRows[3];
bool pieceShown(uint word, out uvec4 own) {
  own = texelFetch(uPieces, ivec2(int(word & ${PIECE_KEYS - 1}u), int(uPieceRows[1].y)), 0);
  if ((own.r & ${PIECE_IN_MESH}u) == 0u) return false;
  uint holder = (word >> ${PIECE_KEY_BITS}u) & ${(1 << HOLDER_BITS) - 1}u;
  if (holder == 0u) return true;
  uint key = holder - 1u, place = 4u;
  if (holder >= ${NEIGHBOUR_HOLDER}u) {
    key = (holder - ${NEIGHBOUR_HOLDER}u) & ${PIECE_SLOTS - 1}u;
    place = (holder - ${NEIGHBOUR_HOLDER}u) >> ${PIECE_KEY_BITS - 1}u;
    place += place >= 4u ? 1u : 0u;
  }
  return (texelFetch(uPieces, ivec2(int(key), int(uPieceRows[place / 3u][place % 3u])), 0).r & ${PIECE_IN_MESH}u) == 0u;
}
`;
/** In `main`, before anything reads `piece`: the face's own texel, and whether it is drawn. */
export const PIECE_PLACE = `  uvec4 piece = uvec4(0u);
  bool pieceGone = aPiece != 0u && !pieceShown(aPiece, piece);
`;
/** After `gl_Position` is set: a face not drawn falls to one point outside the view. */
export const PIECE_END = `  if (pieceGone) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
`;
