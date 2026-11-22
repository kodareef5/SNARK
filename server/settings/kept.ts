// The settings an admin changed on the admin page (server/admin/settings.ts), kept in a JSON file beside the save so
// that they outlive a restart. The config files stay the operator's: nothing here writes them. At a start the page's
// values are laid over what the files and the command line gave, and each remembers what it replaced, so taking one
// away puts that back. A world with no save keeps them in memory.

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync, openSync, fsyncSync, closeSync } from "node:fs";
import { rowOf } from "./catalog.ts";
import type { Row } from "./row.ts";
import { slotOf, type Rules, type Source, type Value } from "./rules.ts";

const SOURCE: Source = "admin page";

/** Writes a file whole beside its place and renames it there, so a kill leaves the old file or the new. */
function put(path: string, text: string): void {
  const tmp = `${path}.tmp`;
  try {
    writeFileSync(tmp, text);
    const fd = openSync(tmp, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

const why = (err: unknown): string => (err instanceof Error ? ((err as NodeJS.ErrnoException).code ?? err.message) : String(err));

/** A setting by the name the page and the file use: a command-line flag's has its dash. */
export function rowNamed(name: string): Row | undefined {
  return name.startsWith("-") ? rowOf(name.slice(1), true) : rowOf(name);
}

export class KeptSettings {
  /** Each setting the page set, by name, as the words it was set with (Rules.set reads them). */
  readonly words = new Map<string, string>();
  /** What each had before the page set it. */
  private readonly under = new Map<string, { value: Value; source: Source }>();
  private readonly path: string | null;
  private readonly rules: Rules;

  constructor(path: string | null, rules: Rules) {
    this.path = path;
    this.rules = rules;
  }

  /** Lays the file's values over the rules, at a start. Returns a line for each, as the start report writes them. */
  load(): string[] {
    if (this.path === null || !existsSync(this.path)) return [];
    let held: unknown;
    try {
      held = (JSON.parse(readFileSync(this.path, "utf8")) as { settings?: unknown }).settings;
    } catch (err) {
      return [`  refused   ${this.path}: ${why(err)}`];
    }
    const out: string[] = [];
    for (const [name, words] of Object.entries(typeof held === "object" && held !== null ? held : {})) {
      const row = rowNamed(name);
      const no = !row ? "is no setting" : typeof words !== "string" ? "has no value" : this.apply(row, words);
      out.push(no === "" ? `  applied   ${name}${row!.secret ? "" : `=${words.includes("\n") ? `${words.split("\n").length} entries` : words}`}  (${SOURCE})` : `  refused   ${name}  (${SOURCE}): ${no}`);
    }
    return out;
  }

  private apply(row: Row, words: string): string {
    const name = slotOf(row);
    const was = { value: this.rules.valueOf(row), source: this.rules.sourceOf(row) };
    const no = this.rules.set(row, words, SOURCE);
    if (no !== "") return no;
    if (!this.under.has(name)) this.under.set(name, was);
    this.words.set(name, words);
    return "";
  }

  /** Sets one and keeps it. Returns why it was refused, or "" with `unkept` saying why the file was not written. */
  set(row: Row, words: string): { why: string; unkept?: string } {
    const no = this.apply(row, words);
    return no === "" ? this.save() : { why: no };
  }

  /** Takes the page's value away: the setting has again what it had before, and the file forgets it. */
  reset(row: Row): { why: string; unkept?: string } {
    const name = slotOf(row);
    const was = this.under.get(name);
    if (!was) return { why: `${name} was not set on the page` };
    this.rules.put(row, was.value, was.source);
    this.under.delete(name);
    this.words.delete(name);
    return this.save();
  }

  private save(): { why: string; unkept?: string } {
    if (this.path === null) return { why: "" };
    try {
      put(this.path, `${JSON.stringify({ settings: Object.fromEntries(this.words) }, null, 2)}\n`);
      return { why: "" };
    } catch (err) {
      return { why: "", unkept: why(err) };
    }
  }
}
