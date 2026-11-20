import { defaultPalette, nearestColour } from "../shared/pack/palette.ts";

/** Shared authored pigments for the drain grate and the painted utility cabinet. */
export const GRATE = 11, UTILITY_ENAMEL = 140;

const palette = defaultPalette();

/** The first tone is the review colour. Wild animals draw evenly from the distinct palette matches. */
export function naturalRegion(name: string, ...tones: number[]) {
  const colours = tones.map((rgb) => nearestColour(palette, rgb >> 16, (rgb >> 8) & 255, rgb & 255));
  return { name, colors: [...new Set(colours)].map((colour) => [colour, 1] as const) };
}
