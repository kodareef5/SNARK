// The finishes a landmark's art states (shared/pack/finish.ts): each one's colour, occlusion, roughness and metalness
// read off its part of its material's pictures as a textured draw shows them from afar, and a palette colour no other
// of them has, which its flat faces are drawn in.

import { FINISH_NUMBERS } from "../../shared/pack/finish.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";
import { NEUTRAL } from "../../client/core/render/surface.ts";
import { materialMips } from "../pack/texture.ts";
import type { Described } from "./materials.ts";
import type { FinishSpec } from "./spec.ts";

export interface StatedFinishes {
  /** FINISH_NUMBERS a finish, for the pack. */
  numbers: number[];
  /** Each finish's palette colour, by the name of the material its flat faces are drawn with ("flat_<finish>"). */
  colour: Map<string, number>;
}

/** Texels across a finish's rectangle in the mip it is read from: about what a textured draw shows of it where its flat level takes over. */
const ACROSS = 4;

const linear = (s: number): number => (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4));
const srgb = (l: number): number => (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);

/**
 * The finishes of those stated that a flat face is drawn in, `drawn` naming the materials the model has. Each takes the
 * palette colour nearest it that none nearer another has taken, the nearest pairs first.
 */
export function stateFinishes(finishes: Readonly<Record<string, FinishSpec>>, pictured: ReadonlyMap<string, Described>, palette: Uint8Array, drawn: ReadonlySet<string>): StatedFinishes {
  const mips = new Map<string, ReturnType<typeof materialMips>>();
  const made: { name: string; numbers: number[] }[] = [];
  for (const [name, f] of Object.entries(finishes)) {
    if (!drawn.has(`flat_${name}`)) continue;
    const d = pictured.get(f.material);
    if (!d?.maps.base) throw new Error(`finish ${name}: its material ${f.material} has no pictures`);
    if (!mips.has(f.material)) mips.set(f.material, materialMips({ base: d.maps.base, normal: d.maps.normal, mro: d.maps.mro }));
    const read = mips.get(f.material)!;
    const side = d.maps.base.width;
    const [x, y, w, h] = f.rect;
    let k = 0;
    while (Math.min(w, h) >> (k + 1) >= ACROSS) k++;
    // The mean of the rectangle's texels at that mip, the base colour as light.
    const mean = (role: "base" | "mro", light: boolean): number[] => {
      const levels = read[role];
      if (!levels) return [...NEUTRAL[role].slice(0, 3)].map((c) => c / 255);
      const s = side >> k, mip = levels[Math.log2(s)]!;
      const sum = [0, 0, 0];
      let n = 0;
      for (let j = y >> k; j < (y + h) >> k; j++) {
        for (let i = x >> k; i < (x + w) >> k; i++, n++) for (let c = 0; c < 3; c++) sum[c]! += light ? linear(mip[(j * s + i) * 4 + c]! / 255) : mip[(j * s + i) * 4 + c]! / 255;
      }
      return sum.map((v) => v / n);
    };
    const base = mean("base", true).map((c, i) => Math.round(srgb(Math.min(1, c * d.material.tint[i]!)) * 255));
    const orm = mean("mro", false).map((c) => Math.round(c * 255));
    made.push({ name, numbers: [...base, ...orm, Math.round((f.sheet ?? d.material.sheet ?? 0) * 255), Math.max(1, Math.round((f.share ?? 1) * 255))] });
  }
  const pairs: [number, number, number][] = [];
  made.forEach(({ numbers: [r, g, b] }, k) => {
    for (let i = 1; i < REGION_BASE; i++) pairs.push([(palette[i * 4]! - r!) ** 2 + (palette[i * 4 + 1]! - g!) ** 2 + (palette[i * 4 + 2]! - b!) ** 2, k, i]);
  });
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const given = new Map<number, number>(), taken = new Set<number>();
  for (const [, k, i] of pairs) {
    if (given.has(k) || taken.has(i)) continue;
    given.set(k, i);
    taken.add(i);
  }
  const colour = new Map(made.map(({ name }, k) => [`flat_${name}`, given.get(k)!]));
  const numbers = made.flatMap(({ numbers }, k) => [given.get(k)!, ...numbers]);
  if (numbers.length !== made.length * FINISH_NUMBERS) throw new Error("finishes: a finish is not whole");
  return { numbers, colour };
}
