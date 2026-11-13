// The server's rules: the value each setting of the catalogue has now.
//
// A value comes from the catalogue's default, a config file, the command
// line, the live file or the console, in that order of strength (D88), and
// remembers which. Rules are read where they are used; nothing caches one.
// They are factors and switches, never a branch at a call site (D66).
//
// Until the end of round 5 the sixteen rules that came before the catalogue
// keep their old names as aliases (`values`, `set`), each standing for one or
// two of ARK's settings.

import { CATALOG, rowOf } from "./catalog.ts";
import { isList, toNumber, toSwitch, unquote, type IniNode } from "./ini.ts";
import type { Row } from "./row.ts";

/** Where a value came from, weakest first. */
export const SOURCES = ["default", "file", "command line", "live file", "console"] as const;
export type Source = (typeof SOURCES)[number];

/** What a setting holds: a number, a switch, words, a number for each index, or the entries of a list. */
export type Value = number | boolean | string | readonly number[] | readonly IniNode[];

/** The old rules, by their old names, with what each begins as: ARK's defaults for the settings they stand for. */
export const RULE_DEFAULTS = {
  playerDamage: 1,
  creatureDamage: 1,
  structureDamage: 1,
  selfDamage: 1,
  headshots: 1,
  damageNumbers: 0,
  friendlyFire: 0,
  globalChat: 1,
  globalVoice: 0,
  tamingSpeed: 1,
  hatchSpeed: 1,
  matureSpeed: 1,
  matingInterval: 1,
  pickupSeconds: 30,
  decayTime: 1,
  decayDestroy: 0,
} as const;

export type RuleName = keyof typeof RULE_DEFAULTS;
export const RULE_NAMES = Object.keys(RULE_DEFAULTS) as RuleName[];
/** The most an old rule may be set to. */
export const RULE_MAX = 1000;

/** The key a row's value is kept under: its exact name, and for a command-line flag a dash before it. */
const slot = (row: Row): string => (row.kind === "flag" ? "-" : "") + row.name;

function defaultOf(row: Row): Value {
  if (row.kind === "struct" || row.kind === "names" || row.kind === "lines") return [];
  if (row.kind === "indexed") return [...(row.def as readonly number[])];
  return row.def as number | boolean | string;
}

/**
 * Read what a config line gives a setting. Returns the value, or words saying
 * why it will not do. For a list this is one entry; for an indexed setting,
 * the number for one index.
 */
export function readValue(row: Row, node: IniNode): { value: number | boolean | string | IniNode } | string {
  if (row.kind === "struct") return isList(node) ? { value: node } : "wants a value in brackets";
  if (isList(node)) return "wants a single value, not a bracketed one";
  const text = unquote(node);
  if (row.kind === "bool") {
    const b = toSwitch(text);
    return b === null ? `wants True or False, got "${text}"` : { value: b };
  }
  if (row.kind === "text") return { value: text };
  if (row.kind === "names") return text === "" ? "wants a name" : { value: text };
  if (row.kind === "flag") {
    if (row.def === false) {
      const b = text === "" ? true : toSwitch(text);
      return b === null ? "takes no value" : { value: b };
    }
    if (text === "") return "wants a value";
    if (row.max > 0) {
      const n = toNumber(text);
      if (!(n >= row.min && n <= row.max)) return `wants a number from ${row.min} to ${row.max}, got "${text}"`;
    }
    return { value: text };
  }
  // A number: float, int, one index of an indexed setting, or one line of a list of numbers.
  const n = toNumber(text);
  if (Number.isNaN(n)) return `wants a number, got "${text}"`;
  if ((row.kind === "int" || row.kind === "lines") && !Number.isInteger(n)) return `wants a whole number, got ${text}`;
  if (!(n >= row.min && n <= row.max)) return `wants a number from ${row.min} to ${row.max}, got ${text}`;
  return { value: n };
}

export class Rules {
  /** Counts every change, for sending. */
  version = 0;
  private readonly vals = new Map<string, Value>();
  private readonly from = new Map<string, Source>();
  private old: Record<RuleName, number> | null = null;

