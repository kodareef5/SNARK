// A landmark's files beside the core's (tools/build-client.ts): its pack and manifest joined to the core's after them, so a
// mesh, material, texture or page of the core keeps its index and the landmark's come after. Its boot file's bytes go
// after the core boot file's, and the client holds both as one. Its pages' rows are numbered as its own manifest numbers
// them, and are moved to where the joined manifest has them as each page is read (`joinedRows`). Its far mesh's row
// (shared/pack/far.ts) goes after any before it.

import type { Manifest, ManifestMesh, ManifestTexture, PageRows } from "./manifest.ts";
import type { Pack, PackMaterial, PackMesh } from "./pack.ts";

/** Where a landmark's rows go in the manifest it is joined to: what comes before each kind of row, and where each of its files went. */
export interface JoinedAt {
  meshes: number;
  materials: number;
  textures: number;
  pages: number;
  rigs: number;
  /** By the landmark's own index, the joined index of each of its files. */
  files: number[];
  /** Its boot file's index, and what is added to a place in it to give the place in the joined boot. */
  boot: number;
  bootAt: number;
}

const shifted = (m: PackMaterial, by: number): PackMaterial => {
  const t = (i: number): number => (i >= 0 ? i + by : i);
  const out = { ...m, base: t(m.base), normal: t(m.normal), mro: t(m.mro), mask: t(m.mask), mask2: t(m.mask2) };
  if (m.layer !== undefined) out.layer = t(m.layer);
  return out;
};

const sectionsOf = (sections: readonly number[] | undefined, by: number): number[] | undefined => sections?.map((v, k) => (k % 3 === 0 ? v + by : v));

/** A mesh's row of the landmark's manifest as the joined manifest has it. One whose page has not come keeps its stand-in levels. */
function joinedMesh(x: ManifestMesh, s: JoinedAt): ManifestMesh {
  const out: ManifestMesh = { ...x };
  if (x.rig !== undefined) out.rig = x.rig + s.rigs;
  if (x.page !== undefined) out.page = x.page + s.pages;
  // A stand-in's levels name no file (manifest.ts meshKnown).
  if (x.levels[0]!.parts.length === 0) return out;
  out.levels = x.levels.map((l) => {
    const level = { ...l, file: s.files[l.file]!, at: l.file === s.boot ? l.at + s.bootAt : l.at };
    if (l.surface) level.surface = { file: s.files[l.surface.file]!, at: l.surface.file === s.boot ? l.surface.at + s.bootAt : l.surface.at };
    if (l.sections) level.sections = sectionsOf(l.sections, s.materials)!;
    return level;
  });
  return out;
}

const joinedTexture = (t: ManifestTexture, s: JoinedAt): ManifestTexture => ({ ...t, in: Object.fromEntries(Object.entries(t.in).map(([format, v]) => [format, { ...v, file: s.files[v.file]! }])) as ManifestTexture["in"] });

/** A page's rows as its landmark's manifest numbers them, numbered as the manifest it is joined to; as they are where `s` is absent. */
export function joinedRows(rows: PageRows, s: JoinedAt | undefined): PageRows {
  if (!s) return rows;
  return {
    meshes: rows.meshes.map(([i, x]) => [i + s.meshes, joinedMesh(x, s)]),
    materials: rows.materials.map(([k, x]) => [k + s.materials, shifted(x, s.textures)]),
    textures: rows.textures.map(([t, x]) => [t + s.textures, joinedTexture(x, s)]),
  };
}

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
 * The core's manifest and boot pack with a landmark's after them. Its files' names are within `dir` of the core's, a
 * level its boot file holds is named as in the core's, at its place in the joined boot, and each of its pages says how
 * its rows are moved (`joinedRows`).
 */
export function joinLandmark(core: { manifest: Manifest; boot: Pack }, more: { manifest: Manifest; boot: Pack }, dir: string): { manifest: Manifest; boot: Pack } {
  const c = core.manifest, m = more.manifest;
  const files = [...c.files];
  const s: JoinedAt = {
    meshes: c.meshes.length,
    materials: c.materials?.length ?? 0,
    textures: c.textures?.length ?? 0,
    pages: c.pages?.length ?? 0,
    rigs: core.boot.header.rigs.length,
    files: m.files.map((f, i) => (i === m.boot ? c.boot : files.push({ ...f, name: `${dir}/${f.name}` }) - 1)),
    boot: m.boot,
    bootAt: core.boot.blobAt + core.boot.blob.length - more.boot.blobAt,
  };
  const manifest: Manifest = {
    ...c,
    files,
    meshes: [...c.meshes, ...m.meshes.map((x) => joinedMesh(x, s))],
    materials: [...(c.materials ?? []), ...(m.materials ?? []).map((x) => shifted(x, s.textures))],
    textures: [...(c.textures ?? []), ...(m.textures ?? []).map((t) => joinedTexture(t, s))],
  };
  if (c.pages || m.pages) manifest.pages = [...(c.pages ?? []), ...(m.pages ?? []).map((p) => ({ ...p, file: s.files[p.file]!, joined: s }))];
  if (m.landmarks) manifest.landmarks = [...(c.landmarks ?? []), ...m.landmarks];
  return { manifest, boot: joinPacks(core.boot, more.boot) };
}
