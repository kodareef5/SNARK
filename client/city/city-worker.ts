// Makes far city levels off the page's thread (client/core/render/citymake.ts makeLevel): the busiest tile takes tens of
// milliseconds, which would stop a frame. Each level goes back as soon as it is made, its buffers moved, not copied. The
// far shadow's map is swept here too (client/core/render/farshadow.ts doSweep).

import { buffersOf, makeLevel, type CityJob, type CityKinds } from "../core/render/citymake.ts";
import { doSweep, sweepBuffers, type SweepJob } from "../core/render/farshadow.ts";

let kinds: CityKinds | null = null;

self.onmessage = (m: MessageEvent<{ kinds: CityKinds } | { job: CityJob } | { sweep: SweepJob }>) => {
  if ("kinds" in m.data) kinds = m.data.kinds;
  else if (!kinds) return;
  else if ("sweep" in m.data) {
    const made = doSweep(kinds, m.data.sweep);
    postMessage(made, { transfer: sweepBuffers(made) });
  } else {
    const made = makeLevel(kinds, m.data.job);
    postMessage(made, { transfer: buffersOf(made) });
  }
};
