// A stage for meshes drawn with materials: frame packets made by hand and handed to the software rasterizer, until
// the scene makes textured draws itself. It also makes the simplest such mesh, a square.

import { Camera } from "../../client/core/render/camera.ts";
import { writeBones } from "../../client/core/render/characters.ts";
import { BONE_FLOATS, DRAW_CUTOUT, DRAW_PLAIN, DRAW_SKINNED, DRAW_TEXTURED, DRAW_TWO_SIDED, FramePacket, InstanceWriter, TRANSIENT_BUFFER } from "../../client/core/render/packet.ts";
import type { Rig } from "../../shared/anim/rigs.ts";
import { solve } from "../../shared/anim/skeleton.ts";
import type { Manifest } from "../../shared/pack/manifest.ts";
import { MATERIAL_CUTOUT, MATERIAL_TWO_SIDED, type Pack, type PackMaterial } from "../../shared/pack/pack.ts";
import { SKY_COLOR } from "../../shared/pack/palette.ts";
import type { TextureRole } from "../../shared/pack/texture.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { materialMips, rgbaPicture, type MaterialMaps } from "../../tools/pack/texture.ts";
import type { SourceMesh } from "../../tools/pack/write.ts";
import { Rasterizer } from "../../tools/snap/raster.ts";

/** One packet for every stage: it is large, and a frame is built and drawn before the next begins. */
const packet = new FramePacket();
const writer = new InstanceWriter(packet.transient);
const ground = new Heightfield({ chunksX: 1, chunksZ: 1 }, TERRAIN_CELL, -32, 1 / 256);

export interface Placed {
  x: number;
  y: number;
  z: number;
  /** Radians, for a rigid mesh. */
  yaw?: number;
  /** For a mesh on a skeleton: the first of its body's bones, as `pose` returned it. */
  bone?: number;
  /** The palette colour of each colour region. */
  regions?: readonly number[];
  /** Flags besides those the mesh and its materials call for. */
  flags?: number;
  /** Draws the level in palette colours, as the flat renderer does. */
  flat?: boolean;
  /** The level's slot on the card, for a stage with a manifest. */
  slot?: number;
}

export class Stage {
  readonly packet = packet;
  readonly cam = new Camera();
  readonly raster: Rasterizer;
  readonly pack: Pack;
  /** The way to the sun. `begin` gives it length 1. */
  sun = [0.3, 0.8, 0.5];

  constructor(pack: Pack, width = 160, height = 90, manifest: Manifest | null = null) {
    this.pack = pack;
    this.raster = new Rasterizer(width, height, pack, ground, manifest);
    this.cam.aspect = width / height;
  }

  /** Starts a frame at noon, with no fog, seen from the camera as it now is. */
  begin(): void {
    const p = packet;
    this.cam.update();
    p.beginFrame();
    p.viewProj.set(this.cam.viewProj);
    p.nearViewProj.set(this.cam.nearViewProj);
    [p.camX, p.camY, p.camZ] = [this.cam.x, this.cam.y, this.cam.z];
    const length = Math.hypot(...this.sun);
    for (let k = 0; k < 3; k++) {
      p.sky[k] = this.pack.palette[SKY_COLOR * 4 + k]! / 255;
      p.sun[k] = this.sun[k]! / length;
    }
    p.light = 1;
    p.fogStart = 1e6;
    p.fogEnd = 2e6;
  }

  /** Sends a whole texture to the card in this frame: its mips as RGBA8, smallest first, as the image tools make them. */
  texture(slot: number, role: TextureRole, mips: readonly Uint8Array[]): void {
    const top = 1 << (mips.length - 1);
    mips.forEach((mip, k) => packet.texUploads.push({ slot, role, format: "rgba", top, size: 1 << k, row: 0, rows: 1 << k, data: rgbaPicture(role, mip), last: k === mips.length - 1 }));
  }

  /** Sends the textures made from a material's source pictures, each to the slot of the pack's texture of its role whose id starts with `prefix`. */
  textures(prefix: string, maps: MaterialMaps): void {
    const mips = materialMips(maps);
    this.pack.header.textures?.forEach((t, slot) => {
      if (t.id.startsWith(prefix) && mips[t.role]) this.texture(slot, t.role, mips[t.role]!);
    });
  }

  /** Poses a body at a place and puts its bones in the frame. `bend` sets the rotations of the rig's pose `a` from rest. Returns its first bone. */
  pose(rig: Rig, at: { x: number; y: number; z: number; yaw?: number }, bend: (rot: Float32Array) => void = () => {}): number {
    rig.a.rest();
    bend(rig.a.rot);
    solve(rig, rig.a, rig.solved);
    const first = packet.boneCount;
    writeBones(packet.bones, first * BONE_FLOATS, rig.solved, rig.rest, null, at.x - this.cam.x, at.y - this.cam.y, at.z - this.cam.z, at.yaw ?? 0);
    packet.boneCount += rig.bones;
    return first;
  }

