// The catalogue: every setting an ARK dedicated server reads, in one table.
//
// It is the list that says what this engine does about each of ARK's
// settings, and so the list that guides what is built next: a planned row
// names the feature it waits for.

import { FEATURES, NOT_HERE, type Row } from "./row.ts";
import { MODE_ROWS } from "./rows-mode.ts";
import { SERVER_ROWS } from "./rows-server.ts";

export const CATALOG: readonly Row[] = [...SERVER_ROWS, ...MODE_ROWS];

/**
 * A setting's name as it is looked up: ARK's keys are matched without regard
 * to case, and a command-line flag is its own thing even when a file key has
 * the same letters.
 */
export const keyOf = (name: string, flag = false): string => (flag ? "-" : "") + name.toLowerCase();

const byKey = new Map<string, Row>();
for (const row of CATALOG) byKey.set(keyOf(row.name, row.kind === "flag"), row);

/** The row for a key from a file (or, with `flag`, from the command line), or undefined. */
export function rowOf(name: string, flag = false): Row | undefined {
  return byKey.get(keyOf(name, flag));
}

/**
 * What is wrong with the catalogue itself, as lines; none if it is sound.
 * Run by the tests, so that a row cannot be added half made.
 */
export function catalogFaults(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of CATALOG) {
    const key = keyOf(r.name, r.kind === "flag");
    if (seen.has(key)) out.push(`${r.name}: listed twice`);
    seen.add(key);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(r.name)) out.push(`${r.name}: not a name`);
    if (r.doc.trim() === "" || !r.doc.endsWith(".")) out.push(`${r.name}: needs a meaning, as a sentence`);
    if (r.status === "planned" && !(r.waits in FEATURES)) out.push(`${r.name}: waits for "${r.waits}", which is no feature`);
    if (r.status === "none" && !(r.waits in NOT_HERE)) out.push(`${r.name}: "${r.waits}" is no reason`);
    if (r.status === "todo" && !/^phase \d+$/.test(r.waits)) out.push(`${r.name}: a row to be wired names its phase`);
    if (r.status === "live" && r.waits !== "") out.push(`${r.name}: a live row waits for nothing`);
    const effective = r.status === "live" || r.status === "todo";
    if (!effective && (r.live || r.client || r.retime !== "")) out.push(`${r.name}: only a row that takes effect can be live, told to clients, or re-timed`);
    if (r.kind === "float" || r.kind === "int") {
      const d = r.def as number;
      if (typeof d !== "number" || !(d >= r.min && d <= r.max)) out.push(`${r.name}: its default ${String(r.def)} is outside ${r.min} to ${r.max}`);
      if (r.kind === "int" && !Number.isInteger(d)) out.push(`${r.name}: a whole number has a whole default`);
    } else if (r.kind === "bool") {
      if (typeof r.def !== "boolean") out.push(`${r.name}: a switch defaults to on or off`);
    } else if (r.kind === "text") {
      if (typeof r.def !== "string") out.push(`${r.name}: words default to words`);
    } else if (r.kind === "indexed") {
      if (!Array.isArray(r.def) || r.def.length === 0 || r.def.some((v) => !(v >= r.min && v <= r.max))) out.push(`${r.name}: an indexed setting has a default in range for each index`);
    } else if (r.kind === "flag") {
      if (r.at !== "cli") out.push(`${r.name}: a flag belongs to the command line`);
    } else if (r.def !== null) out.push(`${r.name}: a list starts empty`);
    if (r.retime !== "" && r.kind !== "float") out.push(`${r.name}: only a multiplier re-times anything`);
    // A divisor is never nothing.
    if (r.retime === "speed" && !(r.min > 0)) out.push(`${r.name}: what time is divided by has a least value above 0`);
    if (r.at === "mode" && r.kind === "flag") out.push(`${r.name}: Game.ini has no flags`);
  }
  return out;
}

/** How many rows stand in each way, for the report and the reference. */
export function catalogCounts(): { live: number; todo: number; planned: number; none: number; all: number } {
  const n = { live: 0, todo: 0, planned: 0, none: 0, all: CATALOG.length };
  for (const r of CATALOG) n[r.status]++;
  return n;
}
