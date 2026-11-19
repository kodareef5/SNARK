import { expect, test } from "bun:test";
import { ICON_SIZE, SKIN_HEIGHT, SKIN_WIDTH, VITAL_KINDS, skinPixels } from "../../client/core/ui/skin.ts";
import { paintVitals } from "../../tools/ui/vitals-art.ts";

/** A generated sheet as the tool is given one: sixteen pale glyphs with a glow on black, here a disc to a cell. */
function sheet(size: number): { width: number; height: number; channels: number; data: Uint8Array } {
  const data = new Uint8Array(size * size * 3), cell = size / 4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot((x % cell) + 0.5 - cell / 2, (y % cell) + 0.5 - cell / 2) - cell * 0.28;
    // Solid inside, paler toward its top as the glyphs are, and a glow that halves every six pixels outside.
    const v = d < 0 ? 0.8 + 0.2 * (1 - (y % cell) / cell) : 0.45 * 0.5 ** (d / 6);
    data.set([v * 200, v * 235, v * 255], (y * size + x) * 3);
  }
  return { width: size, height: size, channels: 3, data };
}

test("the vitals' generated glyphs fill the sheet's four rows as the HUD reads them, and touch nothing else of it", () => {
  const base = skinPixels(), data = base.data.slice();
  paintVitals(data, sheet(512));
  const at = (x: number, y: number): number[] => Array.from(data.subarray((y * SKIN_WIDTH + x) * 4, (y * SKIN_WIDTH + x) * 4 + 4));
  const mid = ICON_SIZE / 2;
  for (let kind = 0; kind < VITAL_KINDS; kind++) {
    const x = kind * ICON_SIZE + mid, where = `vital ${kind}`;
    // Behind: a dark silhouette. The fill: pale ice. The warning's fill: warm. Each solid at the glyph's middle.
    const [dark, fill, warn, line] = [0, 1, 2, 3].map((row) => at(x, row * ICON_SIZE + mid)) as [number[], number[], number[], number[]];
    expect(dark[3]! > 190 && dark[2]! < 80, where).toBe(true);
    expect(fill[3]! > 220 && fill[2]! > 200 && fill[0]! > 120, where).toBe(true);
    expect(warn[3]! > 220 && warn[0]! > warn[2]! + 60, where).toBe(true);
    // The outline is at the glyph's edge and not across its middle, and its glow fades out before the cell's corner.
    let edge = 0;
    for (let i = 0; i < mid; i++) edge = Math.max(edge, at(kind * ICON_SIZE + i, 3 * ICON_SIZE + mid)[3]!);
    expect(edge, where).toBeGreaterThan(150);
    expect(line[3]!, where).toBeLessThan(20);
    for (let row = 0; row < 4; row++) expect(at(kind * ICON_SIZE, row * ICON_SIZE), where).toEqual([0, 0, 0, 0]);
    // The glyph is sized for its cell: the silhouette spans most of it and stays inside.
    let left = ICON_SIZE, right = 0;
    for (let i = 0; i < ICON_SIZE; i++) if (at(kind * ICON_SIZE + i, mid)[3]! > 128) { left = Math.min(left, i); right = Math.max(right, i); }
    expect(right - left, where).toBeGreaterThan(ICON_SIZE * 0.55);
    expect(left > 2 && right < ICON_SIZE - 3, where).toBe(true);
  }
  // What is clear is nothing at all, which the file's size depends on.
  for (let i = 0; i < VITAL_KINDS * ICON_SIZE * 4 * ICON_SIZE; i++) {
    const x = i % (VITAL_KINDS * ICON_SIZE), y = Math.floor(i / (VITAL_KINDS * ICON_SIZE)), p = at(x, y);
    if (p[3] === 0 && p[0]! + p[1]! + p[2]! !== 0) throw new Error(`a clear pixel with a colour at ${x}, ${y}`);
  }
  // The glass, the pad and the rest of the sheet are as the rules drew them.
  for (let y = 4 * ICON_SIZE; y < SKIN_HEIGHT; y += 7) for (let x = 0; x < SKIN_WIDTH; x += 5) expect(at(x, y)).toEqual(Array.from(base.data.subarray((y * SKIN_WIDTH + x) * 4, (y * SKIN_WIDTH + x) * 4 + 4)));
  for (let y = 0; y < 4 * ICON_SIZE; y += 9) for (let x = VITAL_KINDS * ICON_SIZE; x < SKIN_WIDTH; x += 5) expect(at(x, y)).toEqual(Array.from(base.data.subarray((y * SKIN_WIDTH + x) * 4, (y * SKIN_WIDTH + x) * 4 + 4)));
});
