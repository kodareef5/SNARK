import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ModelTextures } from "../tools/pages/models/textures.ts";
import { encodePng } from "../tools/pack/image.ts";

test("static model textures share content URLs, persist native mips, and leave old publications immutable", () => {
  const root = mkdtempSync(join(tmpdir(), "pages-model-cache-"));
  try {
    symlinkSync(resolve(import.meta.dir, "../tools"), join(root, "tools"), "dir");
    const source = join(root, "base.png"), pixels = new Uint8Array(4 * 4 * 4).fill(255);
    const save = () => writeFileSync(source, encodePng({ width: 4, height: 4, channels: 4, depth: 8, data: pixels }));
    save();
    const material = { id: "test:first", name: "first", dir: root, spec: { base: "base.png" } };
    const cache = new ModelTextures(root, join(root, "one")), a = cache.get(material, "base", 4);
    const b = cache.get({ ...material, id: "test:second", name: "second" }, "base", 4);
    expect(a.url).toBe(b.url);
    expect(a.mips().map((m) => m.length)).toEqual([4, 16, 64]);
    expect(readdirSync(join(root, "one/media/models/textures"))).toHaveLength(1);
    const published = join(root, "one", a.url), original = readFileSync(published), modified = statSync(published).mtimeMs;
    const later = new ModelTextures(root, join(root, "two")).get(material, "base", 4);
    expect(later.url).toBe(a.url);
    expect(later.mips().map((m) => [...m])).toEqual(a.mips().map((m) => [...m]));
    expect(readFileSync(join(root, "two", later.url))).toEqual(original);
    pixels[0] = 0; save();
    const changed = new ModelTextures(root, join(root, "one")).get(material, "base", 4);
    expect(changed.url).not.toBe(a.url);
    expect(readFileSync(published)).toEqual(original);
    expect(statSync(published).mtimeMs).toBe(modified);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
