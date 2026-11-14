// The page's end of the asset worker: what client/core asks of an AssetPort goes to the worker, and what the worker
// has fetched waits here for the next frame to take.

import type { AssetArrival, AssetPart, AssetPort, AssetRequest } from "../core/assets/port.ts";
import type { Manifest } from "../../shared/pack/manifest.ts";

export class WorkerPort implements AssetPort {
  readonly formats = 0;
  cache: AssetPort["cache"] = { used: 0, limit: 0, mode: "memory", filling: 0 };
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
      const m = e.data as AssetArrival & { cache?: AssetPort["cache"] };
      if (m.cache) this.cache = m.cache;
      else this.arrived.push(m);
    };
    this.worker.postMessage({ open: keep, ...(net ? { net: net.split(",").map(Number) } : {}) });
  }

  private ask(slot: number, file: number, part: AssetPart, fresh: boolean) {
    return { slot, url: `${this.folder}/${this.manifest.files[file]!.name}`, offset: part.offset, length: part.length, hash: part.hash, fresh };
  }

  request(r: AssetRequest): void {
    this.worker.postMessage({ ask: this.ask(r.slot, r.file, r.parts[0]!, r.fresh) });
  }

  fill(parts: readonly { file: number; part: AssetPart }[]): void {
    // What the player asked to keep should not be the first thing the browser clears when it is short of room.
    void navigator.storage?.persist?.();
    this.worker.postMessage({ fill: parts.map((p) => this.ask(-1, p.file, p.part, false)) });
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
