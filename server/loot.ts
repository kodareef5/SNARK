// World loot (planning/workstreams/loot.md): what lies in the world besides a supply drop. A thing that may hold some is
// sealed with a seed when it appears, and what it holds is rolled from the drop book's sources when it is first opened,
// so a thing nobody opens costs nothing and a table put right reaches what is not yet opened.

import type { SpeciesDef } from "../shared/content/defs.ts";
import { hashString } from "../shared/hash.ts";
import { Rng } from "../shared/rng.ts";
import { FLAG_BLUEPRINT, Inventory } from "../shared/sim/items.ts";
import { BODY_SIZES } from "../shared/sim/loot.ts";
import type { SourceDoc, SupplyBook } from "../shared/supply/book.ts";
import { matches, rollSource, tierOf, type Compiled, type Thing } from "../shared/supply/compile.ts";
import { event, type Bus } from "./events/bus.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import { field, toNumber, toSwitch, unquote, type IniNode } from "./settings/ini.ts";
import type { Rules } from "./settings/rules.ts";
import type { ServerWorld } from "./world.ts";

/** A record's mark that its loot is not yet rolled: its level in two bytes, then its seed in four. */
export const LOOT_TAG = 0x6c6f74;
/** The settings' line that changes one source: `(Source="body/apex",Enabled=False,Chance=0.5)`. */
export const SETTING = "ConfigOverrideLootSource";
/** Stacks a body's loot may take: an apex prize of armour is four pieces, beside scraps. */
export const BODY_SLOTS = 12;
const SEED = 0x6c6f6f74;
const ROLL = event("loot.roll");
const FOUND = event("loot.found");

export interface LootContext {
  world: ServerWorld;
  records: Records;
  items: Items;
  rules: Rules;
  bus: Bus;
  /** The drop book in force, compiled (server/supply.ts). */
  compiled: () => Compiled;
  /** The world's seed. */
  seed: number;
}

/**
 * `sources` with the settings' lines laid over them: a line names a source by its key and may switch it and set its
 * chance. A line for no source of the book is returned in `unknown`.
 */
export function overridden(sources: readonly SourceDoc[], lines: readonly IniNode[]): { sources: SourceDoc[]; unknown: string[] } {
  const out = sources.map((s) => ({ ...s }));
  const unknown: string[] = [];
  for (const line of lines) {
    if (typeof line === "string") continue;
    const name = field(line, "Source");
    const key = typeof name === "string" ? unquote(name) : "";
    const source = out.find((s) => s.key === key);
    if (!source) {
      unknown.push(key);
      continue;
    }
    const on = field(line, "Enabled");
    const chance = field(line, "Chance");
    if (typeof on === "string" && toSwitch(on) !== null) source.on = toSwitch(on)!;
    if (typeof chance === "string" && Number.isFinite(toNumber(chance))) source.chance = Math.max(0, Math.min(1, toNumber(chance)!));
  }
  return { sources: out, unknown };
}

export class Loot {
  private readonly ctx: LootContext;
  /** Finds rolled since the world began, for the console and the tests. */
  finds = 0;

  constructor(ctx: LootContext) {
    this.ctx = ctx;
  }

  /** The book with the settings' lines over its sources, which the supply system compiles (Supply.sourced). */
  sourced(book: SupplyBook): SupplyBook {
    const lines = this.ctx.rules.list(SETTING);
    return lines.length === 0 || !book.sources ? book : { ...book, sources: overridden(book.sources, lines).sources };
  }

  /** The sources in force. */
  sources(): readonly SourceDoc[] {
    return this.ctx.compiled().book.sources ?? [];
  }

  /** Marks `body`, a wild creature's of `level`, as holding loot not yet rolled. */
  seal(body: EntityRecord, level: number): void {
    const seed = hashString(`body/${body.pid}/${this.ctx.world.tick}`, (this.ctx.seed + SEED) >>> 0);
    const l = Math.max(0, Math.min(65535, Math.round(level)));
    body.extra.set(LOOT_TAG, Uint8Array.of(l & 255, l >> 8, seed & 255, (seed >>> 8) & 255, (seed >>> 16) & 255, seed >>> 24));
  }

