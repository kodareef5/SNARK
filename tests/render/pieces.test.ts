// The rule a near chunk's mesh is drawn by (client/core/render/pieces.ts): a face's word, the states' rows, and the
// uniform that gives a draw its nine rows. The meshes and the frames that use it are in nearcity.test.ts.

import { expect, test } from "bun:test";
import { TIERS } from "../../client/core/assets/tiers.ts";
import { FramePacket } from "../../client/core/render/packet.ts";
import { HOLDER_BITS, PIECE_END, PIECE_GLSL, PIECE_IN_MESH, PIECE_KEYED, PIECE_KEYS, PIECE_PLACE, PIECE_ROWS, pieceMade, pieceShown, rowPlace } from "../../client/core/render/pieces.ts";
import { neighbourOf } from "../../client/core/render/nearcity.ts";
import { PROGRAM, PROGRAMS, UNIFORMS, UNIT } from "../../client/core/render/programs.ts";
import { AT_DRAW, Drawn } from "../../client/core/render/uniforms.ts";
import { NEIGHBOUR_HOLDER, PIECE_KEY_BITS, PIECE_SLOTS } from "../../shared/world/city.ts";

test("a face is drawn when its own key is in its mesh and its holder is none or is not in its", () => {
  const state = new Uint8Array(PIECE_KEYS * PIECE_ROWS * 4);
  const on = (row: number, key: number, made = 0): void => void state.set([PIECE_IN_MESH, 0, 0, made], (row * PIECE_KEYS + key) * 4);
  // A chunk on row 7, its neighbours on rows 10 to 17, a row of three then the next, its own the fifth.
  const rows = [0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 11, 12, 13, 7, 14, 15, 16, 17];
  const word = (own: number, holder = 0): number => (own | (holder << PIECE_KEY_BITS) | PIECE_KEYED) >>> 0;
  expect(pieceShown(state, rows, 9, word(5))).toBe(false);
  on(7, 5, 9);
  expect([pieceShown(state, rows, 9, word(5)), pieceMade(state, rows, 9, word(5))]).toEqual([true, 9]);
  // Held by slot 6 of its own chunk, by a merge group of it, and by slot 6 of each neighbour: hidden while that stands.
  expect(pieceShown(state, rows, 9, word(5, 6 + 1))).toBe(true);
  on(7, 6);
  expect(pieceShown(state, rows, 9, word(5, 6 + 1))).toBe(false);
  expect(pieceShown(state, rows, 9, word(5, PIECE_SLOTS + 3 + 1))).toBe(true);
  on(7, PIECE_SLOTS + 3);
  expect(pieceShown(state, rows, 9, word(5, PIECE_SLOTS + 3 + 1))).toBe(false);
  for (let n = 0; n < 8; n++) {
    const held = word(5, NEIGHBOUR_HOLDER + n * PIECE_SLOTS + 6);
    expect(pieceShown(state, rows, 9, held)).toBe(true);
    on(rows[9 + rowPlace(n)]!, 6);
    expect(pieceShown(state, rows, 9, held)).toBe(false);
  }
  // A neighbour's number is its place round the chunk, and the widest holder fits the word under the facade's bits.
  expect([neighbourOf(-1, -1), neighbourOf(1, -1), neighbourOf(-1, 0), neighbourOf(1, 0), neighbourOf(1, 1)]).toEqual([0, 2, 3, 4, 7]);
  expect(NEIGHBOUR_HOLDER + 8 * PIECE_SLOTS).toBeLessThanOrEqual(1 << HOLDER_BITS);
  expect(PIECE_KEY_BITS + HOLDER_BITS + 4).toBe(31);
});

test("the flat and depth texts of every tier apply the rule from one text, with two reads of the states at most", () => {
  for (const tier of TIERS) {
    for (const name of ["flat", "depth"] as const) {
      const vertex = PROGRAMS[name]!(tier, "bc").vertex;
      for (const part of [PIECE_GLSL, PIECE_PLACE, PIECE_END]) expect(vertex.split(part).length).toBe(2);
      expect(vertex.indexOf(PIECE_END)).toBeGreaterThan(vertex.lastIndexOf("uViewProj * vec4(p, 1.0)"));
      expect(PROGRAMS[name]!(tier, "bc").samplers.uPieces).toBe(UNIT.pieces);
    }
  }
  expect(PIECE_GLSL.split("texelFetch(uPieces").length - 1).toBe(2);
  // The text's numbers are the function's.
  expect(PIECE_GLSL).toContain(`word & ${PIECE_KEYS - 1}u`);
  expect(PIECE_GLSL).toContain(`holder >= ${NEIGHBOUR_HOLDER}u`);
  expect(PIECE_GLSL).toContain(`& ${PIECE_SLOTS - 1}u`);
});

test("a draw of a chunk with a row is given its nine rows, again when they change, and any other draw nothing", () => {
  const c = new Drawn({ header: {} } as never, {} as never, { width: [1, 1], height: [1, 1], cell: [1, 1], bytes: 0 }, [], [], Uint8Array.of(0));
  const p = (c.p = new FramePacket());
  for (const [program, column] of [["flat", p.drawBuffer], ["depth", p.casterBuffer]] as const) {
    const row = UNIFORMS[PROGRAM[program]]!.find((r) => r.name === "uPieceRows" && r.at === AT_DRAW)!;
    p.pieceRowOf.clear();
    c.d = 3;
    column[3] = 40;
    expect([row.array!(c), row.key!(c)]).toEqual([null, -1]);
    p.pieceRowOf.set(40, 6);
    p.pieceRows.set([1, 2, 3, 4, 6, 5, 7, 8, 9], 6 * 9);
    const key = row.key!(c);
    expect(Array.from(row.array!(c)!)).toEqual([1, 2, 3, 4, 6, 5, 7, 8, 9]);
    p.pieceStamp[6]!++;
    expect(row.key!(c)).not.toBe(key);
    p.pieceStamp[6]!--;
  }
});