  /** Rules begin as the catalogue's defaults, which are ARK's. `first` gives some of the old rules other values to begin with. */
  constructor(first: Partial<Record<RuleName, number>> = {}) {
    for (const row of CATALOG) this.vals.set(slot(row), defaultOf(row));
    for (const name of RULE_NAMES) {
      const v = first[name];
      if (typeof v === "number") this.set(name, v);
    }
    this.from.clear();
    this.version = 0;
  }

  private need(name: string): Value {
    const v = this.vals.get(name);
    if (v === undefined) throw new Error(`there is no setting called ${name}`);
    return v;
  }

  /** A number: a multiplier, a count, a time. */
  num(name: string): number {
    const v = this.need(name);
    if (typeof v !== "number") throw new Error(`${name} is not a number`);
    return v;
  }

  /** A switch. */
  on(name: string): boolean {
    const v = this.need(name);
    if (typeof v !== "boolean") throw new Error(`${name} is not a switch`);
    return v;
  }

  /** Words. */
  text(name: string): string {
    const v = this.need(name);
    if (typeof v !== "string") throw new Error(`${name} is not words`);
    return v;
  }

  /** The numbers of an indexed setting, one for each index. */
  indexed(name: string): readonly number[] {
    const v = this.need(name);
    if (!Array.isArray(v)) throw new Error(`${name} is not indexed`);
    return v as readonly number[];
  }

  /** The entries of a list of structs or of names, as they were written. */
  list(name: string): readonly IniNode[] {
    const v = this.need(name);
    if (!Array.isArray(v)) throw new Error(`${name} is not a list`);
    return v as readonly IniNode[];
  }

  /** The entries of a list of numbers, in the order of their lines. */
  numbers(name: string): readonly number[] {
    const v = this.need(name);
    if (!Array.isArray(v)) throw new Error(`${name} is not a list`);
    return v as readonly number[];
  }

  /** A command-line flag: whether it was given, or for one that takes a value, that value ("" if it was not given). */
  flag(name: string): boolean | string {
    return this.need("-" + name) as boolean | string;
  }

  /** Where a setting's value came from. */
  sourceOf(row: Row): Source {
    return this.from.get(slot(row)) ?? "default";
  }

  /** What a setting holds, whatever kind it is: for reports. */
  valueOf(row: Row): Value {
    return this.need(slot(row));
  }

  /** Whether a value from `source` may replace what the setting holds: only one from a source at least as strong. */
  yields(row: Row, source: Source): boolean {
    return SOURCES.indexOf(source) >= SOURCES.indexOf(this.sourceOf(row));
  }

  /** Give a setting a value that has been read and checked (`readValue`), from a source. */
  put(row: Row, value: Value, source: Source): void {
    this.vals.set(slot(row), value);
    this.from.set(slot(row), source);
    this.version++;
    this.old = null;
  }

  /**
   * Set a setting from words, as the console does: by ARK's name, whatever
   * its case. Returns "" if it was set, or why it was not. Lists and indexed
   * settings are not set this way.
   */
  assign(name: string, words: string, source: Source): string {
    const row = rowOf(name);
    if (!row) return `there is no setting called ${name}`;
    if (row.kind === "struct" || row.kind === "names" || row.kind === "lines" || row.kind === "indexed") return `${row.name} is a list: it is set in its file`;
    const got = readValue(row, words);
    if (typeof got === "string") return `${row.name} ${got}`;
    this.put(row, got.value as Value, source);
    return "";
  }

  /** The old rules, by their old names, as numbers: what each stands for now. */
  get values(): Record<RuleName, number> {
    if (this.old) return this.old;
    const sw = (name: string): number => (this.on(name) ? 1 : 0);
    this.old = {
      playerDamage: this.num("PlayerResistanceMultiplier"),
      creatureDamage: this.num("DinoResistanceMultiplier"),
      structureDamage: this.num("StructureResistanceMultiplier"),
      selfDamage: this.num("SelfDamageMultiplier"),
      headshots: sw("HeadMultipliers"),
      damageNumbers: sw("ShowFloatingDamageText"),
      friendlyFire: sw("FullFriendlyFire"),
      globalChat: this.on("ProximityChat") ? 0 : 1,
      globalVoice: sw("globalVoiceChat"),
      tamingSpeed: this.num("TamingSpeedMultiplier"),
      hatchSpeed: this.num("EggHatchSpeedMultiplier"),
      matureSpeed: this.num("BabyMatureSpeedMultiplier"),
      matingInterval: this.num("MatingIntervalMultiplier"),
      // 0 was "at any time".
      pickupSeconds: this.on("AlwaysAllowStructurePickup") ? 0 : this.num("StructurePickupTimeAfterPlacement"),
      // 0 was "nothing decays".
      decayTime: this.on("DisableStructureDecayPvE") ? 0 : this.num("PvEStructureDecayPeriodMultiplier"),
      decayDestroy: this.num("AutoDestroyOldStructuresMultiplier") > 0 && this.flag("AutoDestroyStructures") === true ? 1 : 0,
    };
    return this.old;
  }

