// The wiki's pictures, drawn by the software rasterizer from the game's built meshes and rgba textures, lit as
// tools/snap.ts's ModelView lights a model, on a clear ground. A body is drawn standing as its idle clip begins, and a
// thing of many pieces with each where it stands. An item is drawn as the inventory picture is, larger. Each picture has
// a card-sized copy. A picture is kept under .cache/wiki/posters by the hashes of everything it is drawn from.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { place } from "./files.ts";
import { join, resolve } from "node:path";
import { sampleClip, Pose } from "../../shared/anim/clip.ts";
import { HUMAN } from "../../shared/anim/human.ts";
import { buildRig, type Rig } from "../../shared/anim/rigs.ts";
import { solve } from "../../shared/anim/skeleton.ts";
import { VERTEX_BYTES, lodSkin, lodVertices, type Pack, type PackRig } from "../../shared/pack/pack.ts";
import { MAP_ROLES } from "../../shared/pack/texture.ts";
import { IconPainter, rgbaTextures, type IconFraming } from "../pack/icons.ts";
import { indexedPng } from "./quantize.ts";
import { ModelView } from "../snap.ts";
import { PICK_SKY } from "../snap/raster.ts";
import { meshPack, type Built } from "./built.ts";

const CACHE = resolve(import.meta.dir, "../../.cache/wiki/posters");
const DRAWN_BY = ["posters.ts", "built.ts", "quantize.ts", "../snap.ts", "../snap/raster.ts", "../pack/icons.ts"];
/** A body's picture, in pixels, drawn at SUPER times that and shrunk. An item's is square. */
const BODY = [640, 480] as const;
const ITEM = 320;
const SUPER = 2;
const MARGIN = 0.05;
/** ModelView's field of view, up and down, in radians. */
const FOV = 0.2;
/** A card's picture is this wide. */
export const CARD = 240;
/** Degrees round from the front and above: a three-quarter view and the side. */
const VIEWS: readonly (readonly [number, number])[] = [[35, 14], [90, 6]];

export interface Subject {
  /** Its file names start with this. */
  key: string;
  meshes: string[];
  colors: number[];
  /** A body is posed and drawn from two sides; anything else as its inventory picture is. */
  body: boolean;
  /** How many of the body's sides are drawn, where not both: a tree looks alike from any. */
  sides?: number;
  /** Where each of `meshes` stands, by its index: x, y, z in metres and a yaw in 1/65,536 turns, for a thing of many pieces. */
  places?: readonly (readonly [mesh: number, x: number, y: number, z: number, yaw: number])[];
  framing?: IconFraming | null;
}

export interface Picture {
  file: string;
  width: number;
  height: number;
}

export interface Drawn {
  views: Picture[];
  card: Picture;
}

let drawnBy: string | null = null;

function keyOf(b: Built, s: Subject): string {
  const h = createHash("sha256").update((drawnBy ??= DRAWN_BY.map((f) => readFileSync(join(import.meta.dir, f), "utf8")).join("\0")));
  h.update(JSON.stringify([s.meshes, s.colors, s.body, s.framing ?? null, b.manifest.clipHash, ...(s.sides || s.places ? [s.sides ?? null, s.places ?? null] : [])]));
  const materials = b.manifest.materials ?? [];
  for (const id of s.meshes) {
    const m = b.manifest.meshes.find((m) => m.id === id)!;
    h.update(JSON.stringify([m.center, m.half, m.uv ?? null, m.rig ?? null, m.levels[0]!.parts.map((p) => p.hash), m.levels[0]!.sections ?? null]));
    const runs = m.levels[0]!.sections ?? [];
    for (let k = 0; k < runs.length; k += 3) {
      const mat = materials[runs[k]!]!;
      h.update(JSON.stringify(mat));
      for (const role of MAP_ROLES) if (mat[role] >= 0) h.update((b.manifest.textures?.[mat[role]]?.in.rgba?.hash ?? []).join(","));
    }
  }
  return h.digest("hex").slice(0, 16);
}

/** The rig a body's first mesh was made on, posed as its idle clip begins, or at rest without one. */
function posed(pack: Pack): Rig | null {
  const r = pack.header.meshes[0]!.rig;
  const found = r === undefined ? undefined : pack.header.rigs[r];
  if (!found) return null;
  const whole: PackRig = found.names ? found : { ...found, names: [...HUMAN.names], parent: [...HUMAN.parent] };
  const rig = buildRig(whole, pack.clips);
  if (!rig) return null;
  const clip = pack.clips.clips[pack.clips.index.get(`${found.skeleton === "human" ? "human" : found.id}/idle`) ?? -1];
  const pose = new Pose(rig.bones);
  if (clip && clip.bones === rig.bones) sampleClip(clip, 0, pose);
  pose.root.fill(0);
  solve(rig, pose, rig.solved);
  return rig;
}

