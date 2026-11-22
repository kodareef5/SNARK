// A dropped bag that holds one stack is drawn as that stack's item lying on the ground, in place of the bag. The server
// says which item in the bag's replicated gear, in the place of the item in hand (server/death.ts), so nothing new
// travels. An item lies as its own #dropped mesh (`<id>/dropped`, made by tools/pack/lying.ts or modelled), and one that
// has none is drawn as the bag, as is a bag of more than one stack.

import type { Registry } from "../../../shared/content/registry.ts";
import { GEAR_HELD } from "../../../shared/sim/entities.ts";
import type { Binding } from "../assets/bind.ts";
import { droppedTurn, inFlight } from "../../../shared/sim/loose.ts";

/** The container a single drop makes, as server/death.ts names it. */
export const BAG = "core:bag";

export class Dropped {
  /** The bag's content index, or -1. */
  private readonly bag: number;
  /** Per content index, an item's own lying mesh, or -1. */
  private readonly lies: Int32Array;
  private readonly color: Uint8Array;

  constructor(reg: Registry, bind: Binding) {
    this.bag = reg.index.get(BAG) ?? -1;
    this.lies = Int32Array.from(reg.defs, (d) => (d?.type === "item" ? bind.own(d.id, "dropped") : -1));
    this.color = Uint8Array.from(reg.defs, (d) => (d?.type === "item" ? (d.color ?? 0) : 0));
  }

  /** The item a thing of `kind` lies as, its gear at `at` in `gear`: a content index, or 0 where it is drawn as its kind. */
  item(kind: number, gear: Uint16Array, at: number): number {
    if (kind !== this.bag) return 0;
    const item = gear[at + GEAR_HELD]!;
    return item < this.lies.length && this.lies[item]! >= 0 ? item : 0;
  }

  /** Whether a thing of `kind` with the anim word `anim` is a bag in flight (server/loose.ts), drawn along its length. */
  flying(kind: number, anim: number): boolean {
    return kind === this.bag && inFlight(anim);
  }

  /** The mesh an item that `item()` gave lies as. */
  mesh(item: number): number {
    return this.lies[item]!;
  }

  /** The palette colour of its first colour region. */
  colorOf(item: number): number {
    return this.color[item]!;
  }

  /** Its yaw in 65536ths of a turn: its bag's, turned by its id, so that things dropped together do not lie side by side in line. */
  yaw(id: number, yaw: number): number {
    return (yaw + droppedTurn(id)) & 0xffff;
  }
}
