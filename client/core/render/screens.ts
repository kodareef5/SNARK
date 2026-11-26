// Screens on props: each frame, the faces of the structures near enough whose kind has a screen (Registry.screenFace),
// nearest first. A chunk the client holds is read from its table, as it stands now, so a broken billboard shows nothing;
// any other is read from the map's statics (the far city's), as the map placed it, so billboards are found as far as
// they reach. Faces turned away, out of view or out of their type's reach are left out. What each shows, and its
// pictures, are decided in video/faces.ts; the quads are written here.

import { CHUNK_SIZE } from "../../../shared/coords.ts";
import { SCREENS } from "../../../shared/video/clip.ts";
import type { ScreenFace } from "../../../shared/video/face.ts";
import type { CitySquare, CityStatics } from "../../../shared/world/city.ts";
import type { ChunkTable, StructureStore } from "../../../shared/world/structures.ts";
import type { Camera } from "./camera.ts";
import { FACE, FACE_CRT, FACE_FLOATS, FACE_HIGH, FACE_LED, FACE_TOP, FACE_TOP_BEFORE, FACE_WIDE, MAX_FACES, type FramePacket } from "./packet.ts";

/** Metres a quad stands off its face, toward the eye's side, so the mesh's own face never shows through it. */
export const FACE_LIFT = 0.02;
/** The share of a type's reach over which its faces fade out. */
export const REACH_FADE = 0.1;
const TAU = 2 * Math.PI;
/** The type that reaches as far as `reach` says; every other reaches as far as `near`. */
const BILLBOARD = SCREENS.indexOf("billboard");

/** What the faces are found in: the structures the client holds, and the map's statics where it has them. */
export interface FaceWorld {
  readonly structs: StructureStore;
  readonly statics?: CityStatics | null;
}

/** How far each type is drawn, and how many are kept: a tier's (tiers.ts `screens`). */
export interface FaceReach {
  readonly reach: number;
  readonly near: number;
  readonly count: number;
}

/**
 * The screens found in a frame, nearest first, at most MAX_FACES: each one's ref (its chunk times 65,536 and its slot),
 * kind, type (its place in SCREENS), where its structure stands and turns, and how far its face's middle is. `seen`
 * counts every one in reach and in view, kept or not.
 */
export class FaceList {
  count = 0;
  seen = 0;
  readonly ref = new Float64Array(MAX_FACES);
  readonly kind = new Uint16Array(MAX_FACES);
  readonly type = new Uint8Array(MAX_FACES);
  readonly x = new Float64Array(MAX_FACES);
  readonly y = new Float64Array(MAX_FACES);
  readonly z = new Float64Array(MAX_FACES);
  readonly yaw = new Float64Array(MAX_FACES);
  readonly distance = new Float64Array(MAX_FACES);
  /** 1 at the edge of its type's reach, falling to 0 at the reach. */
  readonly fade = new Float64Array(MAX_FACES);
}

/** The slots of a chunk's table whose kind has a face, kept while the table and its version are the same. */
interface Held {
  table: ChunkTable | null;
  version: number;
  slots: Uint16Array;
}
const NONE = new Uint16Array(0);

export class FaceFinder {
  readonly list = new FaceList();
  private readonly faces: readonly (ScreenFace | null)[];
  /** By kind, its type's place in SCREENS, or 0 where it has no face. */
  private readonly typeOf: Uint8Array;
  /** The map's statics, a square a sector, and each square's rows that have a face. */
  private statics: CityStatics | null = null;
  private faced = new WeakMap<CitySquare, { first: Uint32Array; rows: Uint32Array }>();
  private held: Held[] = [];

  constructor(faces: readonly (ScreenFace | null)[]) {
    this.faces = faces;
    this.typeOf = Uint8Array.from(faces, (f) => (f ? SCREENS.indexOf(f.type) : 0));
    this.any = this.typeOf.some((t) => t > 0);
  }

  /** Whether any kind has a face at all. */
  readonly any: boolean;

  /** The face of `kind`, or null. */
  face(kind: number): ScreenFace | null {
    return this.faces[kind] ?? null;
  }

