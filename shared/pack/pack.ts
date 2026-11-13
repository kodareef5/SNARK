// Asset pack format, version 1. One file holds a palette and many meshes.
//
//   0   "SNPK"
//   4   u16 version, u16 reserved
//   8   u32 length of the JSON header in bytes (padded to a multiple of 4)
//   12  JSON header (UTF-8)
//   ..  binary blob; every offset in the header is relative to its start
//
// The header lists each mesh with byte ranges, so a client can fetch part of a
// large pack. Vertex and instance layouts are fixed and shared with the
// renderer:
//
//   vertex    8 bytes   i16 x, y, z   position, signed-normalized within bounds
//                       u8 colour     palette index, or a colour region
//                       u8 bone       reserved for rigid skinning
//   index     u16
//   instance  20 bytes  f32 x, y, z   relative to the batch origin
//                       u16 yaw       1/65536 turns
//                       u8 x 6        palette index for each colour region
//
// Flat shading needs no stored normals: the renderer derives the face normal.

export const PACK_MAGIC = 0x4b504e53; // "SNPK" little-endian
export const PACK_VERSION = 1;
export const VERTEX_BYTES = 8;
export const INSTANCE_BYTES = 20;

export interface PackLod {
  vertexOffset: number;
  vertexCount: number;
  indexOffset: number;
  indexCount: number;
}

export interface PackMesh {
  id: string;
  /** Bounds that positions are quantized within. */
  center: [number, number, number];
  half: [number, number, number];
  lods: PackLod[];
  /** Half extents of the authored collision box, when the source had one. */
  collider?: [number, number, number];
}

export interface PackHeader {
  paletteOffset: number;
  meshes: PackMesh[];
}

export interface Pack {
  readonly header: PackHeader;
  /** The binary blob. Offsets in the header index into this. */
  readonly blob: Uint8Array;
  readonly palette: Uint8Array;
  readonly meshIndex: ReadonlyMap<string, number>;
}

/** Parse a pack file. Throws with a reason if it is not a readable version-1 pack. */
export function parsePack(file: Uint8Array): Pack {
  if (file.length < 12) throw new Error("pack: file too short");
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (view.getUint32(0, true) !== PACK_MAGIC) throw new Error("pack: bad magic");
  const version = view.getUint16(4, true);
  if (version !== PACK_VERSION) throw new Error(`pack: version ${version} is not supported`);
  const jsonLength = view.getUint32(8, true);
  if (12 + jsonLength > file.length) throw new Error("pack: truncated header");
  const header = JSON.parse(decodeUtf8(file.subarray(12, 12 + jsonLength))) as PackHeader;
  const blob = file.subarray(12 + jsonLength);
  const meshIndex = new Map<string, number>();
  header.meshes.forEach((m, i) => {
    meshIndex.set(m.id, i);
    for (const lod of m.lods) {
      if (lod.vertexOffset + lod.vertexCount * VERTEX_BYTES > blob.length || lod.indexOffset + lod.indexCount * 2 > blob.length) {
        throw new Error(`pack: mesh ${m.id} points outside the file`);
      }
    }
  });
  if (header.paletteOffset + 1024 > blob.length) throw new Error("pack: palette outside the file");
  return { header, blob, palette: blob.subarray(header.paletteOffset, header.paletteOffset + 1024), meshIndex };
}

/** Vertex bytes of one level of detail, as a view into the pack. */
export function lodVertices(pack: Pack, lod: PackLod): Uint8Array {
  return pack.blob.subarray(lod.vertexOffset, lod.vertexOffset + lod.vertexCount * VERTEX_BYTES);
}

/** Index bytes (u16 little-endian) of one level of detail, as a view into the pack. */
export function lodIndices(pack: Pack, lod: PackLod): Uint8Array {
  return pack.blob.subarray(lod.indexOffset, lod.indexOffset + lod.indexCount * 2);
}

export function decodeUtf8(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++]!;
    let c = b;
    let extra = 0;
    if (b >= 0xf0) {
      c = b & 7;
      extra = 3;
    } else if (b >= 0xe0) {
      c = b & 15;
      extra = 2;
    } else if (b >= 0xc0) {
      c = b & 31;
      extra = 1;
    }
    for (; extra > 0 && i < bytes.length; extra--) c = (c << 6) | (bytes[i++]! & 63);
    if (c >= 0x10000) {
      c -= 0x10000;
      s += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 1023));
    } else s += String.fromCharCode(c);
  }
  return s;
}
