// Rows for the parts a build serves by range: how small each kind is stored, against its raw bytes and against the
// runtime's deflate at 9 and Brotli at 11 on the same filtered bytes; how fast parts are deflated and inflated; what
// ordering did to the vertex cache and to the stored bytes of the committed meshes; and what each tier fetches for
// the stress scene and for the whole set. `bun tools/bench/parts.ts` runs these alone and prints a table per asset.

import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, deflateRaw, inflateRawSync } from "node:zlib";
import { Assets } from "../../client/core/assets/assets.ts";
import { levelParts, textureParts } from "../../client/core/assets/port.ts";
import { TIERS } from "../../client/core/assets/tiers.ts";
import { stressThings } from "../../client/core/stress.ts";
import type { Manifest } from "../../shared/pack/manifest.ts";
import { parsePack, readIndices } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { unfilterPart } from "../../shared/pack/stored.ts";
import { TEXTURE_FORMATS, type TextureFormat } from "../../shared/pack/texture.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { assetWorld } from "../../tests/fixtures/assetworld.ts";
import { coreRegistry } from "../../tests/fixtures/world.ts";
import { gameTextures } from "../art/materials.ts";
import { SOURCE, filesUnder } from "../art/source.ts";
import { buildCorePack, importedMeshes } from "../pack/build.ts";
import { deflate } from "../pack/deflate.ts";
import { buildTextures } from "../pack/encode.ts";
import { missRatio, orderPack } from "../pack/order.ts";
import { splitPack, type SplitFile } from "../pack/split.ts";
import { storeParts } from "../pack/store.ts";
import { spoilStress, stressMeshes } from "../pack/stress.ts";
import { buildPack } from "../pack/write.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;
type Set = { files: SplitFile[]; manifest: Manifest };

const brotli = promisify(brotliCompress);
const zlib9 = promisify(deflateRaw);
const mb = (bytes: number): number => bytes / 1048576;

/** A part of a set: where it is in the raw files and the stored ones, and what it is. */
interface Listed {
  asset: string;
  kind: string;
  raw: Uint8Array;
  stored: Uint8Array;
  /** What our deflate was given: the filter and the filtered bytes. The raw bytes for a part stored as it is. */
  input: Uint8Array;
}

/** Which asset folder under assets/source each mesh came from. Meshes made in code are "made in code". */
function assetOfMeshes(): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of filesUnder(SOURCE, ".snpk")) for (const m of parsePack(new Uint8Array(readFileSync(file))).header.meshes) out.set(m.id, basename(dirname(file)));
  return out;
}

/** Every ranged part of a set, raw and as stored, side by side. */
function listParts(raw: Set, stored: Set): Listed[] {
  const of = assetOfMeshes();
  const out: Listed[] = [];
  const kinds = ["level", "surface", "skin"];
  const open = (stored: Uint8Array, inflated: number | undefined): Uint8Array => (inflated === undefined ? stored : new Uint8Array(inflateRawSync(stored)));
  stored.manifest.meshes.forEach((m, i) =>
    m.levels.forEach((level, l) => {
      const was = raw.manifest.meshes[i]!.levels[l]!;
      const parts = levelParts(level, 0, level.parts.length);
      const rawParts = levelParts(was, 0, was.parts.length);
      parts.forEach((p, k) => {
        const file = k === 0 ? level.file : (level.surface ?? level).file;
        if (stored.files[file]!.role === "boot") return;
        const r = rawParts[k]!;
        const rawBytes = raw.files[k === 0 ? was.file : (was.surface ?? was).file]!.bytes.subarray(r.offset, r.offset + r.length);
        const got = stored.files[file]!.bytes.subarray(p.offset, p.offset + p.length);
        out.push({ asset: of.get(m.id) ?? "made in code", kind: kinds[k]!, raw: rawBytes, stored: got, input: open(got, p.inflated) });
      });
    }),
  );
  stored.manifest.textures?.forEach((tex, t) => {
    for (const format of TEXTURE_FORMATS) {
      const v = tex.in[format];
      if (!v) continue;
      const was = raw.manifest.textures![t]!;
      const rawParts = textureParts(was, format, v.hash.length - 1);
      textureParts(tex, format, v.hash.length - 1).forEach((p, k) => {
        const r = rawParts[k]!;
        const got = stored.files[v.file]!.bytes.subarray(p.offset, p.offset + p.length);
        out.push({ asset: tex.id.slice(tex.id.indexOf(":") + 1, tex.id.indexOf("/")), kind: `${format} ${tex.role}`, raw: raw.files[was.in[format]!.file]!.bytes.subarray(r.offset, r.offset + r.length), stored: got, input: open(got, p.inflated) });
      });
    }
  });
  return out;
}

/** The core set as `bun run build` makes it, raw and stored. */
async function servedSet(): Promise<{ raw: Set; stored: Set }> {
  const raw = splitPack(orderPack(buildCorePack([...importedMeshes()])), "core");
  const textures = await buildTextures(raw.manifest, await gameTextures(), "core");
  raw.files.push(...textures.files);
  const manifest = structuredClone(raw.manifest);
  const { files } = await storeParts(raw.files, manifest);
  return { raw, stored: { files, manifest } };
}

