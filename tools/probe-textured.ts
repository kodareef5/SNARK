// `bun run probe -- --textured`: the shell drawing with materials, held to our own decoders and to the software
// rasterizer. It serves headless Chrome a page of its own, which makes the shell's renderer (client/shell/gl.ts) for
// each texture variant the GPU takes, and with each:
//
// - Fills textures with test cards through the renderer's own path, a few rows a frame, smallest picture first, then
//   draws every picture of each a texel to a pixel and reads it back. What comes back must be what our decoders
//   (tools/pack/bc.ts, tools/pack/astc.ts) make of the same blocks: BC7 and ASTC exactly, BC5 within 2 of 255, since
//   Apple silicon blends it in 64ths where the specification has sevenths. The cards are random blocks of each BC7
//   mode and of BC5, ASTC blocks built bit by bit over every grid, weight range, endpoint mode and partition count,
//   and what our encoders make of the test card. A base colour is read through an sRGB target, so a texture made in
//   the wrong colour space does not pass either.
// - Draws a thatch house on the proving ground from the frames core builds for it here, at the medium and the high
//   tier: its levels, surfaces and textures streamed in, then the context lost and restored and everything sent
//   again. The last frame must agree with the software rasterizer drawing the same frames, with the compressed
//   variants decoded by our decoders, at points on the house away from its edges (D203).
// - Times the renderer over that frame on a small canvas, its draws repeated up to the packet's limit, with materials
//   and flat.
//
// The pictures of the house at medium and high, in the variant this device takes first, and the rasterizer's at
// medium, go to planning/reference/round7-pictures/.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { tierOf } from "../client/core/assets/tiers.ts";
import { Camera } from "../client/core/render/camera.ts";
import { BONE_FLOATS, DRAW_CUTOUT, DRAW_TEXTURED, DRAW_TWO_SIDED, type FramePacket, type TextureUpload } from "../client/core/render/packet.ts";
import { Scene } from "../client/core/render/scene.ts";
import { DOOR_HEIGHT, FLOOR_THICK, FOUNDATION_THICK, WALL_HEIGHT } from "../content/building.ts";
import { CORE_CONTENT } from "../content/core.ts";
import { compileContent } from "../shared/content/registry.ts";
import { parseManifest, type Manifest } from "../shared/pack/manifest.ts";
import { INSTANCE_BYTES, MATERIAL_CUTOUT, MATERIAL_TWO_SIDED, parsePack } from "../shared/pack/pack.ts";
import type { TextureFormat, TextureRole } from "../shared/pack/texture.ts";
import { Rng } from "../shared/rng.ts";
import { PROVING_DIMS, PROVING_SPAWN, buildProvingHeightfield } from "../shared/world/proving.ts";
import { StructureStore } from "../shared/world/structures.ts";
import { nodeForms } from "../shared/world/nodes.ts";
import { FakeNet } from "../tests/fixtures/assetnet.ts";
import { PINNED, builtBlocks } from "../tests/fixtures/astc.ts";
import { card, randomBc5, randomBc7 } from "../tests/fixtures/bc.ts";
import { describeAstcBlock, decodeAstc, encodeAstc } from "./pack/astc.ts";
import { bc7Mode, decodeBc5, decodeBc7, encodeBc5, encodeBc7 } from "./pack/bc.ts";
import { encodePng } from "./snap/png.ts";
import { PICK_STRUCTURE, Rasterizer } from "./snap/raster.ts";

const ROOT = resolve(import.meta.dir, "..");
const DIST = join(ROOT, "client/dist");
const PICTURES = join(ROOT, "planning/reference/round7-pictures");
/** The page is drawn as on a screen of two device pixels to a CSS pixel, 1280 by 720 CSS pixels: each tier at its own pixel ratio. */
const CSS = [1280, 720];
const SCREEN_RATIO = 2;
const TIERS = ["medium", "high"] as const;
/** Rows of a picture sent in one go: pixel rows in the rgba variant and block rows in the others. Odd, so that bands end mid-picture. */
const BAND = 7;
/** Where the house stands, west of the proving ground's spawn as tools/snap.ts has its house. */
const HOUSE = [PROVING_SPAWN.x - 24, PROVING_SPAWN.z - 2] as const;

/** Bytes sent to the page in one piece. Each run starts on a multiple of 4, so the page can view it as an array of any type. */
class Bytes {
  private readonly parts: Uint8Array[] = [];
  length = 0;

  add(view: ArrayBufferView): number {
    const at = this.length;
    this.parts.push(new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice());
    this.length += view.byteLength;
    const pad = (4 - (this.length & 3)) & 3;
    this.parts.push(new Uint8Array(pad));
    this.length += pad;
    return at;
  }

  join(): Uint8Array {
    return Buffer.concat(this.parts);
  }
}

// ---- Test cards ----

interface Card {
  name: string;
  role: TextureRole;
  /** Each picture as the variant stores it, smallest first, and as our decoders make it out: RGBA. */
  pictures: Uint8Array[];
  want: Uint8Array[];
  /** The most a channel may be off by, and what each block is, for the report. */
  slack: number;
  kinds?: string[];
}

const sizes = (top: number): number[] => Array.from({ length: Math.log2(top) + 1 }, (_, k) => 1 << k);
const blocksOf = (size: number): number => ((size + 3) >> 2) ** 2;