  sealed(rec: EntityRecord): boolean {
    return rec.extra.has(LOOT_TAG);
  }

  /**
   * Rolls a sealed body's loot into it, once: every source that is the loot of such a body, and a little of what its
   * species gives where they gave nothing, so a body is never empty. `by` is who opened it, or 0. Returns the stacks put in.
   */
  body(rec: EntityRecord, species: number, by = 0): number {
    const { world, records, rules } = this.ctx;
    const tag = rec.extra.get(LOOT_TAG);
    if (!tag || tag.length < 6) return 0;
    rec.extra.delete(LOOT_TAG);
    records.dirty.add(rec.pid);
    if (!rules.on("WorldLootEnabled") || !rules.on("BodyLootEnabled")) return 0;
    // A body's record has room for one stack where nothing gave it more (server/items.ts): its loot needs a bag.
    if (!rec.inv || rec.inv.used() === 0) rec.inv = new Inventory(BODY_SLOTS);
    const reg = world.reg;
    const level = tag[0]! | (tag[1]! << 8);
    const seed = (tag[2]! | (tag[3]! << 8) | (tag[4]! << 16) | (tag[5]! << 24)) >>> 0;
    const stacks = this.fill(rec, { kind: "body", species: reg.ids[species]!, size: BODY_SIZES[reg.bodySize[species]!]!, level }, seed, by);
    return stacks > 0 ? stacks : this.own(rec, species, seed);
  }

  /** Rolls every source that is the loot of `thing` into `rec`, each from `seed` and its own key. Returns the stacks put in. */
  fill(rec: EntityRecord, thing: Thing, seed: number, by = 0): number {
    const { items, rules, bus } = this.ctx;
    const compiled = this.ctx.compiled();
    const amount = rules.num("WorldLootAmountMultiplier");
    let stacks = 0;
    for (const source of compiled.book.sources ?? []) {
      if (!source.on || !matches(source, thing)) continue;
      const asked = { source: source.key, kind: thing.kind, pid: rec.pid, byPid: by, level: thing.level ?? 0, tier: tierOf(source, thing.level), chance: rules.num("WorldLootChanceMultiplier") };
      if (bus.n[ROLL] !== 0 && bus.before(ROLL, asked) !== "") continue;
      const drops = rollSource(compiled, source, String(asked.tier), new Rng(hashString(`${source.key}/${seed}`, (this.ctx.seed + SEED) >>> 0)), Number(asked.chance));
      let put = 0;
      for (const d of drops) {
        // A blueprint is one thing whatever the server gives of the rest.
        const n = d.blueprint ? d.count : Math.max(1, Math.round(d.count * amount));
        if (items.mint(rec, d.item, n, d.quality, 0, -1, "loot", d.blueprint ? FLAG_BLUEPRINT : 0) > 0) put++;
      }
      if (put > 0) {
        this.finds++;
        bus.after(FOUND, { source: source.key, kind: thing.kind, pid: rec.pid, byPid: by, tier: String(asked.tier), stacks: put });
      }
      stacks += put;
    }
    return stacks;
  }

  /** One pick of what the species' body gives when harvested, by its weights: what a body holds when no source gave it anything. */
  private own(rec: EntityRecord, species: number, seed: number): number {
    const drops = (this.ctx.world.reg.defs[species] as SpeciesDef | undefined)?.drops ?? [];
    const total = drops.reduce((sum, d) => sum + (d.weight ?? 1), 0);
    if (!(total > 0)) return 0;
    const rng = new Rng(hashString(`own/${seed}`, (this.ctx.seed + SEED) >>> 0));
    let at = rng.float() * total;
    const drop = drops.find((d) => (at -= d.weight ?? 1) < 0) ?? drops[drops.length - 1]!;
    const item = this.ctx.world.reg.index.get(drop.item);
    if (item === undefined) return 0;
    return this.ctx.items.mint(rec, item, drop.min + rng.int(drop.max - drop.min + 1), 0, 0, -1, "loot") > 0 ? 1 : 0;
  }
}
