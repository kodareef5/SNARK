// Builds the browser client into client/dist: the bundled shell, the page and
// the core asset pack.
//
//   bun run build

import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildCorePack } from "./pack/build.ts";

export async function buildClient(): Promise<{ jsBytes: number; packBytes: number }> {
  const root = resolve(import.meta.dir, "..");
  const dist = join(root, "client/dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  const result = await Bun.build({ entrypoints: [join(root, "client/shell/main.ts")], outdir: dist, target: "browser", minify: true, sourcemap: "linked" });
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
