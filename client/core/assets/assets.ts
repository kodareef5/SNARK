// The asset library: what assets there are, which fills each slot of the content, how fine a level each thing is drawn
// at, and which levels are on the graphics card. The whole pack is loaded at start today, so every level is resident.

import type { Registry } from "../../../shared/content/registry.ts";
import { describePack, type Manifest } from "../../../shared/pack/manifest.ts";
import type { Pack } from "../../../shared/pack/pack.ts";
import { Binding } from "./bind.ts";
import { AssetTable } from "./table.ts";
import { DEFAULT_TIER, tierOf, type Tier } from "./tiers.ts";

/** A level is left only when another is right by this margin, so that a body at the edge of a switch does not flicker. */
export const HYSTERESIS = 0.15;

export class Assets {
  readonly table: AssetTable;
  readonly bind: Binding;
  /** The graphics tier: how much error on screen is let pass, and the finest level ever drawn. */
  tier: Tier = tierOf(DEFAULT_TIER);
  /** The pixels a metre covers on screen from a metre away. */
  private scale = 0;

  /** Without a manifest the pack is taken to hold every level of every mesh. */
  constructor(reg: Registry, pack: Pack, manifest: Manifest = describePack(pack, { name: "", bytes: pack.blobAt + pack.blob.length })) {
    this.table = new AssetTable(manifest, pack);
    this.bind = new Binding(reg.defs, this.table);
    this.view(720, 1.2217);
  }

  /** The view this frame: its height in pixels and its vertical field of view in radians. */
  view(height: number, fovY: number): void {
    this.scale = height / (2 * Math.tan(fovY / 2));
  }

  /**
   * The level to draw something at, `distance` metres off, whose levels lie `errors` metres from its finest: the
   * coarsest whose error covers no more pixels than the tier lets pass. `was` is the level it had last, or -1.
   */
  choose(errors: readonly number[], distance: number, was: number): number {
    const allowed = (this.tier.threshold * distance) / this.scale;
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
   * The level of `mesh` to draw when `wanted` is asked for: that level if the mesh has it and it is resident, else the
   * nearest that is. Every draw of the scene passes through here.
   */
  level(mesh: number, wanted: number): number {
    const coarsest = this.table.tris[mesh]!.length - 1;
    return wanted > coarsest ? coarsest : wanted;
  }
}
