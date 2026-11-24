// The wiki renders its subjects from the built meshes and caches by every input to the shot.

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
import { iconShot, rgbaTextures, type IconFraming } from "../pack/icons.ts";
import { indexedPng } from "./quantize.ts";
import { ModelView } from "../snap.ts";
import { PICK_SKY } from "../snap/raster.ts";
import { meshPack, type Built } from "./built.ts";
import { GROUP_HEIGHT, GROUP_WIDTH, groupVanity, ITEM_CUTOUT, swatchCutout, vanity, type GroupDirection, type ItemDirection } from "./item-shots.ts";
import { encodePng } from "../snap/png.ts";
import { cast, daylight, finishPlate, graphite, olive, paper, stone, type Cutout, type Photograph, type Stage } from "./photography.ts";
import { deflateSync, inflateSync } from "node:zlib";
import type { Entry } from "./catalogue.ts";
import type { Image } from "./html.ts";

const CACHE = resolve(import.meta.dir, "../../.cache/wiki/posters");
const DRAWN_BY = ["posters.ts", "photography.ts", "built.ts", "quantize.ts", "../snap.ts", "../snap/raster.ts", "../snap/png.ts", "../pack/icons.ts"];
const BODY = [832, 624] as const;
const FOV = 0.36;
export const CARD = 240;

interface Direction {
  surface: Stage;
  angles: readonly (readonly [around: number, above: number])[];
  clip?: string;
  exposure?: number;
}

const creatures: Direction = { surface: paper, angles: [[42, 13], [112, 9]], exposure: 1.03 };
const vehicles: Direction = { surface: daylight, angles: [[40, 16], [113, 17]] };
const models: Readonly<Record<string, Direction>> = {
  creatures,
  vehicles,
  characters: { surface: graphite, angles: [[23, 5], [110, 6]], exposure: 1 },
  resources: { surface: olive, angles: [[33, 18]], exposure: 0.97 },
  landmarks: { surface: daylight, angles: [[55, 19], [89, 26]] },
};

const bySubject: Readonly<Record<string, Direction>> = {
  "core:raptor": { ...creatures, angles: [[61, 9], [138, 12]] },
  "core:rex": { ...creatures, angles: [[56, 8], [101, 10]] },
  "core:dodo": { ...creatures, angles: [[22, 10], [110, 12]] },
  "core:brachio": { ...creatures, angles: [[58, 9], [99, 12]] },
  "core:pteranodon": { ...creatures, angles: [[36, 18], [104, 24]], clip: "glide" },
  "core:air_carrier": { ...vehicles, angles: [[47, 18], [124, 27]] },
  "core:helicopter": { ...vehicles, angles: [[41, 19], [132, 24]] },
  "core:needle": { ...vehicles, angles: [[48, 18], [116, 31]] },
  koru: { surface: daylight, angles: [[64, 13], [94, 22]] },
  cruise: { surface: daylight, angles: [[56, 24], [104, 31]] },
};

export function cataloguePortraits(entries: readonly Entry[]): Subject[] {
  return entries.flatMap((e) => e.kind === "items" || !e.picture ? [] : [{
    key: e.id.replace(/[:/]/g, "-"),
    ...e.picture,
    photo: bySubject[e.id] ?? models[e.kind] ?? { surface: stone, angles: [[40, 16], [103, 17]] },
  }]);
}

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
  photo?: Direction;
  item?: ItemDirection;
  group?: GroupDirection;
}

export type Picture = Image;

export interface Drawn {
  views: Picture[];
  card: Picture;
}

let drawnBy: string | null = null;
let directedBy: string | null = null;

