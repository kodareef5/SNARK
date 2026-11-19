// A pack built again, settled on the pack it replaces: whatever the new build makes the same as the committed pack to
// within the rounding of storage is the committed pack's, byte for byte, and only what is truly different is new.
//
// Why. A model goes through Blender, and Blender's arithmetic is not the same to the last bit on an Apple processor
// and an Intel one: a bone that is turned (an arm) comes out one unit in the last place of a float apart, where one
// that is not (a leg) comes out alike. That hair is far below anything drawn, but a pack stores a position on a grid of
// 65,535 steps across its mesh, and a value that sits near the middle between two steps goes one way on one machine
// and the other way on the other: one vertex in ten of the survivor's hands moved a step between the Mac's build and
// the Linux server's (2026-11-18), with every count, index, colour and bone the same. No rounding rule ends this, as a
// value can always sit on the boundary of whatever grid is chosen. What both machines do share is the committed pack,
// so that is the reference: a build that reproduces a mesh within one step of it has made that mesh, and keeps it.
//
// Without this an artist who changed one piece on another machine committed a new hair's breadth for every other
// piece in its pack, and what is worked out from a mesh by a search that small differences send elsewhere (the hand's
// grips round a handle, tools/pack/grips.ts) came out visibly different for no change at all.
//
// The second rule is for what Blender does not do alike twice. Its projection of a skin onto a picture, its packing of
// the islands and a layout that turns on which way a face at 45 degrees is taken to look all come out the same shape
// with its texture coordinates somewhere else: a few pixels for the Rex between the Mac and the server, most of the
// sheet for a yacht. The pictures in tex/ are painted on the layout that was committed, so a mesh whose shape is the
// committed one and whose layout has moved keeps the committed mesh, and the build says so. Only a shape that has
// really changed is new, and then its pictures are to be painted again whichever machine made it.

import { CLIP_ROOT_BYTES, SKIN_BYTES, SURFACE_BYTES, VERTEX_BYTES, clipRotBytes, detailsAtlas, lodIndices, lodSkin, lodSurface, lodVertices, parsePack, type Pack, type PackHeader, type PackLod, type PackMesh, type PackRig } from "../../shared/pack/pack.ts";
import { PackBlob } from "./write.ts";

/** Steps of a stored position, texture coordinate, normal's or tangent's part and skin weight that two builds of one thing may lie apart. */
const STEPS = { position: 1, uv: 2, normal: 2, weight: 1 } as const;
/** Metres a mesh's bounds, and a rig's measures, may lie apart: a float's last place at a metre is 1.2e-7. */
const BOUNDS = 2e-6;
const RIG = 1e-4;
/** How far a clip's rotation part and its root may lie apart: a step and a half of each as stored. */
const CLIP_ROT = 1.5 / 8192 * 2;
const CLIP_ROOT = 1.5 / 4096;

/** Whether `a` and `b` are the same thing with numbers no more than `within` apart, or a hundred-thousandth of themselves. */
function near(a: unknown, b: unknown, within: number): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= Math.max(within, 1e-5 * Math.abs(a));
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => k in b && near((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], within));
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** The three ten-bit parts and the two bits over of a packed normal or tangent no further apart than `steps`. */
function packedNear(a: number, b: number, steps: number): boolean {
  if (a >>> 30 !== b >>> 30) return false;
  for (let k = 0; k < 30; k += 10) if (Math.abs(((a >>> k) & 1023) - ((b >>> k) & 1023)) > steps) return false;
  return true;
}

