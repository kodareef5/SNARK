// A small mesh drawn with materials, made in code: a tube that stands on its origin, two metres tall, on two bones,
// so bending the upper one shows whether the skin holds. Its texture coordinates wrap once around it and meet at a
// seam down its back. The lower part has four colour regions, which takes both masks, and the top quarter is a second
// material that is never dyed. It has two levels with a surface and a flat one under them.

import type { Clip } from "../../shared/anim/clip.ts";
import { MATERIAL_TWO_SIDED, type PackMaterial, type PackRig, type PackTexture } from "../../shared/pack/pack.ts";
import { REGION_BASE, defaultPalette } from "../../shared/pack/palette.ts";
import type { TextureRole } from "../../shared/pack/texture.ts";
import type { Picture } from "../../tools/pack/image.ts";
import { spanOf } from "../../tools/pack/surface.ts";
import { buildPack, type SourceLod, type SourceMesh } from "../../tools/pack/write.ts";

export const TUBE = "test:tube";
export const TUBE_RADIUS = 0.25;
export const TUBE_LENGTH = 2;
/** The tube's pictures are this many pixels across. */
export const TUBE_PIXELS = 64;
/** The colour regions of the first material, in bands of equal width around the tube. */
export const TUBE_REGIONS = 4;
/** The share of the tube, from its foot, that is the first material. The rest is the second. */
const HIDE = 0.75;

/** The lower bone is the root. The upper one starts halfway up. */
export const TUBE_RIG: PackRig = { id: TUBE, skeleton: TUBE, rest: [0, 0, 0, 0, TUBE_LENGTH / 2, 0], names: ["lower", "upper"], parent: [-1, 0] };

/** "test:tube/idle": from straight at frame 0 to the upper bone bent a quarter turn forward at frame 1. */
export function tubeClips(): Clip[] {
  const rot = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
  return [{ id: `${TUBE}/idle`, bones: 2, frames: 2, loop: false, rot, root: new Float32Array(6) }];
}

/**
 * One level: `around` sides and `along` rings of quads. Each material has vertices of its own, so the ring where the
 * two meet is there twice, as the ring at the seam is. u is 0.5 at the front (+z) and grows to the viewer's right, and
 * v is 0 at the top.
 */
function tubeLod(around: number, along: number): SourceLod {
  const positions: number[] = [];
  const colors: number[] = [];
  const bones: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const joints: number[] = [];
  const weights: number[] = [];
  const indices: number[] = [];
  const sections: number[] = [];
  const row = around + 1;
  [[0, along * HIDE], [along * HIDE, along]].forEach(([from, to], material) => {
    const first = positions.length / 3;
    for (let j = from!; j <= to!; j++) {
      const y = (j / along) * TUBE_LENGTH;
      // The upper bone takes over across the middle half of the tube.
      const upper = Math.min(Math.max(y / TUBE_LENGTH - 0.25, 0) * 2, 1);
      const own = upper > 0.5 ? 1 : 0;
      for (let i = 0; i <= around; i++) {
        const a = (i / around) * Math.PI * 2;
        positions.push(-Math.sin(a) * TUBE_RADIUS, y, -Math.cos(a) * TUBE_RADIUS);
        normals.push(-Math.sin(a), 0, -Math.cos(a));
        uvs.push(i / around, 1 - j / along);
        // Drawn flat, the lower part is the colour regions its masks mark, and the top is a fixed yellow.
        colors.push(material === 1 ? 6 : REGION_BASE + Math.min(Math.floor((i * TUBE_REGIONS) / around), TUBE_REGIONS - 1));
        bones.push(own);
        // A bone with no weight is written as bone 0, as the pack has it.
        joints.push(own, upper > 0 && upper < 1 ? 1 - own : 0, 0, 0);
        weights.push(own === 1 ? upper : 1 - upper, own === 1 ? 1 - upper : upper, 0, 0);
      }
    }
    for (let j = 0; j < to! - from!; j++) {
      for (let i = 0; i < around; i++) {
        const a = first + j * row + i;
        indices.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
        sections.push(material, material);
      }
    }
  });
  return {
    positions: Float32Array.from(positions), colors: Uint8Array.from(colors), indices: Uint32Array.from(indices), bones: Uint8Array.from(bones),
    uvs: Float32Array.from(uvs), normals: Float32Array.from(normals), joints: Uint8Array.from(joints), weights: Float32Array.from(weights), sections: Uint8Array.from(sections),
    // A coarse level's sides cut inside the round by this much.
    error: TUBE_RADIUS * (1 - Math.cos(Math.PI / around)),
  };
}

const linear = (byte: number): number => (byte / 255 <= 0.04045 ? byte / 255 / 12.92 : Math.pow((byte / 255 + 0.055) / 1.055, 2.4));

