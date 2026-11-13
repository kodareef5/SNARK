// Reading a server's configuration as ARK's is read: GameUserSettings.ini,
// Game.ini, the command line, and the live file.
//
// Each later source is stronger than the one before (D88). Every key is
// looked up in the catalogue: one that takes effect is given its value; one
// that is planned, or has no meaning here, is read and checked all the same
// and listed; one the catalogue does not know, or a value that will not do, is
// listed with where it was written. Nothing here stops a server from
// starting: ARK ignores what it does not understand without a word, and this
// says the word.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { rowOf } from "./catalog.ts";
import { parseIni, type IniNode } from "./ini.ts";
import { FEATURES, NOT_HERE, type Feature, type NotHere, type Place, type Row } from "./row.ts";
import { Rules, readValue, type Source, type Value } from "./rules.ts";

export const GUS_FILE = "GameUserSettings.ini";
export const GAME_FILE = "Game.ini";
export const LIVE_FILE = "DynamicConfig.ini";

/** The sections ARK reads, by their names in lower case, and the place in the catalogue each is. */
const SECTIONS: Record<string, Place> = {
  serversettings: "server",
  sessionsettings: "session",
  messageoftheday: "motd",
  "/script/engine.gamesession": "gamesession",
  snarksettings: "snark",
  ragnarok: "map",
  "/script/shootergame.shootergamemode": "mode",
};
/** Sections a server's files hold that are not the server's to read: said nothing about. */
const NOT_OURS = new Set(["/script/shootergame.shootergameusersettings", "/script/engine.gameusersettings", "scalabilitygroups", "multihome", "modinstaller", "shootergamemode_tempoverrides"]);
/** Which file each place belongs to. */
const FILE_OF: Record<Place, string> = { server: GUS_FILE, session: GUS_FILE, motd: GUS_FILE, gamesession: GUS_FILE, snark: GUS_FILE, map: GUS_FILE, mode: GAME_FILE, cli: "the command line", dynamic: LIVE_FILE };
const SECTION_OF: Record<Place, string> = { server: "[ServerSettings]", session: "[SessionSettings]", motd: "[MessageOfTheDay]", gamesession: "[/Script/Engine.GameSession]", snark: "[SnarkSettings]", map: "a map's section", mode: "[/script/shootergame.shootergamemode]", cli: "", dynamic: "" };

/** What was made of everything that was read. */
export interface Report {
  /** Settings that take effect and were given a value: which, and where it was written. */
  applied: { row: Row; source: Source; where: string }[];
  /** Read and checked, but not effective: it will be this round, or it waits for a feature. */
  waiting: { row: Row; where: string }[];
  /** Read, and of no meaning here. */
  nothing: { row: Row; where: string }[];
  /** Keys the catalogue does not know. */
  unknown: { key: string; where: string }[];
  /** What would not do: a value out of range, a key in the wrong place, a line that could not be read. */
  refused: { key: string; where: string; why: string }[];
}

export const emptyReport = (): Report => ({ applied: [], waiting: [], nothing: [], unknown: [], refused: [] });

/** One pass over one source: lists begun in it replace what weaker sources gave, and then grow. */
class Pass {
  private readonly begun = new Set<string>();
  private readonly rules: Rules;
  private readonly source: Source;
  private readonly report: Report;

  constructor(rules: Rules, source: Source, report: Report) {
    this.rules = rules;
    this.source = source;
    this.report = report;
  }

  /** Give `row` what `node` says, written at `where`; `index` is the number in `Key[3]`, or -1. */
  give(row: Row, node: IniNode, index: number, where: string): void {
    const { rules, source, report } = this;
    const refuse = (why: string): void => void report.refused.push({ key: row.name, where, why });
    if ((row.kind === "indexed") !== index >= 0) return refuse(row.kind === "indexed" ? "wants an index: Key[n]=value" : "takes no index");
    const got = readValue(row, node);
    if (typeof got === "string") return refuse(got);
    if (!rules.yields(row, source)) return;
    const first = !this.begun.has(row.name);
    this.begun.add(row.name);
    let value: Value;
    if (row.kind === "indexed") {
      const now = [...rules.indexed(row.name)];
      if (index >= now.length) return refuse(`has no index ${index}`);
      now[index] = got.value as number;
      value = now;
    } else if (row.kind === "lines") {
      value = first ? [got.value as number] : [...rules.numbers(row.name), got.value as number];
    } else if (row.kind === "struct" || row.kind === "names") {
      value = first ? [got.value as IniNode] : [...rules.list(row.name), got.value as IniNode];
    } else value = got.value as Value;
    rules.put(row, value, source);
    // Listed once, however many lines it took, and by the strongest source that gave it.
    if (!first) return;
    const list: { row: Row }[] = row.status === "live" ? report.applied : row.status === "none" ? report.nothing : report.waiting;
    const was = list.findIndex((x) => x.row === row);
    if (was >= 0) list.splice(was, 1);
    if (row.status === "live") report.applied.push({ row, source, where });
    else if (row.status === "none") report.nothing.push({ row, where });
    else report.waiting.push({ row, where });
  }
}

