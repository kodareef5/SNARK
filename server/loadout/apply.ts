// Hands a loadout to a survivor: each entry is minted as any item is, then put where the entry says. What is handed over
// is ordinary from then on. Every stack is asked of a module with the reason "loadout" (item.gain).

import type { ItemDef } from "../../shared/content/defs.ts";
import { isTame, type ItemEntry, type Loadout } from "../../shared/loadout/book.ts";
import { FLAG_BLUEPRINT, HOTBAR_SLOTS, type Inventory } from "../../shared/sim/items.ts";
import type { EntityRecord } from "../records.ts";
import { giveTame, type TameContext } from "./tame.ts";

/** The reason a module is given for each stack (item.gain). */
export const WHY_LOADOUT = "loadout";

export interface ApplyOptions {
  /** Burns everything the survivor holds first. A full soul ball burned so loses its tame. */
  clear?: boolean;
  /** Whether tame entries are handed over. Without it they are passed by, and are not counted as left out. */
  tames?: boolean;
}

/** What was handed over and what was not, as short labels: "30 round_rifle", "pteranodon 240". */
export interface Applied {
  given: string[];
  missed: string[];
}

/** An id without its pack: round_rifle for core:round_rifle. */
const short = (id: string): string => id.slice(id.indexOf(":") + 1);
const counted = (n: number, name: string): string => (n === 1 ? name : `${n} ${name}`);

/** The bag slots of `inv` that are empty. */
function emptySlots(inv: Inventory): number[] {
  const out: number[] = [];
  for (let s = 0; s < inv.bag; s++) if (inv.item[s] === 0) out.push(s);
  return out;
}

/** The first empty hotbar slot, or -1. */
function freeHotbar(inv: Inventory): number {
  if (inv.hotbar >= 0) for (let s = inv.hotbar; s < inv.hotbar + HOTBAR_SLOTS; s++) if (inv.item[s] === 0) return s;
  return -1;
}

/** Loads the new weapon in `slot` with a clip of `id`, minted for it. False, with nothing left behind, if that cannot be. */
function loadWith(ctx: TameContext, rec: EntityRecord, slot: number, weapon: ItemDef, id: string): boolean {
  const { world, items } = ctx;
  const reg = world.reg;
  const ammo = reg.index.get(id);
  const clip = reg.weapon[items.inv(rec).item[slot]!]?.clip ?? 0;
  if (ammo === undefined || !weapon.weapon?.ammo?.includes(id) || !(clip > 0)) return false;
  // No more than the clip, whatever a module makes of it: the rounds go into the weapon.
  const made = items.mint(rec, ammo, clip, 0, 0, -1, WHY_LOADOUT, 0, clip);
  const held = made > 0 ? Math.max(0, items.load(rec, slot, ammo, made)) : 0;
  if (held < made) items.burnItem(rec, ammo, made - held);
  return held === clip;
}

/** Fits one `id`, minted for it, to the new weapon in `slot`. False, with nothing left behind, if that cannot be. */
function fitWith(ctx: TameContext, rec: EntityRecord, slot: number, weapon: ItemDef, id: string): boolean {
  const { world, items } = ctx;
  const reg = world.reg;
  const part = reg.index.get(id);
  const inv = items.inv(rec);
  // Loaded with rounds fired bare, a weapon takes no attachment.
  if (part === undefined || !weapon.weapon?.fits?.includes(id) || (inv.loaded[slot]! > 0 && items.bare(inv.ammo[slot]!))) return false;
  const before = inv.version;
  if (items.mint(rec, part, 1, 0, 0, -1, WHY_LOADOUT, 0, 1) !== 1) return false;
  let from = -1;
  for (let s = 0; s < inv.bag && from < 0; s++) if (inv.mod[s]! > before && inv.item[s] === part) from = s;
  if (from < 0) return false;
  // One that joined a stack is set apart, since only a slot holding one is fitted.
  if (inv.count[from] !== 1) {
    const apart = inv.free();
    if (apart < 0 || items.move(rec, from, rec, apart, 1) !== 1) return (items.burn(rec, from, 1), false);
    from = apart;
  }
  if (items.attach(rec, slot, from)) return true;
  items.burn(rec, from, 1);
  return false;
}

function giveItem(ctx: TameContext, rec: EntityRecord, e: ItemEntry, out: Applied): void {
  const { world, items } = ctx;
  const reg = world.reg;
  const name = short(e.item);
  const item = reg.index.get(e.item);
  const def = item === undefined ? undefined : reg.defs[item];
  if (item === undefined || def?.type !== "item") return void out.missed.push(counted(e.count, name));
  // Settled here, so that only the mint changes a slot until the new stacks are found.
  const inv = items.inv(rec);
  const empty = emptySlots(inv);
  const before = inv.version;
  const flags = e.blueprint === true ? FLAG_BLUEPRINT : 0;
  const made = items.mint(rec, item, e.count, e.quality ?? 0, 0, -1, WHY_LOADOUT, flags);
  if (made < e.count) out.missed.push(counted(e.count - made, name));
  if (made === 0) return;
  out.given.push(counted(made, name));
  // The slots it filled. What joined a stack that was there stays with that stack, in the bag.
  const fresh = empty.filter((s) => inv.mod[s]! > before && inv.item[s] === item);
  if (flags === 0 && e.place === "wear" && fresh.length > 0) {
    const worn = inv.armor >= 0 && reg.wearSlot[item]! >= 0 ? inv.armor + reg.wearSlot[item]! : -1;
    if (worn >= 0 && inv.item[worn] === 0 && items.move(rec, fresh[0]!, rec, worn, 0) > 0) fresh[0] = worn;
  }
  if (flags === 0 && e.place === "hotbar") {
    for (let k = 0; k < fresh.length; k++) {
      const to = freeHotbar(inv);
      if (to < 0) break;
      if (items.move(rec, fresh[k]!, rec, to, 0) > 0) fresh[k] = to;
    }
  }
  // A weapon lies alone in its slot, so each one made is loaded and fitted.
  if (flags !== 0 || reg.stack[item] !== 1 || (e.ammo === undefined && e.attach === undefined)) return;
  for (const slot of fresh) {
    if (e.ammo !== undefined && !loadWith(ctx, rec, slot, def as ItemDef, e.ammo)) out.missed.push(`${short(e.ammo)} in ${name}`);
    if (e.attach !== undefined && !fitWith(ctx, rec, slot, def as ItemDef, e.attach)) out.missed.push(`${short(e.attach)} on ${name}`);
  }
}

/**
 * Hands `loadout` to `rec`, entry by entry in the book's order. Worn pieces go on where nothing is worn there, hotbar
 * entries take the first empty hotbar slots, and the rest lies in the bag, as does what found its place taken. What did
 * not fit, the game lacks, or a module refused is in `missed`. The caller refreshes the body (Host.refreshBody).
 */
export function apply(ctx: TameContext, rec: EntityRecord, loadout: Loadout, opts: ApplyOptions = {}): Applied {
  const { world, items } = ctx;
  const out: Applied = { given: [], missed: [] };
  if (opts.clear) items.burnAll(rec);
  for (const e of loadout.entries) {
    if (!isTame(e)) {
      giveItem(ctx, rec, e, out);
      continue;
    }
    if (!opts.tames) continue;
    const name = `${short(e.tame)} ${e.level}`;
    const kind = world.reg.index.get(e.tame);
    const got = kind === undefined ? "" : giveTame(ctx, rec, kind, e.level, e.saddled, e.place, WHY_LOADOUT);
    (typeof got === "string" ? out.missed : out.given).push(name);
  }
  return out;
}
