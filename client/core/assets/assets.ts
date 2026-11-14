// The asset library: what assets there are, which fills each slot of the content, and which levels are on the graphics
// card. The whole pack is loaded at start today, so every level is resident and `level` answers what it is asked.

import type { Registry } from "../../../shared/content/registry.ts";
import type { Pack } from "../../../shared/pack/pack.ts";
import { Binding } from "./bind.ts";
import { AssetTable } from "./table.ts";

export class Assets {
  readonly table: AssetTable;
  readonly bind: Binding;

  constructor(reg: Registry, pack: Pack) {
    this.table = new AssetTable(pack);
    this.bind = new Binding(reg.defs, this.table);
  }

  /**
   * The level of `mesh` to draw when `wanted` is asked for: that level if it is resident, else the nearest that is.
   * Every draw of the scene passes through here.
   */
  level(_mesh: number, wanted: number): number {
    return wanted;
  }
}