/**
 * Take in the text of one of the two files. `source` is "file" at a start.
 * A key found in a section it does not belong to is refused, and says where
 * it does belong, since ARK would ignore it silently.
 */
export function applyIni(rules: Rules, text: string, file: string, source: Source, report: Report): void {
  const parsed = parseIni(text);
  for (const f of parsed.faults) report.refused.push({ key: "", where: `${file}:${f.line}`, why: f.why });
  const pass = new Pass(rules, source, report);
  const strange = new Set<string>();
  for (const e of parsed.entries) {
    const where = `${file}:${e.line}`;
    const section = e.section.toLowerCase();
    const place = SECTIONS[section];
    if (place === undefined) {
      // A section that is not the server's: nothing is said of ARK's client settings; anything else is said once.
      if (!NOT_OURS.has(section) && !strange.has(section)) {
        strange.add(section);
        report.unknown.push({ key: `[${e.section}]`, where });
      }
      continue;
    }
    const row = rowOf(e.key);
    if (!row || row.kind === "flag") {
      report.unknown.push({ key: e.key, where });
      continue;
    }
    if (FILE_OF[place] !== file) {
      report.refused.push({ key: e.key, where, why: `[${e.section}] belongs in ${FILE_OF[place]}` });
      continue;
    }
    if (row.at !== place) {
      report.refused.push({ key: row.name, where, why: row.at === "dynamic" ? "is only read from the live file" : `belongs in ${FILE_OF[row.at]} ${SECTION_OF[row.at]}` });
      continue;
    }
    pass.give(row, e.value, e.index, where);
  }
}

/**
 * Take in the live file: `Key=Value` lines with no sections. Only settings
 * that may change while the server runs are taken from it; whatever else it
 * names is refused, with the reason.
 */
export function applyLive(rules: Rules, text: string, report: Report): void {
  const parsed = parseIni(text);
  for (const f of parsed.faults) report.refused.push({ key: "", where: `${LIVE_FILE}:${f.line}`, why: f.why });
  const pass = new Pass(rules, "live file", report);
  for (const e of parsed.entries) {
    const where = `${LIVE_FILE}:${e.line}`;
    const row = rowOf(e.key);
    if (!row || row.kind === "flag") report.unknown.push({ key: e.key, where });
    else if ((row.status === "live" || row.status === "todo") && !row.live) report.refused.push({ key: row.name, where, why: "is read at start only" });
    else pass.give(row, e.value, e.index, where);
  }
}

/**
 * Take in a command line. ARK's forms are read: `Map?Key=Value?Key2=Value2`
 * (any setting of `[ServerSettings]` and its neighbours, never one of
 * Game.ini), and `-Flag` or `-Flag=value`. Words that begin with two dashes
 * are this server's own and are handed back untouched, each with the word
 * after it if that is its value.
 */
export function applyArgs(rules: Rules, argv: readonly string[], report: Report): string[] {
  const pass = new Pass(rules, "command line", report);
  const ours: string[] = [];
  const where = "command line";
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i]!;
    if (word.startsWith("--")) {
      ours.push(word);
      // Its value, if the next word is one.
      if (i + 1 < argv.length && !argv[i + 1]!.startsWith("-") && !argv[i + 1]!.includes("?")) ours.push(argv[++i]!);
      continue;
    }
    if (word.startsWith("-")) {
      const eq = word.indexOf("=");
      const name = eq < 0 ? word.slice(1) : word.slice(1, eq);
      const row = rowOf(name, true);
      if (row) pass.give(row, eq < 0 ? "" : word.slice(eq + 1), -1, where);
      else report.unknown.push({ key: `-${name}`, where });
      continue;
    }
    // `Map?Key=Value?…`: the map's name, if there is one, is not ours to use.
    const parts = word.split("?");
    for (let k = 0; k < parts.length; k++) {
      const part = parts[k]!;
      const eq = part.indexOf("=");
      if (eq <= 0) {
        if (k > 0 && part !== "") report.unknown.push({ key: `?${part}`, where });
        continue;
      }
      const name = part.slice(0, eq);
      // A few of ARK's command-line options are written with a question mark though they are no file's key.
      const row = rowOf(name) ?? rowOf(name, true);
      if (!row) report.unknown.push({ key: `?${name}`, where });
      else if (row.at === "mode") report.refused.push({ key: row.name, where, why: `is a ${GAME_FILE} setting, which the command line cannot give` });
      else if (row.kind === "indexed" || row.kind === "struct" || row.kind === "names" || row.kind === "lines") report.refused.push({ key: row.name, where, why: "is a list: it is set in its file" });
      else pass.give(row, part.slice(eq + 1), -1, where);
    }
  }
  return ours;
}

