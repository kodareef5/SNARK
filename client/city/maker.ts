// The browser's CityMaker (client/core/render/citymake.ts): a worker of its own makes the far city's levels. It is started
// when the first level is asked for, so its script is not among what the first frame waits on.

import { buffersOf, type CityJob, type CityKinds, type CityMade, type CityMaker } from "../core/render/citymake.ts";

export class WorkerCityMaker implements CityMaker {
  onMade: (() => void) | null = null;
  private readonly url: string | URL;
  private worker: Worker | null = null;
  private kinds: CityKinds | null = null;
  private readonly done: CityMade[] = [];

  /** `url` is the worker's script, as the build names it. */
  constructor(url: string | URL = "city-worker.js") {
    this.url = url;
  }

  start(kinds: CityKinds): void {
    this.kinds = kinds;
    this.done.length = 0;
    this.worker?.postMessage({ kinds });
  }

  make(job: CityJob): void {
    if (!this.worker) {
      const worker = (this.worker = new Worker(this.url, { type: "module" }));
      worker.onmessage = (m: MessageEvent<CityMade>) => {
        this.done.push(m.data);
        this.onMade?.();
      };
      worker.postMessage({ kinds: this.kinds });
    }
    this.worker.postMessage({ job }, buffersOf(job));
  }

  take(out: CityMade[]): number {
    const n = this.done.length;
    for (let i = 0; i < n; i++) out[i] = this.done[i]!;
    this.done.length = 0;
    return n;
  }
}