/** The test card `size` across: tests/fixtures/bc.ts's card where it has room for its bands, else a corner of the smallest. */
function cardAt(size: number, alpha: boolean): Uint8Array {
  if (size >= 8) return card(size, alpha);
  const whole = card(8, alpha);
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) out.set(whole.subarray(y * 32, y * 32 + size * 4), y * size * 4);
  return out;
}

function bcCards(): Card[] {
  const cards: Card[] = [];
  const bc7 = (pictures: Uint8Array[]): Uint8Array[] => pictures.map((p, k) => decodeBc7(p, 1 << k, 1 << k));
  for (let mode = 0; mode < 8; mode++) {
    // The 64-pixel picture holds the blocks tests/unit/bc.test.ts pins the decoding of.
    const pictures = sizes(256).map((size) => randomBc7(mode, blocksOf(size), size === 64 ? 100 + mode : 200 + mode * 16 + Math.log2(size)));
    const kinds = pictures.flatMap((p) => Array.from({ length: p.length / 16 }, (_, b) => `mode ${bc7Mode(p, b * 16)}`));
    cards.push({ name: `BC7 mode ${mode}, random bits`, role: "mro", pictures, want: bc7(pictures), slack: 0, kinds });
    cards.push({ name: `BC7 mode ${mode}, random bits, sRGB`, role: "base", pictures, want: bc7(pictures), slack: 0, kinds });
  }
  const bc5 = sizes(256).map((size) => randomBc5(blocksOf(size), 400 + size));
  cards.push({ name: "BC5, random bits", role: "normal", pictures: bc5, want: bc5.map((p, k) => decodeBc5(p, 1 << k, 1 << k)), slack: 2 });
  for (const [name, role, alpha] of [["BC7 encoder, the card", "mro", false], ["BC7 encoder, the card with alpha, sRGB", "base", true]] as const) {
    const pictures = sizes(256).map((size) => encodeBc7(cardAt(size, alpha), size, size, 4));
    cards.push({ name, role, pictures, want: bc7(pictures), slack: 0 });
  }
  const normals = sizes(256).map((size) => encodeBc5(cardAt(size, false), size, size));
  cards.push({ name: "BC5 encoder, the card", role: "normal", pictures: normals, want: normals.map((p, k) => decodeBc5(p, 1 << k, 1 << k)), slack: 2 });
  return cards;
}

function astcCards(): Card[] {
  const cards: Card[] = [];
  // Every valid block built, the set the unit test pins among them, laid over a texture's pictures and repeated to fill it.
  const built = [...builtBlocks(0x1d2c3b4a, 12), ...builtBlocks(PINNED.seed, PINNED.each)].filter((s) => s.set === "built");
  let top = 64;
  while (sizes(top).reduce((sum, size) => sum + blocksOf(size), 0) < built.length) top *= 2;
  let n = 0;
  const pictures = sizes(top).map((size) => {
    const out = new Uint8Array(blocksOf(size) * 16);
    for (let at = 0; at < out.length; at += 16) out.set(built[n++ % built.length]!.block, at);
    return out;
  });
  const kinds = pictures.flatMap((p) => Array.from({ length: p.length / 16 }, (_, b) => describeAstcBlock(p, b * 16)));
  cards.push({ name: `ASTC, ${built.length} blocks built bit by bit`, role: "mro", pictures, want: pictures.map((p, k) => decodeAstc(p, 1 << k, 1 << k, "linear")), slack: 0, kinds });
  cards.push({ name: `ASTC, ${built.length} blocks built bit by bit, sRGB`, role: "base", pictures, want: pictures.map((p, k) => decodeAstc(p, 1 << k, 1 << k, "srgb")), slack: 0, kinds });
  for (const [name, role, alpha, kind] of [["ASTC encoder, the card", "mro", false, "linear"], ["ASTC encoder, the card with alpha, sRGB", "base", true, "srgb"], ["ASTC encoder, the card as a normal", "normal", false, "normal"]] as const) {
    const pictures = sizes(256).map((size) => encodeAstc(cardAt(size, alpha), size, size, kind));
    cards.push({ name, role, pictures, want: pictures.map((p, k) => decodeAstc(p, 1 << k, 1 << k, kind)), slack: 0, kinds: pictures.flatMap((p) => Array.from({ length: p.length / 16 }, (_, b) => describeAstcBlock(p, b * 16))) });
  }
  return cards;
}

function rgbaCards(): Card[] {
  const rng = new Rng(77);
  return (["base", "mro", "normal"] as const).map((role) => {
    const pictures = sizes(256).map((size) => Uint8Array.from({ length: size * size * (role === "normal" ? 2 : 4) }, () => rng.int(256)));
    // Red and green of a normal map come back with no blue and full alpha.
    const want = pictures.map((p) => (role === "normal" ? Uint8Array.from({ length: p.length * 2 }, (_, i) => ((i & 3) < 2 ? p[(i >> 2) * 2 + (i & 3)]! : (i & 3) === 3 ? 255 : 0)) : p));
    return { name: `random bytes, ${role}`, role, pictures, want, slack: 0 };
  });
}