/** Every vertex of the pack's meshes, skinned by `rig` where they have one, or each where `places` stands it, as x, y, z. */
function points(pack: Pack, rig: Rig | null, places?: Subject["places"]): number[] {
  const out: number[] = [];
  for (const [i, m] of pack.header.meshes.entries()) {
    const lod = m.lods[0]!;
    const raw = lodVertices(pack, lod);
    const skin = lodSkin(pack, lod);
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let v = 0; v < lod.vertexCount; v++) {
      const p = [0, 1, 2].map((a) => m.center[a]! + (view.getInt16(v * VERTEX_BYTES + a * 2, true) / 32767) * m.half[a]!);
      if (places) {
        // Turned as the rasterizer turns an instance by its yaw.
        for (const [mesh, x, y, z, yaw] of places) {
          if (mesh !== i) continue;
          const [s, c] = [Math.sin((yaw / 65536) * Math.PI * 2), Math.cos((yaw / 65536) * Math.PI * 2)];
          out.push(c * p[0]! + s * p[2]! + x, p[1]! + y, -s * p[0]! + c * p[2]! + z);
        }
        continue;
      }
      if (!rig || !m.skeleton) {
        out.push(p[0]!, p[1]!, p[2]!);
        continue;
      }
      const q = [0, 0, 0];
      for (let k = 0; k < 4; k++) {
        const [bone, w] = skin ? [skin[v * 8 + k]!, skin[v * 8 + 4 + k]! / 255] : [raw[v * VERTEX_BYTES + 7]!, k === 0 ? 1 : 0];
        if (w === 0 || bone >= rig.bones) continue;
        const [x, y, z] = [0, 1, 2].map((a) => p[a]! - rig.rest[bone * 3 + a]!) as [number, number, number];
        const [qx, qy, qz, qw] = [0, 1, 2, 3].map((a) => rig.solved.rot[bone * 4 + a]!) as [number, number, number, number];
        const [tx, ty, tz] = [2 * (qy * z - qz * y), 2 * (qz * x - qx * z), 2 * (qx * y - qy * x)];
        q[0]! += (x + qw * tx + qy * tz - qz * ty + rig.solved.pos[bone * 3]!) * w;
        q[1]! += (y + qw * ty + qz * tx - qx * tz + rig.solved.pos[bone * 3 + 1]!) * w;
        q[2]! += (z + qw * tz + qx * ty - qy * tx + rig.solved.pos[bone * 3 + 2]!) * w;
      }
      out.push(q[0]!, q[1]!, q[2]!);
    }
  }
  return out;
}

/**
 * The point looked at and the radius ModelView takes so that the points fill the picture, `MARGIN` of it clear on each
 * side, seen from `around` and `above` degrees. Its narrow view is near enough to straight lines to fit them as such.
 */
function fit(at: readonly number[], around: number, above: number, aspect: number): { centre: [number, number, number]; radius: number } {
  const [a, e] = [(around * Math.PI) / 180, (above * Math.PI) / 180];
  const right = [Math.cos(a), 0, -Math.sin(a)];
  const up = [-Math.sin(a) * Math.sin(e), Math.cos(e), -Math.cos(a) * Math.sin(e)];
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let k = 0; k < at.length; k += 3) {
    const x = at[k]! * right[0]! + at[k + 2]! * right[2]!;
    const y = at[k]! * up[0]! + at[k + 1]! * up[1]! + at[k + 2]! * up[2]!;
    [x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)];
  }
  const [mx, my] = [(x0 + x1) / 2, (y0 + y1) / 2];
  const centre = [0, 1, 2].map((k) => right[k]! * mx + up[k]! * my) as [number, number, number];
  // ModelView fits the ball the narrower way, which is up and down in a picture wider than tall.
  const half = Math.max((y1 - y0) / 2, (x1 - x0) / 2 / aspect) / (1 - 2 * MARGIN);
  return { centre, radius: half * Math.cos(FOV / 2) };
}

/** RGBA `width` by `height` from a picture SUPER times larger: each pixel the mean of what covers it, and how much does. */
function shrink(color: ArrayLike<number>, kind: ArrayLike<number>, width: number, height: number, by: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const wide = width * by;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let [r, g, b, n] = [0, 0, 0, 0];
      for (let k = 0; k < by * by; k++) {
        const at = (y * by + Math.floor(k / by)) * wide + x * by + (k % by);
        if (kind[at] === PICK_SKY) continue;
        [r, g, b, n] = [r + color[at * 4]!, g + color[at * 4 + 1]!, b + color[at * 4 + 2]!, n + 1];
      }
      if (n === 0) continue;
      out.set([Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round((n * 255) / (by * by))], (y * width + x) * 4);
    }
  }
  return out;
}

