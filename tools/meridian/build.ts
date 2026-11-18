// Build the wardrobe stage from the cooked meshes, textures and clips used by the client.
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, resolve } from "node:path";
import { skyFile, theSky } from "../../client/core/render/sky.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { drawIcons, iconSubjects, iconPng } from "../pack/icons.ts";
import { authoredClips } from "../../shared/anim/authored.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { findAssets } from "../art/assets.ts";
import { materialsOf } from "../art/materials.ts";
import { buildPack, unpackMeshes } from "../pack/write.ts";
import { rgbaOf, splitWithTextures } from "../snap/files.ts";

const out = resolve(process.argv[2] ?? "var/meridian/stage");
mkdirSync(out, { recursive: true });
const names = ["core:human-bodies", "core:human-clips", "core:pteranodon", "core:stone-tools"];
const assets = (await findAssets()).filter((a) => names.includes(a.id));
const materials = assets.flatMap(materialsOf);
const packs = assets.map((a) => parsePack(new Uint8Array(readFileSync(a.file))));
const bytes = buildPack(
  packs.flatMap(unpackMeshes),
  defaultPalette(),
  [...packs.flatMap((p) => p.clips.clips), ...authoredClips()],
  packs.flatMap((p) => p.header.rigs),
);
const split = splitWithTextures(bytes, (t) => {
  const material = materials.find((m) => t.id === m.id + "/" + t.role);
  if (!material) throw new Error(t.id);
  return rgbaOf(material, t.role, t.id.includes("/meridian/") ? t.top : Math.min(t.top, 256));
});
const pack = parsePack(bytes);
const subjects = iconSubjects(CORE_CONTENT, (id) => pack.meshIndex.has(id)).filter((s) => s.owner.startsWith("core:meridian_"));
const icons = drawIcons(pack, subjects, (slot) => {
  const t = pack.header.textures![slot]!;
  const material = materials.find((m) => t.id === m.id + "/" + t.role);
  return material ? rgbaOf(material, t.role, t.top) : null;
});
for (const subject of subjects)
  writeFileSync(
    join(out, subject.owner.slice(5) + ".png"),
    iconPng(icons.size, icons.size, icons.pictures[icons.index.get(subject.icon)!]!),
  );
split.files.forEach((b, i) => writeFileSync(join(out, i + ".gz"), gzipSync(b, { level: 6 })));
writeFileSync(join(out, "actors.json"), JSON.stringify(split.manifest));
writeFileSync(join(out, "content.json"), JSON.stringify(CORE_CONTENT));
writeFileSync(join(out, "sky.bin"), skyFile(theSky().table));
copyFileSync(join(import.meta.dir, "../../client/armory/index.html"), join(out, "index.html"));
const result = await Bun.build({
  entrypoints: [join(import.meta.dir, "../../client/armory/stage.ts")],
  outdir: out,
  target: "browser",
  minify: true,
});
if (!result.success) throw Error(result.logs.join("\n"));
