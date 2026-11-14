// The asset library: what assets there are, which fills each slot of the content, how fine a level each thing is drawn
// at, and which levels are on the graphics card. Given one whole pack, every level is in it and is resident when first
// drawn. Given a manifest and a port, only the boot pack is here at start and the rest is asked for as it is wanted.

import type { Registry } from "../../../shared/content/registry.ts";
import { describePack, type Manifest } from "../../../shared/pack/manifest.ts";
import type { Pack } from "../../../shared/pack/pack.ts";
import type { FramePacket } from "../render/packet.ts";
import { Binding } from "./bind.ts";
import type { AssetPort } from "./port.ts";
import { Residency } from "./residency.ts";
import { AssetTable } from "./table.ts";
import { DEFAULT_TIER, tierOf, type Tier } from "./tiers.ts";

/** A level is left only when another is right by this margin, so that a body at the edge of a switch does not flicker. */
export const HYSTERESIS = 0.15;

export class Assets {
  readonly table: AssetTable;
  readonly bind: Binding;
  readonly residency: Residency;
  /** The graphics tier: how much error on screen is let pass, and the finest level ever drawn. */
  tier: Tier = tierOf(DEFAULT_TIER);
  /** The pixels a metre covers on screen from a metre away. */
  private scale = 0;

  /** Without a manifest the pack is taken to hold every level of every mesh. */
  constructor(reg: Registry, pack: Pack, manifest: Manifest = describePack(pack, { name: "", bytes: pack.blobAt + pack.blob.length }), port: AssetPort | null = null) {
    this.table = new AssetTable(manifest, pack);
    this.bind = new Binding(reg.defs, this.table);
    this.residency = new Residency(manifest, pack, port);
    this.begin(0, 720, 1.2217);
  }

  /** Starts a frame: the time, and the view's height in pixels and vertical field of view in radians. */
  begin(nowMs: number, height: number, fovY: number): void {
    this.scale = height / (2 * Math.tan(fovY / 2));
    this.residency.budget = this.tier.gpuBytes;
    this.residency.uploadBytes = this.tier.uploadBytes;
    this.residency.begin(nowMs);
  }

  /** Ends a frame: what the graphics card must take on and let go goes into the packet. */
  end(packet: FramePacket, nowMs: number): void {
    this.residency.end(packet.assetUploads, packet.assetDrops, nowMs);
  }

  /**
   * The level to draw something at, `distance` metres off, whose levels lie `errors` metres from its finest: the
   * coarsest whose error covers no more pixels than the tier lets pass. `was` is the level it had last, or -1.
   */
  choose(errors: readonly number[], distance: number, was: number): number {
    const allowed = (this.tier.threshold * this.residency.relax * distance) / this.scale;
    const finest = Math.min(this.tier.finest, errors.length - 1);
    const within = (limit: number): number => {
      let level = errors.length - 1;
      while (level > finest && errors[level]! > limit) level--;
      return level;
    };
    const want = within(allowed);
    if (was < 0 || was >= errors.length || want === was) return want;
    if (want > was) return Math.max(was, within(allowed * (1 - HYSTERESIS)));
    return errors[was]! > allowed * (1 + HYSTERESIS) || was < finest ? want : was;
  }

  /**
   * Says a level of a mesh is wanted for something `distance` metres off. The more pixels of error the level saves
   * over the mesh's coarsest, and the nearer, the sooner it is fetched.
   */
  want(mesh: number, level: number, distance: number): void {
    const errors = this.table.error[mesh]!;
    const at = level < errors.length ? level : errors.length - 1;
    const d = distance > 1 ? distance : 1;
    this.residency.want(mesh, at, ((errors[errors.length - 1]! - errors[at]!) * this.scale) / d + 1 / d);
  }

  /**
   * The level of `mesh` to draw when `wanted` is asked for: that level if the mesh has it and it is resident, else the
   * nearest that is, else -1. Every draw of the scene passes through here.
   */
  level(mesh: number, wanted: number): number {
    return this.residency.level(mesh, wanted);
  }
}
