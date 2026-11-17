// The browser's CityMaker (client/core/render/citymake.ts): workers of its own make the far city's levels, each level
// asked of the one with the fewest in hand, since every level is made alone from what it is sent. They are started when
// the first level is asked for, so their script is not among what the first frame waits on.

import { buffersOf, type CityJob, type CityKinds, type CityMade, type CityMaker } from "../core/render/citymake.ts";

/** Workers for a machine of `cores` logical cores: a core each left to the page and the other workers, and at most three. */
export const cityWorkers = (cores = 4): number => Math.max(1, Math.min(3, cores - 2));

/** Levels a worker is asked for ahead of what it has made: it never waits on the page, and a tile come nearer soon goes first. */
export const CITY_AHEAD = 3;

export class WorkerCityMaker implements CityMaker {
  onMade: (() => void) | null = null;
  readonly flights: number;
  private readonly url: string | URL;
  private readonly count: number;
  private readonly workers: Worker[] = [];
  /** Levels asked of each worker and not yet back. */
  private readonly asked: number[] = [];
  private kinds: CityKinds | null = null;
  private readonly done: CityMade[] = [];

  /** `url` is the workers' script, as the build names it. */
  constructor(url: string | URL = "city-worker.js", count = cityWorkers(globalThis.navigator?.hardwareConcurrency)) {
    this.url = url;
    this.count = count;
    this.flights = count * CITY_AHEAD;
  }

  start(kinds: CityKinds): void {
    this.kinds = kinds;
    this.done.length = 0;
    for (const worker of this.workers) worker.postMessage({ kinds });
  }

  make(job: CityJob): void {
    while (this.workers.length < this.count) {
      const n = this.workers.length;
      const worker = new Worker(this.url, { type: "module" });
      worker.onmessage = (m: MessageEvent<CityMade>) => {
        this.asked[n]!--;
        this.done.push(m.data);
        this.onMade?.();
      };
      worker.postMessage({ kinds: this.kinds });
      this.workers.push(worker);
      this.asked.push(0);
    }
    const n = this.asked.indexOf(Math.min(...this.asked));
    this.asked[n]!++;
    this.workers[n]!.postMessage({ job }, buffersOf(job));
  }

  take(out: CityMade[]): number {
    const n = this.done.length;
    for (let i = 0; i < n; i++) out[i] = this.done[i]!;
    this.done.length = 0;
    return n;
  }
}