/** What the files of a configuration hold, as text; a file that is not there is left out. */
export interface ConfigText {
  gus?: string;
  game?: string;
  live?: string;
}

/**
 * Rules from a configuration: ARK's defaults, then the two files, then the
 * command line, then (if `-UseDynamicConfig` was given) the live file.
 * `ours` is what of the command line is this server's own.
 */
export function loadConfig(text: ConfigText, argv: readonly string[] = []): { rules: Rules; report: Report; ours: string[] } {
  const rules = new Rules();
  const report = emptyReport();
  if (text.gus !== undefined) applyIni(rules, text.gus, GUS_FILE, "file", report);
  if (text.game !== undefined) applyIni(rules, text.game, GAME_FILE, "file", report);
  const ours = applyArgs(rules, argv, report);
  if (text.live !== undefined && rules.flag("UseDynamicConfig") === true) applyLive(rules, text.live, report);
  return { rules, report, ours };
}

/** The text of the files in a folder. */
export function readConfigFolder(dir: string): ConfigText {
  const read = (name: string): string | undefined => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8") : undefined);
  const out: ConfigText = {};
  const gus = read(GUS_FILE);
  const game = read(GAME_FILE);
  const live = read(LIVE_FILE);
  if (gus !== undefined) out.gus = gus;
  if (game !== undefined) out.game = game;
  if (live !== undefined) out.live = live;
  return out;
}

/** Rules from a folder holding the files (any of which may be missing) and a command line. */
export function loadConfigFolder(dir: string, argv: readonly string[] = []): { rules: Rules; report: Report; ours: string[] } {
  return loadConfig(readConfigFolder(dir), argv);
}

/** A value as it is shown in a report: a password never is. */
function shown(row: Row, rules: Rules): string {
  if (/password/i.test(row.name)) return rules.valueOf(row) === "" ? "(none)" : "****";
  const v = rules.valueOf(row);
  if (row.kind === "struct" || row.kind === "names" || row.kind === "lines") return `${(v as readonly unknown[]).length} ${(v as readonly unknown[]).length === 1 ? "entry" : "entries"}`;
  if (row.kind === "indexed") return (v as readonly number[]).join(",");
  if (typeof v === "boolean") return v ? "True" : "False";
  return String(v);
}

const named = (row: Row): string => (row.kind === "flag" ? "-" : "") + row.name;

/** The report as lines, for whoever started the server to read. */
export function formatReport(report: Report, rules: Rules): string[] {
  const out: string[] = [];
  const n = (count: number, one: string, many = one): string => `${count} ${count === 1 ? one : many}`;
  out.push(`settings: ${n(report.applied.length, "applied")}, ${n(report.waiting.length, "not yet effective")}, ${n(report.nothing.length, "of no meaning here")}, ${n(report.unknown.length, "unknown")}, ${n(report.refused.length, "refused")}`);
  for (const a of report.applied) out.push(`  applied   ${named(a.row)}=${shown(a.row, rules)}  (${a.where})`);
  for (const w of report.waiting) out.push(`  not yet   ${named(w.row)}  (${w.where}): ${w.row.status === "todo" ? `takes effect later in this round (${w.row.waits})` : `waits for: ${FEATURES[w.row.waits as Feature].toLowerCase()}`}`);
  for (const x of report.nothing) out.push(`  no use    ${named(x.row)}  (${x.where}): ${NOT_HERE[x.row.waits as NotHere]}`);
  for (const u of report.unknown) out.push(`  unknown   ${u.key}  (${u.where})`);
  for (const r of report.refused) out.push(`  refused   ${r.key === "" ? "a line" : r.key}  (${r.where}): ${r.why}`);
  return out;
}
