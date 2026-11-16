// Reads a server's configuration as ARK does: GameUserSettings.ini, Game.ini, the command line and the live file. Each later source
// is stronger (D88). Nothing here stops a server from starting. ARK ignores what it does not understand silently, and this reports it.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { rowOf } from "./catalog.ts";
import { parseIni, type IniNode } from "./ini.ts";
import { FEATURES, NOT_HERE, type Feature, type NotHere, type Place, type Row } from "./row.ts";
import { Rules, readValue, type Source, type Value } from "./rules.ts";

export const GUS_FILE = "GameUserSettings.ini";
export const GAME_FILE = "Game.ini";
export const LIVE_FILE = "DynamicConfig.ini";

/** The sections ARK reads, keyed in lower case. */
const SECTIONS: Record<string, Place> = {
  serversettings: "server",
  sessionsettings: "session",
  messageoftheday: "motd",
  "/script/engine.gamesession": "gamesession",
  snarksettings: "snark",
  ragnarok: "map",
  "/script/shootergame.shootergamemode": "mode",
};
/** Sections that ARK's files hold and the server does not read. They are skipped without a report. */
const NOT_OURS = new Set(["/script/shootergame.shootergameusersettings", "/script/engine.gameusersettings", "scalabilitygroups", "multihome", "modinstaller", "shootergamemode_tempoverrides"]);
export const FILE_OF: Record<Place, string> = { server: GUS_FILE, session: GUS_FILE, motd: GUS_FILE, gamesession: GUS_FILE, snark: GUS_FILE, map: GUS_FILE, mode: GAME_FILE, cli: "the command line", dynamic: LIVE_FILE };
export const SECTION_OF: Record<Place, string> = { server: "[ServerSettings]", session: "[SessionSettings]", motd: "[MessageOfTheDay]", gamesession: "[/Script/Engine.GameSession]", snark: "[SnarkSettings]", map: "a map's section", mode: "[/script/shootergame.shootergamemode]", cli: "", dynamic: "" };

export interface Report {
  /** Settings that take effect and were given a value. */
  applied: { row: Row; source: Source; where: string }[];
  /** Read and checked, but not effective yet. */
  waiting: { row: Row; where: string }[];
  /** Read, with no meaning here. */
  nothing: { row: Row; where: string }[];
  /** Keys the catalogue does not know. */
  unknown: { key: string; where: string }[];
  /** A value out of range, a key in the wrong place, or a line that could not be read. */
  refused: { key: string; where: string; why: string }[];
  notes: string[];
}

export const emptyReport = (): Report => ({ applied: [], waiting: [], nothing: [], unknown: [], refused: [], notes: [] });

/** ARK's fixed bUseSingleplayerSettings factors, as its reference lists them. The corpse life span is not a factor. It is set to 6. */
const SINGLE_PLAYER: readonly (readonly [name: string, factor: number, index?: number])[] = [
  ["TamingSpeedMultiplier", 2.5],
  ["EggHatchSpeedMultiplier", 9],
  ["BabyMatureSpeedMultiplier", 35],
  ["MatingIntervalMultiplier", 0.15],
  ["BabyCuddleIntervalMultiplier", 0.17],
  ["CropGrowthSpeedMultiplier", 4],
  ["HairGrowthSpeedMultiplier", 0.7],
  ["RaidDinoCharacterFoodDrainMultiplier", 0.4],
  ["PerLevelStatsMultiplier_DinoTamed", 2.125, 0],
  ["PerLevelStatsMultiplier_DinoTamed", 2.3529, 8],
  ["PerLevelStatsMultiplier_DinoTamed_Add", 3.5714, 0],
  ["PerLevelStatsMultiplier_DinoTamed_Add", 3.5714, 8],
  ["PerLevelStatsMultiplier_DinoTamed_Affinity", 2.2727, 0],
  ["PerLevelStatsMultiplier_DinoTamed_Affinity", 2.2727, 8],
];
const SINGLE_PLAYER_CORPSE = 6;

