import { defaultPalette, nearestColour } from "../pack/palette.ts";

type EggColours = readonly [number, number, number, number, number, number];

const PALETTE = defaultPalette();
const tone = (rgb: number): number => nearestColour(PALETTE, rgb >> 16, (rgb >> 8) & 255, rgb & 255);
const CHALK = tone(0xf5f1ea);

function shell(background: number, marks: { blotches?: number; freckles?: number; streaks?: number; dashes?: number } = {}):
  readonly [EggColours, EggColours] {
  const ground = tone(background);
  const { blotches, freckles, streaks, dashes } = marks;
  const pigment = [ground, tone(blotches ?? background), tone(freckles ?? background),
    tone(streaks ?? background), tone(dashes ?? background)] as const;
  return [[...pigment, ground], [...pigment, CHALK]];
}

const SHELLS = new Map([
  ["core:dodo_egg", shell(0xbab2a5, { dashes: 0x807569 })],
  ["core:parasaur_egg", shell(0x61a9a5)],
  ["core:carbonemys_egg", shell(0x394838, { freckles: 0x779a94, dashes: 0x637959 })],
  ["core:trike_egg", shell(0xb9a681, { blotches: 0x523b29 })],
  ["core:raptor_egg", shell(0x7e9dc3, { freckles: 0x293444 })],
  ["core:stego_egg", shell(0x6c7646, { blotches: 0xb0a678, dashes: 0x302c22 })],
  ["core:pteranodon_egg", shell(0xba9147, { streaks: 0x51402e })],
  ["core:brachio_egg", shell(0xbfb093, { freckles: 0x988a72, streaks: 0xccc3a2 })],
  ["core:spino_egg", shell(0x788f80, { streaks: 0xb6c4b2, dashes: 0x38423b })],
  ["core:rex_egg", shell(0x99654b, { blotches: 0x3d2224, freckles: 0x6f433a })],
]);

export function eggColours(item: string, fertile: boolean): EggColours | undefined {
  return SHELLS.get(item)?.[fertile ? 1 : 0];
}
