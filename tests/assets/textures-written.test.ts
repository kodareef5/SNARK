// The texture build as `bun run build` runs it (tools/pack/encode.ts writeTextures): each texture stored as soon as it
// is encoded and written once those before it are, to the files and manifest that encoding every texture and storing
// the files whole make. What it holds is counted here in textures; the build's measured footprint is the proof at scale.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { textureParts } from "../../client/core/assets/port.ts";
import { unfilterPart } from "../../shared/pack/stored.ts";
import { MAP_ROLES, TEXTURE_FORMATS, type TextureRole } from "../../shared/pack/texture.ts";
import { Rng } from "../../shared/rng.ts";
import { buildTextures, eachTexture, writeTextures, type TextureSource } from "../../tools/pack/encode.ts";
import { partHash } from "../../tools/pack/manifest.ts";
import { splitPack } from "../../tools/pack/split.ts";
import { storeParts } from "../../tools/pack/store.ts";
import { materialMips } from "../../tools/pack/texture.ts";
import { textureRanges } from "../../tools/sizes.ts";
import { TUBE, TUBE_PIXELS, tubePack, tubePictures } from "../fixtures/textured.ts";

const mips = materialMips(tubePictures()) as Record<TextureRole, Uint8Array[]>;

/** Pictures 1 to `top` pixels across of a smooth pattern that `seed` varies, which deflates, or with `seed` 0 of noise, which does not. */
function pattern(top: number, seed: number): Uint8Array[] {
  const rng = new Rng(7);
  return Array.from({ length: Math.log2(top) + 1 }, (_, i) => {
    const n = 1 << i;
    return Uint8Array.from({ length: n * n * 4 }, (_, k) => {
      const [x, y] = [(k >> 2) % n, Math.floor((k >> 2) / n)];
      if ((k & 3) === 3) return 255;
      return seed === 0 ? rng.int(256) : (((x * 255) / n + (y * 97) / n + seed * (k & 3) * 31 + ((x ^ y) & seed)) | 0) & 255;
    });
  });
}

/** The tube's five textures, which its pack names, and four of 128 pixels it does not, which have a second step. */
function sources(): TextureSource[] {
  return [
    ...MAP_ROLES.map((role) => ({ id: `${TUBE}/${role}`, role, top: TUBE_PIXELS, mips: () => mips[role] })),
    ...(["base", "normal", "mro", "mask"] as const).map((role, k) => ({ id: `test:large_${role}`, role, top: 128, mips: () => pattern(128, (k + 1) % 4) })),
  ];
}

