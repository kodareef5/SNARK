import type { Def, ItemDef } from "../shared/content/defs.ts";
import { defaultPalette, nearestColour } from "../shared/pack/palette.ts";

const palette = defaultPalette();

/** The first swatch is the artist's reference animal. The other two are heritable wild colours. */
export function region(name: string, reference: number, second: number, third: number) {
  const swatch = (rgb: number, weight: number) => [nearestColour(palette, rgb >> 16, (rgb >> 8) & 255, rgb & 255), weight] as const;
  return { name, colors: [swatch(reference, 4), swatch(second, 2), swatch(third, 1)] as const };
}

export function eggs(species: string, size: string, color: number, radius: number, height: number, weight: number, food: number): Def[] {
  const item = `core:${species}_egg`;
  const common: ItemDef = {
    type: "item", class: "egg", id: item, label: `${species} egg`, stack: 100, weight, color,
    eat: { food, health: food }, spoilHours: 8 * 24 * 3600 / 140,
  };
  return [
    { type: "prop", class: "egg", id: `core:egg_${species}`, mesh: `core:egg_${size}`, item, fertile: item + "_fertile", color, radius, height },
    { ...common, decomposeHours: 30 * 60 / 140 },
    { ...common, id: item + "_fertile", label: `fertilised ${species} egg`, stack: 1 },
  ];
}
