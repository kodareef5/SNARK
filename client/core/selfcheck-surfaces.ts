// Diagnostic-only RGBA reference maps. The GPU still fetches and draws its selected variant independently.
import { SURFACE_MATERIAL } from "../../content/surfaces.ts";
import type { Manifest } from "../../shared/pack/manifest.ts";
import { pictureBytes, stepOf, topIn } from "../../shared/pack/texture.ts";
import { textureParts, type AssetArrival, type AssetPort, type AssetRequest, type AssetPart } from "./assets/port.ts";
import { decodeTexture, sampleWorldTexture, type Texture } from "./render/cpu-texture.ts";
import type { WorldSample } from "./render/world-surfaces.ts";

/** Wrap the page's port only for self-checks. Negative slots belong to this reference, never GPU residency. */
export class SelfcheckSurfaces implements AssetPort {
  sample: WorldSample | null = null;
  error: string | null = null;
  fetched = 0;
  cached = 0;
  private started = false;
  private left = 0;
  private readonly arrivals: AssetArrival[] = [];
  private readonly maps: Texture[] = [];
  private readonly roles = ["base", "normal", "mro"] as const;
  private readonly tops: number[] = [];

  private readonly manifest: Manifest;
  private readonly port: AssetPort;
  constructor(manifest: Manifest, port: AssetPort) { this.manifest = manifest; this.port = port; }

  get cache(): AssetPort["cache"] { return this.port.cache; }
  get done(): boolean { return this.started && this.left === 0; }
  request(r: AssetRequest): void { this.port.request(r); }
  cancel(slot: number): void { this.port.cancel(slot); }
  fill(parts: readonly { file: number; part: AssetPart }[]): void { this.port.fill(parts); }

  /** Called on the first lit frame; low poly needs no reference textures. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const material = this.manifest.materials?.find((m) => m.id === SURFACE_MATERIAL);
    const textures = this.roles.map((role) => this.manifest.textures?.[material?.[role] ?? -1]);
    if (textures.some((t) => !t?.in.rgba)) { this.error = "world-surface reference has no RGBA atlas"; return; }
    this.left = this.roles.length;
    textures.forEach((t, role) => {
      const top = this.tops[role] = topIn("rgba", t!.top);
      this.port.request({ slot: -1 - role, file: t!.in.rgba!.file, parts: textureParts(t!, "rgba", stepOf(top)), priority: 0, fresh: false });
    });
  }

  take(out: AssetArrival[]): number {
    const count = this.port.take(this.arrivals);
    let kept = 0;
    for (let i = 0; i < count; i++) {
      const a = this.arrivals[i]!;
      if (a.slot >= 0) { out[kept++] = a; continue; }
      const role = -1 - a.slot, name = this.roles[role]!;
      this.fetched += a.fetched;
      this.cached += a.cached;
      if (!a.data) this.error = `world-surface reference ${name} failed (${a.fail}, HTTP ${a.status ?? 0})`;
      else {
        let at = 0;
        const pictures: Uint8Array[] = [];
        for (let size = 1; size <= this.tops[role]!; size *= 2) {
          const bytes = pictureBytes("rgba", name, size);
          pictures.push(a.data.subarray(at, at += bytes));
        }
        if (at !== a.data.length) this.error = `world-surface reference ${name} has ${a.data.length} bytes, expected ${at}`;
        else this.maps[role] = decodeTexture(name, pictures);
      }
      if (--this.left === 0 && !this.error) this.sample = (role, u, v, spread, out) => sampleWorldTexture(this.maps[role]!, u, v, spread, out);
    }
    this.arrivals.length = 0;
    return kept;
  }
}
