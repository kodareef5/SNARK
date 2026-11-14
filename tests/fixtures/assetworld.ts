// A world of things drawn through the asset library over a network made of numbers, and a graphics card that holds
// only what packets upload. The residency tests and the benchmark both fly a camera through it.

import { Assets } from "../../client/core/assets/assets.ts";
import { tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import { FramePacket } from "../../client/core/render/packet.ts";
import type { Manifest } from "../../shared/pack/manifest.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { partHash } from "../../tools/pack/manifest.ts";
import type { SplitFile } from "../../tools/pack/split.ts";
import { FakeNet, type NetOptions } from "./assetnet.ts";
import { coreRegistry } from "./world.ts";

export const FRAME_MS = 1000 / 60;

export interface Thing {
  mesh: number;
  x?: number;
  z: number;
}

/** A graphics card that holds what packets upload, and says so when asked to draw anything else. */
export class Card {
  readonly held = new Map<number, number>();
  bytes = 0;
  most = 0;
  private readonly manifest: Manifest;
  constructor(manifest: Manifest) {
    this.manifest = manifest;
  }
  take(p: FramePacket): void {
    for (const u of p.assetUploads) {
      const level = this.manifest.meshes[u.mesh]!.levels[u.level]!;
      if (this.held.has(u.slot)) throw new Error(`slot ${u.slot} uploaded twice`);
      if (partHash(u.data) !== level.parts[0]!.hash) throw new Error(`slot ${u.slot} uploaded with the wrong bytes`);
      this.held.set(u.slot, u.data.length);
      this.bytes += u.data.length;
    }
    for (const slot of p.assetDrops) {
      if (!this.held.has(slot)) throw new Error(`slot ${slot} dropped and never held`);
      this.bytes -= this.held.get(slot)!;
      this.held.delete(slot);
    }
    this.most = Math.max(this.most, this.bytes);
  }
}

export function assetWorld(set: { files: SplitFile[]; manifest: Manifest }, things: readonly Thing[], net: NetOptions = {}, tier: Partial<Tier> = {}) {
  const port = new FakeNet(set.files.map((f) => f.bytes), net);
  const assets = new Assets(coreRegistry(), parsePack(set.files[0]!.bytes), set.manifest, port);
  assets.tier = { ...tierOf("medium"), ...tier };
  const card = new Card(set.manifest);
  const packet = new FramePacket();
  /** The finest level of a mesh that the boot pack holds. */
  const inBoot = (mesh: number): number => set.manifest.meshes[mesh]!.levels.findIndex((l) => l.file === 0);
  const last = new Int8Array(things.length).fill(-1);
  /** The level each thing was drawn at in the last frame, and the level it wanted. */
  const drawn = new Int8Array(things.length).fill(-1);
  const wanted = new Int8Array(things.length);
  const switches: number[][] = things.map(() => []);
  let now = 0;
  let mostUploaded = 0;
  /** One frame with the camera at (x, z). */
  const frame = (z: number, x = 0): void => {
    now += FRAME_MS;
    port.advance(now);
    packet.beginFrame();
    assets.begin(now, 720, 1.2217);
    for (let i = 0; i < things.length; i++) {
      const t = things[i]!;
      const d = Math.hypot((t.x ?? 0) - x, t.z - z);
      const lod = assets.choose(assets.table.error[t.mesh]!, d, last[i]!);
      last[i] = wanted[i] = lod;
      assets.want(t.mesh, lod, d);
      const got = assets.level(t.mesh, lod);
      if (got !== drawn[i] && drawn[i]! >= 0) switches[i]!.push(now);
      drawn[i] = got;
    }
    assets.end(packet, now);
    card.take(packet);
    let up = 0;
    for (const u of packet.assetUploads) if (set.manifest.meshes[u.mesh]!.levels[u.level]!.file !== 0) up += u.data.length;
    mostUploaded = Math.max(mostUploaded, packet.assetUploads.length > 1 ? up : 0);
    // Every draw of this frame is of something the card holds.
    for (let i = 0; i < things.length; i++) {
      if (drawn[i]! < 0 || !card.held.has(assets.residency.slot(things[i]!.mesh, drawn[i]!))) throw new Error(`thing ${i} drawn at level ${drawn[i]}, which the card does not hold`);
    }
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
  return { port, assets, card, packet, frame, run, settled, coarse, usable, inBoot, drawn, wanted, switches, r: assets.residency, mostUploaded: () => mostUploaded, now: () => now };
}
