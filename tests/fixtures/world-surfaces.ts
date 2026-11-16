// Only the three world maps, without building or fetching every authored material in the game.
import { tierOf } from "../../client/core/assets/tiers.ts";
import type { Probe } from "../../client/core/selfcheck.ts";
import { Rng } from "../../shared/rng.ts";
import { PROBE_BODY, PROBE_CREATURE } from "../../shared/world/proving.ts";
import { provingView, type ProvingView } from "../../tools/snap.ts";
import { SURFACE_MATERIAL } from "../../content/surfaces.ts";
import { decodeTexture, sampleWorldTexture } from "../../client/core/render/cpu-texture.ts";
import type { WorldSample } from "../../client/core/render/world-surfaces.ts";
import type { TextureUpload } from "../../client/core/render/packet.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { rgbaOf } from "../../tools/snap/files.ts";
import { worldMaterial } from "../../tools/surfaces/build.ts";

export function worldMaps(pack: Pack): { sample: WorldSample; uploads: TextureUpload[] } {
  const material = pack.header.materials!.find((m) => m.id === SURFACE_MATERIAL)!;
  const source = worldMaterial();
  const uploads: TextureUpload[] = [];
  const maps = (["base", "normal", "mro"] as const).map((role) => {
    const t = rgbaOf(source, role, 2048);
    t.pictures.forEach((data, k) => uploads.push({ slot: material[role], role, format: "rgba", top: t.top, size: 1 << k, row: 0, rows: 1 << k, data, last: k === t.pictures.length - 1 }));
    return decodeTexture(role, t.pictures);
  });
  return { sample: (role, u, v, spread, out) => sampleWorldTexture(maps[role]!, u, v, spread, out), uploads };
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

