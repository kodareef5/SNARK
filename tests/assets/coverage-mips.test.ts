// A cut-out's mips can keep the share of it at the cutoff or over that its top mip has, so hair cards do not thin away
// with distance. It is asked for per material: every other material's mips are as they were.

import { expect, test } from "bun:test";
import { alphaCoverage, baseMips, type Picture } from "../../tools/pack/image.ts";
import { coverageOf } from "../../tools/art/materials.ts";
import { findAssets } from "../../tools/art/assets.ts";
import { materialsOf } from "../../tools/art/materials.ts";
import { paintSheet, sheetPictures, SIDE } from "../../assets/source/core/humans/hair/paint.ts";
import { CARD_KINDS, SHEET_CELLS, cardCell } from "../../assets/source/core/humans/hair/sheet.ts";

/** Strands down a square picture, a few pixels apart and of varied width, their edges soft, as a card's alpha is. */
function strands(side: number, every: number): Picture {
  const data = new Uint8Array(side * side * 4).fill(180);
  for (let i = 3; i < data.length; i += 4) data[i] = 0;
  let seed = 7;
  const random = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let x0 = 1; x0 < side; x0 += every * (0.6 + random() * 0.8)) {
    const width = 0.4 + random() * 0.9, sway = random() * 3, f = 1 + random() * 4;
    for (let y = 0; y < side; y++) {
      const cx = x0 + sway * Math.sin((y / side) * Math.PI * f);
      for (let x = Math.floor(cx - 2); x <= Math.ceil(cx + 2); x++) {
        const at = ((((x % side) + side) % side) + y * side) * 4 + 3;
        data[at] = Math.max(data[at]!, Math.round(255 * Math.max(0, Math.min(1, width + 0.5 - Math.abs(x + 0.5 - cx)))));
      }
    }
  }
  return { width: side, height: side, channels: 4, depth: 8, data };
}

/** The mips from 8 texels across up, each against the top's coverage. */
function drift(mips: Uint8Array[], cutoff: number): number[] {
  const top = alphaCoverage(mips.at(-1)!, cutoff);
  return mips.filter((m) => m.length >= 8 * 8 * 4).map((m) => Math.abs(alphaCoverage(m, cutoff) - top));
}

test("a cut-out's mips down to 8 texels keep coverage within 2% of the top's", () => {
  const p = strands(256, 5);
  for (const cutoff of [0.3, 0.5, 0.7]) {
    expect(Math.max(...drift(baseMips(p, cutoff), cutoff))).toBeLessThan(0.02);
    // Left as they average, the same strands are gone by the third halving.
    expect(Math.max(...drift(baseMips(p), cutoff))).toBeGreaterThan(0.1);
  }
});

test("without a cutoff the mips are the plain means they always were", () => {
  const p = strands(64, 3);
  const plain = baseMips(p);
  expect(baseMips(p, undefined)).toEqual(plain);
  // The top mip is the picture itself either way; only the halvings' alpha moves.
  const kept = baseMips(p, 0.5);
  expect(kept.at(-1)).toEqual(plain.at(-1)!);
  for (const [k, m] of kept.entries()) for (let i = 0; i < m.length; i++) if ((i & 3) !== 3) expect(m[i]).toBe(plain[k]![i]!);
});

test("each card on the strand sheet keeps its coverage down to 8 texels across", () => {
  const base = sheetPictures(paintSheet()).base;
  expect(base.width).toBe(SIDE);
  const mips = baseMips(base, 0.5, SHEET_CELLS);
  for (const kind of CARD_KINDS) {
    const cell = cardCell(kind);
    // Below 8 texels a stubble's bristles are less than a texel each, and its cell's alpha is one grey.
    const shares = mips.filter((m) => Math.sqrt(m.length / 4) * (cell[1] - cell[0]) >= 7.9).map((m) => alphaCoverage(m, 0.5, cell));
    const top = shares.at(-1)!;
    expect(top).toBeGreaterThan(0.2);
    for (const s of shares) expect(Math.abs(s - top)).toBeLessThan(0.02);
  }
});

test("only the hair's cards ask for coverage-keeping mips, and they are cut out", async () => {
  const asking = (await findAssets()).flatMap((a) => materialsOf(a).filter((m) => m.spec.coverage).map((m) => m.id));
  expect(asking).toEqual(["core:human-bodies/hair_cards"]);
  const cards = (await findAssets()).flatMap(materialsOf).find((m) => m.id === "core:human-bodies/hair_cards")!;
  expect(coverageOf(cards.spec)).toEqual({ cutoff: 0.5, cells: SHEET_CELLS });
  expect(() => coverageOf({ coverage: true })).toThrow();
});
