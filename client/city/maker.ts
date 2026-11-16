// The browser's CityMaker (client/core/render/citymake.ts): a worker of its own makes the far city's levels.

import { buffersOf, type CityJob, type CityKinds, type CityMade, type CityMaker } from "../core/render/citymake.ts";

export class WorkerCityMaker implements CityMaker {
  onMade: (() => void) | null = null;
  private readonly worker: Worker;
  private readonly done: CityMade[] = [];

  /** `url` is the worker's script, as the build names it. */
  constructor(url: string | URL = "city-worker.js") {
    this.worker = new Worker(url, { type: "module" });
    this.worker.onmessage = (m: MessageEvent<CityMade>) => {
      this.done.push(m.data);
      this.onMade?.();
    };
  }

  start(kinds: CityKinds): void {
    this.worker.postMessage({ kinds });
    this.done.length = 0;
  }

  make(job: CityJob): void {
    this.worker.postMessage({ job }, buffersOf(job));
  }

  take(out: CityMade[]): number {
    const n = this.done.length;
    for (let i = 0; i < n; i++) out[i] = this.done[i]!;
    this.done.length = 0;
    return n;
  }
}