/** Bytes fetched by every tier standing where the stress scene is seen from, until all it wants is drawn. The parts listed wrongly are left out. */
function stressFetched(set: Set): Map<string, number> {
  const hf = new Heightfield({ chunksX: 2, chunksZ: 2 }, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 0);
  const out = new Map<string, number>();
  for (const tier of TIERS) {
    const placing = new Assets(coreRegistry(), parsePack(set.files[0]!.bytes), set.manifest);
    placing.tier = tier;
    const bad = new Set(["stress:bad_hash", "stress:bad_range", "stress:bad_short"].map((id) => placing.table.find(id)));
    const things = stressThings(placing, hf, { x: 64, z: 64 }, 1.7).things.filter((t) => !bad.has(t.mesh)).map((t) => ({ mesh: t.mesh, x: t.x - 64, z: t.z - 64 }));
    const w = assetWorld(set, things, { latencyMs: 50, bytesPerSecond: 2.5e6 }, tier);
    for (let f = 0; f < 60 * 60 && !(f > 60 && w.settled() && w.r.flying === 0); f++) w.frame(0);
    out.set(tier.name, w.r.stats.fetched);
  }
  return out;
}

/** What each tier would fetch to keep the whole set, in each variant. */
function downloads(set: Set): Map<string, number> {
  const out = new Map<string, number>();
  for (const tier of TIERS) {
    for (const format of tier.texture === 0 ? (["rgba"] as TextureFormat[]) : TEXTURE_FORMATS) {
      const assets = new Assets(coreRegistry(), parsePack(set.files[0]!.bytes), set.manifest, { request() {}, cancel() {}, take: () => 0, fill() {}, cache: { used: 0, limit: 0, mode: "none", filling: 0 } });
      assets.tier = tier;
      assets.format = format;
      assets.begin(0, 720, 1.2217);
      out.set(tier.texture === 0 ? tier.name : `${tier.name} ${format}`, assets.residency.download());
    }
  }
  return out;
}