function levelAlike(fp: Pack, f: PackLod, kp: Pack, k: PackLod): boolean {
  if (f.vertexCount !== k.vertexCount || f.indexCount !== k.indexCount || f.indexBytes !== k.indexBytes) return false;
  if ((f.surfaceOffset === undefined) !== (k.surfaceOffset === undefined) || (f.skinOffset === undefined) !== (k.skinOffset === undefined)) return false;
  if (JSON.stringify(f.sections ?? null) !== JSON.stringify(k.sections ?? null) || !near(f.error, k.error, 5e-5) && Math.abs(f.error - k.error) > 0.02 * Math.abs(k.error)) return false;
  if (!sameBytes(lodIndices(fp, f), lodIndices(kp, k))) return false;
  const fv = lodVertices(fp, f), kv = lodVertices(kp, k);
  const fView = new DataView(fv.buffer, fv.byteOffset, fv.byteLength), kView = new DataView(kv.buffer, kv.byteOffset, kv.byteLength);
  for (let v = 0; v < f.vertexCount; v++) {
    const at = v * VERTEX_BYTES;
    for (let a = 0; a < 6; a += 2) if (Math.abs(fView.getInt16(at + a, true) - kView.getInt16(at + a, true)) > STEPS.position) return false;
    // Its colour and its bone.
    if (fv[at + 6] !== kv[at + 6] || fv[at + 7] !== kv[at + 7]) return false;
  }
  const fs = lodSurface(fp, f), ks = lodSurface(kp, k);
  if (fs && ks) {
    const a = new DataView(fs.buffer, fs.byteOffset, fs.byteLength), b = new DataView(ks.buffer, ks.byteOffset, ks.byteLength);
    for (let v = 0; v < f.vertexCount; v++) {
      const at = v * SURFACE_BYTES;
      if (Math.abs(a.getUint16(at, true) - b.getUint16(at, true)) > STEPS.uv || Math.abs(a.getUint16(at + 2, true) - b.getUint16(at + 2, true)) > STEPS.uv) return false;
      // The tangent is not compared. It is worked out from the positions and the texture coordinates, so it cannot
      // change while they stand, and on a sliver of the picture one step of a corner swings it right round.
      if (!packedNear(a.getUint32(at + 4, true), b.getUint32(at + 4, true), STEPS.normal)) return false;
    }
  }
  const fk = lodSkin(fp, f), kk = lodSkin(kp, k);
  if (fk && kk) {
    for (let v = 0; v < f.vertexCount; v++) {
      const at = v * SKIN_BYTES;
      for (let j = 0; j < 4; j++) if (fk[at + j] !== kk[at + j] || Math.abs(fk[at + 4 + j]! - kk[at + 4 + j]!) > STEPS.weight) return false;
    }
  }
  return true;
}

function meshAlike(fp: Pack, f: PackMesh, kp: Pack, k: PackMesh): boolean {
  if (f.lods.length !== k.lods.length || f.flat !== k.flat || f.skeleton !== k.skeleton || !!f.seeThrough !== !!k.seeThrough) return false;
  if (fp.header.rigs[f.rig ?? -1]?.id !== kp.header.rigs[k.rig ?? -1]?.id) return false;
  if (!near(f.center, k.center, BOUNDS) || !near(f.half, k.half, BOUNDS) || !near(f.uv ?? null, k.uv ?? null, 1e-6) || !near(f.collider ?? null, k.collider ?? null, 1e-5)) return false;
  return f.lods.every((lod, level) => levelAlike(fp, lod, kp, k.lods[level]!));
}

/** The least share of a mesh's finest vertices that must be found in the other build for the two to be one shape. */
const SHAPE = 0.98;

/**
 * Whether two builds of a mesh are one shape lit alike with its texture layout moved, whatever the order and number of
 * their vertices (a seam cut elsewhere splits other vertices). Judged at the finest level, on the same bounds, since a
 * stored position means nothing without them. A vertex's colour is not compared: it is read from the picture at the
 * vertex's texture coordinates, so a layout the pictures were not painted for reads it from the wrong place. That is
 * also why the layout must be seen to have moved: on a layout that stands, another colour is somebody's change. It is
 * seen in a fiftieth of the vertices lying elsewhere on the picture, or `known` from the model's own check of its layout
 * against the one its pictures were painted for, which a few charts out of hundreds are enough to fail (a car's and a
 * boat's moved on 0.3 to 3 in a hundred of their vertices between the Mac and the server).
 */