function keyOf(b: Built, s: Subject, encoder: string): string {
  const h = createHash("sha256").update((drawnBy ??= DRAWN_BY.map((f) => readFileSync(join(import.meta.dir, f), "utf8")).join("\0")));
  h.update(JSON.stringify([s.meshes, s.colors, s.body, s.framing ?? null, b.manifest.clipHash, ...(s.sides || s.places ? [s.sides ?? null, s.places ?? null] : [])]));
  h.update(b.boot.palette);
  h.update(JSON.stringify([s.photo, s.group?.layout, encoder]));
  if (s.item || s.group) {
    h.update(directedBy ??= ["item-shots.ts", "../snap/font.ts"].map((f) => readFileSync(join(import.meta.dir, f), "utf8")).join("\0"));
    h.update(JSON.stringify(s.item ?? s.group?.surface));
    for (const member of s.group?.members ?? []) h.update(keyOf(b, member, encoder));
  }
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
function posed(pack: Pack, move = "idle"): Rig | null {
  const r = pack.header.meshes[0]!.rig;
  const found = r === undefined ? undefined : pack.header.rigs[r];
  if (!found) return null;
  const whole: PackRig = found.names ? found : { ...found, names: [...HUMAN.names], parent: [...HUMAN.parent] };
  const rig = buildRig(whole, pack.clips);
  if (!rig) return null;
  const name = found.skeleton === "human" ? "human" : found.id;
  const clip = pack.clips.clips[pack.clips.index.get(`${name}/${move}`) ?? pack.clips.index.get(`${name}/idle`) ?? -1];
  const pose = new Pose(rig.bones);
  if (clip && clip.bones === rig.bones) sampleClip(clip, 0, pose);
  pose.root.fill(0);
  solve(rig, pose, rig.solved);
  return rig;
}

/** Every vertex of the pack's meshes, skinned by `rig` where they have one, or each where `places` stands it, as x, y, z. */
function points(pack: Pack, rig: Rig | null, places?: Subject["places"]): number[] {
  const out: number[] = [];
  const placed = new Map<number, { x: number; y: number; z: number; s: number; c: number }[]>();
  for (const [mesh, x, y, z, yaw] of places ?? []) {
    const angle = yaw / 65536 * Math.PI * 2;
    const list = placed.get(mesh) ?? [];
    list.push({ x, y, z, s: Math.sin(angle), c: Math.cos(angle) });
    placed.set(mesh, list);
  }
  for (const [i, m] of pack.header.meshes.entries()) {
    const instances = placed.get(i) ?? [];
    const lod = m.lods[0]!;
    const raw = lodVertices(pack, lod);
    const skin = lodSkin(pack, lod);
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let v = 0; v < lod.vertexCount; v++) {
      const p = [0, 1, 2].map((a) => m.center[a]! + (view.getInt16(v * VERTEX_BYTES + a * 2, true) / 32767) * m.half[a]!);
      if (places) {
        for (const { x, y, z, s, c } of instances) out.push(c * p[0]! + s * p[2]! + x, p[1]! + y, -s * p[0]! + c * p[2]! + z);
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

/** Fit the full projected silhouette with a deliberate margin on each edge. */
export function fitPortrait(at: readonly number[], around: number, above: number, aspect: number, roll = 0, margin = 0.075): { centre: [number, number, number]; radius: number; distance: number } {
  const [a, e] = [around * Math.PI / 180, above * Math.PI / 180];
  const right = [Math.cos(a), 0, -Math.sin(a)];
  const up = [-Math.sin(a) * Math.sin(e), Math.cos(e), -Math.cos(a) * Math.sin(e)];
  const out = [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
  const c = Math.cos(roll), s = Math.sin(roll);
  const rows = [right.map((v, k) => v * c - up[k]! * s), up.map((v, k) => v * c + right[k]! * s), out];
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  const shown = new Float64Array(at.length);
  for (let k = 0; k < at.length; k += 3) {
    for (let d = 0; d < 3; d++) {
      const axis = rows[d]!;
      const p = at[k]! * axis[0]! + at[k + 1]! * axis[1]! + at[k + 2]! * axis[2]!;
      shown[k + d] = p;
      low[d] = Math.min(low[d]!, p);
      high[d] = Math.max(high[d]!, p);
    }
  }
  const mid = low.map((v, k) => (v + high[k]!) * 0.5);
  const centre = [0, 1, 2].map((k) => rows.reduce((v, a, d) => v + a[k]! * mid[d]!, 0)) as [number, number, number];
  const extent = low.map((v, k) => (high[k]! - v) * 0.5);
  const half = Math.tan(FOV / 2) * (1 - margin * 2);
  let distance = 0.1;
  for (let k = 0; k < shown.length; k += 3) {
    const x = Math.abs(shown[k]! - mid[0]!) / (half * aspect);
    const y = Math.abs(shown[k + 1]! - mid[1]!) / half;
    distance = Math.max(distance, Math.max(x, y) + shown[k + 2]! - mid[2]!);
  }
  return { centre, radius: Math.max(0.045, Math.hypot(...extent)), distance };
}

function removeBackdrop(view: ModelView): Uint8Array {
  const pixels = new Uint8Array(view.raster.color);
  const kinds = view.raster.pickKind;
  for (let i = 0; i < kinds.length; i++) pixels[i * 4 + 3] = kinds[i] === PICK_SKY ? 0 : 255;
  return pixels;
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

function studio(b: Built, pack: Pack, width: number, height: number): ModelView {
  const view = new ModelView(pack, width, height, [0, 0, 0]);
  const textures = rgbaTextures(b.manifest, (f, at, n) => b.read(f, at, n));
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
  return view;
}

interface CameraShot { around: number; above: number; roll: number; margin: number }

function capture(s: Subject, view: ModelView, at: readonly number[], rig: Rig | null, camera: CameraShot, surface: Stage): Cutout {
  const { around, above, margin, roll } = camera;
  const { width, height } = view.raster;
  const { centre, radius, distance } = fitPortrait(at, around, above, width / height, roll, margin);
  const parts = s.places ? { mesh: s.places[0]![0], placed: s.places } : { mesh: 0, also: s.meshes.slice(1).map((_, k) => k + 1) };
  let bottom = Infinity;
  for (let i = 1; i < at.length; i += 3) bottom = Math.min(bottom, at[i]!);
  view.draw({
    ...parts, level: 0, around, above, centre, radius, rig, colors: s.colors, textured: true,
    keyLight: surface.key, perspective: { distance, fovY: FOV }, studio: { roll, exposure: s.photo?.exposure },
  });
  return {
    rgba: removeBackdrop(view),
    shadow: cast(view, width, height, bottom - (s.photo?.clip ? 0.045 * radius : 0), around, surface.key),
    width, height,
  };
}

function drawModel(b: Built, s: Subject): Photograph[] {
  const pack = meshPack(b, s.meshes);
  const direction = s.photo ?? { surface: paper, angles: [[40, 15], [106, 12]] };
  const [width, height] = BODY;
  const view = studio(b, pack, width, height);
  const rig = s.places ? null : posed(pack, s.photo?.clip);
  const at = points(pack, rig, s.places);
  return direction.angles.slice(0, s.sides ?? direction.angles.length).map(([around, above]) =>
    finishPlate(capture(s, view, at, rig, { around: around!, above: above!, roll: 0, margin: 0.075 }, direction.surface), direction.surface));
}

/** Bring two disconnected hand meshes in from their positions on the reference body. */
export function spacePair(xs: Float64Array, middle: number): boolean {
  let innerLeft = -Infinity, outerLeft = Infinity, innerRight = Infinity, outerRight = -Infinity;
  for (const x of xs) {
    if (x < middle) {
      innerLeft = Math.max(innerLeft, x);
      outerLeft = Math.min(outerLeft, x);
    } else {
      innerRight = Math.min(innerRight, x);
      outerRight = Math.max(outerRight, x);
    }
  }
  const one = Math.max(innerLeft - outerLeft, outerRight - innerRight);
  if (!(Number.isFinite(one) && one > 0 && innerRight - innerLeft > one * 0.8)) return false;
  const gap = 0.38 * one;
  const left = middle - gap / 2 - innerLeft, right = middle + gap / 2 - innerRight;
  for (let i = 0; i < xs.length; i++) xs[i] = xs[i]! + (xs[i]! < middle ? left : right);
  return true;
}

function arrangeHands(pack: Pack): void {
  const mesh = pack.header.meshes[0]!, lod = mesh.lods[0]!;
  const raw = lodVertices(pack, lod);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const xs = Float64Array.from({ length: lod.vertexCount }, (_, i) => mesh.center[0] + view.getInt16(i * VERTEX_BYTES, true) * mesh.half[0] / 32767);
  if (!spacePair(xs, mesh.center[0])) return;
  let low = Infinity, high = -Infinity;
  for (const x of xs) [low, high] = [Math.min(low, x), Math.max(high, x)];
  const middle = (low + high) / 2, half = (high - low) / 2;
  mesh.center = [middle, mesh.center[1], mesh.center[2]];
  mesh.half = [half, mesh.half[1], mesh.half[2]];
  xs.forEach((x, i) => view.setInt16(i * VERTEX_BYTES, Math.round(Math.max(-1, Math.min(1, (x - middle) / half)) * 32767), true));
}

function itemCutouts(b: Built, s: Subject, key: string, leadOnly = false): Cutout[] {
  const direction = s.item!;
  if (direction.swatch) return [swatchCutout(b.boot.palette, direction.swatch)];
  const path = join(CACHE, key);
  const first = join(path, "lead.cut");
  const n = ITEM_CUTOUT, pixels = n * n * 4;
  const lead = existsSync(first) ? new Uint8Array(inflateSync(readFileSync(first))) : null;
  const cached = lead ? { width: n, height: n, rgba: lead.subarray(0, pixels), shadow: lead.subarray(pixels) } : null;
  if (cached && leadOnly) return [cached];
  const pack = meshPack(b, s.meshes);
  if (direction.pair) arrangeHands(pack);
  const view = studio(b, pack, n, n);
  const original = s.framing ?? iconShot(pack, 0);
  const around = direction.pair ? 18 : original.around + direction.azimuth;
  const above = direction.pair ? 32 : original.above + direction.elevation;
  const cameras = [[around, above], [around + (direction.azimuth > 100 ? 65 : 115), Math.min(60, above + 8)]];
  const at = points(pack, null);
  return cameras.slice(0, leadOnly ? 1 : 2).map(([around, above], k) => {
    if (k === 0 && cached) return cached;
    const shot = iconShot(pack, 0, { around: around!, above: above!, roll: direction.pair ? 0 : k === 0 ? s.framing?.roll : undefined });
    const image = capture(s, view, at, null, { around: shot.around, above: shot.above, roll: shot.roll * Math.PI / 180, margin: 0.072 }, direction.surface);
    if (k === 0) {
      mkdirSync(path, { recursive: true });
      const raw = new Uint8Array(pixels + n * n);
      raw.set(image.rgba);
      raw.set(image.shadow!, pixels);
      writeFileSync(`${first}.${process.pid}`, deflateSync(raw, { level: 3 }));
      renameSync(`${first}.${process.pid}`, first);
    }
    return image;
  });
}

function drawSubject(b: Built, s: Subject, key: string, encoder: string): Photograph[] {
  if (s.item) return itemCutouts(b, s, key).map((image, k) => vanity(image, s.item!, k > 0));
  if (s.group) {
    const cutouts = s.group.members.map((m) => itemCutouts(b, m, keyOf(b, m, encoder), true)[0]!);
    return [groupVanity(cutouts, s.group)];
  }
  return drawModel(b, s);
}

interface Encoder { name: string; extension: "png" | "webp"; encode(p: Photograph, card: boolean): Uint8Array }

function posterEncoder(): Encoder {
  const cwebp = Bun.which("cwebp");
  if (!cwebp) return { name: "indexed PNG", extension: "png", encode: (p) => indexedPng(p.width, p.height, p.rgba) };
  const version = Bun.spawnSync([cwebp, "-version"]);
  const name = `WebP ${new TextDecoder().decode(version.stdout).trim()}`;
  return {
    name, extension: "webp",
    encode(p, card) {
      const input = encodePng(p.width, p.height, p.rgba, 1);
      const encoded = Bun.spawnSync([cwebp, "-quiet", "-q", card ? "84" : "90", "-m", "4", "-sharp_yuv", "-size", String((card ? 61 : 312) * 1024), "-o", "-", "--", "-"], { stdin: input });
      if (!encoded.success) throw new Error(`could not encode the wiki photograph: ${new TextDecoder().decode(encoded.stderr)}`);
      return encoded.stdout;
    },
  };
}

/** Draws the pictures of each subject, or takes them from the cache, into `out`, named by `prefix`. */
export function drawPosters(b: Built, subjects: readonly Subject[], out: string, prefix: string): { drawn: Map<string, Drawn>; made: number } {
  mkdirSync(out, { recursive: true });
  const drawn = new Map<string, Drawn>();
  const encoder = posterEncoder();
  let made = 0;
  for (const s of subjects) {
    const key = keyOf(b, s, encoder.name);
    const dir = join(CACHE, key);
    const angles = s.item ? (s.item.swatch ? 1 : 2) : s.group ? 1 : s.sides ?? s.photo?.angles.length ?? 2;
    const views = Array.from({ length: angles }, (_, k) => `${s.key}.${key}.${k}.${encoder.extension}`);
    const card = `${s.key}.${key}.card.${encoder.extension}`;
    if (![...views, card].every((f) => existsSync(join(dir, f)))) {
      const pictures = drawSubject(b, s, key, encoder.name);
      mkdirSync(dir, { recursive: true });
      const small = scaled(pictures[0]!.rgba, pictures[0]!.width, pictures[0]!.height, CARD);
      for (const [file, p] of [...views.map((f, k) => [f, pictures[k]!] as const), [card, small] as const]) {
        writeFileSync(join(dir, `${file}.${process.pid}`), encoder.encode(p, file === card));
        renameSync(join(dir, `${file}.${process.pid}`), join(dir, file));
      }
      made++;
    }
    for (const f of [...views, card]) place(join(dir, f), join(out, f));
    const [width, height] = s.item ? [ITEM_CUTOUT, ITEM_CUTOUT] : s.group ? [GROUP_WIDTH, GROUP_HEIGHT] : BODY;
    const thumbnail = { file: `${prefix}${card}`, width: CARD, height: Math.round(height * CARD / width) };
    drawn.set(s.key, { views: views.map((f) => ({ file: `${prefix}${f}`, width, height })), card: thumbnail });
  }
  return { drawn, made };
}