export async function benchParts(section: Section, record: Row, table = false): Promise<void> {
  section("Parts served by range: the core set as `bun run build` makes it, raw and stored");
  const { raw, stored } = await servedSet();
  const parts = listParts(raw, stored);
  // The runtime's deflate at 9 and Brotli at 11 on what our deflate was given, and Brotli on the raw bytes, all at once.
  const sizes = await Promise.all(
    parts.map(async (p) => {
      const opts = { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: p.raw.length } };
      const [z, b, br] = await Promise.all([zlib9(p.input, { level: 9, memLevel: 9 }), brotli(p.input, opts), brotli(p.raw, opts)]);
      return { z: Math.min(z.length, p.raw.length), b: Math.min(b.length, p.raw.length), br: Math.min(br.length, p.raw.length) };
    }),
  );
  const sum = (filter: (p: Listed) => boolean) => {
    const s = { n: 0, raw: 0, ours: 0, z: 0, b: 0, br: 0 };
    parts.forEach((p, i) => {
      if (!filter(p)) return;
      s.n++;
      s.raw += p.raw.length;
      s.ours += p.stored.length;
      s.z += sizes[i]!.z;
      s.b += sizes[i]!.b;
      s.br += sizes[i]!.br;
    });
    return s;
  };
  const kinds = [...new Set(parts.map((p) => p.kind))];
  for (const kind of kinds) {
    const s = sum((p) => p.kind === kind);
    record(`${kind}: ${s.n} parts, ${mb(s.raw).toFixed(2)} MB raw, stored over raw`, s.ours / s.raw, "");
    record(`${kind}: the runtime's deflate at 9 on the same bytes, over ours`, s.z / s.ours, "");
    record(`${kind}: Brotli at 11 on the same bytes, over ours`, s.b / s.ours, "");
  }
  const all = sum(() => true);
  const files = (set: Set) => set.files.reduce((n, f) => n + (f.role === "boot" ? 0 : f.bytes.length), 0);
  record("the ranged files, raw", mb(files(raw)), "MB");
  record("the ranged files, stored", mb(files(stored)), "MB");
  record("every part stored, over Brotli at 11 on its raw bytes", all.ours / all.br, "");
  if (table) {
    console.log(`\n  ${"asset".padEnd(16)}${"kind".padEnd(14)}${"parts".padStart(6)}${"raw".padStart(12)}${"ours".padStart(12)}${"zlib 9".padStart(12)}${"brotli 11".padStart(12)}${"br 11 raw".padStart(12)}`);
    for (const asset of [...new Set(parts.map((p) => p.asset))]) {
      for (const kind of kinds) {
        const s = sum((p) => p.asset === asset && p.kind === kind);
        if (s.n > 0) console.log(`  ${asset.padEnd(16)}${kind.padEnd(14)}${String(s.n).padStart(6)}${[s.raw, s.ours, s.z, s.b, s.br].map((n) => String(n).padStart(12)).join("")}`);
      }
    }
    console.log(`  ${"all".padEnd(30)}${String(all.n).padStart(6)}${[all.raw, all.ours, all.z, all.b, all.br].map((n) => String(n).padStart(12)).join("")}`);
  }

  section("Parts: deflating and inflating, seconds of one core's time");
  const cpu = (run: () => void): number => {
    const t0 = process.cpuUsage();
    run();
    const t = process.cpuUsage(t0);
    return (t.user + t.system) / 1e6;
  };
  // Ours on what it was given: every level, and the last step of the last texture of each of three kinds, with nothing kept from before.
  for (const kind of ["level", "bc base", "astc normal", "rgba base"]) {
    const sample = parts.filter((p) => p.kind === kind && p.input !== p.stored).slice(kind === "level" ? 0 : -1);
    const bytes = sample.reduce((n, p) => n + p.input.length, 0);
    record(`ours on ${kind}, ${mb(bytes).toFixed(2)} MB`, mb(bytes) / cpu(() => sample.forEach((p) => deflate(p.input))), "MB/s");
  }
  const inflated = parts.filter((p) => p.input !== p.stored);
  const out = inflated.reduce((n, p) => n + p.raw.length, 0);
  record("the runtime's inflate, every part stored deflated", mb(out) / cpu(() => inflated.forEach((p) => inflateRawSync(p.stored))), "MB/s");
  record("the same, and the filter undone", mb(out) / cpu(() => inflated.forEach((p) => unfilterPart(new Uint8Array(inflateRawSync(p.stored)), p.raw.length))), "MB/s");

  section("Parts: the committed meshes drawn with materials, as built and ordered for the cache");
  const whole = parsePack(buildCorePack([...importedMeshes()]));
  const ordered = parsePack(orderPack(buildCorePack([...importedMeshes()])));
  const ratios = [0, 0, 0];
  let levels = 0;
  whole.header.meshes.forEach((m, i) =>
    m.lods.forEach((lod, l) => {
      if (!lod.sections) return;
      levels++;
      ratios[0]! += missRatio(readIndices(whole, lod), lod.vertexCount);
      ratios[1]! += missRatio(readIndices(ordered, ordered.header.meshes[i]!.lods[l]!), lod.vertexCount);
      ratios[2]! += lod.vertexCount / (lod.indexCount / 3);
    }),
  );
  record(`vertices fetched a triangle, ${levels} levels as built, first in first out of 16`, ratios[0]! / levels, "");
  record("the same, ordered", ratios[1]! / levels, "");
  record("the same, the least there can be: vertices over triangles", ratios[2]! / levels, "");
  // Every part of those levels, as stored, whatever file it is in: the boot file's are stored as they are.
  const storedOf = async (pack: Uint8Array): Promise<number> => {
    const set = splitPack(pack, "core");
    await storeParts(set.files, set.manifest);
    let n = 0;
    for (const m of set.manifest.meshes) for (const level of m.levels) if (level.sections) for (const p of levelParts(level, 0, level.parts.length)) n += p.length;
    return n;
  };
  record("their levels stored, as built", (await storedOf(buildCorePack([...importedMeshes()]))) / 1024, "KB");
  record("their levels stored, ordered", (await storedOf(orderPack(buildCorePack([...importedMeshes()])))) / 1024, "KB");

  section("Parts: bytes each tier fetches, raw and stored");
  const rawStress = splitPack(buildPack(stressMeshes(), defaultPalette()), "stress");
  const storedStress = splitPack(buildPack(stressMeshes(), defaultPalette()), "stress");
  const kept = await storeParts(storedStress.files, storedStress.manifest);
  storedStress.files = kept.files;
  spoilStress(rawStress.files, rawStress.manifest);
  spoilStress(storedStress.files, storedStress.manifest);
  const [was, now] = [stressFetched(rawStress), stressFetched(storedStress)];
  for (const tier of TIERS) {
    record(`the stress scene on ${tier.name}, raw`, mb(was.get(tier.name)!), "MB");
    record(`the stress scene on ${tier.name}, stored`, mb(now.get(tier.name)!), "MB", tier.name === "lowpoly" ? mb(was.get(tier.name)!) : null);
  }
  const [rawAll, storedAll] = [downloads(raw), downloads(stored)];
  for (const [name, bytes] of rawAll) {
    record(`the whole core set on ${name}, raw`, mb(bytes), "MB");
    record(`the whole core set on ${name}, stored`, mb(storedAll.get(name)!), "MB");
  }
}

if (import.meta.main) {
  await benchParts(
    (title) => console.log(`\n${title}`),
    (name, value, unit, budget = null) => console.log(`  ${name.padEnd(78)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${budget === null ? "" : value <= budget ? `  ok (budget ${budget.toFixed(3)})` : `  MISS (budget ${budget.toFixed(3)})`}`),
    true,
  );
}
