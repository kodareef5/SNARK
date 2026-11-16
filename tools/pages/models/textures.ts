// One capped material texture is processed once and shared by every public model that uses it.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TextureRole } from "../../../shared/pack/texture.ts";
import { mipsOf, pictureFiles, type Material } from "../../art/materials.ts";
import { asPicture, encodePng } from "../../pack/image.ts";

const digest = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex").slice(0, 20);
interface Stored { hash: string; bytes: number; top: number; lengths: number[] }
export interface BakedTexture { hash: string; bytes: number; top: number; url: string; mips: () => Uint8Array[] }

export class ModelTextures {
  private readonly dir: string;
  private readonly output: string;
  private readonly code: string;
  private readonly sources = new Map<string, string>();
  private readonly baked = new Map<string, BakedTexture>();
  private readonly resident = new Map<string, Uint8Array[]>();
  constructor(root: string, outDir: string) {
    this.dir = join(root, ".cache/pages-model-textures"); this.output = join(outDir, "media/models/textures");
    mkdirSync(this.dir, { recursive: true }); mkdirSync(this.output, { recursive: true });
    const h = createHash("sha256");
    for (const name of ["tools/pack/image.ts", "tools/pack/mask.ts", "tools/pack/texture.ts", "tools/art/materials.ts", "tools/surfaces/build.ts"]) h.update(readFileSync(join(root, name)));
    this.code = h.digest("hex");
  }
  signature(material: Material): string {
    let found = this.sources.get(material.id);
    if (found) return found;
    const h = createHash("sha256"), { dir: _dir, ...spec } = material.spec;
    h.update(JSON.stringify(spec));
    for (const [role, file] of Object.entries(pictureFiles(material)).sort(([a], [b]) => a.localeCompare(b))) if (existsSync(file)) h.update(role).update(readFileSync(file));
    found = h.digest("hex"); this.sources.set(material.id, found); return found;
  }
  get(material: Material, role: TextureRole, top: number): BakedTexture {
    const key = digest(`guide-texture-1:${this.code}:${this.signature(material)}:${role}:${top}`), prior = this.baked.get(key);
    if (prior) return prior;
    const index = join(this.dir, `${key}.json`), pixels = join(this.dir, `${key}.bin`);
    let stored: Stored;
    if (existsSync(index) && existsSync(pixels)) stored = JSON.parse(readFileSync(index, "utf8")) as Stored;
    else {
      const mips = mipsOf(material, role, top), png = encodePng(asPicture(mips[mips.length - 1]!)), hash = digest(png);
      stored = { hash, bytes: png.length, top, lengths: mips.map((m) => m.length) };
      writeFileSync(join(this.dir, `${hash}.png`), png);
      writeFileSync(pixels, Buffer.concat(mips));
      writeFileSync(index, JSON.stringify(stored));
      this.keep(key, mips);
    }
    const target = join(this.output, `${stored.hash}.png`);
    if (!existsSync(target)) copyFileSync(join(this.dir, `${stored.hash}.png`), target);
    const texture: BakedTexture = { hash: stored.hash, bytes: stored.bytes, top: stored.top, url: `/media/models/textures/${stored.hash}.png`, mips: () => {
      const found = this.resident.get(key); if (found) { this.resident.delete(key); this.resident.set(key, found); return found; }
      const all = readFileSync(pixels); let offset = 0;
      const mips = stored.lengths.map((length) => { const mip = new Uint8Array(all.buffer, all.byteOffset + offset, length); offset += length; return mip; });
      this.keep(key, mips); return mips;
    } };
    this.baked.set(key, texture); return texture;
  }
  private keep(key: string, mips: Uint8Array[]): void {
    // A bounded build working set; persistent mips make revisiting an older material cheap.
    if (this.resident.size >= 32) this.resident.delete(this.resident.keys().next().value!);
    this.resident.set(key, mips);
  }
}