function sameShape(fp: Pack, f: PackMesh, kp: Pack, k: PackMesh, known: boolean): boolean {
  if (f.flat !== k.flat || f.skeleton !== k.skeleton || !near(f.center, k.center, BOUNDS) || !near(f.half, k.half, BOUNDS)) return false;
  const a = f.lods[0]!, b = k.lods[0]!;
  const fs = lodSurface(fp, a), ks = lodSurface(kp, b);
  // Without texture coordinates there is no layout to have moved.
  if (!fs || !ks) return false;
  /** By position and bone as stored: the normals and the texture coordinates met there. */
  const rows = (pack: Pack, lod: PackLod, surface: Uint8Array): Map<string, number[]> => {
    const v = lodVertices(pack, lod), view = new DataView(surface.buffer, surface.byteOffset, surface.byteLength), out = new Map<string, number[]>();
    for (let i = 0; i < lod.vertexCount; i++) {
      const at = i * VERTEX_BYTES;
      const key = String.fromCharCode(v[at]!, v[at + 1]!, v[at + 2]!, v[at + 3]!, v[at + 4]!, v[at + 5]!, v[at + 7]!);
      const row = [view.getUint32(i * SURFACE_BYTES + 4, true) & 0x3fffffff, view.getUint16(i * SURFACE_BYTES, true), view.getUint16(i * SURFACE_BYTES + 2, true)];
      const list = out.get(key);
      if (list) list.push(...row);
      else out.set(key, row);
    }
    return out;
  };
  const mine = rows(fp, a, fs), theirs = rows(kp, b, ks);
  let moved = 0;
  const found = (from: Map<string, number[]>, to: Map<string, number[]>, count: boolean): number => {
    let n = 0;
    for (const [key, here] of from) {
      const there = to.get(key);
      if (!there) continue;
      // A corner where charts meet is several vertices in one place, and each is asked on its own where it lies on
      // the picture: one chart of the three moving is a layout that moved.
      let lit = false, astray = false;
      for (let i = 0; i < here.length; i += 3) {
        let placed = false;
        for (let j = 0; j < there.length; j += 3) {
          // A normal within eight of its 1,023 steps a part: under a degree.
          if (packedNear(here[i]!, there[j]!, 8)) lit = true;
          if (Math.abs(here[i + 1]! - there[j + 1]!) <= STEPS.uv && Math.abs(here[i + 2]! - there[j + 2]!) <= STEPS.uv) placed = true;
        }
        if (!placed) astray = true;
      }
      if (lit) n++;
      if (count && astray) moved++;
    }
    return n / Math.max(1, from.size);
  };
  return found(mine, theirs, true) >= SHAPE && found(theirs, mine, false) >= SHAPE && (known ? moved > 0 : moved >= (1 - SHAPE) * mine.size);
}

/** A rig less what is searched for from its meshes, which is kept with the meshes or made again with them. */
const measures = (rig: PackRig): unknown => ({ ...rig, grips: undefined });

export interface Settled {
  /** The pack to write: the committed file itself where nothing in it is new. */
  readonly file: Uint8Array;
  /** Ids of the meshes kept as committed, and of those made anew or not in the committed pack. */
  readonly kept: readonly string[];
  readonly made: readonly string[];
  /** Of `kept`, those this build gave another texture layout or was told to keep, which it would otherwise have made anew. */
  readonly layout: readonly string[];
  readonly told: readonly string[];
  /** The rigs and clips made anew, by id. */
  readonly rigs: readonly string[];
  readonly clips: readonly string[];
}

/**
 * `fresh` with every mesh, rig and clip that is `committed`'s to within rounding taken from `committed` as it stands.
 * A mesh is kept whole or not at all, since its levels share its bounds. A rig is kept where its measures are the same
 * and every mesh on it is kept, and then with the grips it has: they are a search's answer, and the same hand is to
 * have the same one. Where everything is kept and the rest of the two headers agrees, the committed file is returned.
 */
export interface SettleOptions {
  /** Mesh ids, or the start of them, to keep as committed whatever this build made of them. */
  readonly keep?: readonly string[];
  /** Take this build's texture layout where it moved on an unchanged shape: its pictures are being painted again. */
  readonly relayout?: boolean;
  /** The model's own check found its layout is not the one its pictures were painted for. */
  readonly layoutMoved?: boolean;
}