  /** Set an old rule by its old name. False if there is no such rule or the value is not a number from 0 to RULE_MAX. */
  set(name: string, value: number): boolean {
    if (!(RULE_NAMES as string[]).includes(name) || !(value >= 0 && value <= RULE_MAX)) return false;
    const to = (ark: string, v: Value): void => {
      const row = rowOf(ark)!;
      // An old rule might be 0 where the setting it stands for, which time is divided by, may not: the least it may be, then.
      this.put(row, typeof v === "number" && v < row.min ? row.min : v, "console");
    };
    switch (name as RuleName) {
      case "playerDamage": to("PlayerResistanceMultiplier", value); break;
      case "creatureDamage": to("DinoResistanceMultiplier", value); break;
      case "structureDamage": to("StructureResistanceMultiplier", value); break;
      case "selfDamage": to("SelfDamageMultiplier", value); break;
      case "headshots": to("HeadMultipliers", value !== 0); break;
      case "damageNumbers": to("ShowFloatingDamageText", value !== 0); break;
      case "friendlyFire": to("FullFriendlyFire", value !== 0); break;
      case "globalChat": to("ProximityChat", value === 0); break;
      case "globalVoice": to("globalVoiceChat", value !== 0); break;
      case "tamingSpeed": to("TamingSpeedMultiplier", value); break;
      case "hatchSpeed": to("EggHatchSpeedMultiplier", value); break;
      case "matureSpeed": to("BabyMatureSpeedMultiplier", value); break;
      case "matingInterval": to("MatingIntervalMultiplier", value); break;
      case "pickupSeconds":
        to("AlwaysAllowStructurePickup", value === 0);
        if (value !== 0) to("StructurePickupTimeAfterPlacement", value);
        break;
      case "decayTime":
        to("DisableStructureDecayPvE", value === 0);
        if (value !== 0) to("PvEStructureDecayPeriodMultiplier", value);
        break;
      case "decayDestroy":
        // The old rule was one switch; ARK's is a multiplier that also needs its command-line flag.
        to("AutoDestroyOldStructuresMultiplier", value !== 0 ? 1 : 0);
        this.put(rowOf("AutoDestroyStructures", true)!, value !== 0, "console");
        break;
    }
    return true;
  }

  /**
   * The values that timers already running were worked out under: every
   * setting that re-times something, by name. Stored with the world (D91), so
   * that a save loaded under other values can be re-timed once.
   */
  timers(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const row of CATALOG) if (row.retime !== "") out[row.name] = this.num(row.name);
    return out;
  }
}

/**
 * What a save's timers were worked out under, read back: the stored
 * snapshot, or for a save from before there was one, the three old rules
 * that were saved with the world. Null if there is neither.
 */
export function timersOf(snapshot: string | number | null, oldRules: string | number | null): Record<string, number> | null {
  const read = (text: string | number | null): Record<string, unknown> | null => {
    if (typeof text !== "string") return null;
    try {
      const parsed: unknown = JSON.parse(text);
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const out: Record<string, number> = {};
  const snap = read(snapshot);
  const timers = snap && typeof snap.timers === "object" && snap.timers !== null ? (snap.timers as Record<string, unknown>) : null;
  if (timers) {
    for (const [name, v] of Object.entries(timers)) if (typeof v === "number" && v > 0) out[name] = v;
    return out;
  }
  const old = read(oldRules);
  if (!old) return null;
  for (const [was, name] of [["hatchSpeed", "EggHatchSpeedMultiplier"], ["matureSpeed", "BabyMatureSpeedMultiplier"], ["matingInterval", "MatingIntervalMultiplier"]] as const) {
    const v = old[was];
    if (typeof v === "number" && v > 0) out[name] = v;
  }
  return out;
}