/** Each result is clamped to its setting's range. Anything that sets one of them afterwards sets it outright. */
function applySinglePlayer(rules: Rules, report: Report): void {
  const within = (row: Row, v: number): number => Math.min(row.max, Math.max(row.min, v));
  for (const [name, factor, index] of SINGLE_PLAYER) {
    const row = rowOf(name);
    if (!row) continue;
    if (index === undefined) rules.put(row, within(row, rules.num(row.name) * factor), rules.sourceOf(row));
    else {
      const values = [...rules.indexed(row.name)];
      values[index] = within(row, values[index]! * factor);
      rules.put(row, values, rules.sourceOf(row));
    }
  }
  const corpse = rowOf("UseCorpseLifeSpanMultiplier")!;
  rules.put(corpse, SINGLE_PLAYER_CORPSE, rules.sourceOf(corpse));
  report.notes.push("bUseSingleplayerSettings: ARK's single-player factors are on top of what was read: taming x2.5, hatching x9, growing up x35, the wait to mate x0.15, a tame's health per level x2.125 and melee x2.3529, and what the dead leave lies six times as long");
}

/** One pass over one source. A list begun in it replaces what weaker sources gave, then grows. */
class Pass {
  private readonly begun = new Set<string>();
  /** The lists begun, each put whole by end(), so a list read again as it was is not a change. */
  private readonly lists = new Map<Row, (number | IniNode)[]>();
  private readonly rules: Rules;
  private readonly source: Source;
  private readonly report: Report;

  constructor(rules: Rules, source: Source, report: Report) {
    this.rules = rules;
    this.source = source;
    this.report = report;
  }

  /** `index` is the number in `Key[3]`, or -1. */
  give(row: Row, node: IniNode, index: number, where: string): void {
    const { rules, source, report } = this;
    const refuse = (why: string): void => void report.refused.push({ key: row.name, where, why });
    if ((row.kind === "indexed") !== index >= 0) return refuse(row.kind === "indexed" ? "wants an index: Key[n]=value" : "takes no index");
    const got = readValue(row, node);
    if (typeof got === "string") return refuse(got);
    if (!rules.yields(row, source)) return;
    const first = !this.begun.has(row.name);
    this.begun.add(row.name);
    if (row.kind === "indexed") {
      const now = [...rules.indexed(row.name)];
      if (index >= now.length) return refuse(`has no index ${index}`);
      now[index] = got.value as number;
      rules.put(row, now, source);
    } else if (row.kind === "lines" || row.kind === "struct" || row.kind === "names") {
      if (first) this.lists.set(row, []);
      this.lists.get(row)!.push(got.value as number | IniNode);
    } else rules.put(row, got.value as Value, source);
    // A row is listed once, by the strongest source that gave it.
    if (!first) return;
    const list: { row: Row }[] = row.status === "live" ? report.applied : row.status === "none" ? report.nothing : report.waiting;
    const was = list.findIndex((x) => x.row === row);
    if (was >= 0) list.splice(was, 1);
    if (row.status === "live") report.applied.push({ row, source, where });
    else if (row.status === "none") report.nothing.push({ row, where });
    else report.waiting.push({ row, where });
  }

  /** Call it when the source has been read through. */
  end(): void {
    for (const [row, list] of this.lists) this.rules.put(row, list as Value, this.source);
  }
}

/** Reads one of the two files. A key in the wrong section is refused with the right one named, since ARK would ignore it silently. */
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
      // An unknown section is reported once. NOT_OURS sections are not reported.
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
  pass.end();
}

/** The live file is `Key=Value` lines with no sections. A setting that is read at start only is refused. */
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
  pass.end();
}

/**
 * Reads ARK's forms: `Map?Key=Value?Key2=Value2` (never a Game.ini setting) and `-Flag` or `-Flag=value`. Words that begin
 * with two dashes are this server's own. They are returned untouched, each with the word after it if that is its value.
 */