/**
 * The tube's five pictures, as the image tools take them: four bytes a pixel, rows from the top. The top quarter,
 * where the second material is, is ivory and never dyed. Below it the base is a light grey check in four bands from
 * left to right, which are colour regions 0 to 3: the first three in the red, green and blue of the mask, the fourth
 * in the red of the second mask. The lowest eighth is dyed at half strength. The normals ripple, and the packed map
 * holds occlusion, roughness and metalness.
 */
export function tubePictures(): Record<TextureRole, Picture> {
  const size = TUBE_PIXELS;
  const horn = size * (1 - HIDE);
  const made = (pixel: (x: number, y: number) => number[]): Picture => {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data.set(pixel(x, y), (y * size + x) * 4);
    return { width: size, height: size, channels: 4, depth: 8, data };
  };
  const check = (x: number, y: number): number => ((x >> 3) ^ (y >> 3)) & 1;
  const grey = (x: number, y: number): number => 200 - 30 * check(x, y);
  const height = (x: number, y: number): number => Math.sin((x * Math.PI) / 8) * Math.sin((y * Math.PI) / 8);
  /** How much of a pixel colour region `k` has. */
  const region = (x: number, y: number, k: number): number => (y < horn || Math.floor((x * TUBE_REGIONS) / size) !== k ? 0 : y < size * 0.875 ? 255 : 128);
  return {
    base: made((x, y) => (y < horn ? [224, 214, 180, 255] : [grey(x, y), grey(x, y), grey(x, y), 255])),
    // Green points up the picture, as glTF has it, so a slope down the rows counts the other way.
    normal: made((x, y) => {
      const n = [(height(x - 1, y) - height(x + 1, y)) * 0.5, (height(x, y + 1) - height(x, y - 1)) * 0.5, 1];
      const length = Math.hypot(n[0]!, n[1]!, n[2]!);
      return [...n.map((c) => Math.round((c / length / 2 + 0.5) * 255)), 255];
    }),
    mro: made((x, y) => [255 - 25 * check(x, y), y < horn ? 90 : 200, 0, 255]),
    mask: made((x, y) => [region(x, y, 0), region(x, y, 1), region(x, y, 2), 255]),
    mask2: made((x, y) => [region(x, y, 3), 0, 0, 255]),
  };
}

/** The tube as a source mesh, made afresh each time. Its materials and textures are in order of id, as a pack lists them. */
export function tubeMesh(): SourceMesh {
  const lods = [tubeLod(16, 16), tubeLod(8, 8), tubeLod(4, 4)];
  const { base, mask, mask2 } = tubePictures();
  // The mean brightness of the base where the masks mark a region, in linear light, each pixel counting by how much it is dyed.
  let lit = 0;
  let dyed = 0;
  for (let p = 0; p < base.data.length; p += 4) {
    const share = (mask.data[p]! + mask.data[p + 1]! + mask.data[p + 2]! + mask2.data[p]! + mask2.data[p + 1]! + mask2.data[p + 2]!) / 255;
    lit += share * (0.2126 * linear(base.data[p]!) + 0.7152 * linear(base.data[p + 1]!) + 0.0722 * linear(base.data[p + 2]!));
    dyed += share;
  }
  const textures: PackTexture[] = (["base", "mask", "mask2", "mro", "normal"] as const).map((role) => ({ id: `${TUBE}/${role}`, role, top: TUBE_PIXELS }));
  const material = (name: string, k: number, over: Partial<PackMaterial>): PackMaterial => ({ id: `${TUBE}/${name}`, base: 0, normal: 4, mro: 3, mask: 1, mask2: 2, tint: [1, 1, 1], grey: 1, emissive: 0, flags: 0, cutoff: 0, span: spanOf(lods[0]!, k), ...over });
  const materials = [material("hide", 0, { grey: Math.round((lit / dyed) * 1e4) / 1e4 }), material("horn", 1, { mask: -1, mask2: -1, tint: [0.9, 0.8, 0.55], flags: MATERIAL_TWO_SIDED })];
  return { id: TUBE, lods, skeleton: TUBE, rig: TUBE, flat: 2, materials, textures };
}

let pack: Uint8Array | null = null;

/** The tube, its rig and its clip as a pack. Built once per test process. */
export function tubePack(): Uint8Array {
  return (pack ??= buildPack([tubeMesh()], defaultPalette(), tubeClips(), [TUBE_RIG]));
}