/** What the page is sent of the cards: for each, its role and top, and its rows in bands, each band as where its bytes are and whether it ends the texture. */
function cardJob(format: TextureFormat, cards: Card[]): { json: unknown; bytes: Uint8Array } {
  const blob = new Bytes();
  const json = cards.map((c) => {
    const top = 1 << (c.pictures.length - 1);
    const bands: number[][] = [];
    c.pictures.forEach((picture, k) => {
      const size = 1 << k;
      const rows = format === "rgba" ? size : (size + 3) >> 2;
      const rowBytes = picture.length / rows;
      for (let row = 0; row < rows; row += BAND) {
        const n = Math.min(BAND, rows - row);
        const at = blob.add(picture.subarray(row * rowBytes, (row + n) * rowBytes));
        bands.push([size, row, n, at, n * rowBytes, size === top && row + n === rows ? 1 : 0]);
      }
    });
    return { role: c.role, top, bands };
  });
  return { json, bytes: blob.join() };
}

/** Each card's pictures as the GPU drew them against our decoders: a line for each card. */
function judgeCards(cards: Card[], got: Uint8Array): { ok: boolean; lines: string[] } {
  let at = 0;
  let ok = true;
  const lines = cards.map((c) => {
    let worst = 0;
    let blocks = 0;
    const off = new Map<string, number>();
    c.want.forEach((want, k) => {
      const size = 1 << k;
      const shown = got.subarray(at, at + want.length);
      at += want.length;
      for (let b = 0; b < blocksOf(size); b++, blocks++) {
        const across = (size + 3) >> 2;
        let most = 0;
        for (let y = (b / across | 0) * 4; y < Math.min(size, (b / across | 0) * 4 + 4); y++) {
          for (let x = (b % across) * 4; x < Math.min(size, (b % across) * 4 + 4); x++) {
            for (let ch = 0; ch < 4; ch++) most = Math.max(most, Math.abs((shown[(y * size + x) * 4 + ch] ?? -999) - want[(y * size + x) * 4 + ch]!));
          }
        }
        worst = Math.max(worst, most);
        const kind = c.kinds?.[blocks] ?? "";
        if (most > c.slack) off.set(kind, (off.get(kind) ?? 0) + 1);
      }
    });
    if (off.size > 0) ok = false;
    const kinds = new Set(c.kinds ?? []).size;
    return `  ${c.name.padEnd(48)} ${String(blocks).padStart(6)} blocks${kinds > 0 ? ` of ${String(kinds).padStart(3)} kinds` : "             "}, worst ${String(worst).padStart(3)}${off.size > 0 ? `  OFF: ${[...off].slice(0, 6).map(([k, n]) => `${n} ${k}`).join("; ")}` : ""}`;
  });
  if (at !== got.length) return { ok: false, lines: [...lines, `  the page sent ${got.length} bytes of pictures where ${at} were wanted`] };
  return { ok, lines };
}

// ---- The house ----

/** A frame as the page rebuilds it: its numbers, its arrays as far as they are used, and its uploads, with where their bytes are. */
interface Frame {
  scalars: Record<string, number>;
  arrays: [string, number, number][];
  uploads: number[][];
  drops: number[];
  assetUploads: unknown[];
  assetDrops: number[];
  texUploads: unknown[];
  texDrops: number[];
}

const DRAW_ARRAYS = ["drawMesh", "drawLod", "drawSlot", "drawBuffer", "drawFirst", "drawInstances", "drawFlags", "drawMaterial", "drawFirstIndex", "drawIndexCount"] as const;

function packFrame(p: FramePacket, out: Bytes): Frame {
  const ref = (data: Uint8Array): [number, number] => [out.add(data), data.length];
  const arrays: [string, number, number][] = [];
  const put = (name: string, count: number): void => void arrays.push([name, out.add((p[name as keyof FramePacket] as Uint8Array).subarray(0, count)), count]);
  put("viewProj", 16);
  put("nearViewProj", 16);
  put("sky", 3);
  put("sun", 3);
  for (const name of DRAW_ARRAYS) put(name, p.drawCount);
  put("drawOffset", p.drawCount * 3);
  put("tiles", p.tileCount * 4);
  put("tileOrigin", p.tileCount * 2);
  put("transient", p.transientCount * INSTANCE_BYTES);
  put("bones", p.boneCount * BONE_FLOATS);
  const { camX, camY, camZ, light, fogStart, fogEnd, drawCount, tileCount, transientCount, boneCount } = p;
  return {
    scalars: { camX, camY, camZ, light, fogStart, fogEnd, drawCount, tileCount, transientCount, boneCount },
    arrays,
    uploads: p.uploads.map((u) => [u.buffer, ...ref(u.data)]),
    drops: [...p.drops],
    assetUploads: p.assetUploads.map(({ data, ...u }) => ({ ...u, data: ref(data) })),
    assetDrops: [...p.assetDrops],
    texUploads: p.texUploads.map(({ data, ...u }) => ({ ...u, data: ref(data) })),
    texDrops: [...p.texDrops],
  };
}

/** Rows of a compressed texture as the rgba variant would send them, decoded by our decoders, for the rasterizer, which reads that variant alone. */
function decoded(u: TextureUpload): TextureUpload {
  if (u.format === "rgba") return u;
  const height = Math.min(u.rows * 4, u.size - u.row * 4);
  const kind = u.role === "base" ? "srgb" : u.role === "normal" ? "normal" : "linear";
  const rgba = u.format === "astc" ? decodeAstc(u.data, u.size, height, kind) : u.role === "normal" ? decodeBc5(u.data, u.size, height) : decodeBc7(u.data, u.size, height);
  // A normal map in the rgba variant is x and y alone: red and green, where astc keeps y in alpha.
  const y = u.format === "astc" ? 3 : 1;
  const data = u.role === "normal" ? Uint8Array.from({ length: u.size * height * 2 }, (_, i) => rgba[(i >> 1) * 4 + (i & 1 ? y : 0)]!) : rgba;
  return { ...u, format: "rgba", row: u.row * 4, rows: height, data };
}