/** A smaller copy, `width` across, each pixel the coverage-weighted mean of the pixels it covers. */
export function scaled(rgba: Uint8Array, width: number, height: number, to: number): { rgba: Uint8Array; width: number; height: number } {
  const h = Math.round((height * to) / width);
  const out = new Uint8Array(to * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < to; x++) {
      const [x0, x1] = [Math.floor((x * width) / to), Math.ceil(((x + 1) * width) / to)];
      const [y0, y1] = [Math.floor((y * height) / h), Math.ceil(((y + 1) * height) / h)];
      let [r, g, b, a, n] = [0, 0, 0, 0, 0];
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const at = (sy * width + sx) * 4;
          const w = rgba[at + 3]!;
          [r, g, b, a, n] = [r + rgba[at]! * w, g + rgba[at + 1]! * w, b + rgba[at + 2]! * w, a + w, n + 1];
        }
      }
      if (a > 0) out.set([Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round(a / n)], (y * to + x) * 4);
    }
  }
  return { rgba: out, width: to, height: h };
}

function draw(b: Built, s: Subject): { rgba: Uint8Array; width: number; height: number }[] {
  const pack = meshPack(b, s.meshes);
  const textures = rgbaTextures(b.manifest, (f, at, n) => b.read(f, at, n));
  if (!s.body) {
    const painter = new IconPainter(pack, textures, ITEM);
    return [{ rgba: painter.draw(0, s.colors, s.framing ?? null), width: ITEM, height: ITEM }];
  }
  const [w, h] = BODY;
  const view = new ModelView(pack, w * SUPER, h * SUPER, [0, 0, 0]);
  const sent = new Set<number>();
  const materials = pack.header.materials ?? [];
  for (const m of pack.header.meshes) {
    const runs = m.lods[0]!.sections ?? [];
    for (let k = 0; k < runs.length; k += 3) {
      for (const role of MAP_ROLES) {
        const t = materials[runs[k]!]![role];
        const tex = t >= 0 && !sent.has(t) ? textures(t) : null;
        if (tex) view.texture(t, tex.role, tex.pictures);
        sent.add(t);
      }
    }
  }
  const rig = s.places ? null : posed(pack);
  const at = points(pack, rig, s.places);
  return VIEWS.slice(0, s.sides ?? VIEWS.length).map(([around, above]) => {
    const { centre, radius } = fit(at, around, above, w / h);
    const parts = s.places ? { mesh: s.places[0]![0], placed: s.places } : { mesh: 0, also: pack.header.meshes.slice(1).map((_, k) => k + 1) };
    view.draw({ ...parts, level: 0, around, above, centre, radius, rig, colors: s.colors, textured: true });
    return { rgba: shrink(view.raster.color, view.raster.pickKind, w, h, SUPER), width: w, height: h };
  });
}

/** Draws the pictures of each subject, or takes them from the cache, into `out`, named by `prefix`. */
export function drawPosters(b: Built, subjects: readonly Subject[], out: string, prefix: string): { drawn: Map<string, Drawn>; made: number } {
  mkdirSync(out, { recursive: true });
  const drawn = new Map<string, Drawn>();
  let made = 0;
  for (const s of subjects) {
    const key = keyOf(b, s);
    const dir = join(CACHE, key);
    const views = Array.from({ length: s.body ? (s.sides ?? VIEWS.length) : 1 }, (_, k) => `${s.key}.${key}.${k}.png`);
    const card = `${s.key}.${key}.card.png`;
    if (![...views, card].every((f) => existsSync(join(dir, f)))) {
      const pictures = draw(b, s);
      mkdirSync(dir, { recursive: true });
      const small = scaled(pictures[0]!.rgba, pictures[0]!.width, pictures[0]!.height, CARD);
      for (const [file, p] of [...views.map((f, k) => [f, pictures[k]!] as const), [card, small] as const]) {
        writeFileSync(join(dir, `${file}.${process.pid}`), indexedPng(p.width, p.height, p.rgba));
        renameSync(join(dir, `${file}.${process.pid}`), join(dir, file));
      }
      made++;
    }
    for (const f of [...views, card]) place(join(dir, f), join(out, f));
    const size = (f: string): Picture => {
      const png = readFileSync(join(dir, f));
      return { file: `${prefix}${f}`, width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    };
    drawn.set(s.key, { views: views.map(size), card: size(card) });
  }
  return { drawn, made };
}
