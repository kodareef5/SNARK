// One row of the catalogue: a setting an ARK dedicated server reads, and what
// this engine does with it.
//
// The catalogue is data. Parsing a config file, checking a value, the report
// printed at start, the reference page, what a client is told and what is
// stored for re-timing are all derived from these rows (D87). Nothing about a
// setting is decided anywhere else.
//
// A row's `status` is the plan for it:
//   live     it takes effect here, as the reference describes it
//   todo     it will this round, in the phase named in `waits`; until then it
//            is read, checked, and reported as not yet effective
//   planned  it waits for a feature this engine does not have yet (`waits` is
//            a key of FEATURES): the list that guides later rounds
//   none     it has no meaning here (`waits` is a key of NOT_HERE)

/** What a value is, and how it is written in an ini file. */
export type Kind =
  /** `Key=1.5` */
  | "float"
  /** `Key=3` */
  | "int"
  /** `Key=True` */
  | "bool"
  /** `Key=some words` */
  | "text"
  /** `Key[3]=0.5`, one line for each index that differs from the default */
  | "indexed"
  /** `Key=(A=1,B="x")`, one line for each entry */
  | "struct"
  /** `Key="core:raptor"`, one line for each name */
  | "names"
  /** `Key=8`, one line for each in order (engram points for each level) */
  | "lines"
  /** `-Key` on the command line, or `-Key=value` */
  | "flag";

/** Where ARK reads a setting from. */
export type Place =
  /** GameUserSettings.ini `[ServerSettings]`; also `?Key=Value` on the command line. */
  | "server"
  /** GameUserSettings.ini `[SessionSettings]`. */
  | "session"
  /** GameUserSettings.ini `[MessageOfTheDay]`. */
  | "motd"
  /** GameUserSettings.ini `[/Script/Engine.GameSession]`. */
  | "gamesession"
  /** GameUserSettings.ini, a section for one of ARK's maps. */
  | "map"
  /** GameUserSettings.ini `[SnarkSettings]`: ours, for what ARK has no key for. */
  | "snark"
  /** Game.ini `[/script/shootergame.shootergamemode]`. Never on the command line. */
  | "mode"
  /** The command line only. */
  | "cli"
  /** ARK's live file only. */
  | "dynamic";

/** Features this engine does not have yet, each with the settings that wait for it. */
export const FEATURES = {
  spawner: "Wild creatures that spawn and respawn by region",
  imprinting: "Imprinting and baby care",
  tameBonus: "Taming bonuses in a tame's stats, passive taming, mate boost, unfertilised eggs",
  defences: "Defences: turrets, spikes, and explosives that are set",
  limits: "Structure limits, platforms, caves, and where building is prevented",
  decay: "Decay in finer grain, and of tamed creatures; unclaiming",
  offline: "Offline protection, PvP timers, and hardcore",
  tribes: "Tribes in depth: alliances, the log, wars, merges, cooldowns",
  dinoHarvest: "Creatures that harvest, and raid creatures",
  regrowth: "Nodes that do not grow back near what is built",
  farming: "Farming, irrigation, and upkeep of the body",
  loot: "Loot: supply crates, fishing, quality, item stat clamps, custom recipes",
  passiveXp: "Experience over time, from notes and events, and by what was killed",
  flyers: "Flyers",
  weather: "Weather, temperature, and disease",
  transfers: "Transfers between servers",
  ops: "Operations: RCON, ban and admin lists, exclusive join, logs, filters, the live file by URL",
  polish: "Small behaviours of things already built",
} as const;
export type Feature = keyof typeof FEATURES;

/** Why a setting has no meaning here. */
export const NOT_HERE = {
  anticheat: "ARK's anti-cheat and integrity checks",
  platform: "ARK's platforms, stores and save formats",
  unreal: "Unreal Engine performance and client switches",
  mods: "ARK's mods",
  expansion: "Things only ARK's expansions, events or named maps have",
  deprecated: "Deprecated in ARK itself",
} as const;
export type NotHere = keyof typeof NOT_HERE;

export interface Row {
  /** ARK's key, as ARK writes it. Matched without regard to case. */
  readonly name: string;
  readonly at: Place;
  readonly kind: Kind;
  /** The default: a number, a switch, words, or for an indexed setting one number for each index. Null for lists, which start empty. */
  readonly def: number | boolean | string | readonly number[] | null;
  /** The least and the most a number may be. */
  readonly min: number;
  readonly max: number;
  readonly status: "live" | "todo" | "planned" | "none";
  /** For `todo`, the phase that wires it ("phase 4"); for `planned`, a Feature; for `none`, a NotHere. */
  readonly waits: string;
  /** It may be changed while the server runs: from the console or the live file. */
  readonly live: boolean;
  /** Clients are told its value. */
  readonly client: boolean;
  /**
   * What is already under way when it changes: a timer whose time is divided
   * by the value ("speed") or multiplied by it ("period"), re-timed from that
   * moment; a rate a body was given ("rate"), worked out again; or the pace
   * of the clock ("clock"), where the hour is kept as it was. The value a
   * world was saved under is kept with it, so that a save loaded under
   * another is brought to it once (D91).
   */
  readonly retime: "" | "speed" | "period" | "rate" | "clock";
  /** Heading it is listed under in the reference. */
  readonly group: string;
  /** What it scales or switches, and which way. */
  readonly doc: string;
  /** "E": ARK: Survival Evolved only. "A": Ascended only. "": both, or not known. */
  readonly game: "" | "E" | "A";
  /** Quirks, and what the research could not verify. */
  readonly note: string;
}

