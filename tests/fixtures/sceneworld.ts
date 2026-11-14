// A small world for the scene to draw with materials: the core content and a few things of its own, a creature (the
// tube), the tube again as a thing on no bones, a building piece and a held item, in a pack split as a build splits
// it, with their textures in the rgba variant. Levels, surfaces and textures come over a network made of numbers to a
// card that holds only what packets upload, and the software rasterizer draws each frame from the same packets.

import { CORE_CONTENT } from "../../content/core.ts";
import { tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { DRAW_TEXTURED, type FramePacket } from "../../client/core/render/packet.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { authoredClips } from "../../shared/anim/authored.ts";
import { B_PROP_R, HUMAN } from "../../shared/anim/human.ts";
import type { Def } from "../../shared/content/defs.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import type { Manifest } from "../../shared/pack/manifest.ts";
import { MATERIAL_CUTOUT, MATERIAL_TWO_SIDED, parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { TEXTURE_ROLES } from "../../shared/pack/texture.ts";
import { GEAR_COUNT, GEAR_HELD } from "../../shared/sim/entities.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { grayboxMeshes } from "../../tools/pack/build.ts";
import { mannequinMeshes } from "../../tools/pack/mannequin.ts";
import { splitPack, type SplitFile } from "../../tools/pack/split.ts";
import type { Picture } from "../../tools/pack/image.ts";
import { materialMips, rgbaTexture, writeTextureFile } from "../../tools/pack/texture.ts";
import { weaponMeshes } from "../../tools/pack/weapons.ts";
import { boxMesh, buildPack, type SourceMesh } from "../../tools/pack/write.ts";
import { Rasterizer } from "../../tools/snap/raster.ts";
import { FakeNet, type NetOptions } from "./assetnet.ts";
import { Card } from "./assetworld.ts";
import { picture, squareMesh } from "./stage.ts";
import { TUBE, TUBE_RIG, tubeClips, tubeMesh, tubePictures } from "./textured.ts";

export const PANEL = "test:panel";
export const CLUB = "test:club";
export const POST = "test:post";
export const W = 160;
export const H = 90;
const HORN = 146;

const DEFS: readonly Def[] = [
  ...CORE_CONTENT,
  {
    type: "species", class: "creature", id: TUBE, mesh: TUBE, skeleton: "tube", color: 9, radius: 0.25, height: 2, eyeHeight: 1.8, walkSpeed: 3, sprintMul: 2, jumpSpeed: 5,
    breeds: { egg: POST, incubate: 7199, mature: 133333 },
    stats: { health: [100, 0.2, 0.05], stamina: [100, 0.1, 0.1], oxygen: [100, 0.1, 0.1], food: [100, 0.1, 0.1], weight: [100, 0.02, 0.04], melee: [1, 0.05, 0.02], speed: [1, 0, 0.01], torpidity: [100, 0.06, 0] },
  },
  // The tube again as a thing that stands where it is put, on no bones.
  { type: "prop", class: "egg", id: POST, mesh: TUBE, color: 6, radius: 0.25, height: 2 },
  { type: "structure", class: "static", id: PANEL, mesh: PANEL, color: 5, half: [1, 1, 0.1], hp: 100 },
  { type: "item", class: "weapon", id: CLUB, stack: 1, weight: 1, color: 5, weapon: { kind: "melee", damage: 10, type: "melee", uses: 10, mesh: CLUB, hold: "tool" } },
];

/**
 * A square two metres across whose picture is laid a metre wide, so it runs across the piece twice and on into the
 * next. Its two triangles are a material each, and the second shows both faces and is cut out where the picture is clear.
 */
function panelMesh(): SourceMesh {
  const mesh = squareMesh(PANEL, 2, ["base"], { span: 1 }, false, 2);
  mesh.lods[0]!.sections = Uint8Array.from([0, 1]);
  mesh.materials!.push({ ...mesh.materials![0]!, id: `${PANEL}/lattice`, tint: [0.6, 0.9, 0.6], flags: MATERIAL_TWO_SIDED | MATERIAL_CUTOUT, cutoff: 0.5 });
  return mesh;
}

/** A stick for the right hand, in the panel's picture. Each side of it has four vertices of its own. */
function clubMesh(): SourceMesh {
  const lod = boxMesh([0.06, 0.06, 0.3], 3);
  const n = lod.positions.length / 3;
  const p = lod.positions;
  const normals = new Float32Array(n * 3);
  for (let t = 0; t < lod.indices.length; t += 3) {
    const [a, b, c] = [lod.indices[t]! * 3, lod.indices[t + 1]! * 3, lod.indices[t + 2]! * 3];
    const u = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!];
    const v = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!];
    const cross = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const length = Math.hypot(...cross);
    for (const at of [a, b, c]) for (let k = 0; k < 3; k++) normals[at + k] = cross[k]! / length;
  }
  for (let v = 0; v < n; v++) p[v * 3 + 2]! += 0.2;
  return {
    id: CLUB,
    lods: [{ ...lod, bones: new Uint8Array(n).fill(B_PROP_R), normals, uvs: Float32Array.from({ length: n * 2 }, (_, i) => [0, 0, 1, 0, 1, 1, 0, 1][i % 8]!) }],
    skeleton: HUMAN.id,
    flat: 1,
    materials: [{ id: `${CLUB}/wood`, base: 0, normal: -1, mro: -1, mask: -1, mask2: -1, tint: [1, 0.7, 0.4], grey: 1, emissive: 0, flags: 0, cutoff: 0, span: 0.6 }],
    textures: [{ id: `${PANEL}/base`, role: "base", top: 64 }],
  };
}

