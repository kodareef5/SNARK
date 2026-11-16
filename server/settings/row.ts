// One row of the catalogue: a setting an ARK dedicated server reads, and what this engine does with it. The config parser, the value
// checks, the start report, the reference page, what clients are told and re-timing are all derived from these rows (D87).

export type Kind =
  | "float"
  | "int"
  | "bool"
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
  /** GameUserSettings.ini `[ServerSettings]`, and `?Key=Value` on the command line. */
  | "server"
  | "session"
  | "motd"
  | "gamesession"
  /** GameUserSettings.ini, a section for one of ARK's maps. */
  | "map"
  /** GameUserSettings.ini `[SnarkSettings]`, this engine's own section for what ARK has no key for. */
  | "snark"
  /** Game.ini `[/script/shootergame.shootergamemode]`. Never on the command line. */
  | "mode"
  /** The command line only. */
  | "cli"
  /** ARK's live file only. */
  | "dynamic";

export { FEATURES, type Feature } from "../../shared/features.ts";
import type { Feature } from "../../shared/features.ts";

/** Why a setting has no meaning here. */
export const NOT_HERE = {
  anticheat: "ARK's anti-cheat and integrity checks",
  platform: "ARK's platforms, stores and save formats",
  unreal: "Unreal Engine performance and client switches",
  mods: "ARK's mods",
  expansion: "Things only ARK's expansions, events or named maps have",
  ascended: "What ARK: Survival Ascended added that was not a fix",
  deprecated: "Deprecated in ARK itself",
} as const;
export type NotHere = keyof typeof NOT_HERE;

export interface Row {
  /** ARK's key, as ARK writes it. Matched without regard to case. */
  readonly name: string;
  readonly at: Place;
  readonly kind: Kind;
  /** For an indexed setting, one number for each index. Null for lists, which start empty. */
  readonly def: number | boolean | string | readonly number[] | null;
  readonly min: number;
  readonly max: number;
  readonly status: "live" | "todo" | "planned" | "none";
  /** For `todo`, the phase that wires it ("phase 4"). For `planned`, a Feature. For `none`, a NotHere. */
  readonly waits: string;
  /** It may change while the server runs, from the console or the live file. */
  readonly live: boolean;
  /** Its value is sent to clients. */
  readonly client: boolean;
  /**
   * What a change does to timers and rates already running. "speed" divides a timer's time by the value and "period" multiplies
   * it, both re-timed from that moment. "rate" recomputes a rate a body was given. "clock" changes the clock's pace and keeps
   * the hour. The value a world was saved under is kept with it, so a save loaded under another is re-timed once (D91).
   */
  readonly retime: "" | "speed" | "period" | "rate" | "clock";
  /** Heading it is listed under in the reference. */
  readonly group: string;
  /** What it scales or switches, and which way. */
  readonly doc: string;
  /** "E" is ARK: Survival Evolved only, "A" is Ascended only, and "" is both or not known. */
  readonly game: "" | "E" | "A";
  /** Quirks, and what the research could not verify. */
  readonly note: string;
  /** A player may know its value: the wiki lists it (tools/wiki). */
  readonly public: boolean;
}

export interface Extra {
  min?: number;
  max?: number;
  live?: boolean;
  client?: boolean;
  retime?: "speed" | "period" | "rate" | "clock";
  game?: "E" | "A";
  note?: string;
  public?: boolean;
}

interface Standing extends Extra {
  status: Row["status"];
  waits: string;
}

/** Read and checked, but not effective until the phase given wires it. */
export const todo = (phase: number, x: Extra = {}): Standing => ({ status: "todo", waits: `phase ${phase}`, ...x });
/** It takes effect. */
export const live = (x: Extra = {}): Standing => ({ status: "live", waits: "", ...x });
/** It waits for a feature this engine does not have yet. */
export const plan = (feature: Feature, x: Extra = {}): Standing => ({ status: "planned", waits: feature, ...x });
/** It has no meaning here. */
export const none = (why: NotHere, x: Extra = {}): Standing => ({ status: "none", waits: why, ...x });

/** The maximum of a multiplier whose row gives none. */
export const MULTIPLIER_MAX = 100000;

/** Adds rows for one place, under the current heading. */
export class Sheet {
  readonly rows: Row[];
  private readonly at: Place;
  private group: string;

  constructor(rows: Row[], at: Place, group: string) {
    this.rows = rows;
    this.at = at;
    this.group = group;
  }

  /** Sets the heading for the rows that follow. */
  under(group: string): this {
    this.group = group;
    return this;
  }

  private add(name: string, kind: Kind, def: Row["def"], doc: string, s: Standing, min: number, max: number): void {
    this.rows.push({ name, at: this.at, kind, def, min: s.min ?? min, max: s.max ?? max, status: s.status, waits: s.waits, live: s.live ?? false, client: s.client ?? false, retime: s.retime ?? "", group: this.group, doc, game: s.game ?? "", note: s.note ?? "", public: s.public ?? false });
  }

  f(name: string, def: number, doc: string, s: Standing): this {
    this.add(name, "float", def, doc, s, 0, MULTIPLIER_MAX);
    return this;
  }

  i(name: string, def: number, doc: string, s: Standing): this {
    this.add(name, "int", def, doc, s, 0, 2147483647);
    return this;
  }

  b(name: string, def: boolean, doc: string, s: Standing): this {
    this.add(name, "bool", def, doc, s, 0, 1);
    return this;
  }

  t(name: string, def: string, doc: string, s: Standing): this {
    this.add(name, "text", def, doc, s, 0, 0);
    return this;
  }

  x(name: string, def: readonly number[], doc: string, s: Standing): this {
    this.add(name, "indexed", def, doc, s, 0, MULTIPLIER_MAX);
    return this;
  }

  s(name: string, doc: string, s: Standing): this {
    this.add(name, "struct", null, doc, s, 0, 0);
    return this;
  }

  n(name: string, doc: string, s: Standing): this {
    this.add(name, "names", null, doc, s, 0, 0);
    return this;
  }

  l(name: string, doc: string, s: Standing): this {
    this.add(name, "lines", null, doc, s, 0, 2147483647);
    return this;
  }

  /** With `valued`, the flag is written `-Key=value`: a number, or with "text" any words, such as a name or a folder. */
  flag(name: string, doc: string, s: Standing, valued: boolean | "text" = false): this {
    this.add(name, "flag", valued ? "" : false, doc, s, 0, valued === "text" ? 0 : 2147483647);
    return this;
  }

  offs(names: readonly string[], doc: string, s: Standing): this {
    for (const name of names) this.b(name, false, doc, s);
    return this;
  }

  /** A name ending in "=" takes a value. */
  flags(names: readonly string[], doc: string, s: Standing): this {
    for (const name of names) this.flag(name.endsWith("=") ? name.slice(0, -1) : name, doc, s, name.endsWith("="));
    return this;
  }
}