/**
 * Two foundations square of thatch, the door open on the north side, where the noon sun is, and the south half roofed.
 * Each wall is turned as building turns it, a quarter for each edge from the north, so its thatch is out and its mat in.
 */
function placeHouse(structs: StructureStore, id: (name: string) => number, ground: number): void {
  const [cx, cz] = HOUSE;
  const floor = ground + FOUNDATION_THICK;
  const wy = floor + WALL_HEIGHT / 2;
  const add = (piece: string, x: number, y: number, z: number, edge = 0): void => void structs.add(id(`core:${piece}_thatch`), cx + x, y, cz + z, edge * 16384, 0, 1);
  for (const ox of [-1.5, 1.5]) for (const oz of [-1.5, 1.5]) add("foundation", ox, ground + FOUNDATION_THICK / 2, oz);
  add("doorframe", 1.5, wy, 3);
  add("door_open", 1.5, floor + DOOR_HEIGHT / 2, 3);
  add("wall", -1.5, wy, 3);
  for (const o of [-1.5, 1.5]) {
    add("wall", o, wy, -3, 2);
    add("wall", 3, wy, o, 1);
    add("wall", -3, wy, o, 3);
    add("ceiling", o, floor + WALL_HEIGHT + FLOOR_THICK / 2, -1.5);
  }
}

interface House {
  width: number;
  height: number;
  /** The frame before which the page loses its context and has it back. */
  loseAt: number;
  frames: Frame[];
  bytes: Uint8Array;
  raster: Rasterizer;
  /** Draws in the last frame, those with materials, those of a mesh with materials drawn flat, and those cut out and two-sided. */
  draws: number;
  textured: number;
  flat: number;
  cut: number;
  both: number;
}

/**
 * Builds the frames of the house in one variant at one tier, as the shell would be sent them, until everything is on
 * the card and nothing has moved for a few frames, twice: from nothing, and after a lost context. The rasterizer
 * takes the same frames as they come and draws the last.
 */
function house(manifest: Manifest, files: Uint8Array[], format: TextureFormat, tierName: string): House {
  const reg = compileContent(CORE_CONTENT).registry!;
  const hf = buildProvingHeightfield();
  const structs = new StructureStore(PROVING_DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const ground = hf.heightAt(HOUSE[0], HOUSE[1]);
  placeHouse(structs, (id) => reg.index.get(id)!, ground);
  // Rocks, a tree and a bush about the house, each at a size of its kind and turned, so that sized draws are held to the
  // rasterizer with the rest.
  const forms = nodeForms(reg);
  const nodes = new StructureStore(PROVING_DIMS, forms.halfX, forms.halfY, forms.halfZ, forms.soft, forms.parts);
  for (const [kind, dx, dz, step] of [["core:rock", -5.5, 2, 15], ["core:rock", 4.5, -1, 0], ["core:tree", -6, -4, 9], ["core:bush", 5, 3, 12]] as const) {
    const [x, z] = [HOUSE[0] + dx, HOUSE[1] + dz];
    nodes.add(forms.first[reg.index.get(kind)!]! + step, x, hf.heightAt(x, z), z, step * 4099, 0, 1);
  }
  const pack = parsePack(files[manifest.boot]!);
  const port = new FakeNet(files);
  const scene = new Scene({ dims: PROVING_DIMS, hf, structs, nodes }, reg, pack, { manifest, port });
  const tier = tierOf(tierName);
  scene.assets.tier = tier;
  scene.assets.format = format;
  scene.viewHeight = CSS[1]!;
  const ratio = tier.pixelRatio > 0 ? Math.min(SCREEN_RATIO, tier.pixelRatio) : SCREEN_RATIO;
  const [width, height] = [Math.floor(CSS[0]! * ratio), Math.floor(CSS[1]! * ratio)];
  // Off the north-east corner, looking at the door.
  const cam = new Camera();
  [cam.x, cam.y, cam.z, cam.yaw, cam.pitch, cam.aspect] = [HOUSE[0] + 4.2, ground + 2.3, HOUSE[1] + 8, (204 * Math.PI) / 180, (-8 * Math.PI) / 180, width / height];
  let raster = new Rasterizer(width, height, pack, hf, manifest);
  const out = new Bytes();
  const frames: Frame[] = [];
  let loseAt = -1;
  let quiet = 0;
  let p: FramePacket | null = null;
  for (let now = 0; frames.length < 4000; ) {
    now += 1000 / 60;
    port.advance(now);
    scene.now = now;
    p = scene.build(cam, null);
    const r = scene.assets.residency;
    const busy = p.assetUploads.length + p.assetDrops.length + p.texUploads.length + p.texDrops.length + p.uploads.length + p.drops.length > 0 || r.flying > 0 || r.waiting > 0;
    frames.push(packFrame(p, out));
    const sent = p.texUploads.splice(0, p.texUploads.length);
    p.texUploads.push(...sent.map(decoded));
    const [draws, tiles] = [p.drawCount, p.tileCount];
    p.drawCount = p.tileCount = 0;
    raster.render(p);
    [p.drawCount, p.tileCount] = [draws, tiles];
    p.texUploads.splice(0, p.texUploads.length, ...sent);
    quiet = busy ? 0 : quiet + 1;
    if (quiet < 3) continue;
    if (loseAt >= 0) break;
    // The context is lost: the card has nothing, and core sends everything again.
    scene.resetUploads();
    raster = new Rasterizer(width, height, pack, hf, manifest);
    loseAt = frames.length;
    quiet = 0;
  }
  raster.render(p!);
  const sections = scene.assets.table.sections;
  let [textured, flat, cut, both] = [0, 0, 0, 0];
  for (let d = 0; d < p!.drawCount; d++) {
    const flags = p!.drawFlags[d]!;
    if ((flags & DRAW_TEXTURED) !== 0) textured++;
    else if ((sections[p!.drawMesh[d]!]![0]?.length ?? 0) > 0) flat++;
    if ((flags & DRAW_CUTOUT) !== 0) cut++;
    if ((flags & DRAW_TWO_SIDED) !== 0) both++;
  }
  return { width, height, loseAt, frames, bytes: out.join(), raster, draws: p!.drawCount, textured, flat, cut, both };
}

interface Spread {
  points: number;
  mean: number;
  p95: number;
  p99: number;
  worst: number;
}

function spread(values: number[]): Spread {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.floor((sorted.length - 1) * q)] ?? 0;
  return { points: sorted.length, mean: sorted.reduce((s, v) => s + v, 0) / Math.max(1, sorted.length), p95: at(0.95), p99: at(0.99), worst: at(1) };
}

