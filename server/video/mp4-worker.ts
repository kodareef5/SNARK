// An uploaded MP4's own thread: it reads the whole file, checks its boxes and writes it moved to faststart, so none of
// that waits in the world's tick (server/video/upload.ts inspectMp4).
import { closeSync, openSync, readFileSync, writeSync } from "node:fs";
import { faststartParts, probeMp4 } from "../../shared/video/mp4.ts";
import type { FromMp4, ToMp4 } from "./upload.ts";

declare const self: { onmessage: ((e: { data: ToMp4 }) => void) | null; postMessage(m: FromMp4): void };

self.onmessage = (e) => {
  const { src, part } = e.data;
  try {
    const bytes = new Uint8Array(readFileSync(src));
    const info = probeMp4(bytes);
    if (typeof info === "string") return self.postMessage({ error: info });
    const parts = faststartParts(bytes);
    if (typeof parts === "string") return self.postMessage({ error: parts });
    if (!info.faststart) {
      const fd = openSync(part, "w");
      try {
        for (const p of parts) for (let at = 0; at < p.length; ) at += writeSync(fd, p, at);
      } finally {
        closeSync(fd);
      }
    }
    self.postMessage({ info });
  } catch (err) {
    self.postMessage({ fault: err instanceof Error ? err.message : String(err) });
  }
};