/** A picture `times` as large each way, each pixel as many of the same. */
function enlarged(p: Picture, times: number): Picture {
  const [width, height] = [p.width * times, p.height * times];
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (Math.floor(y / times) * p.width + Math.floor(x / times)) * 4;
      data.set(p.data.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  return { ...p, width, height, data };
}

export interface SceneSet {
  files: SplitFile[];
  manifest: Manifest;
}

let registry: Registry | null = null;
const sets = new Map<number, SceneSet>();

export function sceneRegistry(): Registry {
  if (registry) return registry;
  const made = compileContent(DEFS);
  if (!made.registry) throw new Error(made.errors.join("\n"));
  return (registry = made.registry);
}

/**
 * The boot file, the mesh file and the rgba texture file, with their manifest. The tube's pictures are `pixels`
 * across, which tests leave at 64 and the benchmark raises. Built once per process for each size.
 */
export function sceneSet(pixels = 64): SceneSet {
  const made = sets.get(pixels);
  if (made) return made;
  const tube = tubeMesh();
  for (const t of tube.textures!) t.top = pixels;
  // Drawn flat, the tube's horn is the palette colour the build finds nearest its pictures (D154), not the fixture's yellow.
  for (const lod of tube.lods) lod.colors = lod.colors.map((c) => (c === 6 ? HORN : c));
  const meshes = [...grayboxMeshes(DEFS), ...mannequinMeshes(), ...weaponMeshes(), tube, panelMesh(), clubMesh()];
  const { files, manifest } = splitPack(buildPack(meshes, defaultPalette(), [...authoredClips(), ...tubeClips()], [TUBE_RIG]), "scene");
  // Planks in two browns, with every fourth square of them clear.
  const planks = picture(64, (x, y) => (((x >> 3) + (y >> 3)) & 3) === 0 ? [150, 110, 70, 0] : (x >> 3) & 1 ? [170, 125, 80, 255] : [120, 85, 55, 255]);
  const pictures = tubePictures();
  for (const role of TEXTURE_ROLES) pictures[role] = enlarged(pictures[role], pixels / pictures[role].width);
  const mips: Record<string, ReturnType<typeof materialMips>> = { [TUBE]: materialMips(pictures), [PANEL]: materialMips({ base: planks }) };
  const file = writeTextureFile("rgba", manifest.textures!.map((t) => rgbaTexture(t.role, mips[t.id.slice(0, t.id.lastIndexOf("/"))]![t.role]!)));
  manifest.textures!.forEach((t, i) => (t.in.rgba = { file: files.length, ...file.placed[i]! }));
  files.push({ name: "scene.tex.rgba.sntx", role: "tex", bytes: file.bytes });
  manifest.files.push({ name: "scene.tex.rgba.sntx", bytes: file.bytes.length, role: "tex", format: "rgba" });
  sets.set(pixels, { files, manifest });
  return { files, manifest };
}

export interface Body {
  yaw?: number;
  /** The palette colour of each colour region. */
  colors?: readonly number[];
  /** The item in its hand, by id. */
  held?: string;
}

/**
 * Flat ground 128 metres square at y = 0, seen through a scene on the medium tier, or on `tier` over it, whose assets
 * come over `net`. The camera stands at (32, 1.2, 20) and looks along +z.
 */
export function sceneWorld(net: NetOptions = {}, tier: Partial<Tier> = {}, set = sceneSet()) {
  const { files, manifest } = set;
  const reg = sceneRegistry();
  const dims = { chunksX: 2, chunksZ: 2 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 0);
  const [structs, nodes] = [0, 1].map(() => new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts)) as [StructureStore, StructureStore];
  const port = new FakeNet(files.map((f) => f.bytes), net);
  const pack = parsePack(files[0]!.bytes);
  const scene = new Scene({ dims, hf, structs, nodes }, reg, pack, { manifest, port });
  scene.assets.tier = { ...tierOf("medium"), ...tier };
  scene.viewHeight = H;
  const cam = new Camera();
  [cam.x, cam.y, cam.z, cam.aspect] = [32, 1.2, 20, W / H];
  const remote = new RemoteSample();
  const raster = new Rasterizer(W, H, pack, hf, manifest);
  const card = new Card(manifest, files.map((f) => f.bytes));
  const kind = (id: string): number => reg.index.get(id)!;
  const mesh = (id: string): number => manifest.meshes.findIndex((m) => m.id === id);
  let now = 0;
  return {
    reg, manifest, hf, structs, nodes, port, pack, scene, cam, remote, raster, card, kind, mesh,
    now: () => now,
    /** A body or a thing among the remote entities, standing on the ground. Returns its index there. */
    place(id: string, x: number, z: number, more: Body = {}): number {
      const n = remote.count++;
      [remote.id[n], remote.kind[n], remote.x[n], remote.y[n], remote.z[n], remote.yaw[n], remote.flags[n]] = [100 + n, kind(id), x, 0, z, more.yaw ?? Math.PI, 1];
      remote.colors.set(more.colors ?? [], n * 6);
      if (more.held) remote.gear[n * GEAR_COUNT + GEAR_HELD] = kind(more.held);
      return n;
    },
    /**
     * One frame, `ms` after the last. Throws if the card is sent anything out of order, if a draw is of a level, a
     * surface or a material's base colour or masks that the card does not hold, or if a level drawn with materials is
     * not drawn once for each of its sections, in their order.
     */
    frame(ms = 100, draw = true): FramePacket {
      now += ms;
      port.advance(now);
      scene.now = now;
      const p = scene.build(cam, remote);
      card.take(p);
      for (let d = 0; d < p.drawCount; d++) {
        const slot = p.drawSlot[d]!;
        if (!card.held.has(slot)) throw new Error(`draw ${d} is of a level the card does not hold`);
        if ((p.drawFlags[d]! & DRAW_TEXTURED) === 0) continue;
        const runs = manifest.meshes[p.drawMesh[d]!]!.levels[p.drawLod[d]!]!.sections ?? [];
        if (runs.length === 0 || !card.surfaces.has(slot)) throw new Error(`draw ${d} is textured, and the card does not hold its level's surface`);
        const first = d;
        for (let k = 0; k < runs.length; k += 3) {
          d = first + k / 3;
          const m = manifest.materials![runs[k]!]!;
          const same = [p.drawSlot, p.drawBuffer, p.drawFirst, p.drawInstances].every((of) => of[d] === of[first]) && (p.drawFlags[d]! & DRAW_TEXTURED) !== 0;
          if (d >= p.drawCount || !same || p.drawMaterial[d] !== runs[k] || p.drawFirstIndex[d] !== runs[k + 1] || p.drawIndexCount[d] !== runs[k + 2]) throw new Error(`draw ${d} is not section ${k / 3} of its level`);
          if ([m.base, m.mask, m.mask2].some((t) => t >= 0 && !card.textures.has(t))) throw new Error(`draw ${d} is with ${m.id}, whose textures the card does not hold`);
        }
      }
      if (draw) raster.render(p);
      return p;
    },
    /** The draws of a mesh in a packet. */
    draws(p: FramePacket, id: string): number[] {
      return [...Array(p.drawCount).keys()].filter((d) => p.drawMesh[d] === mesh(id));
    },
  };
}