/** The tolerance, in levels of 255, at points on the house with nothing but one flat face of one piece within 4 pixels. */
const TOLERANCE = { meanP99: 2, meanWorst: 4, pixelP95: 4 };
const NEAR = 4;

/**
 * The GPU's picture against the rasterizer's at points on the house: the worst channel of the pixel there, and of the
 * mean of the five by five pixels about it, which a texel more or less in the GPU's choice of picture does not move
 * much. A point is taken where the rasterizer's depth about it lies on one plane, so that no edge of a triangle or of
 * a piece, where the GPU's samples share a pixel, is near.
 */
function judgeHouse(shot: Uint8Array, raster: Rasterizer): { pixel: Spread; mean: Spread; ok: boolean } {
  const { width: W, height: H, color, depth, pickKind, pickId } = raster;
  // The GPU's rows come bottom first.
  const gpu = (x: number, y: number, c: number): number => shot[((H - 1 - y) * W + x) * 4 + c]!;
  const flat = (at: number): boolean => {
    const gx = (depth[at + 1]! - depth[at - 1]!) / 2;
    const gy = (depth[at + W]! - depth[at - W]!) / 2;
    const slack = (Math.abs(gx) + Math.abs(gy)) * 0.05 + 1e-7;
    for (let dy = -NEAR; dy <= NEAR; dy++) {
      for (let dx = -NEAR; dx <= NEAR; dx++) {
        const near = at + dy * W + dx;
        if (pickKind[near] !== PICK_STRUCTURE || pickId[near] !== pickId[at] || Math.abs(depth[near]! - depth[at]! - dx * gx - dy * gy) > slack) return false;
      }
    }
    return true;
  };
  const pixel: number[] = [];
  const mean: number[] = [];
  const step = Math.round(W / 240);
  for (let y = NEAR + 1; y < H - NEAR - 1; y += step) {
    for (let x = NEAR + 1; x < W - NEAR - 1; x += step) {
      const at = y * W + x;
      if (pickKind[at] !== PICK_STRUCTURE || !flat(at)) continue;
      let most = 0;
      let mostMean = 0;
      for (let c = 0; c < 3; c++) {
        most = Math.max(most, Math.abs(gpu(x, y, c) - color[at * 4 + c]!));
        let sum = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) sum += gpu(x + dx, y + dy, c) - color[(at + dy * W + dx) * 4 + c]!;
        mostMean = Math.max(mostMean, Math.abs(sum / 25));
      }
      pixel.push(most);
      mean.push(mostMean);
    }
  }
  const [p, m] = [spread(pixel), spread(mean)];
  return { pixel: p, mean: m, ok: p.points >= 200 && m.p99 <= TOLERANCE.meanP99 && m.worst <= TOLERANCE.meanWorst && p.p95 <= TOLERANCE.pixelP95 };
}

// ---- The page ----

