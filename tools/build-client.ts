// Builds client/dist: the bundled shell, the voice worker and worklets, the page and the core asset pack.

import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildCorePack } from "./pack/build.ts";

export async function buildClient(): Promise<{ jsBytes: number; packBytes: number }> {
  const root = resolve(import.meta.dir, "..");
  const dist = join(root, "client/dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  // The voice worker and worklets run in their own threads, so each is bundled as a separate file.
  const entrypoints = ["client/shell/main.ts", "client/voice/voice-worker.ts", "client/voice/voice-capture.ts", "client/voice/voice-playback.ts"].map((f) => join(root, f));
  const result = await Bun.build({ entrypoints, outdir: dist, naming: "[name].[ext]", target: "browser", minify: true, sourcemap: "linked" });
  if (!result.success) throw new Error(result.logs.map(String).join("\n"));
  copyFileSync(join(root, "client/index.html"), join(dist, "index.html"));
  const pack = buildCorePack();
  writeFileSync(join(dist, "assets/core.snpk"), pack);
  return { jsBytes: result.outputs.find((o) => o.path.endsWith("main.js"))!.size, packBytes: pack.length };
}

if (import.meta.main) {
  const t0 = performance.now();
  const { jsBytes, packBytes } = await buildClient();
  console.log(`client/dist  main.js ${jsBytes} bytes, core.snpk ${packBytes} bytes, ${(performance.now() - t0).toFixed(0)} ms`);
}
