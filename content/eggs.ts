import type { Def } from "../shared/content/defs.ts";
import { defaultPalette, nearestColour } from "../shared/pack/palette.ts";

// Eggs as items, and the feces creatures leave. Each species' own eggs are in its creature file. The feces items are ARK's
// four for animals, as the ARK wiki (ark.wiki.gg) gave them on 2026-11-15, in in-game hours of 140 seconds: none stacks,
// each spoils in its time and lies on the ground for a minute. The nitrogen each gives a crop plot waits for crops.

const PALETTE = defaultPalette();
const tone = (rgb: number): number => nearestColour(PALETTE, rgb >> 16, (rgb >> 8) & 255, rgb & 255);
const DUNG = tone(0x5a4428);
const MINUTE = 60 / 140;
const feces = (size: string, weight: number, spoilSeconds: number): Def => ({
  type: "item", class: "feces",
  id: `core:feces_${size}`,
  label: `${size} animal feces`,
  color: DUNG,
  stack: 1,
  weight,
  spoilHours: spoilSeconds / 140,
  decomposeHours: MINUTE,
});

export const EGGS: readonly Def[] = [
  feces("small", 0.3, 5050),
  feces("medium", 1.5, 5050),
  feces("large", 4, 10000),
  feces("massive", 35, 10020),
  // Where feces lies until it is taken or gone, opened like a dropped bag. ARK draws a heap; this is a stand-in until there
  // is one.
  { type: "prop", class: "container", id: "core:feces", mesh: "box", color: DUNG, radius: 0.1, height: 0.07, slots: 1 },
];
