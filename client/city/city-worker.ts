// Makes far city levels off the page's thread (client/core/render/citymake.ts makeLevel): the busiest tile takes tens of
// milliseconds, which would stop a frame. Each level goes back as soon as it is made, its buffers moved, not copied.

import { buffersOf, makeLevel, type CityJob, type CityKinds } from "../core/render/citymake.ts";

let kinds: CityKinds | null = null;

self.onmessage = (m: MessageEvent<{ kinds: CityKinds } | { job: CityJob }>) => {
  if ("kinds" in m.data) kinds = m.data.kinds;
  else if (kinds) {
    const made = makeLevel(kinds, m.data.job);
    postMessage(made, { transfer: buffersOf(made) });
  }
};
