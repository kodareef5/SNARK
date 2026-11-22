// Only the world finishes' maps, without building or fetching every authored material in the game.
import { expect } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { probePasses, provingProbes, type Probe } from "../../client/core/selfcheck.ts";
import { SKY_COLOR } from "../../shared/pack/palette.ts";
import { PICK_ENTITY, PICK_STRUCTURE, PICK_TERRAIN } from "../../tools/snap/raster.ts";
import { corePack } from "./pack.ts";
import { Rng } from "../../shared/rng.ts";
import { PROBE_BODY, PROBE_CREATURE } from "../../shared/world/proving.ts";
import { provingView, type ProvingView } from "../../tools/snap.ts";
import { MASK_MATERIALS, SURFACE_NAMES, surfaceMaterial } from "../../content/surfaces.ts";
import { decodeTexture, sample, type Texture } from "../../client/core/render/cpu-texture.ts";
import type { WorldSample } from "../../client/core/render/world-surfaces.ts";
import type { TextureUpload } from "../../client/core/render/packet.ts";
import { describePack } from "../../shared/pack/manifest.ts";
import type { Pack, PackMaterial } from "../../shared/pack/pack.ts";
import { rgbaOf } from "../../tools/snap/files.ts";
import { worldMaterials, worldSurfaceMeshes } from "../../tools/surfaces/build.ts";

const ROLES = ["base", "normal", "mro"] as const;

/** The probe tests supply their own texture bytes, including on a checkout with no finishes: each finish's material, in the order of SURFACE_NAMES, and the weathering masks' after them. */
export function referenceManifest(pack: Pack): { manifest: ReturnType<typeof describePack>; materials: PackMaterial[] } {
  const manifest = describePack(pack, { name: "boot", bytes: pack.blobAt + pack.blob.length });
  const present = [...SURFACE_NAMES.map(surfaceMaterial), ...MASK_MATERIALS].map((id) => manifest.materials?.find((m) => m.id === id));
  if (present.every((m) => m)) return { manifest, materials: present as PackMaterial[] };
  const first = (manifest.textures ??= []).length;
  const materials = worldSurfaceMeshes().map((mesh, k) => ({ ...mesh.materials![0]!, base: first + 3 * k, normal: first + 3 * k + 1, mro: first + 3 * k + 2 }));
  manifest.materials = [...(manifest.materials ?? []), ...materials];
  return { manifest, materials };
}

/**
 * The finishes' maps and the weathering masks as the rgba variant has them, at most as wide as medium keeps them:
 * uploads for a frame, and the twin's sampler. Both read the same pictures, and whole ones would hold a test's worker at 4 GB.
 */
export function worldMaps(pack: Pack): { sample: WorldSample; uploads: TextureUpload[] } {
  const before = mapsOf.get(pack);
  if (before) return before;
  const sources = worldMaterials();
  const uploads: TextureUpload[] = [];
  // The masks' materials are the layers after the finishes', as the packed array has them.
  const maps: Texture[][] = [...SURFACE_NAMES.map(surfaceMaterial), ...MASK_MATERIALS].map((id, k) => {
    const material = pack.header.materials!.find((m) => m.id === id)!;
    return ROLES.map((role) => {
      const top = Math.min(pack.header.textures![material[role]]!.top, role === "mro" ? 256 : 512);
      const t = rgbaOf(sources[k]!, role, top);
      t.pictures.forEach((data, i) => uploads.push({ slot: material[role], role, format: "rgba", top: t.top, size: 1 << i, row: 0, rows: 1 << i, data, last: i === t.pictures.length - 1 }));
      return decodeTexture(role, t.pictures);
    });
  });
  const made = { sample: ((role, layer, u, v, spread, out) => sample(maps[layer]![role]!, u, v, spread, out)) as WorldSample, uploads };
  mapsOf.set(pack, made);
  return made;
}

/** Decoded once a pack: nothing changes the maps, and a file's tests ask for them one after another. */
const mapsOf = new WeakMap<Pack, { sample: WorldSample; uploads: TextureUpload[] }>();

export function surfaceProbeView(width: number, height: number): ProvingView {
  const v = provingView(width, height), r = v.remote;
  v.scene.assets.tier = tierOf("medium");
  v.scene.plainSky = true;
  v.scene.hour = 9; // server/host.ts starts a new world at 09:00.
  v.scene.viewHeight = height;
  for (const [i, at] of [[0, PROBE_BODY], [1, PROBE_CREATURE]] as const) {
    [r.x[i], r.y[i], r.z[i]] = [at.x, v.hf.heightAt(at.x, at.z), at.z];
  }
  r.colors[6] = PROBE_CREATURE.color;
  // server/creatures.ts: the first spawn's yaw is the first integer from the default seed.
  r.yaw[1] = new Rng(1).int(65536) * Math.PI * 2 / 65536;
  return v;
}

/** The exact readPixels address, converted from bottom-up to the rasterizer's top-down rows. */
export function probePixel(v: ProvingView, p: Probe): number {
  return (v.raster.height - 1 - Math.floor((1 - p.sy) * v.raster.height)) * v.raster.width + Math.floor(p.sx * v.raster.width);
}
export function probeRgb(v: ProvingView, p: Probe): [number, number, number] {
  return [...v.raster.color.subarray(probePixel(v, p) * 4, probePixel(v, p) * 4 + 3)] as [number, number, number];
}

/** The probes' surface twins hit the same pixels, planes and mips as the software scene drawn at one canvas size and hour. */
export function surfaceTwins(width: number, height: number, hour: number): void {
  const maps = worldMaps(corePack());
  const v = surfaceProbeView(width, height); v.scene.hour = hour;
  const p = v.scene.build(v.cam, v.remote);
  p.texUploads.push(...maps.uploads);
  v.raster.render(p);
  const probes = provingProbes(v.cam, v.reg, v.pack.palette, SKY_COLOR, v.hf, true, p, { width, height, sample: maps.sample });
  expect(probes.map((b) => b.name)).toEqual(["sky", "plaza", "block", "slope", "creature", "body"]);
  for (const b of probes) {
    const got = probeRgb(v, b);
    expect(probePasses(b, ...got)).toBe(true);
    if (["sky", "plaza", "block", "slope"].includes(b.name)) {
      // Much tighter than the browser's lit tolerance: no compression or unknown body facing here.
      expect(Math.max(...got.map((c, k) => Math.abs(c - b.rgb[k]!)))).toBeLessThanOrEqual(1);
    }
  }
  for (const [index, kind] of [[1, PICK_TERRAIN], [2, PICK_STRUCTURE], [3, PICK_TERRAIN], [4, PICK_ENTITY]]) expect(v.raster.pickKind[probePixel(v, probes[index!]!)]).toBe(kind);
  // Without the reference the ground and the statics are left out, never held to palette light.
  expect(provingProbes(v.cam, v.reg, v.pack.palette, SKY_COLOR, v.hf, true, p, { width, height, sample: null }).map((b) => b.name)).toEqual(["sky", "creature", "body"]);
}
