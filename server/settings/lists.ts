// The settings that are lists naming classes, as tables keyed by content index. ARK writes its own class names, and here they are
// content ids ("core:raptor"). An entry naming something this build lacks is counted and reported, never an error (D86).

import type { Def } from "../../shared/content/defs.ts";
import { find } from "../../shared/content/find.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { field, isList, toNumber, unquote } from "./ini.ts";
import type { Rules } from "./rules.ts";

/** Settings that are lists of names, then settings that are lists of a name and a multiplier, and the family each names. */
const NAMES: Readonly<Record<string, Def["type"]>> = { PreventDinoTameClassNames: "species", PreventBreedingForClassNames: "species" };
const MULTIPLIERS: Readonly<Record<string, Def["type"]>> = {
  HarvestResourceItemAmountClassMultipliers: "item",
  DinoClassDamageMultipliers: "species",
  TamedDinoClassDamageMultipliers: "species",
  DinoClassResistanceMultipliers: "species",
  TamedDinoClassResistanceMultipliers: "species",
};

export class Lists {
  /** Entries that named something this build does not have. */
  readonly missing: { setting: string; name: string }[] = [];
  /** Entries that named something by an id it no longer has, and what they were read as. */
  readonly renamed: { setting: string; name: string; to: string[] }[] = [];
  /** Entries whose name fits several things, and so was read as none of them. */
  readonly unclear: { setting: string; name: string; could: readonly string[] }[] = [];
  private readonly rules: Rules;
  private readonly reg: Registry;
  private readonly sets = new Map<string, { at: number; of: Set<number> }>();
  private readonly maps = new Map<string, { at: number; of: Map<number, number> }>();
  private readonly told = new Set<string>();

  constructor(rules: Rules, reg: Registry) {
    this.rules = rules;
    this.reg = reg;
  }

  /**
   * The content `name` means in `setting`, of `type` if one is given (shared/content/find.ts). More than one where an id
   * was split, as a set of armor's engram became one for each piece. A name that means nothing here is recorded once, in
   * `missing` or `unclear`, and one that was renamed in `renamed`.
   */
  of(setting: string, name: string, type?: Def["type"]): readonly number[] {
    const found = find(this.reg, name, type);
    const key = `${setting} ${name}`;
    if ((found.kinds.length === 0 || found.renamed) && !this.told.has(key)) {
      this.told.add(key);
      if (found.kinds.length > 0) this.renamed.push({ setting, name, to: found.kinds.map((k) => this.reg.ids[k]!) });
      else if (found.could.length > 0) this.unclear.push({ setting, name, could: found.could });
      else this.missing.push({ setting, name });
    }
    return found.kinds;
  }

  /** The same, as ids. */
  ids(setting: string, name: string, type: Def["type"]): string[] {
    return this.of(setting, name, type).map((k) => this.reg.ids[k]!);
  }

  /** Builds every table now, so missing names are known when the server starts and not when a table is first used. */
  warm(): void {
    for (const name of Object.keys(NAMES)) this.kinds(name);
    for (const name of Object.keys(MULTIPLIERS)) this.multipliers(name);
  }

  /** Content indices for a list of names, written `Key="core:raptor"` on any number of lines. */
  kinds(setting: string): ReadonlySet<number> {
    const have = this.sets.get(setting);
    if (have && have.at === this.rules.version) return have.of;
    const of = new Set<number>();
    for (const entry of this.rules.list(setting)) {
      if (typeof entry === "string") for (const k of this.of(setting, unquote(entry), NAMES[setting])) of.add(k);
    }
    this.sets.set(setting, { at: this.rules.version, of });
    return of;
  }

  /** From `(ClassName="core:thatch",Multiplier=2.0)` entries. Content that is not named is absent, and its multiplier is 1. */
  multipliers(setting: string, key = "ClassName"): ReadonlyMap<number, number> {
    const have = this.maps.get(setting);
    if (have && have.at === this.rules.version) return have.of;
    const of = new Map<number, number>();
    for (const entry of this.rules.list(setting)) {
      if (!isList(entry)) continue;
      const name = field(entry, key);
      const by = field(entry, "Multiplier");
      const m = typeof by === "string" ? toNumber(by) : NaN;
      if (typeof name !== "string" || !(m >= 0)) continue;
      for (const k of this.of(setting, unquote(name), MULTIPLIERS[setting])) of.set(k, m);
    }
    this.maps.set(setting, { at: this.rules.version, of });
    return of;
  }
}
