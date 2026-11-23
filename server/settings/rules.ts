// The value each catalogue setting has now, and the source it came from. A stronger source wins (D88). Rules are read where they are
// used and nothing caches one. They are factors and switches, never a branch at a call site (D66).

import type { ChangedSetting } from "../../shared/admin.ts";
import { CATALOG, rowOf } from "./catalog.ts";
import { isList, parseIni, toNumber, toSwitch, unquote, writeNode, type IniNode } from "./ini.ts";
import type { Row } from "./row.ts";

/** Weakest first. */
export const SOURCES = ["default", "file", "command line", "live file", "console", "admin page"] as const;
export type Source = (typeof SOURCES)[number];

export type Value = number | boolean | string | readonly number[] | readonly IniNode[];

/** A setting's name as reports and the admin page write it: a command-line flag's has its dash. */
export const slotOf = (row: Row): string => (row.kind === "flag" ? "-" : "") + row.name;
const slot = slotOf;

const isLines = (row: Row): boolean => row.kind === "struct" || row.kind === "names" || row.kind === "lines";

/** A value as `Rules.set` reads it back: a list's entries one a line, an indexed setting's numbers with commas between. */
export function wordsOf(row: Row, v: Value): string {
  if (row.kind === "indexed") return (v as readonly number[]).join(",");
  if (Array.isArray(v)) return (v as readonly (number | IniNode)[]).map((x) => (typeof x === "number" ? String(x) : writeNode(x))).join("\n");
  return typeof v === "boolean" ? (v ? "True" : "False") : String(v);
}

function defaultOf(row: Row): Value {
  if (row.kind === "struct" || row.kind === "names" || row.kind === "lines") return [];
  if (row.kind === "indexed") return [...(row.def as readonly number[])];
  return row.def as number | boolean | string;
}

/** Whether two values of one setting are the same. Bracketed entries are compared as they would be written. */
function same(a: Value, b: Value): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
  const plain = (v: number | IniNode): number | string => (typeof v === "number" ? v : writeNode(v));
  return a.length === b.length && a.every((v: number | IniNode, i) => plain(v) === plain(b[i] as number | IniNode));
}

/** A string result says why the value is refused. For a list the value is one entry, and for an indexed setting the number at one index. */
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
  // The rest are numbers: float, int, one index of an indexed setting, or one line of a list of numbers.
  const n = toNumber(text);
  if (Number.isNaN(n)) return `wants a number, got "${text}"`;
  if ((row.kind === "int" || row.kind === "lines") && !Number.isInteger(n)) return `wants a whole number, got ${text}`;
  if (!(n >= row.min && n <= row.max)) return `wants a number from ${row.min} to ${row.max}, got ${text}`;
  return { value: n };
}

export class Rules {
  /** Counts every change. */
  version = 0;
  private readonly vals = new Map<string, Value>();
  private readonly from = new Map<string, Source>();

  constructor() {
    for (const row of CATALOG) this.vals.set(slot(row), defaultOf(row));
  }

  private need(name: string): Value {
    const v = this.vals.get(name);
    if (v === undefined) throw new Error(`there is no setting called ${name}`);
    return v;
  }

  num(name: string): number {
    const v = this.need(name);
    if (typeof v !== "number") throw new Error(`${name} is not a number`);
    return v;
  }

  on(name: string): boolean {
    const v = this.need(name);
    if (typeof v !== "boolean") throw new Error(`${name} is not a switch`);
    return v;
  }

  text(name: string): string {
    const v = this.need(name);
    if (typeof v !== "string") throw new Error(`${name} is not words`);
    return v;
  }

  indexed(name: string): readonly number[] {
    const v = this.need(name);
    if (!Array.isArray(v)) throw new Error(`${name} is not indexed`);
    return v as readonly number[];
  }

  /** The entries of a struct or names setting, as written. */
  list(name: string): readonly IniNode[] {
    const v = this.need(name);
    if (!Array.isArray(v)) throw new Error(`${name} is not a list`);
    return v as readonly IniNode[];
  }

  /** The entries of a lines setting, in the order of their lines. */
  numbers(name: string): readonly number[] {
    const v = this.need(name);
    if (!Array.isArray(v)) throw new Error(`${name} is not a list`);
    return v as readonly number[];
  }

  /** Whether the flag was given. For a flag that takes a value, that value, or "" if it was not given. */
  flag(name: string): boolean | string {
    return this.need("-" + name) as boolean | string;
  }

  sourceOf(row: Row): Source {
    return this.from.get(slot(row)) ?? "default";
  }

  /** Untyped, for reports. */
  valueOf(row: Row): Value {
    return this.need(slot(row));
  }

