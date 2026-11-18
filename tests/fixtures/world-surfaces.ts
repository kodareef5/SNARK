// Only the world finishes' maps, without building or fetching every authored material in the game.
import { tierOf } from "../../client/core/assets/tiers.ts";
import type { Probe } from "../../client/core/selfcheck.ts";
import { Rng } from "../../shared/rng.ts";
import { PROBE_BODY, PROBE_CREATURE } from "../../shared/world/proving.ts";
import { provingView, type ProvingView } from "../../tools/snap.ts";
import { SURFACE_NAMES, surfaceMaterial } from "../../content/surfaces.ts";
import { decodeTexture, sample, type Texture } from "../../client/core/render/cpu-texture.ts";
import type { WorldSample } from "../../client/core/render/world-surfaces.ts";
import type { TextureUpload } from "../../client/core/render/packet.ts";
import { describePack } from "../../shared/pack/manifest.ts";
import type { Pack, PackMaterial } from "../../shared/pack/pack.ts";
import { rgbaOf } from "../../tools/snap/files.ts";
import { worldMaterials, worldSurfaceMeshes } from "../../tools/surfaces/build.ts";

const ROLES = ["base", "normal", "mro"] as const;

/** The probe tests supply their own texture bytes, including on a checkout with no finishes: each finish's material, in the order of SURFACE_NAMES. */
export function referenceManifest(pack: Pack): { manifest: ReturnType<typeof describePack>; materials: PackMaterial[] } {
  const manifest = describePack(pack, { name: "boot", bytes: pack.blobAt + pack.blob.length });
  const present = SURFACE_NAMES.map((name) => manifest.materials?.find((m) => m.id === surfaceMaterial(name)));
  if (present.every((m) => m)) return { manifest, materials: present as PackMaterial[] };
  const first = (manifest.textures ??= []).length;
  const materials = worldSurfaceMeshes().map((mesh, k) => ({ ...mesh.materials![0]!, base: first + 3 * k, normal: first + 3 * k + 1, mro: first + 3 * k + 2 }));
  manifest.materials = [...(manifest.materials ?? []), ...materials];
  return { manifest, materials };
}

/**
 * The finishes' maps as the rgba variant has them, at most as wide as medium keeps them: uploads for a frame, and the
 * twin's sampler. Both read the same pictures, and 48 whole ones would hold a test's worker at 4 GB.
 */
export function worldMaps(pack: Pack): { sample: WorldSample; uploads: TextureUpload[] } {
  const sources = worldMaterials();
  const uploads: TextureUpload[] = [];
  const maps: Texture[][] = SURFACE_NAMES.map((name, k) => {
    const material = pack.header.materials!.find((m) => m.id === surfaceMaterial(name))!;
    return ROLES.map((role) => {
      const top = Math.min(pack.header.textures![material[role]]!.top, role === "mro" ? 256 : 512);
      const t = rgbaOf(sources[k]!, role, top);
      t.pictures.forEach((data, i) => uploads.push({ slot: material[role], role, format: "rgba", top: t.top, size: 1 << i, row: 0, rows: 1 << i, data, last: i === t.pictures.length - 1 }));
      return decodeTexture(role, t.pictures);
    });
  });
  return { sample: (role, layer, u, v, spread, out) => sample(maps[layer]![role]!, u, v, spread, out), uploads };
}

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

