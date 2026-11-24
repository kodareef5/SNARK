// Hands a loadout to a survivor: each entry is minted where the entry says, or in the bag where that is taken. What is handed over
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

/** The slot `item` is worn in, if nothing is worn there, or -1. */
function freeWorn(inv: Inventory, wearSlot: number): number {
  const slot = inv.armor >= 0 && wearSlot >= 0 ? inv.armor + wearSlot : -1;
  return slot >= 0 && inv.item[slot] === 0 ? slot : -1;
}

/** Loads the new weapon in `slot` with a clip of `id`, minted into it. False, with nothing made, if that cannot be. */
function loadWith(ctx: TameContext, rec: EntityRecord, slot: number, weapon: ItemDef, id: string): boolean {
  const { world, items } = ctx;
  const reg = world.reg;
  const ammo = reg.index.get(id);
  const clip = reg.weapon[items.inv(rec).item[slot]!]?.clip ?? 0;
  if (ammo === undefined || !weapon.weapon?.ammo?.includes(id) || !(clip > 0)) return false;
  return items.mintLoaded(rec, slot, ammo, clip, WHY_LOADOUT) === clip;
}

/** Fits one `id`, minted onto it, to the new weapon in `slot`. False, with nothing made, if that cannot be. */
function fitWith(ctx: TameContext, rec: EntityRecord, slot: number, weapon: ItemDef, id: string): boolean {
  const { world, items } = ctx;
  const part = world.reg.index.get(id);
  if (part === undefined || !weapon.weapon?.fits?.includes(id)) return false;
  return items.mintFitted(rec, slot, part, WHY_LOADOUT);
}

function giveItem(ctx: TameContext, rec: EntityRecord, e: ItemEntry, out: Applied): void {
  const { world, items } = ctx;
  const reg = world.reg;
  const name = short(e.item);
  const item = reg.index.get(e.item);
  const def = item === undefined ? undefined : reg.defs[item];
  if (item === undefined || def?.type !== "item") return void out.missed.push(counted(e.count, name));
  const inv = items.inv(rec);
  const flags = e.blueprint === true ? FLAG_BLUEPRINT : 0;
  const quality = e.quality ?? 0;
  const stack = Math.max(1, reg.stack[item]!);
  const fresh: number[] = [];
  let left = e.count;
  // Straight into its place while that is empty: a full bag keeps nothing off the body or the hotbar, and a hotbar
  // entry does not join a stack lying in the bag. A module that makes one smaller has had its say on the rest.
  let refused = false;
  while (flags === 0 && e.place !== "bag" && left > 0 && !refused) {
    const to = e.place === "wear" ? freeWorn(inv, reg.wearSlot[item]!) : freeHotbar(inv);
    if (to < 0) break;
    const want = Math.min(left, stack);
    const made = items.mintAt(rec, to, item, want, quality, WHY_LOADOUT);
    if (made > 0) fresh.push(to);
    left -= made;
    refused = made < want;
  }
  // The rest lies in the bag, as does what found its place taken.
  if (left > 0 && !refused) {
    const empty = emptySlots(inv);
    const before = inv.version;
    left -= items.mint(rec, item, left, quality, 0, -1, WHY_LOADOUT, flags);
    for (const s of empty) if (inv.mod[s]! > before && inv.item[s] === item) fresh.push(s);
  }
  if (left > 0) out.missed.push(counted(left, name));
  if (left === e.count) return;
  out.given.push(counted(e.count - left, name));
  // A weapon lies alone in its slot, so each one made is loaded and fitted.
  if (flags !== 0 || reg.stack[item] !== 1 || (e.ammo === undefined && e.attach === undefined)) return;
  for (const slot of fresh) {
    if (e.ammo !== undefined && !loadWith(ctx, rec, slot, def as ItemDef, e.ammo)) out.missed.push(`${short(e.ammo)} in ${name}`);
    if (e.attach !== undefined && !fitWith(ctx, rec, slot, def as ItemDef, e.attach)) out.missed.push(`${short(e.attach)} on ${name}`);
  }
}

/**
 * Hands `loadout` to `rec`, entry by entry in the book's order. Worn pieces go on where nothing is worn there, hotbar
 * entries take the first empty hotbar slots, each made in its place, and the rest lies in the bag, as does what found
 * its place taken. What did not fit, the game lacks, or a module refused is in `missed`. The caller refreshes the body (Host.refreshBody).
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
