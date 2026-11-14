// The page's end of the asset worker: what client/core asks of an AssetPort goes to the worker, and what the worker
// has fetched waits here for the next frame to take.

import type { AssetArrival, AssetPort, AssetRequest } from "../core/assets/port.ts";
import type { Manifest } from "../../shared/pack/manifest.ts";

export class WorkerPort implements AssetPort {
  readonly formats = 0;
  readonly cache = { used: 0, limit: 64 * 1024 * 1024, mode: "memory" as const };
  private readonly worker = new Worker("assets-worker.js", { type: "module" });
  private readonly manifest: Manifest;
  private readonly folder: string;
  private readonly arrived: AssetArrival[] = [];

  /** `folder` is where the manifest's files are. `net` is a made-up link for trying things by hand: "delay ms, KB/s, % lost". */
  constructor(manifest: Manifest, folder: string, net: string | null) {
    this.manifest = manifest;
    this.folder = folder;
    this.worker.onmessage = (e) => void this.arrived.push(e.data as AssetArrival);
    if (net) this.worker.postMessage({ net: net.split(",").map(Number) });
  }

  request(r: AssetRequest): void {
    const part = r.parts[0]!;
    this.worker.postMessage({ ask: { slot: r.slot, url: `${this.folder}/${this.manifest.files[r.file]!.name}`, offset: part.offset, length: part.length, hash: part.hash, fresh: r.fresh } });
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
