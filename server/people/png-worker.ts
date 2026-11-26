// An uploaded print's thread: it checks the PNG's frame, hashes it and writes it to the part file, so none of that waits
// in the world's tick (png.ts PrintThread).
import { closeSync, openSync, writeSync } from "node:fs";
import { checkPng, hashOf, type FromPrint, type ToPrint } from "./png.ts";

declare const self: { onmessage: ((e: { data: ToPrint }) => void) | null; postMessage(m: FromPrint): void };

self.onmessage = (e) => {
  const { seq, bytes, part } = e.data;
  try {
    const b = new Uint8Array(bytes);
    const size = checkPng(b);
    if (typeof size === "string") return self.postMessage({ seq, error: size });
    const fd = openSync(part, "w");
    try {
      for (let at = 0; at < b.length; ) at += writeSync(fd, b, at);
    } finally {
      closeSync(fd);
    }
    self.postMessage({ seq, info: { ...size, bytes: b.length, hash: hashOf(b) } });
  } catch (err) {
    self.postMessage({ seq, fault: err instanceof Error ? err.message : String(err) });
  }
};
