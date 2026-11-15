// The browser's SoundDecoder (client/core/sound/library.ts): a worker of its own decodes each sound's takes.

import type { Decoded, SoundDecoder } from "../core/sound/library.ts";

export class WorkerDecoder implements SoundDecoder {
  private readonly worker = new Worker("decode-worker.js", { type: "module" });
  private readonly done: Decoded[] = [];

  constructor() {
    this.worker.onmessage = (m: MessageEvent<Decoded>) => void this.done.push(m.data);
  }

  decode(s: number, data: Uint8Array, takes: readonly { samples: number; bytes: number }[]): void {
    this.worker.postMessage({ s, data, takes: takes.map((t) => ({ samples: t.samples, bytes: t.bytes })) });
  }

  take(out: Decoded[]): number {
    const n = this.done.length;
    for (let i = 0; i < n; i++) out[i] = this.done[i]!;
    this.done.length = 0;
    return n;
  }
}