const PAGE = `<!doctype html><meta charset="utf-8"><title>textured probe</title><body><script type="module">
// The shell and core as this probe bundled them.
const load = (name) => import("/m/" + name + ".js");
const { GlRenderer } = await load("gl");
const { FramePacket } = await load("packet");
const { parsePack } = await load("pack");
const { parseManifest } = await load("manifest");
const { buildProvingHeightfield } = await load("proving");

const get = async (path) => (await fetch(path)).json();
const bytes = async (path) => new Uint8Array(await (await fetch(path)).arrayBuffer());
const post = (path, body) => fetch(path, { method: "POST", body });
const errors = [];
const manifest = parseManifest(await (await fetch("/assets/manifest.json")).text());
const pack = parsePack(await bytes("/assets/" + manifest.files[manifest.boot].name));
const hf = buildProvingHeightfield();

function renderer(width, height, format) {
  const canvas = document.createElement("canvas");
  [canvas.width, canvas.height] = [width, height];
  const r = new GlRenderer(canvas, pack, hf, manifest, format);
  if (format && r.format !== format) throw new Error("the renderer took " + r.format + " where " + format + " was asked for");
  return r;
}
const done = (r) => r.gl.getExtension("WEBGL_lose_context").loseContext();

function lose(r) {
  return new Promise((resolve) => {
    const canvas = r.gl.canvas;
    const lost = r.gl.getExtension("WEBGL_lose_context");
    canvas.addEventListener("webglcontextlost", (e) => (e.preventDefault(), setTimeout(() => lost.restoreContext(), 0)), { once: true });
    canvas.addEventListener("webglcontextrestored", () => (r.init(), resolve()), { once: true });
    lost.loseContext();
  });
}

function unpack(p, f, blob) {
  p.beginFrame();
  Object.assign(p, f.scalars);
  for (const [name, at, n] of f.arrays) p[name].set(new p[name].constructor(blob.buffer, at, n));
  const data = ([at, n]) => blob.subarray(at, at + n);
  for (const [buffer, at, n] of f.uploads) p.uploads.push({ buffer, data: data([at, n]), slots: new Uint16Array(0) });
  for (const u of f.assetUploads) p.assetUploads.push({ ...u, data: data(u.data) });
  for (const u of f.texUploads) p.texUploads.push({ ...u, data: data(u.data) });
  p.drops.push(...f.drops);
  p.assetDrops.push(...f.assetDrops);
  p.texDrops.push(...f.texDrops);
}

function link(gl, vertex, fragment) {
  const program = gl.createProgram();
  for (const [type, text] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, text);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(program, s);
  }
  gl.linkProgram(program);
  return program;
}

async function cards(format) {
  const list = await get("/cards/" + format);
  const blob = await bytes("/cards/" + format + ".bin");
  const r = renderer(4, 4, format);
  const gl = r.gl;
  const p = new FramePacket();
  list.forEach((card, slot) => {
    p.beginFrame();
    for (const [size, row, rows, at, n, last] of card.bands) p.texUploads.push({ slot, role: card.role, format, top: card.top, size, row, rows, data: blob.subarray(at, at + n), last: last === 1 });
    r.draw(p);
  });
  // Each picture a texel to a pixel, a base colour through an sRGB target so that it reads back as the bytes it decoded to.
  const program = link(gl, "#version 300 es\\nvoid main() { gl_Position = vec4(float((gl_VertexID << 1) & 2) * 2.0 - 1.0, float(gl_VertexID & 2) * 2.0 - 1.0, 0.0, 1.0); }",
    "#version 300 es\\nprecision highp float; uniform highp sampler2D t; uniform int lod; out vec4 o; void main() { o = texelFetch(t, ivec2(gl_FragCoord.xy), lod); }");
  gl.useProgram(program);
  gl.disable(gl.DITHER);
  gl.disable(gl.BLEND);
  gl.disable(gl.CULL_FACE);
  const out = [];
  list.forEach((card, slot) => {
    for (let size = 1, lod = Math.log2(card.top); size <= card.top; size *= 2, lod--) {
      gl.activeTexture(gl.TEXTURE1);
      const target = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, target);
      gl.texStorage2D(gl.TEXTURE_2D, 1, card.role === "base" ? gl.SRGB8_ALPHA8 : gl.RGBA8, size, size);
      const frame = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, frame);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, r.textures.get(slot) ?? null);
      gl.uniform1i(gl.getUniformLocation(program, "t"), 0);
      gl.uniform1i(gl.getUniformLocation(program, "lod"), lod);
      gl.viewport(0, 0, size, size);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const px = new Uint8Array(size * size * 4);
      gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, px);
      out.push(px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(frame);
      gl.deleteTexture(target);
    }
  });
  const error = gl.getError();
  if (r.errors > 0 || error !== 0) errors.push(format + " cards: " + r.errors + " frames of rows the GL refused, and error " + error + " after reading them back");
  await post("/pixels/" + format, new Blob(out));
  done(r);
}

/** The last frame's draws over and over up to the packet's limit, each frame drawn twenty times: what the page spends a draw, and the GPU with it. */
function time(r, p, flat) {
  const n = p.drawCount;
  let total = n;
  for (; total + n <= p.drawMesh.length; total += n) {
    for (const name of ${JSON.stringify(DRAW_ARRAYS)}) p[name].copyWithin(total, 0, n);
    p.drawOffset.copyWithin(total * 3, 0, n * 3);
  }
  p.drawCount = total;
  if (flat) for (let d = 0; d < total; d++) p.drawFlags[d] &= ~${DRAW_TEXTURED};
  const one = new Uint8Array(4);
  r.draw(p);
  r.gl.readPixels(0, 0, 1, 1, r.gl.RGBA, r.gl.UNSIGNED_BYTE, one);
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) r.draw(p);
  const t1 = performance.now();
  r.gl.readPixels(0, 0, 1, 1, r.gl.RGBA, r.gl.UNSIGNED_BYTE, one);
  const t2 = performance.now();
  return { draws: total, calls: r.drawCalls, pageMicros: ((t1 - t0) * 1000) / 20 / total, gpuMicros: ((t2 - t0) * 1000) / 20 / total };
}

async function scene(format, tier) {
  const s = await get("/house/" + format + "/" + tier);
  const blob = await bytes("/house/" + format + "/" + tier + ".bin");
  const r = renderer(s.width, s.height, format);
  const p = new FramePacket();
  for (let k = 0; k < s.frames.length; k++) {
    if (k === s.loseAt) await lose(r);
    unpack(p, s.frames[k], blob);
    r.draw(p);
    if (r.failed.length + r.failedTextures.length > 0) errors.push(format + " " + tier + ": the card had no room in frame " + k);
  }
  const gl = r.gl;
  const shot = new Uint8Array(s.width * s.height * 4);
  gl.readPixels(0, 0, s.width, s.height, gl.RGBA, gl.UNSIGNED_BYTE, shot);
  const error = gl.getError();
  if (r.errors > 0 || error !== 0) errors.push(format + " " + tier + ": " + r.errors + " frames the GL refused uploads of, and error " + error + " at the end");
  await post("/shot/" + format + "/" + tier, shot);
  // Timed on a small canvas, so that what is measured is the draws and not the pixels they fill.
  [gl.canvas.width, gl.canvas.height] = [64, 36];
  const textured = time(r, p, false);
  unpack(p, s.frames[s.frames.length - 1], blob);
  const flat = time(r, p, true);
  await post("/timing/" + format + "/" + tier, JSON.stringify({ textured, flat }));
  done(r);
}

try {
  const first = renderer(4, 4, null);
  const formats = first.formats;
  await post("/hello", JSON.stringify({ renderer: first.rendererName, formats, extensions: first.gl.getSupportedExtensions() }));
  done(first);
  for (const format of formats) {
    await cards(format);
    for (const tier of ${JSON.stringify(TIERS)}) await scene(format, tier);
  }
} catch (e) {
  errors.push(String((e && e.stack) || e));
}
await post("/report", JSON.stringify({ errors }));
</script>`;

