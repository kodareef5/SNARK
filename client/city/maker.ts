// The browser's CityMaker (client/core/render/citymake.ts ThreadedCityMaker): workers of its own make the far city's
// levels. They are started when the first level is asked for, so their script is not among what the first frame waits on.

import { ThreadedCityMaker, cityThreads, type CityMade, type CityThread } from "../core/render/citymake.ts";
import type { BlocksMade } from "../core/render/blocks.ts";
import type { SweepMade } from "../core/render/farshadow.ts";

export class WorkerCityMaker extends ThreadedCityMaker {
  /** `url` is the workers' script, as the build names it. */
  constructor(url: string | URL = "city-worker.js", count = cityThreads(globalThis.navigator?.hardwareConcurrency)) {
    super(() => {
      const worker = new Worker(url, { type: "module" });
      const thread: CityThread = { onmessage: null, postMessage: (m, transfer = []) => worker.postMessage(m, transfer) };
      worker.onmessage = (m: MessageEvent<CityMade | SweepMade | BlocksMade>) => thread.onmessage?.(m);
      return thread;
    }, count);
  }
}
