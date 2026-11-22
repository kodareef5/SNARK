// The first frame's weighing (tools/first-frame.ts): a source map read run by run, so the page's script is told by the
// modules it was built from; and a built client's parts, its total as tools/sizes.ts counts it, and the last build's
// beside it.

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { byFolder, scriptModules, segments, writeFirstFrame } from "../../tools/first-frame.ts";
import { firstFrame } from "../../tools/sizes.ts";

test("a source map's runs are read back to their sources", () => {
  // "AAAA" is column 0 of source 0; "KCAA" 5 columns on and the next source; a new line starts its columns again.
  expect(segments("AAAA,KCAA;AAAA")).toEqual([[{ col: 0, src: 0 }, { col: 5, src: 1 }], [{ col: 0, src: 1 }]]);
  expect(byFolder([{ file: "client/core/a.ts", bytes: 10, raw: 30 }, { file: "client/core/b.ts", bytes: 5, raw: 9 }, { file: "shared/c.ts", bytes: 7, raw: 7 }])).toEqual([{ file: "client/core", bytes: 15, raw: 39 }, { file: "shared", bytes: 7, raw: 7 }]);
});

test("a built client is weighed part by part, its script by module, and beside the last build's", async () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-first-frame-"));
  try {
    // A script of two modules, built as the client's is.
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/big.ts"), `export const big = ${JSON.stringify(Array.from({ length: 400 }, (_, i) => `word ${i * 7919 % 1000}`))};\n`);
    writeFileSync(join(dir, "src/main.ts"), `import { big } from "./big.ts";\nexport function count(): number { return big.length + 1; }\nconsole.log(count());\n`);
    const dist = join(dir, "dist");
    const built = await Bun.build({ entrypoints: [join(dir, "src/main.ts")], outdir: dist, naming: "[name].[ext]", minify: true, sourcemap: "linked", target: "browser" });
    expect(built.success).toBe(true);
    mkdirSync(join(dist, "assets"));
    const files: Record<string, string> = { "index.html": `<link rel="modulepreload" href="main.js">\n<script>for (const href of ["map.json","assets/manifest.json","assets/core.0001.snpk","assets/sky.0002.bin","assets/content.0003.json"]) fetch(href)</script>`, "assets-worker.js": "x".repeat(300), "assets/manifest.json": "{}".repeat(500), "assets/core.0001.snpk": "b".repeat(9000), "assets/sky.0002.bin": "s".repeat(100), "assets/content.0003.json": "c".repeat(2000) };
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dist, name), text);
    const { readFileSync } = await import("node:fs");
    for (const name of [...Object.keys(files), "main.js"]) writeFileSync(join(dist, `${name}.br`), brotliCompressSync(readFileSync(join(dist, name))));
    writeFileSync(join(dist, "assets/hud.0004.webp"), new Uint8Array(1234));
    const w = writeFirstFrame(dist, true);
    expect(w.total).toBe(firstFrame(dist).first);
    expect(w.parts.reduce((n, p) => n + p.bytes, 0)).toBe(w.total);
    expect(w.parts.find((p) => p.name === "the HUD's pictures and font")!.bytes).toBe(1234);
    expect(w.room).toBe(w.budget - w.total);
    // The script is told by its two modules, the larger first, adding up to its own Brotli bytes.
    const names = w.modules.map((m) => m.file);
    expect([names.some((n) => n.endsWith("src/big.ts")), names.some((n) => n.endsWith("src/main.ts"))]).toEqual([true, true]);
    expect(names[0]!.endsWith("src/big.ts")).toBe(true);
    expect(Math.abs(w.modules.reduce((n, m) => n + m.bytes, 0) - w.parts[0]!.bytes)).toBeLessThanOrEqual(w.modules.length);
    expect(w.previous).toBeNull();
    const again = writeFirstFrame(dist, false);
    expect([again.previous?.total, again.previous?.quick]).toEqual([w.total, true]);
    expect(scriptModules(dist, ["main.js"], 1000).reduce((n, m) => n + m.raw, 0)).toBe(readFileSync(join(dist, "main.js")).length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
