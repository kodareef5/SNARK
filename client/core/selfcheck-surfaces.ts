// Diagnostic-only RGBA reference maps. The GPU still fetches and draws its selected variant independently.
import { SURFACE_NAMES, surfaceMaterial } from "../../content/surfaces.ts";
import type { Manifest } from "../../shared/pack/manifest.ts";
import { pictureBytes, stepOf, topIn } from "../../shared/pack/texture.ts";
import { textureParts, type AssetArrival, type AssetPort, type AssetRequest, type AssetPart } from "./assets/port.ts";
import { decodeTexture, sample, type Texture } from "./render/cpu-texture.ts";
import type { WorldSample } from "./render/world-surfaces.ts";

/** What a report says of the reference: whether its maps are in, why not, and its bytes from the network and from disk. */
export interface SurfaceReference { ready: boolean; format: "rgba"; error: string | null; fetched: number; cached: number }
export const NO_REFERENCE: SurfaceReference = { ready: false, format: "rgba", error: "the page made none", fetched: 0, cached: 0 };

/** Wrap the page's port only for self-checks. Negative slots belong to this reference, never GPU residency. */
export class SelfcheckSurfaces implements AssetPort {
  sample: WorldSample | null = null;
  error: string | null = null;
  fetched = 0;
  cached = 0;
  private started = false;
  private left = 0;
  private readonly arrivals: AssetArrival[] = [];
  /** Each finish's base colour, normal and packed map, by finish * 3 + role. */
  private readonly maps: Texture[] = [];
  private readonly roles = ["base", "normal", "mro"] as const;
  private readonly tops: number[] = [];

  private readonly manifest: Manifest;
  private readonly port: AssetPort;
  constructor(manifest: Manifest, port: AssetPort) { this.manifest = manifest; this.port = port; }

  get cache(): AssetPort["cache"] { return this.port.cache; }
  get protocol(): string { return this.port.protocol; }
  get done(): boolean { return this.started && this.left === 0; }
  get state(): SurfaceReference { return { ready: this.sample !== null, format: "rgba", error: this.error, fetched: this.fetched, cached: this.cached }; }
  request(r: AssetRequest): void { this.port.request(r); }
  cancel(slot: number): void { this.port.cancel(slot); }
  fill(parts: readonly { file: number; part: AssetPart }[]): void { this.port.fill(parts); }

  /** Called on the first lit frame; low poly needs no reference textures. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const textures = SURFACE_NAMES.flatMap((name) => {
      const material = this.manifest.materials?.find((m) => m.id === surfaceMaterial(name));
      return this.roles.map((role) => this.manifest.textures?.[material?.[role] ?? -1]);
    });
    if (textures.some((t) => !t?.in.rgba)) { this.error = "world-surface reference has no RGBA maps"; return; }
    this.left = textures.length;
    textures.forEach((t, k) => {
      const top = this.tops[k] = topIn("rgba", t!.top);
      this.port.request({ slot: -1 - k, file: t!.in.rgba!.file, parts: textureParts(t!, "rgba", stepOf(top)), priority: 0, fresh: false });
    });
  }

  take(out: AssetArrival[]): number {
    const count = this.port.take(this.arrivals);
    let kept = 0;
    for (let i = 0; i < count; i++) {
      const a = this.arrivals[i]!;
      if (a.slot >= 0) { out[kept++] = a; continue; }
      const k = -1 - a.slot, name = this.roles[k % 3]!;
      this.fetched += a.fetched;
      this.cached += a.cached;
      if (!a.data) this.error = `world-surface reference ${name} failed (${a.fail}, HTTP ${a.status ?? 0})`;
      else {
        let at = 0;
        const pictures: Uint8Array[] = [];
        for (let size = 1; size <= this.tops[k]!; size *= 2) {
          const bytes = pictureBytes("rgba", name, size, 1);
          pictures.push(a.data.subarray(at, at += bytes));
        }
        if (at !== a.data.length) this.error = `world-surface reference ${name} has ${a.data.length} bytes, expected ${at}`;
        else this.maps[k] = decodeTexture(name, pictures);
      }
      if (--this.left === 0 && !this.error) this.sample = (role, layer, u, v, spread, out) => sample(this.maps[layer * 3 + role]!, u, v, spread, out);
    }
    this.arrivals.length = 0;
    return kept;
  }
}
