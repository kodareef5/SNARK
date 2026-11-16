import { PICK_SKY, type Rasterizer } from "../../snap/raster.ts";

/** Preserve every rendered colour; only pixels with no model geometry become transparent. */
export function posterPixels(raster: Pick<Rasterizer, "color" | "pickKind">): Uint8Array {
  if (raster.color.length !== raster.pickKind.length * 4) throw new Error("Model poster colour and geometry masks differ in size");
  const pixels = Uint8Array.from(raster.color);
  for (let at = 0; at < raster.pickKind.length; at++) if (raster.pickKind[at] === PICK_SKY) pixels[at * 4 + 3] = 0;
  return pixels;
}