  /** True if `source` is at least as strong as the source of the current value. */
  yields(row: Row, source: Source): boolean {
    return SOURCES.indexOf(source) >= SOURCES.indexOf(this.sourceOf(row));
  }

  /** `value` must already be read and checked by readValue. The value the setting already has is not a change. */
  put(row: Row, value: Value, source: Source): void {
    const name = slot(row);
    this.from.set(name, source);
    if (same(this.vals.get(name)!, value)) return;
    this.vals.set(name, value);
    this.version++;
  }

  /** Takes ARK's name in any case, as the console does. Returns "" if it was set, or why not. Lists and indexed settings are refused. */
  assign(name: string, words: string, source: Source): string {
    const row = rowOf(name);
    if (!row) return `there is no setting called ${name}`;
    if (isLines(row) || row.kind === "indexed") return `${row.name} is a list: it is set in its file`;
    const why = this.set(row, words, source);
    return why === "" ? "" : `${row.name} ${why}`;
  }

  /**
   * Sets any setting from words (wordsOf writes them): a list's entries one a line, each as its file has it with or
   * without its `Key=`, and an indexed setting's numbers with commas between. Returns "" if it was set, or why not, and
   * then nothing has changed.
   */
  set(row: Row, words: string, source: Source): string {
    if (row.kind === "indexed") {
      const parts = words.split(",");
      const n = (row.def as readonly number[]).length;
      if (parts.length !== n) return `wants ${n} numbers with commas between, got ${parts.length}`;
      const out: number[] = [];
      for (const part of parts) {
        const got = readValue(row, part);
        if (typeof got === "string") return got;
        out.push(got.value as number);
      }
      this.put(row, out, source);
      return "";
    }
    if (!isLines(row)) {
      const got = readValue(row, words);
      if (typeof got === "string") return got;
      this.put(row, got.value as Value, source);
      return "";
    }
    const out: (number | IniNode)[] = [];
    const key = `${row.name.toLowerCase()}=`;
    const lines = words.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const parsed = parseIni(`K=${line.toLowerCase().startsWith(key) ? line.slice(key.length) : line}`);
      const node = parsed.entries[0]?.value;
      if (node === undefined) return `line ${i + 1}: ${parsed.faults[0]?.why ?? "cannot be read"}`;
      const got = readValue(row, node);
      if (typeof got === "string") return `line ${i + 1} ${got}`;
      out.push(got.value as number | IniNode);
    }
    this.put(row, out as Value, source);
    return "";
  }

  /** Every setting that re-times something, by name. Stored with the world (D91), so a save loaded under other values is re-timed once. */
  timers(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const row of CATALOG) if (row.retime !== "") out[row.name] = this.num(row.name);
    return out;
  }
}

/** The settings a player may know (Row.public) that take effect and are not at their default, by name. Nothing else ever leaves. */
export function publicValues(rules: Rules): Record<string, number | boolean | string> {
  const out: Record<string, number | boolean | string> = {};
  for (const row of CATALOG) {
    if (!row.public || row.status !== "live") continue;
    const v = rules.valueOf(row);
    if ((typeof v === "number" || typeof v === "boolean" || typeof v === "string") && v !== row.def) out[row.name] = v;
  }
  return out;
}

/** Every setting not at its default, for an admin: what it is, where it came from and whether it takes effect. No secret's value leaves. */
export function changedSettings(rules: Rules): ChangedSetting[] {
  const out: ChangedSetting[] = [];
  for (const row of CATALOG) {
    const v = rules.valueOf(row);
    if (same(v, defaultOf(row))) continue;
    const words = (x: number | boolean | string | IniNode): string => (typeof x === "boolean" ? (x ? "True" : "False") : typeof x === "object" ? writeNode(x) : String(x));
    const value = row.secret ? "set" : Array.isArray(v) ? (v as readonly (number | IniNode)[]).map(words) : words(v as number | boolean | string);
    out.push({ name: (row.kind === "flag" ? "-" : "") + row.name, value, source: rules.sourceOf(row), status: row.status });
  }
  return out;
}

/** The values a save's timers were computed under, from its snapshot. Null if the snapshot does not read. */
export function timersOf(snapshot: string | number | null): Record<string, number> | null {
  let snap: unknown;
  try {
    snap = typeof snapshot === "string" ? JSON.parse(snapshot) : null;
  } catch {
    return null;
  }
  const timers = typeof snap === "object" && snap !== null ? (snap as { timers?: unknown }).timers : null;
  if (typeof timers !== "object" || timers === null) return null;
  const out: Record<string, number> = {};
  for (const [name, v] of Object.entries(timers)) if (typeof v === "number" && v > 0) out[name] = v;
  return out;
}
