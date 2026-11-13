// The settings that are lists naming classes, as tables keyed by content.
//
// ARK writes these with its own class names; here they take content ids
// ("core:raptor"). An entry naming something this build does not have is
// counted and reported, never an error (D86): a list written for another
// build of the content still starts the server.
//
// Each table is worked out when it is first asked for and again only when a
// rule has changed since.

import type { Registry } from "../../shared/content/registry.ts";
import { field, isList, toNumber, unquote } from "./ini.ts";
import type { Rules } from "./rules.ts";

export class Lists {
  /** Entries that named something this build does not have: the setting and the name. */
  readonly missing: { setting: string; name: string }[] = [];
  private readonly rules: Rules;
  private readonly reg: Registry;
  private readonly sets = new Map<string, { at: number; of: Set<number> }>();
  private readonly maps = new Map<string, { at: number; of: Map<number, number> }>();
  private readonly told = new Set<string>();

  constructor(rules: Rules, reg: Registry) {
    this.rules = rules;
    this.reg = reg;
  }

  private index(setting: string, name: string): number {
    const i = this.reg.index.get(name);
    if (i === undefined && !this.told.has(`${setting} ${name}`)) {
      this.told.add(`${setting} ${name}`);
      this.missing.push({ setting, name });
    }
    return i ?? 0;
  }

  /** The content named by a list of names (`Key="core:raptor"`, any number of lines), as content indices. */
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

  /**
   * A list of `(ClassName="core:thatch",Multiplier=2.0)` entries as content
   * index to multiplier. What is not named is not in the table: its
   * multiplier is 1. `key` is the field that holds the name.
   */
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
