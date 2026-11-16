// Bakes bounded native-model packages and pictures. Nothing here starts a game server or rewrites source art.
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { HUMAN } from "../../shared/anim/human.ts";
import type { Clip } from "../../shared/anim/clip.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { parsePack, type Pack, type PackRig } from "../../shared/pack/pack.ts";
import type { ModelBounds, ModelDocument, ModelTexture } from "../../shared/pages/model.ts";
import type { GuideEntry, GuideModel } from "../../shared/pages/types.ts";
import { meshBounds, modelMesh, ModelPose } from "../../client/core/pages/model.ts";
import { findAssets } from "../art/assets.ts";
import { materialsOf, pictureFiles } from "../art/materials.ts";
import { buildCorePack } from "../pack/build.ts";
import { encodePng } from "../pack/image.ts";
import { rgbaPicture } from "../pack/texture.ts";
import { buildPack, unpackMeshes, type SourceLod, type SourceMesh } from "../pack/write.ts";
import { ModelView } from "../snap.ts";
import { ModelTextures } from "./models/textures.ts";

const ROOT = resolve(import.meta.dir, "../..");
const CACHE = join(ROOT, ".cache/pages-models");
// Bump when changing pose sampling, framing, poster settings or assembly. Packaging changes need no rerender.
const VERSION = "guide-model-shared-1";
const MAKERS = ["tools/pack/image.ts", "tools/pack/texture.ts", "tools/art/materials.ts", "tools/snap.ts", "tools/snap/raster.ts", "client/core/pages/model.ts"];
// Repackage already valid posters from the first exporter, without altering its immutable public files.
const LEGACY_MAKER = "dfa3099e239d203d57be30aaaf939af110dae9e5a2ae9ac470d05d6a32b5f1d0";
const LEGACY_RENDER = "7cfa3c9af72144b7ae52fe18895e0c735172819b50db6f2c76c66f0b952a5284";
const hash = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex").slice(0, 20);
const label = (id: string): string => id.slice(id.lastIndexOf("/") + 1).replaceAll("_", " ");

/** Keep the finest practical textured level; the game still owns the source and all coarser levels. */
export function previewMesh(source: SourceMesh): SourceMesh {
  let level = source.lods.findIndex((l) => l.indices.length / 3 <= 16000);
  if (level < 0) level = source.lods.length - 1;
  if ((source.flat ?? 0) > 0) level = Math.min(level, source.flat! - 1);
  return { ...source, flat: source.flat === undefined ? undefined : (level < source.flat ? 1 : 0), lods: [{ ...source.lods[level]!, error: 0 }] };
}
function human(meshes: readonly SourceMesh[], mannequin = false): SourceMesh {
  const ids = mannequin ? ["head", "torso", "hands", "legs", "feet"].map((s) => `core:mannequin/${s}`) : ["head", "hands", "armor/cloth/torso", "armor/cloth/legs", "armor/cloth/feet", "hair/buzzed"].map((s) => `core:human_m/${s}`);
  const parts = ids.map((id) => meshes.find((m) => m.id === id)!.lods[0]!);
  const count = parts.reduce((n, p) => n + p.colors.length, 0), triangles = parts.reduce((n, p) => n + p.indices.length, 0);
  const lod: SourceLod = { positions: new Float32Array(count * 3), colors: new Uint8Array(count), bones: new Uint8Array(count), indices: new Uint32Array(triangles) };
  let vertex = 0, index = 0;
  for (const p of parts) {
    lod.positions.set(p.positions, vertex * 3); lod.colors.set(p.colors, vertex); lod.bones!.set(p.bones!, vertex);
    for (const v of p.indices) lod.indices[index++] = v + vertex;
    vertex += p.colors.length;
  }
  return { id: mannequin ? "core:mannequin" : "core:survivor", skeleton: "human", rig: mannequin ? "guide:mannequin" : "human_m", lods: [lod] };
}
function rigFor(pack: Pack, source: SourceMesh): PackRig | undefined {
  if (source.rig === "guide:mannequin") return { id: source.rig, skeleton: "human", names: [...HUMAN.names], parent: [...HUMAN.parent], rest: [...HUMAN.rest] };
  const r = pack.header.rigs.find((r) => r.id === source.rig);
  if (!r) return undefined;
  if (r.names) return r;
  if (r.skeleton !== "human") return undefined;
  return { ...r, names: [...HUMAN.names], parent: [...HUMAN.parent] };
}
function colours(id: string): number[] {
  const d = CORE_CONTENT.find((d) => d.id === id);
  if (d?.type === "species" && d.regions) return Array.from({ length: 6 }, (_, k) => d.regions?.[k]?.colors[0]?.[0] ?? d.color ?? 15);
  return Array.from({ length: 6 }, (_, k) => id === "core:survivor" || id === "core:civilian" ? [218, 229, 234, 5, 5, 15][k]! : d && "color" in d ? d.color ?? 15 : 15);
}
function union(bounds: readonly ModelBounds[]): ModelBounds {
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  for (const b of bounds) for (let k = 0; k < 3; k++) { const extent = b.half?.[k] ?? b.radius; low[k] = Math.min(low[k]!, b.center[k]! - extent); high[k] = Math.max(high[k]!, b.center[k]! + extent); }
  const half = high.map((v, k) => (v - low[k]!) / 2) as [number, number, number];
  return { center: low.map((v, k) => (v + high[k]!) / 2) as [number, number, number], half, radius: Math.max(0.05, Math.hypot(...half)), height: high[1]! - low[1]! };
}
function clipBounds(pack: Pack, colors: readonly number[], clip: Clip | null): ModelBounds {
  const pose = new ModelPose(pack), meshes = pack.header.meshes.map((m) => modelMesh(pack, m, colors));
  const frames = clip ? Array.from({ length: 7 }, (_, k) => Math.floor((clip.frames - 1) * k / 6)) : [0];
  return union(frames.map((frame) => { pose.sample(clip, frame); return meshBounds(meshes, pose); }));
}
function png(path: string, width: number, height: number, pixels: Uint8Array): void {
  writeFileSync(path, encodePng({ width, height, channels: 4, depth: 8, data: pixels }));
}

