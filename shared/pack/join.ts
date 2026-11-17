// A landmark's files beside the core's (tools/build-client.ts): its pack and manifest joined to the core's after them, so a
// mesh, material or texture of the core keeps its index and the landmark's come after. Its boot file's bytes go after the
// core boot file's, and the client holds both as one. Its far mesh's row (shared/pack/far.ts) goes after any before it.

import type { Manifest, ManifestMesh, ManifestTexture } from "./manifest.ts";
import type { Pack, PackMaterial, PackMesh } from "./pack.ts";

const shifted = (m: PackMaterial, by: number): PackMaterial => {
  const t = (i: number): number => (i >= 0 ? i + by : i);
  const out = { ...m, base: t(m.base), normal: t(m.normal), mro: t(m.mro), mask: t(m.mask), mask2: t(m.mask2) };
  if (m.layer !== undefined) out.layer = t(m.layer);
  return out;
};

const sectionsOf = (sections: readonly number[] | undefined, by: number): number[] | undefined => sections?.map((v, k) => (k % 3 === 0 ? v + by : v));

/** `core` with `more` after it. A landmark's pack has the core's palette and no clips. */
export function joinPacks(core: Pack, more: Pack): Pack {
  if (more.header.clips.length > 0) throw new Error("pack: a landmark's pack holds no clips");
  if (more.palette.length !== core.palette.length || more.palette.some((v, i) => v !== core.palette[i])) throw new Error("pack: a landmark's pack is in another palette");
  const at = core.blob.length, rigs = core.header.rigs.length, materials = core.header.materials?.length ?? 0, textures = core.header.textures?.length ?? 0;
  const meshes = more.header.meshes.map((m): PackMesh => ({
    ...m,
    ...(m.rig !== undefined ? { rig: m.rig + rigs } : {}),
    lods: m.lods.map((l) => {
      const lod = { ...l, indexOffset: l.indexOffset + at, vertexOffset: l.vertexOffset + at };
      if (l.surfaceOffset !== undefined) lod.surfaceOffset = l.surfaceOffset + at;
      if (l.skinOffset !== undefined) lod.skinOffset = l.skinOffset + at;
      if (l.sections) lod.sections = sectionsOf(l.sections, materials)!;
      return lod;
    }),
  }));
  const blob = new Uint8Array(at + more.blob.length);
  blob.set(core.blob);
  blob.set(more.blob, at);
  const header = { ...core.header, meshes: [...core.header.meshes, ...meshes], rigs: [...core.header.rigs, ...more.header.rigs] };
  if (more.header.materials) header.materials = [...(core.header.materials ?? []), ...more.header.materials.map((m) => shifted(m, textures))];
  if (more.header.textures) header.textures = [...(core.header.textures ?? []), ...more.header.textures];
  if (more.header.landmarks) header.landmarks = [...(core.header.landmarks ?? []), ...more.header.landmarks];
  return { header, blob, blobAt: core.blobAt, palette: core.palette, meshIndex: new Map(header.meshes.map((m, i) => [m.id, i])), clips: core.clips };
}

/**
 * The core's manifest and boot pack with a landmark's after them. Its files' names are within `dir` of the core's, and a
 * level its boot file holds is named as in the core's, at its place in the joined boot.
 */
export function joinLandmark(core: { manifest: Manifest; boot: Pack }, more: { manifest: Manifest; boot: Pack }, dir: string): { manifest: Manifest; boot: Pack } {
  const c = core.manifest, m = more.manifest;
  const files = [...c.files];
  const fileOf = m.files.map((f, i) => (i === m.boot ? c.boot : files.push({ ...f, name: `${dir}/${f.name}` }) - 1));
  const bootAt = core.boot.blobAt + core.boot.blob.length - more.boot.blobAt;
  const materials = c.materials?.length ?? 0, textures = c.textures?.length ?? 0, rigs = core.boot.header.rigs.length;
  const meshes = m.meshes.map((x): ManifestMesh => ({
    ...x,
    ...(x.rig !== undefined ? { rig: x.rig + rigs } : {}),
    levels: x.levels.map((l) => {
      const level = { ...l, file: fileOf[l.file]!, at: l.file === m.boot ? l.at + bootAt : l.at };
      if (l.surface) level.surface = { file: fileOf[l.surface.file]!, at: l.surface.file === m.boot ? l.surface.at + bootAt : l.surface.at };
      if (l.sections) level.sections = sectionsOf(l.sections, materials)!;
      return level;
    }),
  }));
  const manifest: Manifest = {
    ...c,
    files,
    meshes: [...c.meshes, ...meshes],
    materials: [...(c.materials ?? []), ...(m.materials ?? []).map((x) => shifted(x, textures))],
    textures: [...(c.textures ?? []), ...(m.textures ?? []).map((t) => ({ ...t, in: Object.fromEntries(Object.entries(t.in).map(([format, v]) => [format, { ...v, file: fileOf[v.file]! }])) as ManifestTexture["in"] }))],
  };
  if (m.landmarks) manifest.landmarks = [...(c.landmarks ?? []), ...m.landmarks];
  return { manifest, boot: joinPacks(core.boot, more.boot) };
}