  /**
   * Finds the faces in reach of `cam`, in view and turned to it, the nearest `MAX_FACES` of them in `list`. It makes
   * nothing but where a chunk's table has changed or the map's statics are new.
   */
  find(world: FaceWorld, cam: Camera, reach: FaceReach): FaceList {
    const list = this.list, dims = world.structs.dims;
    list.count = list.seen = 0;
    if (reach.reach <= 0 && reach.near <= 0) return list;
    if ((world.statics ?? null) !== this.statics) this.index(world.statics ?? null);
    const far = Math.max(reach.reach, reach.near);
    const c0 = Math.max(0, Math.floor((cam.x - far) / CHUNK_SIZE)), c1 = Math.min(dims.chunksX - 1, Math.floor((cam.x + far) / CHUNK_SIZE));
    const r0 = Math.max(0, Math.floor((cam.z - far) / CHUNK_SIZE)), r1 = Math.min(dims.chunksZ - 1, Math.floor((cam.z + far) / CHUNK_SIZE));
    const city = this.statics;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const chunk = r * dims.chunksX + c, t = world.structs.chunks[chunk] ?? null;
        if (t && t.high > 0) {
          const slots = this.slotsOf(chunk, t);
          for (let i = 0; i < slots.length; i++) {
            const s = slots[i]!;
            this.consider(cam, reach, chunk * 65536 + s, t.kind[s]!, t.x[s]!, t.y[s]!, t.z[s]!, (t.yaw[s]! / 65536) * TAU);
          }
        } else if (city) {
          const square = city.squareOf(chunk);
          if (!square) continue;
          const m = square.map, from = square.mapFrom(chunk), faced = this.facedOf(square, city.bentKind), at = square.at(chunk);
          for (let k = faced.first[at]!; k < faced.first[at + 1]!; k++) {
            const row = faced.rows[k]!, kind = city.bentKind[m.kind[row]!]!;
            this.consider(cam, reach, chunk * 65536 + (row - from), kind, m.x[row]!, m.y[row]!, m.z[row]!, (m.yaw[row]! / 65536) * TAU);
          }
        }
      }
    }
    return list;
  }

  /** One face: kept in its place by distance where it is in reach, in view and turned to the eye. */
  private consider(cam: Camera, reach: FaceReach, ref: number, kind: number, x: number, y: number, z: number, yaw: number): void {
    const face = this.faces[kind];
    if (!face) return;
    const type = this.typeOf[kind]!, range = type === BILLBOARD ? reach.reach : reach.near;
    const r = face.face, x0 = r[0], x1 = r[1], y0 = r[2], y1 = r[3], fz = r[4];
    const s = Math.sin(yaw), c = Math.cos(yaw);
    // The face's middle, camera-relative, and the way it faces: local +z is (sin yaw, cos yaw).
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const px = x + mx * c + fz * s - cam.x, py = y + my - cam.y, pz = z - mx * s + fz * c - cam.z;
    const d = Math.hypot(px, py, pz);
    if (d >= range || s * px + c * pz >= 0) return;
    const hw = (x1 - x0) / 2, hh = (y1 - y0) / 2, ex = Math.abs(hw * c), ez = Math.abs(hw * s);
    if (!cam.boxVisible(px - ex, py - hh, pz - ez, px + ex, py + hh, pz + ez)) return;
    const list = this.list;
    list.seen++;
    // Kept in order, nearest first: where it goes, the rest moved one along.
    let at = list.count;
    while (at > 0 && list.distance[at - 1]! > d) at--;
    if (at >= MAX_FACES) return;
    const end = Math.min(list.count, MAX_FACES - 1);
    for (let k = end; k > at; k--) {
      list.ref[k] = list.ref[k - 1]!;
      list.kind[k] = list.kind[k - 1]!;
      list.type[k] = list.type[k - 1]!;
      list.x[k] = list.x[k - 1]!;
      list.y[k] = list.y[k - 1]!;
      list.z[k] = list.z[k - 1]!;
      list.yaw[k] = list.yaw[k - 1]!;
      list.distance[k] = list.distance[k - 1]!;
      list.fade[k] = list.fade[k - 1]!;
    }
    list.ref[at] = ref;
    list.kind[at] = kind;
    list.type[at] = type;
    list.x[at] = x;
    list.y[at] = y;
    list.z[at] = z;
    list.yaw[at] = yaw;
    list.distance[at] = d;
    list.fade[at] = Math.min(1, (range - d) / (range * REACH_FADE));
    list.count = end + 1;
  }

  /** The slots of `t` whose kind has a face, found again where the table or its version has changed. */
  private slotsOf(chunk: number, t: ChunkTable): Uint16Array {
    const h = this.held[chunk];
    if (h && h.table === t && h.version === t.version) return h.slots;
    let n = 0;
    for (let s = 0; s < t.high; s++) if (this.typeOf[t.kind[s]!]! > 0) n++;
    const slots = n > 0 ? new Uint16Array(n) : NONE;
    for (let s = 0, k = 0; s < t.high && k < n; s++) if (this.typeOf[t.kind[s]!]! > 0) slots[k++] = s;
    this.held[chunk] = { table: t, version: t.version, slots };
    return slots;
  }

  /** A new map's statics: what was found in the last is let go. */
  private index(statics: CityStatics | null): void {
    this.statics = statics;
    this.held = [];
    this.faced = new WeakMap();
  }

  /** A square's map rows that have a face, by its chunks: rows `first[k]` up to `first[k + 1]` of `rows`. */
  private facedOf(square: CitySquare, registryKinds: Uint16Array): { first: Uint32Array; rows: Uint32Array } {
    const known = this.faced.get(square);
    if (known) return known;
    const m = square.map, chunks = m.first.length - 1, first = new Uint32Array(chunks + 1);
    const rows: number[] = [];
    for (let c = 0; c < chunks; c++) {
      first[c] = rows.length;
      for (let r = m.first[c]!; r < m.first[c + 1]!; r++) {
        const kind = registryKinds[m.kind[r]!]!;
        if (this.typeOf[kind]! > 0) rows.push(r);
      }
    }
    first[chunks] = rows.length;
    const made = { first, rows: Uint32Array.from(rows) };
    this.faced.set(square, made);
    return made;
  }
}