export function settlePack(fresh: Uint8Array, committed: Uint8Array, options: SettleOptions = {}): Settled {
  const f = parsePack(fresh), k = parsePack(committed);
  const header = structuredClone(f.header) as PackHeader;
  const out = new PackBlob();
  header.paletteOffset = out.append(f.palette);
  if (header.details) header.details.atlas.offset = out.append(detailsAtlas(f));
  const kept: string[] = [], made: string[] = [], layout: string[] = [], told: string[] = [];
  const keptMesh = new Uint8Array(header.meshes.length);
  header.meshes.forEach((mesh, i) => {
    const was = k.meshIndex.get(mesh.id);
    let same = was !== undefined && meshAlike(f, f.header.meshes[i]!, k, k.header.meshes[was]!);
    if (!same && was !== undefined) {
      if (options.keep?.some((id) => mesh.id.startsWith(id))) {
        same = true;
        told.push(mesh.id);
      } else if (!options.relayout && sameShape(f, f.header.meshes[i]!, k, k.header.meshes[was]!, options.layoutMoved === true)) {
        same = true;
        layout.push(mesh.id);
      }
    }
    const from = same ? k : f;
    const source = same ? k.header.meshes[was!]! : f.header.meshes[i]!;
    if (same) {
      // The committed mesh as it is, on this pack's rig of the same name.
      header.meshes[i] = { ...structuredClone(source), ...(mesh.rig === undefined ? {} : { rig: mesh.rig }) };
      keptMesh[i] = 1;
      kept.push(mesh.id);
    } else made.push(mesh.id);
    header.meshes[i]!.lods.forEach((lod, level) => {
      const at = source.lods[level]!;
      lod.indexOffset = out.append(lodIndices(from, at));
      lod.vertexOffset = out.append(lodVertices(from, at));
      const surface = lodSurface(from, at), skin = lodSkin(from, at);
      if (surface) lod.surfaceOffset = out.append(surface);
      if (skin) lod.skinOffset = out.append(skin);
    });
  });
  const rigs: string[] = [];
  header.rigs.forEach((rig, r) => {
    const was = k.header.rigs.find((x) => x.id === rig.id);
    const meshesKept = header.meshes.every((m, i) => m.rig !== r || keptMesh[i] === 1);
    if (was && meshesKept && near(measures(rig), measures(was), RIG)) header.rigs[r] = structuredClone(was);
    else rigs.push(rig.id);
  });
  const clips: string[] = [];
  header.clips.forEach((clip, c) => {
    const was = k.header.clips.findIndex((x) => x.id === clip.id);
    const mine = f.clips.clips[c]!, theirs = was < 0 ? null : k.clips.clips[was]!;
    const same = theirs !== null && mine.bones === theirs.bones && mine.frames === theirs.frames && mine.loop === theirs.loop
      && mine.rot.every((v, i) => Math.abs(v - theirs.rot[i]!) <= CLIP_ROT) && mine.root.every((v, i) => Math.abs(v - theirs.root[i]!) <= CLIP_ROOT);
    const from = same ? k : f, at = same ? k.header.clips[was]! : f.header.clips[c]!;
    if (!same) clips.push(clip.id);
    clip.rotOffset = out.append(from.blob.subarray(at.rotOffset, at.rotOffset + at.frames * clipRotBytes(at.bones)));
    clip.rootOffset = out.append(from.blob.subarray(at.rootOffset, at.rootOffset + at.frames * CLIP_ROOT_BYTES));
  });
  // What is measured from the meshes is the committed pack's when all of them are: a material's span.
  if (made.length === 0 && header.materials && k.header.materials) {
    header.materials.forEach((material, m) => {
      const was = k.header.materials!.find((x) => x.id === material.id);
      if (was && JSON.stringify({ ...material, span: 0 }) === JSON.stringify({ ...was, span: 0 })) header.materials![m] = structuredClone(was);
    });
  }
  // Nothing new, nothing gone and the rest of what the headers say alike: the committed file, not a file like it.
  const rest = (h: PackHeader): string => JSON.stringify({ materials: h.materials, textures: h.textures, finishes: h.finishes, landmarks: h.landmarks, details: h.details && { ...h.details, atlas: { ...h.details.atlas, offset: 0 } } });
  const whole = made.length === 0 && rigs.length === 0 && clips.length === 0
    && f.header.meshes.length === k.header.meshes.length && f.header.rigs.length === k.header.rigs.length && f.header.clips.length === k.header.clips.length
    && rest(header) === rest(k.header) && sameBytes(f.palette, k.palette) && sameBytes(detailsAtlas(f), detailsAtlas(k));
  return { file: whole ? committed : out.file(header), kept, made, layout, told, rigs, clips };
}
