// Measures the tier's materials with the engine's own texture checks (tools/pack/image.ts), apart from the makers'
// own checks: `bun assets/source/core/structures/wood/tex/measure.ts`.

import { join } from "node:path";
import { normalAgainstHeight, oddSizes, readPicture, seam, unpack } from "../../../../../../tools/pack/image.ts";

const toLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v: number): number => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));

for (const name of ["boards", "deck", "timber", "fittings"]) {
  const at = (layer: string) => readPicture(join(import.meta.dir, name, `${name}_${layer}.png`));
  const layers = { base: at("base"), height: at("height"), normal: at("normal"), orm: at("orm") };
  const base = layers.base;
  // The mean base colour as light averages it, back in sRGB.
  const rgba = unpack(base, toLinear);
  const sum = [0, 0, 0];
  for (let i = 0; i < rgba.length; i += 4) for (let k = 0; k < 3; k++) sum[k]! += rgba[i + k]!;
  const mean = sum.map((s) => toSrgb(s / (rgba.length / 4)));
  const agree = normalAgainstHeight(layers.normal, layers.height);
  const f = (n: number): string => n.toFixed(2);
  console.log(
    `${name.padEnd(9)} ${base.width}x${base.height}  sizes ${oddSizes(layers).join(", ") || "agree"}  height ${layers.height.depth} bit` +
      `  seam base ${seam(base).map(f).join(" ")}  normal ${seam(layers.normal).map(f).join(" ")}` +
      `  normal against height x ${f(agree.x)} y ${f(agree.y)} length ${f(agree.length)}  mean sRGB ${mean.join(", ")}`,
  );
}