export function applyArgs(rules: Rules, argv: readonly string[], report: Report): string[] {
  const pass = new Pass(rules, "command line", report);
  const ours: string[] = [];
  const where = "command line";
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i]!;
    if (word.startsWith("--")) {
      ours.push(word);
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
    // The map name, if the word starts with one, is ignored.
    const parts = word.split("?");
    for (let k = 0; k < parts.length; k++) {
      const part = parts[k]!;
      const eq = part.indexOf("=");
      if (eq <= 0) {
        if (k > 0 && part !== "") report.unknown.push({ key: `?${part}`, where });
        continue;
      }
      const name = part.slice(0, eq);
      // ARK writes a few of its command-line flags with a question mark.
      const row = rowOf(name) ?? rowOf(name, true);
      if (!row) report.unknown.push({ key: `?${name}`, where });
      else if (row.at === "mode") report.refused.push({ key: row.name, where, why: `is a ${GAME_FILE} setting, which the command line cannot give` });
      else if (row.kind === "indexed" || row.kind === "struct" || row.kind === "names" || row.kind === "lines") report.refused.push({ key: row.name, where, why: "is a list: it is set in its file" });
      else pass.give(row, part.slice(eq + 1), -1, where);
    }
  }
  pass.end();
  return ours;
}

export interface ConfigText {
  gus?: string;
  game?: string;
  live?: string;
}

/**
 * Order: the two files, the command line, the single-player factors, then the live file if -UseDynamicConfig was given. The live
 * file is read again while the server runs, so its values are never multiplied. `ours` is this server's own arguments.
 */
export function loadConfig(text: ConfigText, argv: readonly string[] = []): { rules: Rules; report: Report; ours: string[] } {
  const rules = new Rules();
  const report = emptyReport();
  if (text.gus !== undefined) applyIni(rules, text.gus, GUS_FILE, "file", report);
  if (text.game !== undefined) applyIni(rules, text.game, GAME_FILE, "file", report);
  const ours = applyArgs(rules, argv, report);
  if (rules.on("bUseSingleplayerSettings")) applySinglePlayer(rules, report);
  if (text.live !== undefined && rules.flag("UseDynamicConfig") === true) applyLive(rules, text.live, report);
  return { rules, report, ours };
}

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

export function loadConfigFolder(dir: string, argv: readonly string[] = []): { rules: Rules; report: Report; ours: string[] } {
  return loadConfig(readConfigFolder(dir), argv);
}

/** A password is never shown. */
function shown(row: Row, rules: Rules): string {
  if (/password/i.test(row.name)) return rules.valueOf(row) === "" ? "(none)" : "****";
  const v = rules.valueOf(row);
  if (row.kind === "struct" || row.kind === "names" || row.kind === "lines") return `${(v as readonly unknown[]).length} ${(v as readonly unknown[]).length === 1 ? "entry" : "entries"}`;
  if (row.kind === "indexed") return (v as readonly number[]).join(",");
  if (typeof v === "boolean") return v ? "True" : "False";
  return String(v);
}

const named = (row: Row): string => (row.kind === "flag" ? "-" : "") + row.name;

export function formatReport(report: Report, rules: Rules): string[] {
  const out: string[] = [];
  const n = (count: number, one: string, many = one): string => `${count} ${count === 1 ? one : many}`;
  out.push(`settings: ${n(report.applied.length, "applied")}, ${n(report.waiting.length, "not yet effective")}, ${n(report.nothing.length, "of no meaning here")}, ${n(report.unknown.length, "unknown")}, ${n(report.refused.length, "refused")}`);
  for (const a of report.applied) out.push(`  applied   ${named(a.row)}=${shown(a.row, rules)}  (${a.where})`);
  for (const w of report.waiting) out.push(`  not yet   ${named(w.row)}  (${w.where}): ${w.row.status === "todo" ? `takes effect later in this round (${w.row.waits})` : `waits for: ${FEATURES[w.row.waits as Feature].toLowerCase()}`}`);
  for (const x of report.nothing) out.push(`  no use    ${named(x.row)}  (${x.where}): ${NOT_HERE[x.row.waits as NotHere]}`);
  for (const u of report.unknown) out.push(`  unknown   ${u.key}  (${u.where})`);
  for (const r of report.refused) out.push(`  refused   ${r.key === "" ? "a line" : r.key}  (${r.where}): ${r.why}`);
  for (const note of report.notes) out.push(`  note      ${note}`);
  return out;
}
