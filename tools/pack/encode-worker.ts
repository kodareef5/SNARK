// One of the build's encoding threads. Each encoder keeps the block it is working on in its module, and a thread has
// its own copy of both. It encodes the range of blocks it is sent into memory it shares with the build, then answers.

import { parentPort } from "node:worker_threads";
import { encodeAstcBlocks } from "./astc.ts";
import { encodeBc5, encodeBc7 } from "./bc.ts";
import type { EncodeJob } from "./encode.ts";

parentPort!.on("message", ({ rgba, size, how, from, to, out }: EncodeJob) => {
  const blocks = out.subarray(from * 16, to * 16);
  if (how.with === "astc") encodeAstcBlocks(rgba, size, size, how.kind, from, to - from, blocks);
  else blocks.set(how.with === "bc5" ? encodeBc5(rgba, size, size, from, to) : encodeBc7(rgba, size, size, how.channels, from, to));
  parentPort!.postMessage(null);
});