test("written a texture at a time, the texture files and the manifest are those of every texture encoded and each file stored whole", async () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-written-"));
  try {
    const capped = { id: "test:small_base", top: 64, role: "base" as const, mips: () => pattern(64, 1) };
    const all = [capped, ...sources()];
    const whole = splitPack(tubePack(), "tube");
    for (const s of [capped, all.find((s) => s.id === "test:large_base")!]) {
      const base = whole.manifest.textures!.length;
      whole.manifest.textures!.push({ id: s.id, role: s.role, top: s.top, in: {} });
      whole.manifest.materials!.push({ ...whole.manifest.materials![0]!, id: s.id + "_mat", base });
    }
    const manifest = structuredClone(whole.manifest);
    const raw = await buildTextures(whole.manifest, all, "tube", { workers: 2, cache: null });
    const files = [...whole.files, ...raw.files];
    const stored = await storeParts(files, whole.manifest, { workers: 2, cache: null, only: files.flatMap((f, i) => (f.role === "tex" ? [i] : [])) });
    const tex = whole.manifest.files.flatMap((f, i) => (f.role === "tex" ? [{ entry: f, bytes: stored.files[i]!.bytes }] : []));
    for (const { entry, bytes } of tex) entry.name = entry.name.replace(/\.(\w+)$/, `.${partHash(bytes)}.$1`);

    const written = await writeTextures(manifest, all, "tube", dir, { workers: 2, cache: null, parts: null });
    expect(JSON.stringify(manifest)).toBe(JSON.stringify(whole.manifest));
    expect(readdirSync(dir).sort()).toEqual(tex.map((t) => t.entry.name).sort());
    for (const { entry, bytes } of tex) expect([entry.name, Buffer.compare(readFileSync(join(dir, entry.name)), bytes)]).toEqual([entry.name, 0]);
    // Megapixels are summed in the order the threads finish, so in their last digits they differ from run to run.
    const counted = (r: { pictures: number; encoded: number; megapixels: number }) => ({ ...r, megapixels: r.megapixels.toFixed(6) });
    expect([written.raw, counted(written.report), written.stored]).toEqual([raw.files.reduce((sum, f) => sum + f.bytes.length, 0), counted(raw.report), stored.report]);
    // Some steps are stored deflated and some as they are, so the manifest says of some textures what each step is stored in.
    expect(stored.report.deflated).toBeGreaterThan(0);
    expect(stored.report.deflated).toBeLessThan(stored.report.parts);
    const small = manifest.textures![manifest.materials!.find((m) => m.id === capped.id + "_mat")!.base]!;
    const large = manifest.textures![manifest.materials!.find((m) => m.id === "test:large_base_mat")!.base]!;
    expect([small.id, small.top, large.id, large.top]).toEqual([capped.id, 64, "test:large_base", 128]);
    for (const format of TEXTURE_FORMATS) {
      const first = textureParts(small, format, 0);
      const chain = textureParts(large, format, 1);
      expect(first).toEqual(chain.slice(0, 1));
      const bytes = readFileSync(join(dir, manifest.files[large.in[format]!.file]!.name));
      for (const p of chain) {
        const stored = bytes.subarray(p.offset, p.offset + p.length);
        const raw = p.inflated ? unfilterPart(inflateRawSync(stored), p.inflated)! : stored;
        expect(partHash(raw)).toBe(p.hash);
      }
    }
    const variant = small.in.astc!;
    const shared = textureRanges(manifest, "astc", Infinity);
    expect(new Set(shared.map((r) => r.hash)).size).toBe(shared.length);
    // An independent copy of the smaller texture still counts against the duplicate budget.
    variant.file = manifest.files.push({ ...manifest.files[variant.file]!, name: "separate_copy.sntx" }) - 1;
    const copies = textureRanges(manifest, "astc", Infinity);
    expect(copies.filter((r) => r.hash === variant.hash[0]).length).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the textures are handed on in order, and a texture's pictures are asked for only once those before it are handed on and all but the last taken", async () => {
  let [asked, handed, taken] = [0, 0, 0];
  const seen: number[][] = [];
  const counted = sources().map((s) => ({ ...s, mips: () => (seen.push([asked++, handed, taken]), s.mips()) }));
  const { places } = await eachTexture(counted, { workers: 2, cache: null }, async () => {
    // One texture is taken at a time.
    expect(taken).toBe(handed);
    handed++;
    await new Promise((next) => setImmediate(next));
    taken++;
  });
  expect(places).toEqual(counted.map((_, k) => k));
  expect(seen).toEqual(counted.map((_, k) => [k, k, Math.max(0, k - 1)]));
  expect([handed, taken]).toEqual([counted.length, counted.length]);
});

test("with nothing left to be stored, every texture is in its file by the time the one after the next is encoded", async () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-written-"));
  try {
    const sizes: number[][] = [];
    const order: string[] = [];
    const counted = sources().map((s) => ({ ...s, mips: () => {
      order.push(s.id);
      sizes.push(TEXTURE_FORMATS.map((format) => statSync(join(dir, `tube.tex.${format}.sntx`)).size));
      return s.mips();
    } }));
    const manifest = splitPack(tubePack(), "tube").manifest;
    await writeTextures(manifest, counted, "tube", dir, { workers: 2, cache: null, parts: null, storing: 0 });
    // A file is opened empty and its header written last: when texture k is asked for, it ends where texture k - 1 starts.
    const starts = order.map((id) => TEXTURE_FORMATS.map((format) => manifest.textures!.find((t) => t.id === id)!.in[format]!.at));
    expect(sizes).toEqual(counted.map((_, k) => (k < 2 ? [0, 0, 0] : starts[k - 1]!)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
