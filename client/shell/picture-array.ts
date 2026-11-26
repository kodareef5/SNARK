// The card's side of a set of picture layers (core/render/picture-layers.ts): one square sRGB texture array on a unit,
// made again at the size a frame asks and let go at none, a picture put in its layer as given, and the layer's levels
// made from it by halving, one layer at a time. And the page's side of the prints (core/render/prints.ts): a picture
// fetched from our own server and decoded away from the page's thread, premultiplied, at a layer's size, and its mean.

import type { PrintHost, PrintMade } from "../core/render/prints.ts";

export class PictureArray {
  texture: WebGLTexture | null = null;
  side = 0;
  layers = 0;
  /** Pictures put in it in all, for the bench. */
  puts = 0;
  private from: WebGLFramebuffer | null = null;
  private to: WebGLFramebuffer | null = null;
  private readonly gl: WebGL2RenderingContext;
  private readonly unit: number;

  constructor(gl: WebGL2RenderingContext, unit: number) {
    this.gl = gl;
    this.unit = unit;
  }

  /** The array `side` texels a side and `layers` deep, bound on its unit; made again where it is not, let go at 0. */
  size(side: number, layers: number): void {
    const gl = this.gl;
    if (side !== this.side || layers !== this.layers) {
      gl.deleteTexture(this.texture);
      this.texture = null;
      this.side = side;
      this.layers = layers;
      if (side > 0 && layers > 0) {
        gl.activeTexture(gl.TEXTURE0 + this.unit);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, (this.texture = gl.createTexture()));
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.log2(side) + 1, gl.SRGB8_ALPHA8, side, side, layers);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
    }
    if (!this.texture) return;
    gl.activeTexture(gl.TEXTURE0 + this.unit);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
  }

  /** `source` in `layer`, a decoded picture or its bytes, RGBA at the array's side, and the layer's levels made from it. */
  put(layer: number, source: unknown): void {
    const gl = this.gl, side = this.side;
    if (!this.texture || !source || layer < 0 || layer >= this.layers) return;
    gl.activeTexture(gl.TEXTURE0 + this.unit);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    if (source instanceof Uint8Array) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, side, side, 1, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, side, side, 1, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
    this.from ??= gl.createFramebuffer();
    this.to ??= gl.createFramebuffer();
    for (let level = 1; side >> level >= 1; level++) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.from);
      gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.texture, level - 1, layer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.to);
      gl.framebufferTextureLayer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.texture, level, layer);
      gl.blitFramebuffer(0, 0, side >> (level - 1), side >> (level - 1), 0, 0, side >> level, side >> level, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    this.puts++;
  }

  /** A lost context: nothing it held is held. */
  lost(): void {
    this.texture = this.from = this.to = null;
    this.side = this.layers = 0;
  }
}

/** The side of the picture a print's mean is taken from. */
const MEAN_SIDE = 8;

/** The page's side of the prints: each picture fetched, decoded premultiplied at the layer's size, and its mean colour. */
export function printHost(): PrintHost {
  const fetching = new Map<string, AbortController>();
  let small: OffscreenCanvasRenderingContext2D | null = null;
  const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return {
    async image(path, width, height): Promise<PrintMade> {
      const abort = new AbortController();
      fetching.set(path, abort);
      try {
        const r = await fetch(path, { signal: abort.signal });
        if (!r.ok) throw new Error(`${path}: ${r.status}`);
        const blob = await r.blob();
        const source = await createImageBitmap(blob, { resizeWidth: width, resizeHeight: height, resizeQuality: "high", premultiplyAlpha: "premultiply", colorSpaceConversion: "none" });
        // The mean from a small copy: each texel's colour as light, premultiplied as the layer holds it.
        const tiny = await createImageBitmap(blob, { resizeWidth: MEAN_SIDE, resizeHeight: MEAN_SIDE, resizeQuality: "medium", premultiplyAlpha: "none", colorSpaceConversion: "none" });
        small ??= new OffscreenCanvas(MEAN_SIDE, MEAN_SIDE).getContext("2d", { willReadFrequently: true });
        const mean = [0, 0, 0, 0];
        if (small) {
          small.clearRect(0, 0, MEAN_SIDE, MEAN_SIDE);
          small.drawImage(tiny, 0, 0);
          const px = small.getImageData(0, 0, MEAN_SIDE, MEAN_SIDE).data;
          for (let i = 0; i < px.length; i += 4) {
            const a = px[i + 3]! / 255;
            for (let c = 0; c < 3; c++) mean[c]! += linear(px[i + c]! / 255) * a;
            mean[3]! += a;
          }
          for (let c = 0; c < 4; c++) mean[c]! /= MEAN_SIDE * MEAN_SIDE;
        }
        tiny.close();
        return { source, mean };
      } finally {
        if (fetching.get(path) === abort) fetching.delete(path);
      }
    },
    drop(path) {
      fetching.get(path)?.abort();
      fetching.delete(path);
    },
  };
}
