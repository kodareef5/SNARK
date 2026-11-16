// Decodes a sound's takes off the page's thread (client/core/sound/library.ts SoundDecoder): a long bed takes tens of
// milliseconds, which would stop a frame. Answers each request with every take's samples, transferred, or null takes.

import { decodeTake } from "../../shared/pack/sound.ts";

interface Ask {
  s: number;
  data: Uint8Array;
  takes: { samples: number; bytes: number }[];
}

self.onmessage = (m: MessageEvent<Ask>) => {
  const { s, data, takes } = m.data;
  const out: Float32Array[] = [];
  let at = 0;
  for (const t of takes) {
    const samples = new Float32Array(t.samples);
    if (!decodeTake(data.subarray(at, at + t.bytes), t.samples, samples)) {
      postMessage({ s, takes: null });
      return;
    }
    at += t.bytes;
    out.push(samples);
  }
  postMessage({ s, takes: out }, { transfer: out.map((t) => t.buffer as ArrayBuffer) });
};
