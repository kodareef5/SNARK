// The page's end of the asset worker: what client/core asks of an AssetPort goes to the worker, and what the worker
// has fetched, inflated and checked waits here for the next frame to take.

import type { AssetArrival, AssetPart, AssetPort, AssetRequest } from "../core/assets/port.ts";
import { StorageInfo } from "../core/assets/storage.ts";
import type { Manifest } from "../../shared/pack/manifest.ts";
import type { Ask } from "./assets-worker.ts";

export class WorkerPort implements AssetPort {
  cache: AssetPort["cache"] = { used: 0, limit: 0, mode: "memory", filling: 0 };
  /** The page's own until the worker's first fetch says. */
  protocol = (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.nextHopProtocol ?? "";
  readonly storage = new StorageInfo(navigator.storage);
  named = 0;
  private readonly worker = new Worker("assets-worker.js", { type: "module" });
  private readonly manifest: Manifest;
  private readonly folder: string;
  private readonly arrived: AssetArrival[] = [];

  /**
   * `folder` is where the manifest's files are, and `keep` the most bytes to keep on disk between visits. `net` is a
   * made-up link for trying things by hand: "delay ms, KB/s, % lost".
   */
  constructor(manifest: Manifest, folder: string, keep: number, net: string | null) {
    this.manifest = manifest;
    this.folder = folder;
    this.worker.onmessage = (e) => {
      const m = e.data as AssetArrival & { cache?: AssetPort["cache"] & { protocol: string } };
      if (m.cache) {
        const { protocol, ...cache } = m.cache;
        this.cache = cache;
        if (protocol) this.protocol = protocol;
      } else this.arrived.push(m);
    };
    this.worker.postMessage({ open: { keep, touch: matchMedia("(pointer: coarse)").matches }, ...(net ? { net: net.split(",").map(Number) } : {}) });
  }

  private url(file: number): string {
    return `${this.folder}/${this.manifest.files[file]!.name}`;
  }

  request(r: AssetRequest): void {
    const ask: Ask = { slot: r.slot, generation: r.generation, url: this.url(r.file), parts: [...r.parts], fresh: r.fresh };
    this.worker.postMessage({ ask });
  }

  fill(parts: readonly { file: number; part: AssetPart }[]): void {
    this.named += parts.length;
    this.worker.postMessage({ fill: parts.map((p) => ({ url: this.url(p.file), part: p.part })) });
  }

  keep(mode: number, reset = false): void {
    this.worker.postMessage({ keep: { mode, reset } });
  }

  clear(): void {
    this.worker.postMessage({ clear: true });
  }

  limit(bytes: number): void {
    this.worker.postMessage({ limit: bytes });
  }

  cancel(slot: number): void {
    this.worker.postMessage({ cancel: slot });
  }

  take(out: AssetArrival[]): number {
    const n = this.arrived.length;
    for (let i = 0; i < n; i++) out[i] = this.arrived[i]!;
    this.arrived.length = 0;
    return n;
  }
}