/** Data and picture files are content-addressed and reused unchanged by hourly page generation. */
export async function buildModels(outDir: string, entries: readonly GuideEntry[]): Promise<Record<string, GuideModel>> {
  const core = parsePack(buildCorePack());
  const sources = unpackMeshes(core);
  sources.push(human(sources), human(sources, true));
  const byId = new Map(sources.map((m) => [m.id, m]));
  const assets = await findAssets();
  const materials = assets.flatMap(materialsOf);
  const artIds = new Set(assets.flatMap((a) => existsSync(a.file) ? parsePack(new Uint8Array(readFileSync(a.file))).header.meshes.map((m) => m.id) : []));
  const code = createHash("sha256");
  for (const file of MAKERS) code.update(readFileSync(join(ROOT, file)));
  const makerHash = code.digest("hex");
  const textureCache = new ModelTextures(ROOT, outDir);
  const records: Record<string, GuideModel> = {};
  const done = new Map<string, GuideModel>();
  mkdirSync(join(outDir, "media/models"), { recursive: true });
  mkdirSync(CACHE, { recursive: true });
  for (const entry of entries) {
    const key = entry.modelId ?? entry.id;
    if (records[key]) continue;
    let source = byId.get(`${key}/dropped`) ?? byId.get(key);
    if (key === "core:human" || entry.id === "core:survivor" || entry.id === "core:civilian") source = byId.get("core:survivor");
    if (!source || source.id.startsWith("core:zz_") || (!artIds.has(source.id) && source.id !== "core:survivor" && source.lods[0]!.indices.length <= 108)) continue;
    if (source.skeleton && !source.rig) continue;
    const found = done.get(source.id);
    if (found) { records[key] = found; continue; }
    const mesh = previewMesh(source), rig = rigFor(core, mesh);
    const clips = rig ? core.clips.clips.filter((c) => c.id.startsWith((rig.skeleton === "human" ? "human" : rig.id) + "/") && c.bones === rig.rest.length / 3) : [];
    const colors = colours(entry.id);
    const modelLabel = source.id === "core:survivor" ? "Human" : entry.label;
    const base = buildPack([mesh], core.palette, [], rig ? [rig] : []), pack = parsePack(base);
    const input = createHash("sha256").update(VERSION).update(makerHash).update(base).update(JSON.stringify(colors));
    const legacy = createHash("sha256").update("guide-model-5").update(LEGACY_MAKER).update(base).update(JSON.stringify(colors));
    for (const c of clips) {
      const rot = new Uint8Array(c.rot.buffer, c.rot.byteOffset, c.rot.byteLength), root = new Uint8Array(c.root.buffer, c.root.byteOffset, c.root.byteLength);
      input.update(JSON.stringify([c.id, c.frames, c.loop])).update(rot).update(root); legacy.update(rot).update(root);
    }
    const textureMaterials = (pack.header.textures ?? []).map((t) => materials.find((m) => t.id === `${m.id}/${t.role}`));
    if (textureMaterials.some((m) => !m)) continue;
    const textures: ModelTexture[] = [], pictures: { slot: number; role: ModelTexture["role"]; mips: () => Uint8Array[] }[] = [];
    for (let slot = 0; slot < (pack.header.textures?.length ?? 0); slot++) {
      const t = pack.header.textures![slot]!;
      if (t.role === "layer") continue;
      const baked = textureCache.get(textureMaterials[slot]!, t.role, Math.min(t.top, t.role === "base" ? 1024 : 512));
      input.update(JSON.stringify([slot, t.role, baked.hash]));
      textures.push({ slot, url: baked.url, role: t.role, width: baked.top, height: baked.top, bytes: baked.bytes });
      pictures.push({ slot, role: t.role, mips: baked.mips });
    }
    const hero = ["creatures", "vehicles", "characters"].includes(entry.kind), width = hero ? 768 : 480, height = hero ? 576 : 360;
    input.update(JSON.stringify([modelLabel, width, height, hero ? 3 : 1]));
    const fingerprint = input.digest("hex").slice(0, 20), dir = join(CACHE, fingerprint), url = `/media/models/${fingerprint}`;
    let record: GuideModel;
    if (existsSync(join(dir, "record.json"))) record = JSON.parse(readFileSync(join(dir, "record.json"), "utf8")) as GuideModel;
    else {
      let reused: { dir: string; doc: ModelDocument; record: GuideModel } | undefined;
      if (makerHash === LEGACY_RENDER && VERSION === "guide-model-shared-1") {
        for (const m of new Set(textureMaterials)) for (const p of Object.values(pictureFiles(m!))) if (existsSync(p)) legacy.update(readFileSync(p));
        const oldDir = join(CACHE, legacy.digest("hex").slice(0, 20));
        if (existsSync(join(oldDir, "record.json"))) {
          const oldRecord = JSON.parse(readFileSync(join(oldDir, "record.json"), "utf8")) as GuideModel;
          const oldDoc = JSON.parse(readFileSync(join(oldDir, "model.json"), "utf8")) as ModelDocument;
          if (oldRecord.images.length === (hero ? 3 : 1) && oldRecord.images[0]?.width === width && oldDoc.bounds.half) reused = { dir: oldDir, doc: oldDoc, record: oldRecord };
        }
      }
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "model.snpk"), base);
      const defaultClip = clips.find((c) => c.id.endsWith("/idle")) ?? null;
      const bounds = reused?.doc.bounds ?? clipBounds(pack, colors, defaultClip);
      const doc: ModelDocument = { version: 1, id: source.id, label: modelLabel, pack: `${url}/model.snpk`, packBytes: base.length, colors, bounds, textures, clips: [] };
      for (const c of clips) {
        const bytes = buildPack([], core.palette, [c]), file = `clip-${hash(c.id)}.snpk`;
        writeFileSync(join(dir, file), bytes);
        doc.clips.push({ id: c.id, label: label(c.id), url: `${url}/${file}`, bytes: bytes.length, seconds: Math.max(1, c.frames) / TICK_RATE, frames: c.frames, loop: c.loop, bounds: reused?.doc.clips.find((old) => old.id === c.id)?.bounds ?? clipBounds(pack, colors, c) });
      }
      const view = reused ? null : new ModelView(pack, width, height, [5 / 255, 17 / 255, 27 / 255]);
      if (view) for (const p of pictures) view.texture(p.slot, p.role, p.mips().map((mip) => rgbaPicture(p.role, mip)));
      const pose = new ModelPose(pack); pose.sample(defaultClip, 0);
      const posed = meshBounds(pack.header.meshes.map((m) => modelMesh(pack, m, colors)), pose);
      const angles = hero ? [[35, 12], [110, 8], [205, 18]] : [[35, 18]];
      const images = angles.map(([around, above], k) => {
        const file = `view-${k}.png`;
        if (view) { view.draw({ mesh: 0, level: 0, around: around!, above: above!, centre: posed.center, radius: posed.radius * 0.9, colors, rig: pose.rig, textured: !!pack.header.meshes[0]!.lods[0]!.sections }); png(join(dir, file), width, height, new Uint8Array(view.raster.color.buffer)); }
        else copyFileSync(join(reused!.dir, file), join(dir, file));
        return { src: `${url}/${file}`, label: ["Three-quarter view", "Side view", "Rear view"][k]!, width, height };
      });
      writeFileSync(join(dir, "model.json"), JSON.stringify(doc));
      record = { id: source.id, label: modelLabel, url: `${url}/model.json`, bytes: base.length + textures.reduce((n, t) => n + t.bytes, 0), poster: images[0]!.src, images, clips: doc.clips.map(({ id, label, seconds, loop }) => ({ id, label, seconds, loop })), credit: "Game asset · original materials and animation" };
      writeFileSync(join(dir, "record.json"), JSON.stringify(record));
    }
    cpSync(dir, join(outDir, "media/models", fingerprint), { recursive: true, filter: (p) => !p.endsWith("record.json") });
    records[key] = record; done.set(source.id, record);
  }
  return records;
}