interface Hello {
  renderer: string;
  formats: TextureFormat[];
  extensions: string[];
}

/** Runs the page in Chrome and judges what it sends. True if everything passed. */
export async function texturedProbe(chrome: string): Promise<boolean> {
  const manifest = parseManifest(readFileSync(join(DIST, "assets/manifest.json"), "utf8"));
  // The thatch has no cut-out or two-sided material. Its cord is cut out here and its poles two-sided, which changes
  // nothing drawn, since the cord's alpha is whole and a pole is closed, so that the shell's paths for both are run.
  for (const m of manifest.materials ?? []) {
    if (m.id.endsWith("/Cord")) [m.flags, m.cutoff] = [m.flags | MATERIAL_CUTOUT, 0.5];
    if (m.id.endsWith("/Pole")) m.flags |= MATERIAL_TWO_SIDED;
  }
  const files = manifest.files.map((f) => new Uint8Array(readFileSync(join(DIST, "assets", f.name))));
  const modules = await Bun.build({ entrypoints: ["client/shell/gl.ts", "client/core/render/packet.ts", "shared/pack/pack.ts", "shared/pack/manifest.ts", "shared/world/proving.ts"].map((f) => join(ROOT, f)), target: "browser", splitting: true, format: "esm", naming: "[name].[ext]" });
  if (!modules.success) throw new Error(modules.logs.map(String).join("\n"));
  const served = new Map<string, Blob>(modules.outputs.map((o) => [`/m/${o.path.slice(2)}`, o]));
  const cards = new Map<string, Card[]>();
  const jobs = new Map<string, { json: unknown; bytes: Uint8Array }>();
  const houses = new Map<string, House>();
  const shots = new Map<string, Uint8Array>();
  const timings = new Map<string, unknown>();
  const cardLines: string[] = [];
  let hello: Hello | null = null;
  let ok = true;
  let finish: (r: { errors: string[] }) => void = () => {};
  const finished = new Promise<{ errors: string[] }>((r) => (finish = r));

  const cardsOf = (format: TextureFormat): Card[] => {
    if (!cards.has(format)) cards.set(format, format === "bc" ? bcCards() : format === "astc" ? astcCards() : rgbaCards());
    return cards.get(format)!;
  };
  const houseOf = (key: string): House => {
    if (!houses.has(key)) {
      const [format, tier] = key.split("/") as [TextureFormat, string];
      const t0 = performance.now();
      houses.set(key, house(manifest, files, format, tier));
      console.log(`  the house, ${key}: ${houses.get(key)!.frames.length} frames built and rasterized in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    }
    return houses.get(key)!;
  };
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const body = req.method === "POST" ? new Uint8Array(await req.arrayBuffer()) : null;
      if (path === "/") return new Response(PAGE, { headers: { "content-type": "text/html" } });
      if (served.has(path)) return new Response(served.get(path)!, { headers: { "content-type": "text/javascript" } });
      if (path === "/assets/manifest.json") return Response.json(manifest);
      if (path.startsWith("/assets/")) return new Response(Bun.file(join(DIST, path)));
      if (path === "/hello") hello = JSON.parse(new TextDecoder().decode(body!)) as Hello;
      else if (path.startsWith("/cards/")) {
        const format = path.slice(7).replace(".bin", "") as TextureFormat;
        if (!jobs.has(format)) jobs.set(format, cardJob(format, cardsOf(format)));
        return path.endsWith(".bin") ? new Response(jobs.get(format)!.bytes) : Response.json(jobs.get(format)!.json);
      } else if (path.startsWith("/pixels/")) {
        const format = path.slice(8) as TextureFormat;
        const judged = judgeCards(cardsOf(format), body!);
        cardLines.push(`${format}:`, ...judged.lines);
        ok &&= judged.ok;
      } else if (path.startsWith("/house/")) {
        const h = houseOf(path.slice(7).replace(".bin", ""));
        if (path.endsWith(".bin")) return new Response(h.bytes);
        return Response.json({ width: h.width, height: h.height, loseAt: h.loseAt, frames: h.frames });
      } else if (path.startsWith("/shot/")) shots.set(path.slice(6), body!);
      else if (path.startsWith("/timing/")) timings.set(path.slice(8), JSON.parse(new TextDecoder().decode(body!)));
      else if (path === "/report") finish(JSON.parse(new TextDecoder().decode(body!)) as { errors: string[] });
      else return new Response("not found", { status: 404 });
      return new Response("ok");
    },
  });

  const profile = mkdtempSync(join(tmpdir(), "snark-probe-"));
  const browser = Bun.spawn([chrome, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1280,720", `--user-data-dir=${profile}`, `http://localhost:${server.port}/`], { stdout: "ignore", stderr: "ignore" });
  const report = await Promise.race([finished, new Promise<null>((r) => setTimeout(() => r(null), 600000))]);
  browser.kill();
  await browser.exited;
  server.stop(true);
  rmSync(profile, { recursive: true, force: true });
  if (!report || !hello) {
    console.error("probe: the textured page sent no report within ten minutes");
    return false;
  }
  const h = hello as Hello;
  console.log(`renderer: ${h.renderer}`);
  console.log(`variants this GPU takes: ${h.formats.join(", ")}   (${h.extensions.filter((e) => /compression|astc|bptc|rgtc|s3tc|etc/i.test(e)).join(", ")})`);
  for (const e of report.errors) console.log(`page error: ${e}`);
  ok &&= report.errors.length === 0 && h.formats.every((f) => cards.has(f));
  console.log("\nThe test cards, drawn a texel to a pixel, against our decoders. Differences are in levels of 255.");
  for (const line of cardLines) console.log(line);

  console.log(`\nThe house against the rasterizer at points with one flat face of one piece within ${NEAR} pixels: the worst channel, as a pixel and as the mean of the 5 by 5 about it.`);
  console.log(`Passes with the means within ${TOLERANCE.meanP99} at 99 points in 100 and ${TOLERANCE.meanWorst} at every point, and pixels within ${TOLERANCE.pixelP95} at 95 in 100.`);
  for (const [key, house] of houses) {
    const shot = shots.get(key);
    if (!shot) {
      console.log(`  ${key}: NO PICTURE`);
      ok = false;
      continue;
    }
    const j = judgeHouse(shot, house.raster);
    ok &&= j.ok && house.flat === 0 && house.textured > 0 && house.cut > 0 && house.both > 0;
    const t = timings.get(key) as { textured: { draws: number; pageMicros: number; gpuMicros: number }; flat: { pageMicros: number; gpuMicros: number } } | undefined;
    console.log(`  ${key.padEnd(12)} ${house.width}x${house.height}, ${house.frames.length} frames, context lost before ${house.loseAt}; ${house.draws} draws, ${house.textured} with materials (${house.cut} cut out, ${house.both} two-sided), ${house.flat} flat that have them`);
    console.log(`  ${"".padEnd(12)} ${j.pixel.points} points: pixels mean ${j.pixel.mean.toFixed(1)}, 95 in 100 within ${j.pixel.p95}, worst ${j.pixel.worst}; means mean ${j.mean.mean.toFixed(2)}, 99 in 100 within ${j.mean.p99.toFixed(1)}, worst ${j.mean.worst.toFixed(1)}  ${j.ok ? "ok" : "FAIL"}`);
    if (t) console.log(`  ${"".padEnd(12)} ${t.textured.draws} draws a frame: ${t.textured.pageMicros.toFixed(2)} us a draw in the page and ${t.textured.gpuMicros.toFixed(2)} us to the GPU's end with materials, ${t.flat.pageMicros.toFixed(2)} and ${t.flat.gpuMicros.toFixed(2)} flat`);
  }
  // The pictures of the variant this device takes first, top row first, and the rasterizer's of the house at medium.
  const save = (name: string, width: number, height: number, rgba: Uint8Array | Uint8ClampedArray): void => {
    writeFileSync(join(PICTURES, name), encodePng(width, height, rgba));
    console.log(`saved planning/reference/round7-pictures/${name}`);
  };
  console.log("");
  for (const tier of TIERS) {
    const key = `${h.formats[0]}/${tier}`;
    const [shot, house] = [shots.get(key), houses.get(key)];
    if (!shot || !house) continue;
    const rows = new Uint8Array(shot.length);
    const row = house.width * 4;
    for (let y = 0; y < house.height; y++) rows.set(shot.subarray((house.height - 1 - y) * row, (house.height - y) * row), y * row);
    for (let i = 3; i < rows.length; i += 4) rows[i] = 255;
    save(`thatch-house-${tier}.png`, house.width, house.height, rows);
    if (tier === "medium") save("thatch-house-medium-reference.png", house.width, house.height, house.raster.color);
  }
  return ok;
}
