// Decodes a sound's takes off the page's thread (client/core/sound/library.ts SoundDecoder): a long bed takes tens of
// milliseconds, which would stop a frame. Answers each request with every take's samples, transferred, or null takes.

import { decodeTakes } from "../../shared/pack/sound.ts";

interface Ask {
  s: number;
  data: Uint8Array;
  takes: { samples: number; bytes: number }[];
}

self.onmessage = (m: MessageEvent<Ask>) => {
  const takes = decodeTakes(m.data.data, m.data.takes);
  postMessage({ s: m.data.s, takes }, { transfer: (takes ?? []).map((t) => t.buffer) });
};
