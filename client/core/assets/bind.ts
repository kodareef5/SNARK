// Finds the asset that fills a slot of a definition (shared/content/slots.ts). Nothing here knows how the art is named:
// the class table does.

import type { Def } from "../../../shared/content/defs.ts";
import { fillSlot, slotAddress, slotsOf, type SlotUse } from "../../../shared/content/slots.ts";
import type { AssetTable } from "./table.ts";

export class Binding {
  private readonly uses = new Map<string, SlotUse>();
  private readonly table: AssetTable;

  constructor(defs: readonly (Def | null)[], table: AssetTable) {
    this.table = table;
    for (const u of slotsOf(defs.filter((d) => d !== null))) this.uses.set(slotAddress(u), u);
  }

  /** The id of the asset that fills `owner#slot/key`: its own, or the one that stands in. "" when only a word does, or there is no such slot. */
  id(owner: string, slot: string, key = ""): string {
    const u = this.uses.get(slotAddress({ owner, slot, key }));
    return u ? fillSlot(u, this.table.has).id : "";
  }

  /** The mesh that fills the slot, its own or a stand-in, or -1. */
  mesh(owner: string, slot: string, key = ""): number {
    const id = this.id(owner, slot, key);
    return id === "" ? -1 : this.table.find(id);
  }

  /** The slot's own mesh and no stand-in, or -1. For a caller that does something else of its own when the art is missing. */
  own(owner: string, slot: string, key = ""): number {
    const u = this.uses.get(slotAddress({ owner, slot, key }));
    return u && u.id !== "" ? this.table.find(u.id) : -1;
  }
}
