// A world of things drawn through the asset library over a network made of numbers, and a graphics card that holds
// only what packets upload. The residency tests and the benchmark both fly a camera through it.

import { Assets } from "../../client/core/assets/assets.ts";
import type { AssetUpload } from "../../client/core/assets/residency.ts";
import { tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import { PULL_SLOTS } from "../../client/core/render/farnodes.ts";
import { FramePacket } from "../../client/core/render/packet.ts";
import type { Manifest } from "../../shared/pack/manifest.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { blockOf, pictureBytes, textureBytes, type TextureFormat } from "../../shared/pack/texture.ts";
import { partHash } from "../../tools/pack/manifest.ts";
import type { SplitFile } from "../../tools/pack/split.ts";
import { FakeNet, type NetOptions } from "./assetnet.ts";
import { coreRegistry } from "./world.ts";

export const FRAME_MS = 1000 / 60;

export interface Thing {
  mesh: number;
  x?: number;
  z: number;
  /** How many times its modelled size it is drawn. 1 where not given. */
  size?: number;
}

/** A copy of a texture on the card: how wide, in which variant, and the bytes the card gives it. */
interface Copy {
  top: number;
  format: TextureFormat;
  bytes: number;
  /** The picture and row the next rows must start at. */
  size: number;
  row: number;
}

/** A graphics card that holds what packets upload, and says so when asked to draw anything else. */
export class Card {
  readonly held = new Map<number, number>();
  /** The slot of the surface the card holds for the level in a slot. */
  readonly surfaces = new Map<number, number>();
  /** Levels and surfaces going up in pieces: the whole as far as it has come, and a surface's level. */
  readonly coming = new Map<number, { bytes: Uint8Array; at: number; of: number | undefined }>();
  /** The copy of each texture the card draws with, and the copy it is being sent. */
  readonly textures = new Map<number, Copy>();
  readonly making = new Map<number, Copy>();
  /** Every copy completed, in order: the texture and how wide. */
  readonly made: [texture: number, top: number][] = [];
  bytes = 0;
  most = 0;
  /** Bytes of textures, the most there have been, and the most that came in one run of rows. */
  texBytes = 0;
  mostTex = 0;
  mostBand = 0;
  private readonly manifest: Manifest;
  private readonly files: readonly Uint8Array[];
  constructor(manifest: Manifest, files: readonly Uint8Array[] = []) {
    this.manifest = manifest;
    this.files = files;
  }

  take(p: FramePacket): void {
    for (const piece of p.assetUploads) {
      // The card holds the whole of a level or a surface from its first piece, and takes it as uploaded once its last is in.
      if ((piece.at ?? 0) === 0) this.bytes += piece.whole ?? piece.data.length;
      const u = this.joined(piece);
      if (!u) continue;
      const level = this.manifest.meshes[u.mesh]!.levels[u.level]!;
      if (this.held.has(u.slot)) throw new Error(`slot ${u.slot} uploaded twice`);
      // The far nodes' pulled draws name levels core makes, which no file holds.
      if (u.slot >= PULL_SLOTS) {
        if (u.slot >= PULL_SLOTS + 3 || u.indexBytes !== 2) throw new Error(`slot ${u.slot} is no level of a pulled draw`);
      } else if (u.of === undefined) {
        if (partHash(u.data) !== level.parts[0]!.hash) throw new Error(`slot ${u.slot} uploaded with the wrong bytes`);
        if (u.indexCount !== level.tris * 3 || u.indexBytes !== level.index) throw new Error(`slot ${u.slot} uploaded with the wrong counts`);
      } else {
        if (!this.held.has(u.of) || this.surfaces.has(u.of)) throw new Error(`surface ${u.slot} uploaded without its level, or twice`);
        const [surface, skin] = [u.data.subarray(0, u.skinAt), u.data.subarray(u.skinAt)];
        if (partHash(surface) !== level.parts[1]!.hash || (level.parts[2] ? partHash(skin) !== level.parts[2].hash : skin.length > 0)) throw new Error(`surface ${u.slot} uploaded with the wrong bytes`);
        this.surfaces.set(u.of, u.slot);
      }
      this.held.set(u.slot, u.data.length);
    }
    for (const slot of p.assetDrops) {
      // What had come of a level's surface goes with the level.
      for (const [s, had] of this.coming) {
        if (had.of !== slot) continue;
        this.bytes -= had.bytes.length;
        this.coming.delete(s);
      }
      if (!this.held.has(slot)) throw new Error(`slot ${slot} dropped and never held`);
      if (this.surfaces.has(slot)) throw new Error(`level ${slot} dropped before its surface`);
      for (const [level, surface] of this.surfaces) if (surface === slot) this.surfaces.delete(level);
      this.bytes -= this.held.get(slot)!;
      this.held.delete(slot);
    }
    // Textures as a renderer must take them: what goes first, then rows, which start a copy, add to it or complete it.
    for (const t of p.texDrops) {
      if (!this.textures.has(t) && !this.making.has(t)) throw new Error(`texture ${t} dropped and never held`);
      this.forget(t);
    }
    for (const u of p.texUploads) {
      const tex = this.manifest.textures![u.slot]!;
      const v = tex.in[u.format]!;
      const block = blockOf(u.format, v);
      // Rows of blocks: the upload's rows are pixels, whole blocks but for the picture's edge.
      const rows = Math.ceil(u.size / block);
      const rowBytes = pictureBytes(u.format, tex.role, u.size, block) / rows;
      const [row, n] = [u.row / block, Math.ceil(u.rows / block)];
      if (u.size === 1 && u.row === 0) {
        if (this.making.has(u.slot)) throw new Error(`texture ${u.slot} begun twice`);
        this.making.set(u.slot, { top: u.top, format: u.format, bytes: textureBytes(u.format, tex.role, u.top, block), size: 1, row: 0 });
        this.texBytes += textureBytes(u.format, tex.role, u.top, block);
      }
      const copy = this.making.get(u.slot);
      if (!copy || copy.top !== u.top || copy.format !== u.format || tex.role !== u.role || (u.format !== "rgba" && u.block !== block)) throw new Error(`texture ${u.slot} sent rows of a copy that was not begun`);
      if (copy.size !== u.size || copy.row !== row || n < 1 || row + n > rows || u.rows !== Math.min(n * block, u.size - u.row) || u.data.length !== n * rowBytes) throw new Error(`texture ${u.slot} sent rows out of order`);
      // The rows are the ones the file holds there.
      let at = v.at + row * rowBytes;
      for (let size = 1; size < u.size; size <<= 1) at += pictureBytes(u.format, tex.role, size, block);
      if (Buffer.compare(u.data, this.files[v.file]!.subarray(at, at + u.data.length)) !== 0) throw new Error(`texture ${u.slot} sent the wrong bytes`);
      this.mostBand = Math.max(this.mostBand, u.data.length);
      copy.row += n;
      if (copy.row === rows) [copy.size, copy.row] = [u.size * 2, 0];
      if (u.last !== (copy.size > u.top)) throw new Error(`texture ${u.slot} completed at the wrong rows`);
      if (!u.last) continue;
      // The new copy is what is drawn with from here, and the old one goes.
      this.texBytes -= this.textures.get(u.slot)?.bytes ?? 0;
      this.textures.set(u.slot, copy);
      this.making.delete(u.slot);
      this.made.push([u.slot, u.top]);
    }
    this.most = Math.max(this.most, this.bytes + this.texBytes);
    this.mostTex = Math.max(this.mostTex, this.texBytes);
  }

  /** An upload whole, once the last of its pieces is in, in order; null while more are to come. */
  private joined(u: AssetUpload): AssetUpload | null {
    if (u.whole === undefined) return u;
    let had = this.coming.get(u.slot);
    if (u.at === 0) {
      if (had || this.held.has(u.slot)) throw new Error(`slot ${u.slot} begun twice`);
      this.coming.set(u.slot, (had = { bytes: new Uint8Array(u.whole), at: 0, of: u.of }));
    }
    if (!had || had.at !== u.at || had.at + u.data.length > u.whole) throw new Error(`slot ${u.slot} sent a piece out of order`);
    had.bytes.set(u.data, had.at);
    had.at += u.data.length;
    if (had.at < u.whole) return null;
    this.coming.delete(u.slot);
    return { ...u, data: had.bytes };
  }

  /** The card loses a texture: what it draws with, and a copy being made. */
  forget(t: number): void {
    this.texBytes -= (this.textures.get(t)?.bytes ?? 0) + (this.making.get(t)?.bytes ?? 0);
    this.textures.delete(t);
    this.making.delete(t);
  }

  /** The card loses everything. */
  clear(): void {
    for (const map of [this.held, this.surfaces, this.textures, this.making, this.coming]) map.clear();
    this.bytes = this.texBytes = 0;
  }
}

/**
 * `format` makes the world one drawn with materials, in that variant: things are wanted with their surfaces and
 * textures. `sight` is how far off a thing is still drawn.
 */
export function assetWorld(set: { files: SplitFile[]; manifest: Manifest }, things: readonly Thing[], net: NetOptions = {}, tier: Partial<Tier> = {}, format?: TextureFormat, sight = Infinity) {
  const port = new FakeNet(set.files.map((f) => f.bytes), net);
  const assets = new Assets(coreRegistry(), parsePack(set.files[0]!.bytes), set.manifest, port);
  assets.tier = { ...tierOf("medium"), ...tier };
  if (format) assets.format = format;
  const card = new Card(set.manifest, set.files.map((f) => f.bytes));
  const packet = new FramePacket();
  /** The finest level of a mesh that the boot pack holds. */
  const inBoot = (mesh: number): number => set.manifest.meshes[mesh]!.levels.findIndex((l) => l.file === 0);
  const last = new Int8Array(things.length).fill(-1);
  /** The level each thing was drawn at in the last frame, and the level it wanted. */
  const drawn = new Int8Array(things.length).fill(-1);
  const wanted = new Int8Array(things.length);
  /** Whether each thing was drawn with its materials in the last frame, and in how many frames it was drawn flat after having been. */
  const shown = new Uint8Array(things.length);
  const lapsed = new Int32Array(things.length).fill(-1);
  /** Levels and surfaces let go, and textures let go. */
  const dropped = { levels: 0, textures: 0 };
  const switches: number[][] = things.map(() => []);
  let now = 0;
  let mostUploaded = 0;
  let mostRows = 0;
  /** Bytes something that is not an asset sends to the card each frame, before the assets. */
  let spending = 0;
  /** One frame with the camera at (x, z). */
  const frame = (z: number, x = 0): void => {
    now += FRAME_MS;
    port.advance(now);
    packet.beginFrame();
    assets.begin(now, 720, 1.2217);
    assets.residency.spend(spending);
    for (let i = 0; i < things.length; i++) {
      const t = things[i]!;
      const d = Math.hypot((t.x ?? 0) - x, t.z - z);
      if (d > sight) {
        drawn[i] = -1;
        shown[i] = 0;
        continue;
      }
      const lod = assets.choose(assets.table.error[t.mesh]!, d, last[i]!);
      last[i] = wanted[i] = lod;
      if (format) assets.wantTextured(t.mesh, lod, d, t.size ?? 1);
      else assets.want(t.mesh, lod, d);
      const got = assets.level(t.mesh, lod);
      if (got !== drawn[i] && drawn[i]! >= 0) switches[i]!.push(now);
      drawn[i] = got;
      shown[i] = format && got >= 0 && assets.textured(t.mesh, got) ? 1 : 0;
      if (shown[i] === 1 ? lapsed[i]! < 0 : lapsed[i]! >= 0) lapsed[i]!++;
    }
    assets.end(packet, now);
    card.take(packet);
    dropped.levels += packet.assetDrops.length;
    dropped.textures += packet.texDrops.length;
    let up = 0;
    for (const u of packet.assetUploads) if (set.manifest.meshes[u.mesh]!.levels[u.level]!.file !== 0) up += u.data.length;
    mostUploaded = Math.max(mostUploaded, packet.assetUploads.length > 1 ? up : 0);
    mostRows = Math.max(mostRows, packet.texUploads.reduce((sum, u) => sum + u.data.length, 0));
    // Every draw of this frame is of something the card holds.
    for (let i = 0; i < things.length; i++) {
      const slot = assets.residency.slot(things[i]!.mesh, drawn[i]!);
      if (sight < Infinity && drawn[i]! < 0) continue;
      if (drawn[i]! < 0 || !card.held.has(slot)) throw new Error(`thing ${i} drawn at level ${drawn[i]}, which the card does not hold`);
      if (shown[i] === 0) continue;
      const runs = assets.table.sections[things[i]!.mesh]![drawn[i]!]!;
      for (let k = 0; k < runs.length; k += 3) {
        const m = assets.table.materials[runs[k]!]!;
        if ([m.base, m.mask, m.mask2].some((t) => t >= 0 && !card.textures.has(t))) throw new Error(`thing ${i} drawn with material ${m.id}, whose textures the card does not hold`);
      }
      if (runs.length === 0 || !card.surfaces.has(slot)) throw new Error(`thing ${i} drawn with materials at level ${drawn[i]}, whose surface the card does not hold`);
    }
    // The library's count of the card is the card's own, to the byte, while copies are made and swapped.
    if (format && (card.bytes + card.texBytes !== assets.residency.ledger || card.texBytes !== assets.residency.texLedger)) throw new Error(`the card holds ${card.bytes} and ${card.texBytes} of textures, and the library counts ${assets.residency.ledger} and ${assets.residency.texLedger}`);
  };
  /** `seconds` of frames, the camera moving along z from `from` at `speed` metres a second. Returns where it ended. */
  const run = (seconds: number, from: number, speed = 0): number => {
    let z = from;
    for (let f = 0; f < seconds * 60; f++) frame((z += speed / 60));
    return z;
  };
  const settled = (): boolean => drawn.every((l, i) => l === wanted[i]);
  /** Every thing is drawn as the boot pack alone allows: the level wanted if it is in there, else the finest that is. */
  const coarse = (): boolean => drawn.every((l, i) => l === Math.max(wanted[i]!, inBoot(things[i]!.mesh)));
  /** No thing that wants finer than the boot pack has is still drawn from the boot pack. */
  const usable = (): boolean => drawn.every((l, i) => l === wanted[i] || l < inBoot(things[i]!.mesh));
  const spend = (bytes: number): void => void (spending = bytes);
  return { port, assets, card, packet, frame, run, settled, coarse, usable, inBoot, drawn, wanted, shown, lapsed, dropped, switches, r: assets.residency, mostUploaded: () => mostUploaded, mostRows: () => mostRows, now: () => now, spend };
}