/** What a face shows this frame: its layers, crops, change and colours, as video/faces.ts decides them. */
export interface FaceShow {
  /** The layer of the picture shown and of the one before, -1 for none. */
  layer: number;
  before: number;
  /** How far the change from the one before has come, 0 to 1. */
  wipe: number;
  /** The crops (s and t scale, then offset) of each. */
  readonly crop: Float64Array;
  readonly cropBefore: Float64Array;
  /** The mean colours of each, as sRGB bytes in a word. */
  mean: number;
  meanBefore: number;
  /** The last level of each one's layer that holds its picture. */
  top: number;
  topBefore: number;
}

/**
 * Face `i` of `list` into the packet's faces, as packet.ts FACE lays them out, `bright` its brightness: its corner and
 * sides camera-relative, stood FACE_LIFT off its face.
 */
export function writeFace(p: FramePacket, list: FaceList, i: number, face: ScreenFace, cam: Camera, show: FaceShow, bright: number): void {
  const at = p.faceCount * FACE_FLOATS, f = p.faces, w = p.faceWords;
  const r = face.face, x0 = r[0], x1 = r[1], y0 = r[2], y1 = r[3], fz = r[4];
  const yaw = list.yaw[i]!, s = Math.sin(yaw), c = Math.cos(yaw), z = fz + FACE_LIFT;
  f[at + FACE.corner] = list.x[i]! + x0 * c + z * s - cam.x;
  f[at + FACE.corner + 1] = list.y[i]! + y0 - cam.y;
  f[at + FACE.corner + 2] = list.z[i]! - x0 * s + z * c - cam.z;
  f[at + FACE.across] = (x1 - x0) * c;
  f[at + FACE.across + 1] = 0;
  f[at + FACE.across + 2] = -(x1 - x0) * s;
  f[at + FACE.up] = 0;
  f[at + FACE.up + 1] = y1 - y0;
  f[at + FACE.up + 2] = 0;
  for (let k = 0; k < 4; k++) {
    f[at + FACE.crop + k] = show.crop[k]!;
    f[at + FACE.cropBefore + k] = show.cropBefore[k]!;
  }
  f[at + FACE.layer] = show.layer;
  f[at + FACE.before] = show.before;
  f[at + FACE.wipe] = show.wipe;
  f[at + FACE.bright] = bright;
  w[at + FACE.flags] = (face.led ? FACE_LED : 0) | (face.crt ? FACE_CRT : 0) | (show.top << FACE_TOP) | (show.topBefore << FACE_TOP_BEFORE);
  w[at + FACE.mean] = show.mean;
  w[at + FACE.meanBefore] = show.meanBefore;
  p.faceCount++;
}

/** The level of a picture's layer read on face `face` cropped by `crop`, `metres` a pixel spans there: as the program finds it. */
export function faceLevel(face: ScreenFace, crop: Float64Array, metres: number): number {
  const r = face.face, texels = Math.max((FACE_WIDE * crop[0]!) / (r[1] - r[0]), (FACE_HIGH * crop[1]!) / (r[3] - r[2]));
  return Math.log2(Math.max(metres * texels, 1e-6));
}
