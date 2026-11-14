// The settings that are lists naming classes, as tables keyed by content index. ARK writes its own class names, and here they are
// content ids ("core:raptor"). An entry naming something this build lacks is counted and reported, never an error (D86).

import type { Registry } from "../../shared/content/registry.ts";
import { field, isList, toNumber, unquote } from "./ini.ts";
import type { Rules } from "./rules.ts";

/** Settings that are lists of names, then settings that are lists of a name and a multiplier. */
const NAMES = ["PreventDinoTameClassNames", "PreventBreedingForClassNames"];
const MULTIPLIERS = ["HarvestResourceItemAmountClassMultipliers", "DinoClassDamageMultipliers", "TamedDinoClassDamageMultipliers", "DinoClassResistanceMultipliers", "TamedDinoClassResistanceMultipliers"];

export class Lists {
  /** Entries that named something this build does not have. */
  readonly missing: { setting: string; name: string }[] = [];
  /** Entries that named something by an id it no longer has, and what they were read as. */
  readonly renamed: { setting: string; name: string; to: string[] }[] = [];
  private readonly rules: Rules;
  private readonly reg: Registry;
  private readonly sets = new Map<string, { at: number; of: Set<number> }>();
  private readonly maps = new Map<string, { at: number; of: Map<number, number> }>();
  private readonly told = new Set<string>();

  constructor(rules: Rules, reg: Registry) {
    this.rules = rules;
    this.reg = reg;
  }

  /** Returns 0, and records the name in `missing`, if this build has no content of that name or it is not of `type`. */
  index(setting: string, name: string, type?: string): number {
    // A file written before something was renamed still names it.
    const i = this.reg.index.get(name) ?? this.reg.redirects.get(name)?.[0] ?? 0;
    if (i !== 0 && (type === undefined || this.reg.defs[i]!.type === type)) return i;
    if (!this.told.has(`${setting} ${name}`)) {
      this.told.add(`${setting} ${name}`);
      this.missing.push({ setting, name });
    }
    return 0;
  }

  /**
   * The ids `name` means now: itself, or everything it was renamed to, as a set of armor's engram became one for each
   * piece. Empty, and recorded in `missing`, if this build has nothing of that name and `type`.
   */
  ids(setting: string, name: string, type: string): string[] {
    if (this.reg.index.has(name)) return this.index(setting, name, type) === 0 ? [] : [name];
    const now = (this.reg.redirects.get(name) ?? []).filter((i) => this.reg.defs[i]!.type === type).map((i) => this.reg.ids[i]!);
    if (now.length === 0) this.index(setting, name, type);
    else if (!this.told.has(`${setting} ${name}`)) {
      this.told.add(`${setting} ${name}`);
      this.renamed.push({ setting, name, to: now });
    }
    return now;
  }

  /** Builds every table now, so missing names are known when the server starts and not when a table is first used. */
  warm(): void {
    for (const name of NAMES) this.kinds(name);
    for (const name of MULTIPLIERS) this.multipliers(name);
  }

  /** Content indices for a list of names, written `Key="core:raptor"` on any number of lines. */
  kinds(setting: string): ReadonlySet<number> {
    const have = this.sets.get(setting);
    if (have && have.at === this.rules.version) return have.of;
    const of = new Set<number>();
    for (const entry of this.rules.list(setting)) {
      const i = typeof entry === "string" ? this.index(setting, unquote(entry)) : 0;
      if (i !== 0) of.add(i);
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
      const i = this.index(setting, unquote(name));
      if (i !== 0) of.set(i, m);
    }
    this.maps.set(setting, { at: this.rules.version, of });
    return of;
  }
}
