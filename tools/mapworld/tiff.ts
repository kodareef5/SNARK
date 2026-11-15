// A reader for the one kind of GeoTIFF a map's sources hold: a single band of 32-bit floats in strips or tiles, stored
// plain or deflated, with no predictor, the horizontal one, or the floating-point one (TIFF Technical Note 3).

import { inflateSync } from "node:zlib";

export interface FloatRaster {
  readonly width: number;
  readonly height: number;
  /** Row by row from the top. */
  readonly data: Float32Array;
  /** The centre of the top-left pixel and the step to the next, from the tie point and the pixel scale; y steps down. */
  readonly x0: number;
  readonly y0: number;
  readonly dx: number;
  readonly dy: number;
  readonly nodata: number | null;
  /** Whether the tie point names a pixel's corner (GeoTIFF's RasterPixelIsArea) and was moved to its centre. */
  readonly area: boolean;
}

export function readFloatTiff(file: Uint8Array): FloatRaster {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const little = view.getUint16(0) === 0x4949;
  if (!little && view.getUint16(0) !== 0x4d4d) throw new Error("tiff: not a TIFF file");
  if (view.getUint16(2, little) !== 42) throw new Error("tiff: BigTIFF and other versions are not read");
  const size = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
  const tags = new Map<number, number[]>();
  const ifd = view.getUint32(4, little);
  for (let n = view.getUint16(ifd, little), at = ifd + 2; n > 0; n--, at += 12) {
    const tag = view.getUint16(at, little);
    const type = view.getUint16(at + 2, little);
    const count = view.getUint32(at + 4, little);
    const bytes = (size[type] ?? 1) * count;
    const from = bytes <= 4 ? at + 8 : view.getUint32(at + 8, little);
    const values: number[] = [];
    for (let i = 0; i < count; i++) {
      const p = from + i * (size[type] ?? 1);
      if (type === 3) values.push(view.getUint16(p, little));
      else if (type === 4) values.push(view.getUint32(p, little));
      else if (type === 12) values.push(view.getFloat64(p, little));
      else if (type === 11) values.push(view.getFloat32(p, little));
      else values.push(view.getUint8(p));
    }
    tags.set(tag, values);
  }
  const one = (tag: number, fallback?: number): number => {
    const v = tags.get(tag)?.[0] ?? fallback;
    if (v === undefined) throw new Error(`tiff: tag ${tag} is missing`);
    return v;
  };
  const width = one(256);
  const height = one(257);
  if (one(258) !== 32 || one(339, 1) !== 3 || one(277, 1) !== 1) throw new Error("tiff: only one band of 32-bit floats is read");
  const compression = one(259, 1);
  if (compression !== 1 && compression !== 8 && compression !== 32946) throw new Error(`tiff: compression ${compression} is not read`);
  const predictor = one(317, 1);
  const tiled = tags.has(322);
  const blockW = tiled ? one(322) : width;
  const blockH = tiled ? one(323) : one(278, height);
  const offsets = tags.get(tiled ? 324 : 273)!;
  const counts = tags.get(tiled ? 325 : 279)!;
  const across = Math.ceil(width / blockW);
  const data = new Float32Array(width * height);
  const out = new DataView(data.buffer);
  offsets.forEach((offset, b) => {
    const packed = file.subarray(offset, offset + counts[b]!);
    const raw = compression === 1 ? packed : new Uint8Array(inflateSync(packed));
    const rowBytes = blockW * 4;
    const bx = (b % across) * blockW;
    const by = Math.floor(b / across) * blockH;
    for (let r = 0; r < blockH && by + r < height; r++) {
      const row = raw.subarray(r * rowBytes, (r + 1) * rowBytes);
      if (row.length < rowBytes) break;
      const word = new Uint8Array(4);
      if (predictor === 3) {
        // Bytes were differenced along the row, after the floats were split into planes of their bytes, most significant first.
        for (let i = 1; i < rowBytes; i++) row[i] = (row[i]! + row[i - 1]!) & 255;
      }
      for (let c = 0; c < blockW && bx + c < width; c++) {
        let v: number;
        if (predictor === 3) {
          for (let k = 0; k < 4; k++) word[k] = row[k * blockW + c]!;
          v = new DataView(word.buffer).getFloat32(0, false);
        } else v = new DataView(row.buffer, row.byteOffset + c * 4, 4).getFloat32(0, little);
        out.setFloat32(((by + r) * width + bx + c) * 4, v, true);
      }
      if (predictor === 2) throw new Error("tiff: the horizontal predictor on floats is not read");
    }
  });
  const scale = tags.get(33550) ?? [1, 1, 0];
  const tie = tags.get(33922) ?? [0, 0, 0, 0, 0, 0];
  // GTRasterTypeGeoKey (1025) in the key directory: 1 is a pixel's area, 2 its point.
  const keys = tags.get(34735) ?? [];
  let area = true;
  for (let k = 4; k + 3 < keys.length; k += 4) if (keys[k] === 1025) area = keys[k + 3] === 1;
  const ascii = tags.get(42113);
  const nodata = ascii ? Number(String.fromCharCode(...ascii.filter((c) => c !== 0))) : null;
  const half = area ? 0.5 : 0;
  return {
    width,
    height,
    data,
    x0: tie[3]! + (half - tie[0]!) * scale[0]!,
    y0: tie[4]! - (half - tie[1]!) * scale[1]!,
    dx: scale[0]!,
    dy: -scale[1]!,
    nodata,
    area,
  };
}
