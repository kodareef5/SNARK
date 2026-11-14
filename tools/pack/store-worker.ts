// One of the build's threads for storing parts: deflates what it is sent and answers with the stream.

import { parentPort } from "node:worker_threads";
import { deflate } from "./deflate.ts";

parentPort!.on("message", ({ id, data }: { id: number; data: Uint8Array }) => {
  const out = deflate(data);
  parentPort!.postMessage({ id, out }, [out.buffer as ArrayBuffer]);
});