  /** Queues one instance of a level of a mesh: a draw for each of its materials, or one flat draw. */
  add(id: string, level: number, at: Placed): void {
    const p = packet;
    const mesh = this.pack.meshIndex.get(id)!;
    const lod = this.pack.header.meshes[mesh]!.lods[level]!;
    const n = p.transientCount++;
    const regions = at.regions ?? [];
    if (at.bone !== undefined) writer.setSkinned(n, at.bone, regions[0] ?? 0);
    else writer.set(n, at.x - this.cam.x, at.y - this.cam.y, at.z - this.cam.z, Math.round(((at.yaw ?? 0) / (Math.PI * 2)) * 65536) & 0xffff, regions[0] ?? 0);
    writer.regions(n, Uint8Array.from({ length: 6 }, (_, k) => regions[k] ?? 0), 0);
    p.transientIds[n] = n + 1;
    const flags = DRAW_PLAIN | (at.bone !== undefined ? DRAW_SKINNED : 0) | (at.flags ?? 0);
    const runs = at.flat || !lod.sections ? [-1, 0, lod.indexCount] : lod.sections;
    for (let k = 0; k < runs.length; k += 3) {
      const d = p.drawCount++;
      const material: PackMaterial | undefined = this.pack.header.materials?.[runs[k]!];
      p.drawMesh[d] = mesh;
      p.drawLod[d] = level;
      p.drawSlot[d] = at.slot ?? 0;
      p.drawBuffer[d] = TRANSIENT_BUFFER;
      p.drawFirst[d] = n;
      p.drawInstances[d] = 1;
      p.drawOffset.fill(0, d * 3, d * 3 + 3);
      p.drawFlags[d] = flags;
      if (!material) continue;
      p.drawFlags[d]! |= DRAW_TEXTURED | ((material.flags & MATERIAL_TWO_SIDED) !== 0 ? DRAW_TWO_SIDED : 0) | ((material.flags & MATERIAL_CUTOUT) !== 0 ? DRAW_CUTOUT : 0);
      p.drawMaterial[d] = runs[k]!;
      p.drawFirstIndex[d] = runs[k + 1]!;
      p.drawIndexCount[d] = runs[k + 2]!;
    }
  }

  /** Draws the frame. The picture is the rasterizer's own, good until the next. */
  render(): Uint8ClampedArray {
    this.raster.render(packet);
    return this.raster.color;
  }
}

/**
 * A square `side` metres across that stands on its origin and faces +z, drawn with one material that has a texture
 * for each of `roles`. Seen from in front its picture is upright. With `mirrored` it is two halves, and the right
 * half shows the picture of the left one mirrored, as the two sides of a body share one picture.
 */
export function squareMesh(id: string, side: number, roles: readonly TextureRole[], material: Partial<PackMaterial> = {}, mirrored = false): SourceMesh {
  const h = side / 2;
  const xs = mirrored ? [-h, 0, 0, h] : [-h, h];
  const us = mirrored ? [0, 1, 1, 0] : [0, 1];
  const positions: number[] = [];
  const uvs: number[] = [];
  const tangents: number[] = [];
  const indices: number[] = [];
  for (let q = 0; q < xs.length; q += 2) {
    const first = positions.length / 3;
    positions.push(xs[q]!, 0, 0, xs[q + 1]!, 0, 0, xs[q + 1]!, side, 0, xs[q]!, side, 0);
    uvs.push(us[q]!, 1, us[q + 1]!, 1, us[q + 1]!, 0, us[q]!, 0);
    // The tangent runs the way u grows, and the bitangent up the picture: on the other side of it where the picture is mirrored.
    const way = us[q + 1]! - us[q]!;
    for (let v = 0; v < 4; v++) tangents.push(way, 0, 0, way);
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  const n = positions.length / 3;
  const place = (role: TextureRole): number => roles.indexOf(role);
  const normals = Float32Array.from({ length: n * 3 }, (_, i) => (i % 3 === 2 ? 1 : 0));
  return {
    id,
    lods: [{ positions: Float32Array.from(positions), colors: new Uint8Array(n).fill(15), indices: Uint32Array.from(indices), uvs: Float32Array.from(uvs), normals, tangents: Float32Array.from(tangents) }],
    flat: 1,
    materials: [{ id, base: place("base"), normal: place("normal"), mro: place("mro"), mask: place("mask"), mask2: place("mask2"), tint: [1, 1, 1], grey: 1, emissive: 0, flags: 0, cutoff: 0, span: side, ...material }],
    textures: roles.map((role) => ({ id: `${id}/${role}`, role, top: 64 })),
  };
}

/** A picture `size` pixels across from a function that gives each pixel's four bytes. */
export function picture(size: number, pixel: (x: number, y: number) => readonly number[]): { width: number; height: number; channels: number; depth: 8; data: Uint8Array } {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data.set(pixel(x, y), (y * size + x) * 4);
  return { width: size, height: size, channels: 4, depth: 8, data };
}
