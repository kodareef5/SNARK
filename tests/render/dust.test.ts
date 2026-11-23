// The dust over a collapse told from afar (client/core/render/dust-columns.ts): its cards, their life, and the picture.

import { expect, test } from "bun:test";
import { Camera } from "../../client/core/render/camera.ts";
import { DUST_FROM, DUST_MS, DUST_WHOLE, DustColumns, MAX_DUST_CARDS } from "../../client/core/render/dust-columns.ts";
import { DETAIL, DETAIL_FLOATS, DETAIL_LIT, DETAIL_PUFF, DRAW_BLEND, DRAW_DETAILS, FramePacket } from "../../client/core/render/packet.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { building, cityWorld } from "../fixtures/cityworld.ts";

const FELL = { x: 1000, z: 1000, foot: 2, across: 30, tall: 60 };

/** The cards of a frame `ms` after `fell` was told, seen from `metres` south of it: how much each shows of 255, and its half sizes. */
function cards(metres: number, ms: number, fell = [FELL]): { shows: number; wide: number; high: number; y: number; flags: number }[] {
  const dust = new DustColumns();
  for (const f of fell) dust.add(f, 0);
  const cam = new Camera();
  [cam.x, cam.y, cam.z] = [FELL.x, 10, FELL.z - metres];
  dust.build(cam, ms);
  const p = new FramePacket();
  p.beginFrame();
  dust.write(p);
  return [...Array(p.detailCount).keys()].map((n) => {
    const o = n * DETAIL_FLOATS, misc = p.detailWords[o + DETAIL.misc]!;
    return { shows: (misc >>> 16) & 255, wide: Math.hypot(p.details[o + DETAIL.across]!, p.details[o + DETAIL.across + 2]!), high: p.details[o + DETAIL.along + 1]!, y: p.details[o + 1]! + 10, flags: (misc >>> 8) & 255 };
  });
}

test("a collapse told from afar is a column of dust and a cloud at its foot, lit puffs that rise, stand and thin away", () => {
  const early = cards(800, 1000), risen = cards(800, 8000), late = cards(800, DUST_MS - 4000);
  expect([early.length, risen.length, late.length, cards(800, DUST_MS).length]).toEqual([2, 2, 2, 0]);
  // The column is taller than it is wide and stands over its foot; both are lit puffs.
  const [foot, column] = [risen.find((c) => c.high < c.wide)!, risen.find((c) => c.high > c.wide)!];
  expect([column.flags & (DETAIL_LIT | DETAIL_PUFF), foot.flags & (DETAIL_LIT | DETAIL_PUFF)]).toEqual([DETAIL_LIT | DETAIL_PUFF, DETAIL_LIT | DETAIL_PUFF]);
  expect(column.y + column.high).toBeGreaterThan(FELL.foot + FELL.tall * 0.8);
  expect(column.y - column.high).toBeLessThan(FELL.foot + 8);
  // It rises and widens, shows whole while it stands, and less at its end.
  const tall = (list: typeof risen): number => Math.max(...list.map((c) => c.high));
  expect(tall(risen)).toBeGreaterThan(tall(early) * 1.5);
  expect(Math.max(...risen.map((c) => c.shows))).toBe(255);
  expect(Math.max(...late.map((c) => c.shows))).toBeLessThan(60);
});

test("a column thins to nothing inside 150 m, where the pieces themselves are seen, and eight cards are the most", () => {
  expect(cards(DUST_FROM - 1, 8000).length).toBe(0);
  const half = cards((DUST_FROM + DUST_WHOLE) / 2, 8000);
  expect(Math.max(...half.map((c) => c.shows))).toBeGreaterThan(100);
  expect(Math.max(...half.map((c) => c.shows))).toBeLessThan(155);
  expect(Math.max(...cards(DUST_WHOLE, 8000).map((c) => c.shows))).toBe(255);
  // Five collapses: a column each, and feet for the three newest. Twelve: the eight newest, columns alone.
  const many = (n: number) => Array.from({ length: n }, (_, k) => ({ ...FELL, x: FELL.x + k * 40 }));
  const five = cards(800, 8000, many(5));
  expect([five.length, five.filter((c) => c.high > c.wide).length]).toEqual([MAX_DUST_CARDS, 5]);
  const twelve = cards(800, 8000, many(12));
  expect([twelve.length, twelve.every((c) => c.high > c.wide)]).toEqual([MAX_DUST_CARDS, true]);
});

test("the scene draws the dust in one draw of see-through cards, and the rasterizer shows it over the skyline", () => {
  const [x, z] = [6 * CHUNK_SIZE + 32, 6 * CHUNK_SIZE + 32];
  const w = cityWorld({ chunks: 16, statics: building(x, z, 0, 3), width: 320, height: 180 });
  w.look(x, 20, z, 500, 0.4, 2);
  const details = (p: FramePacket): number[] => [...Array(p.drawCount).keys()].filter((d) => (p.drawFlags[d]! & DRAW_DETAILS) !== 0 && (p.drawFlags[d]! & DRAW_BLEND) !== 0);
  let p = w.frame();
  const before = details(p).length;
  const clear = w.raster.color.slice();
  w.scene.dust.add({ x, z, foot: 0, across: 30, tall: 60 }, w.scene.now);
  for (let f = 0; f < 5; f++) p = w.frame(false, 2000);
  const drawn = details(p);
  expect(drawn.length).toBe(before + 1);
  expect(Math.max(...drawn.map((d) => p.drawInstances[d]!))).toBe(2);
  let moved = 0;
  for (let i = 0; i < w.W * w.H; i++) if ([0, 1, 2].some((k) => Math.abs(w.raster.color[i * 4 + k]! - clear[i * 4 + k]!) > 4)) moved++;
  expect(moved).toBeGreaterThan(100);
  // Gone when its time is over.
  p = w.frame(false, DUST_MS);
  expect(details(p).length).toBe(before);
});
