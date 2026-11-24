// The boot mips occupy their levels in the full texture, so every particle keeps its UVs as the finer mips arrive.

import type { PackDetails } from "../../shared/pack/details.ts";
import type { ManifestFile } from "../../shared/pack/manifest.ts";
import { DetailMips, type DetailCard } from "../core/assets/detail-mips.ts";
import { MOST_LOD } from "../core/render/detailtext.ts";
import { UNIT } from "../core/render/programs.ts";

export type ReadAtlas = (file: ManifestFile) => Promise<Uint8Array>;

async function readAtlas(file: ManifestFile): Promise<Uint8Array> {
  const response = await fetch("assets/" + file.name, { priority: "low" });
  if (!response.ok) throw new Error("details atlas: HTTP " + response.status);
  return new Uint8Array(await response.arrayBuffer());
}

export class DetailAtlas implements DetailCard {
  texture: WebGLTexture | null = null;
  private readonly mips: DetailMips;

  private readonly gl: WebGL2RenderingContext;
  private readonly atlas: PackDetails["atlas"];

  constructor(gl: WebGL2RenderingContext, atlas: PackDetails["atlas"], boot: Uint8Array, file?: ManifestFile, read: ReadAtlas = readAtlas) {
    this.gl = gl;
    this.atlas = atlas;
    this.mips = new DetailMips(atlas.side, atlas.firstMip ?? 0, boot, file && (() => read(file)));
  }

  init(): void {
    const g = this.gl, side = this.atlas.side;
    this.texture = g.createTexture();
    this.bind();
    g.texStorage2D(g.TEXTURE_2D, Math.log2(side) + 1, g.RGBA8, side, side);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    this.mips.restore(this);
  }

  afterDraw(now: number): void {
    this.mips.afterDraw(this, now);
  }

  sample(base: number, minimum: number): void {
    const g = this.gl;
    this.bind();
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_BASE_LEVEL, base);
    g.texParameterf(g.TEXTURE_2D, g.TEXTURE_MIN_LOD, minimum);
    g.texParameterf(g.TEXTURE_2D, g.TEXTURE_MAX_LOD, MOST_LOD - base);
  }

  private bind(): void {
    const g = this.gl;
    g.activeTexture(g.TEXTURE0 + UNIT.details);
    g.bindTexture(g.TEXTURE_2D, this.texture);
  }

  upload(bytes: Uint8Array, first: number, end: number): void {
    const g = this.gl;
    this.bind();
    for (let level = first, at = 0; level < end; level++) {
      const side = this.atlas.side >> level, size = side * side * 4;
      g.texSubImage2D(g.TEXTURE_2D, level, 0, 0, side, side, g.RGBA, g.UNSIGNED_BYTE, bytes.subarray(at, at + size));
      at += size;
    }
  }
}