/** What a row may say beyond its name, default and meaning. */
export interface Extra {
  min?: number;
  max?: number;
  live?: boolean;
  client?: boolean;
  retime?: "speed" | "period" | "rate" | "clock";
  game?: "E" | "A";
  note?: string;
}

interface Standing extends Extra {
  status: Row["status"];
  waits: string;
}

/** It takes effect this round, from the phase given. */
export const todo = (phase: number, x: Extra = {}): Standing => ({ status: "todo", waits: `phase ${phase}`, ...x });
/** It takes effect. */
export const live = (x: Extra = {}): Standing => ({ status: "live", waits: "", ...x });
/** It waits for a feature. */
export const plan = (feature: Feature, x: Extra = {}): Standing => ({ status: "planned", waits: feature, ...x });
/** It has no meaning here. */
export const none = (why: NotHere, x: Extra = {}): Standing => ({ status: "none", waits: why, ...x });

/** The most a multiplier may be, where a row does not say. */
export const MULTIPLIER_MAX = 100000;

/** Rows being written for one place and one heading. */
export class Sheet {
  readonly rows: Row[];
  private readonly at: Place;
  private group: string;

  constructor(rows: Row[], at: Place, group: string) {
    this.rows = rows;
    this.at = at;
    this.group = group;
  }

  /** The rows that follow are listed under another heading. */
  under(group: string): this {
    this.group = group;
    return this;
  }

  private add(name: string, kind: Kind, def: Row["def"], doc: string, s: Standing, min: number, max: number): void {
    this.rows.push({ name, at: this.at, kind, def, min: s.min ?? min, max: s.max ?? max, status: s.status, waits: s.waits, live: s.live ?? false, client: s.client ?? false, retime: s.retime ?? "", group: this.group, doc, game: s.game ?? "", note: s.note ?? "" });
  }

  /** A number with a fraction; most are multipliers. */
  f(name: string, def: number, doc: string, s: Standing): this {
    this.add(name, "float", def, doc, s, 0, MULTIPLIER_MAX);
    return this;
  }

  /** A whole number. */
  i(name: string, def: number, doc: string, s: Standing): this {
    this.add(name, "int", def, doc, s, 0, 2147483647);
    return this;
  }

  /** A switch. */
  b(name: string, def: boolean, doc: string, s: Standing): this {
    this.add(name, "bool", def, doc, s, 0, 1);
    return this;
  }

  /** Words. */
  t(name: string, def: string, doc: string, s: Standing): this {
    this.add(name, "text", def, doc, s, 0, 0);
    return this;
  }

  /** `Key[n]=value`: one default for each index. */
  x(name: string, def: readonly number[], doc: string, s: Standing): this {
    this.add(name, "indexed", def, doc, s, 0, MULTIPLIER_MAX);
    return this;
  }

  /** `Key=(…)`, any number of lines. */
  s(name: string, doc: string, s: Standing): this {
    this.add(name, "struct", null, doc, s, 0, 0);
    return this;
  }

  /** `Key="name"`, any number of lines. */
  n(name: string, doc: string, s: Standing): this {
    this.add(name, "names", null, doc, s, 0, 0);
    return this;
  }

  /** `Key=number`, any number of lines, in order. */
  l(name: string, doc: string, s: Standing): this {
    this.add(name, "lines", null, doc, s, 0, 2147483647);
    return this;
  }

  /** `-Key` on the command line; with `valued`, `-Key=value`. */
  flag(name: string, doc: string, s: Standing, valued = false): this {
    this.add(name, "flag", valued ? "" : false, doc, s, 0, 2147483647);
    return this;
  }

  /** Several switches that are off by default and share a meaning and a standing. */
  offs(names: readonly string[], doc: string, s: Standing): this {
    for (const name of names) this.b(name, false, doc, s);
    return this;
  }

  /** Several command-line flags that share a meaning and a standing. A name ending in "=" takes a value. */
  flags(names: readonly string[], doc: string, s: Standing): this {
    for (const name of names) this.flag(name.endsWith("=") ? name.slice(0, -1) : name, doc, s, name.endsWith("="));
    return this;
  }
}