type Data = Float32Array | Uint8Array | Uint16Array | Uint32Array;
const SIZES: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** A .glb of `gltf` with an accessor for each of `data`, in order. */
export function writeGlb(gltf: Record<string, unknown>, data: readonly [Data, string][]): Uint8Array {
  const views: object[] = [];
  const accessors: object[] = [];
  let length = 0;
  for (const [array, type] of data) {
    views.push({ buffer: 0, byteOffset: length, byteLength: array.byteLength });
    accessors.push({ bufferView: views.length - 1, componentType: array instanceof Float32Array ? 5126 : array instanceof Uint32Array ? 5125 : array instanceof Uint16Array ? 5123 : 5121, count: array.length / SIZES[type]!, type });
    length += (array.byteLength + 3) & ~3;
  }
  const text = JSON.stringify({ asset: { version: "2.0" }, ...gltf, accessors, bufferViews: views, buffers: [{ byteLength: length }] });
  const json = new TextEncoder().encode(text.padEnd((text.length + 3) & ~3));
  const out = new Uint8Array(28 + json.length + length);
  const view = new DataView(out.buffer);
  [0x46546c67, 2, out.length, json.length, 0x4e4f534a].forEach((word, k) => view.setUint32(k * 4, word, true));
  out.set(json, 20);
  view.setUint32(20 + json.length, length, true);
  view.setUint32(24 + json.length, 0x004e4942, true);
  let at = 28 + json.length;
  for (const [array] of data) {
    out.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), at);
    at += (array.byteLength + 3) & ~3;
  }
  return out;
}

/**
 * The tube's finest level as a modelling program would export it: a primitive for each material, on a skin of the rig's
 * two bones. With `far`, a level of its own follows it, tube_LOD1: a tetrahedron in one flat colour of a material of no
 * pictures, rgb 32, 64, 96.
 */
export function tubeGlb(far = false): Uint8Array {
  const source = tubeMesh();
  const lod = source.lods[0]!;
  const data: [Data, string][] = [];
  const add = (array: Data, type: string): number => data.push([array, type]) - 1;
  const primitives = source.materials!.map((_, material) => {
    // A material's vertices follow one another, so a primitive is a run of them.
    const tris = [...lod.sections!.keys()].filter((t) => lod.sections![t] === material);
    const corners = tris.flatMap((t) => [...lod.indices.subarray(t * 3, t * 3 + 3)]);
    const [from, to] = [Math.min(...corners), Math.max(...corners) + 1];
    return {
      material,
      indices: add(Uint16Array.from(corners, (c) => c - from), "SCALAR"),
      attributes: {
        POSITION: add(lod.positions.slice(from * 3, to * 3), "VEC3"),
        NORMAL: add(lod.normals!.slice(from * 3, to * 3), "VEC3"),
        TEXCOORD_0: add(lod.uvs!.slice(from * 2, to * 2), "VEC2"),
        JOINTS_0: add(lod.joints!.slice(from * 4, to * 4), "VEC4"),
        WEIGHTS_0: add(lod.weights!.slice(from * 4, to * 4), "VEC4"),
      },
    };
  });
  const rest = TUBE_RIG.rest;
  // Each joint's inverse bind matrix takes a vertex from where the tube rests to the joint's own space.
  const inverse = add(Float32Array.from([0, 1].flatMap((b) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -rest[b * 3]!, -rest[b * 3 + 1]!, -rest[b * 3 + 2]!, 1])), "MAT4");
  return writeGlb(
    {
      scene: 0,
      scenes: [{ nodes: far ? [0, 1, 3] : [0, 1] }],
      nodes: [
        { name: "tube", mesh: 0, skin: 0 },
        { name: "lower", children: [2] },
        { name: "upper", translation: [rest[3]! - rest[0]!, rest[4]! - rest[1]!, rest[5]! - rest[2]!] },
        ...(far ? [{ name: "tube_LOD1", mesh: 1 }] : []),
      ],
      meshes: [{ primitives }, ...(far ? [{ primitives: [{ material: source.materials!.length, indices: add(Uint16Array.from([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]), "SCALAR"), attributes: { POSITION: add(Float32Array.from([0, 0, 0, 0.2, 0, 0, 0, 0, 0.2, 0, 0.6, 0]), "VEC3") } }] }] : [])],
      skins: [{ joints: [1, 2], inverseBindMatrices: inverse }],
      materials: [
        ...source.materials!.map((m) => ({ name: m.id.slice(TUBE.length + 1), doubleSided: (m.flags & MATERIAL_TWO_SIDED) !== 0, pbrMetallicRoughness: { baseColorFactor: [...m.tint, 1] } })),
        ...(far ? [{ name: "f204060", pbrMetallicRoughness: { baseColorFactor: [32, 64, 96].map((c) => Math.pow(c / 255, 2.2)).concat(1) } }] : []),
      ],
    },
    data,
  );
}
