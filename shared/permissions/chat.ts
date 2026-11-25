// CrossChat's chat config, its keys kept as CrossChat writes them: a permission group's chat format, the tags, the muted
// group and the maps' colours. Read from a pasted file, and used to turn a speaker's line into coloured runs.
// Only the admin's strings are read for markup. A player's words, name and tribe are always shown as they are written.

import { CHAT_RUNS_MOST, type TextRun } from "../net/chat.ts";
import { readRichColor } from "./richcolor.ts";

// ---- Loose JSON ----

export type LooseJson = { ok: true; value: unknown } | { ok: false; reason: string };

/** The index just past the string that opens at `i`, or past the end where it is not closed. */
function stringEnd(text: string, i: number): number {
  let j = i + 1;
  while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
  return j + 1;
}

/** JSON as a pasted config has it: `//` and `/* *\/` comments outside strings, and commas before a closing bracket. Never throws. */
export function readLooseJson(text: string): LooseJson {
  let bare = "";
  let from = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (let i = from; i < text.length; ) {
    const ch = text[i];
    if (ch === '"') i = stringEnd(text, i);
    else if (ch === "/" && text[i + 1] === "/") {
      bare += text.slice(from, i);
      const nl = text.indexOf("\n", i);
      i = from = nl < 0 ? text.length : nl;
    } else if (ch === "/" && text[i + 1] === "*") {
      bare += text.slice(from, i) + " ";
      const end = text.indexOf("*/", i + 2);
      if (end < 0) return { ok: false, reason: "A /* comment is never closed." };
      i = from = end + 2;
    } else i++;
  }
  bare += text.slice(from);
  let strict = "";
  from = 0;
  for (let i = 0; i < bare.length; ) {
    const ch = bare[i];
    if (ch === '"') i = stringEnd(bare, i);
    else if (ch === ",") {
      let j = i + 1;
      while (j < bare.length && /\s/.test(bare[j]!)) j++;
      if (bare[j] === "}" || bare[j] === "]") {
        strict += bare.slice(from, i);
        from = i + 1;
      }
      i++;
    } else i++;
  }
  strict += bare.slice(from);
  try {
    return { ok: true, value: JSON.parse(strict) };
  } catch (e) {
    return { ok: false, reason: `The text is not JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ---- Templates ----

export type PartKey = "map" | "tags" | "sender" | "tribe" | "message";
export const PART_KEYS: readonly PartKey[] = ["map", "tags", "sender", "tribe", "message"];
const BIT: Readonly<Record<PartKey, number>> = { map: 1, tags: 2, sender: 4, tribe: 8, message: 16 };

/** The format a speaker with no group's format is given. */
export const DEFAULT_CHAT_FORMAT = "{tags} {sender}: {message}";
/** A part's value, as each part of FormattingParts has it unless it says otherwise. */
const DEFAULT_PART = "{name}";

const SLOT = /\{\s*([a-z]+)\s*\}/gi;

/** A piece of a parsed string: text in an ink (-1 for none), or the place a value goes (`slot`). */
interface Bit {
  text: string;
  ink: number;
  slot: string;
}

/** `classify` takes a placeholder's word in lower case and gives the slot it fills, "" to leave it out, or null to keep it as text. */
function parseTemplate(source: string, classify: (word: string) => string | null): Bit[] {
  const out: Bit[] = [];
  const lit = (text: string, ink: number) => {
    const last = out[out.length - 1];
    if (last && last.slot === "" && last.ink === ink) last.text += text;
    else out.push({ text, ink, slot: "" });
  };
  for (const run of readRichColor(source)) {
    const ink = run.ink ?? -1;
    let at = 0;
    for (const m of run.text.matchAll(SLOT)) {
      const slot = classify(m[1]!.toLowerCase());
      if (slot === null) continue;
      if (m.index > at) lit(run.text.slice(at, m.index), ink);
      if (slot !== "") out.push({ text: "", ink, slot });
      at = m.index + m[0].length;
    }
    if (at < run.text.length) lit(run.text.slice(at), ink);
  }
  return out;
}

/** What one place in a line holds, made once for each set of parts a line leaves out. */
interface Item {
  text: string;
  /** The ink it is drawn in, -1 for the channel's own. */
  ink: number;
  /** A map part's text with no ink of its own, which the map's colour takes. */
  mapped: boolean;
  /** The part whose value goes here, or null for text. */
  value: PartKey | null;
}

/** A ChatFormat and its parts, parsed. A line that leaves parts out reads its plan from `plans` by their bits. */
export interface ChatTemplate {
  /** The text between the parts, one more than `parts`. */
  readonly lits: readonly Bit[][];
  readonly parts: readonly { key: PartKey; ink: number; bits: readonly Bit[] }[];
  /** The bits of parts that show nothing whatever their value. */
  readonly blank: number;
  readonly plans: (Item[] | undefined)[];
}

function compile(chatFormat: string, parts: Readonly<Record<PartKey, string>>): ChatTemplate {
  const partBits = {} as Record<PartKey, Bit[]>;
  let blank = 0;
  for (const key of PART_KEYS) {
    partBits[key] = parseTemplate(parts[key], (w) => (w === "name" || w === key ? "value" : w === "icon" ? "" : null));
    if (!partBits[key].some((b) => b.slot !== "" || b.text !== "")) blank |= BIT[key];
  }
  const top = parseTemplate(chatFormat, (w) => ((PART_KEYS as readonly string[]).includes(w) ? w : w === "icon" ? "" : null));
  const lits: Bit[][] = [[]];
  const used: { key: PartKey; ink: number; bits: readonly Bit[] }[] = [];
  for (const b of top) {
    if (b.slot === "") lits[lits.length - 1]!.push(b);
    else {
      const key = b.slot as PartKey;
      used.push({ key, ink: b.ink, bits: partBits[key] });
      lits.push([]);
    }
  }
  return { lits, parts: used, blank, plans: [] };
}

const OPENS: Readonly<Record<string, string>> = { "[": "]", "(": ")", "{": "}", "<": ">" };

const textOf = (lit: readonly Bit[]): string => lit.reduce((s, b) => s + b.text, "");
const isSpace = (s: string): boolean => s.trim() === "";

/** Takes `n` characters off the start (or the end) of a run of text pieces. */
function cut(lit: Bit[], n: number, fromEnd: boolean): void {
  while (n > 0 && lit.length > 0) {
    const b = fromEnd ? lit[lit.length - 1]! : lit[0]!;
    const k = Math.min(n, b.text.length);
    b.text = fromEnd ? b.text.slice(0, b.text.length - k) : b.text.slice(k);
    n -= k;
    if (b.text === "") (fromEnd ? lit.pop() : lit.shift());
  }
}

/**
 * The plan of a line that leaves out the parts in `absent`. An absent part takes with it the brackets around it and one
 * of the two pieces of text beside it: the one after it at the line's start, the one before it at the line's end, and
 * otherwise the one of only spaces, or else the one after it. So `{sender} {tribe}: {message}` loses the space.
 */
function plan(t: ChatTemplate, absent: number): Item[] {
  const lits = t.lits.map((l) => l.map((b) => ({ ...b })));
  const parts = t.parts.slice();
  for (let p = 0; p < parts.length; ) {
    if (!(absent & BIT[parts[p]!.key])) {
      p++;
      continue;
    }
    const before = lits[p]!, after = lits[p + 1]!;
    const b = textOf(before), a = textOf(after);
    const close = OPENS[b.slice(-1)];
    if (close !== undefined && a.startsWith(close)) {
      cut(before, 1, true);
      cut(after, 1, false);
    }
    const atStart = p === 0, atEnd = p === parts.length - 1;
    const keepBefore = atStart || (!atEnd && !isSpace(textOf(before)) && isSpace(textOf(after)));
    lits.splice(p, 2, keepBefore ? before : after);
    parts.splice(p, 1);
  }
  const items: Item[] = [];
  const text = (bits: readonly Bit[]) => {
    for (const b of bits) if (b.text !== "") items.push({ text: b.text, ink: b.ink, mapped: false, value: null });
  };
  for (let p = 0; p <= parts.length; p++) {
    text(lits[p]!);
    const part = parts[p];
    if (!part) continue;
    for (const b of part.bits) {
      if (b.slot === "" && b.text === "") continue;
      const ink = b.ink >= 0 ? b.ink : part.ink;
      items.push({ text: b.text, ink, mapped: part.key === "map" && b.ink < 0, value: b.slot === "" ? null : part.key });
    }
  }
  while (items.length > 0 && items[0]!.value === null && (items[0]!.text = items[0]!.text.trimStart()) === "") items.shift();
  while (items.length > 0 && items[items.length - 1]!.value === null && (items[items.length - 1]!.text = items[items.length - 1]!.text.trimEnd()) === "") items.pop();
  return items;
}

// ---- Readers ----

/** A thing read from a config, and what was wrong in it in plain words. What was wrong was left out; the rest is kept. */
export interface Read<T> {
  value: T;
  faults: string[];
}

/** A permission group's chat block as CrossChat writes it: its strings as written, and their parsed form. */
export interface ChatFormat {
  /** The highest among a speaker's groups gives the format. */
  readonly priority: number;
  /** Kept, and not shown: there are no icons in chat here. */
  readonly icon: string;
  readonly chatFormat: string;
  readonly parts: Readonly<Record<PartKey, string>>;
  readonly template: ChatTemplate;
}

export interface ChatTag {
  /** The permission group it belongs to: the one of the same name, whatever its capitals. */
  readonly name: string;
  readonly priority: number;
  readonly icon: string;
  readonly text: string;
  /** Whether its holder may switch it off. */
  readonly canBeDisabled: boolean;
  /** The text, parsed, with `{icon}` left out. */
  readonly runs: readonly TextRun[];
}

/** CrossChat's chat settings: ChatTags with StackChatTags among them, MutedPermissionGroup and MapColors. */
export interface ChatSettings {
  /** Every tag shows when true, and only the highest otherwise. */
  readonly stackTags: boolean;
  /** Highest Priority first. */
  readonly tags: readonly ChatTag[];
  /** Its members may not use global chat. */
  readonly mutedGroup: string;
  /** By the map's name as written. */
  readonly mapColors: ReadonlyMap<string, number>;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The path of a key in a fault, as `ChatTags.Admin.Priority`. */
const at = (where: string, key: string): string => (where === "" ? key : `${where}.${key}`);

/** A field of `obj`, or `fallback` where it is missing or of the wrong type, which is a fault. */
function field<T>(obj: Record<string, unknown>, key: string, kind: "string" | "number" | "boolean", fallback: T, where: string, faults: string[]): T {
  const v = obj[key];
  if (v === undefined) return fallback;
  if (typeof v === kind && (kind !== "number" || Number.isFinite(v))) return v as T;
  faults.push(`${at(where, key)} is not a ${kind}, so it was left out.`);
  return fallback;
}

/** Reads one group's chat block. Null, with a fault, where it is not an object. `where` names it in the faults. */
export function readChatFormat(raw: unknown, where = ""): Read<ChatFormat | null> {
  const faults: string[] = [];
  if (!isObject(raw)) return { value: null, faults: [`${where || "The chat block"} is not an object, so it was left out.`] };
  const chatFormat = field(raw, "ChatFormat", "string", DEFAULT_CHAT_FORMAT, where, faults);
  const parts = { map: DEFAULT_PART, tags: DEFAULT_PART, sender: DEFAULT_PART, tribe: DEFAULT_PART, message: "{message}" };
  const fp = raw.FormattingParts;
  if (isObject(fp)) for (const key of PART_KEYS) parts[key] = field(fp, key, "string", parts[key], at(where, "FormattingParts"), faults);
  else if (fp !== undefined) faults.push(`${at(where, "FormattingParts")} is not an object, so it was left out.`);
  const template = compile(chatFormat, parts);
  for (const key of ["sender", "message"] as const) {
    if (!template.parts.some((p) => p.key === key)) faults.push(`${at(where, "ChatFormat")} has no {${key}}, so its lines show none.`);
  }
  const value: ChatFormat = {
    priority: field(raw, "Priority", "number", 0, where, faults),
    icon: field(raw, "Icon", "string", "", where, faults),
    chatFormat,
    parts,
    template,
  };
  return { value, faults };
}

function readTag(name: string, raw: unknown, where: string, faults: string[]): ChatTag | null {
  if (!isObject(raw)) {
    faults.push(`${where} is not an object, so it was left out.`);
    return null;
  }
  const text = field(raw, "Text", "string", "", where, faults);
  const runs: TextRun[] = [];
  for (const b of parseTemplate(text, (w) => (w === "icon" ? "" : null))) runs.push(b.ink < 0 ? { text: b.text } : { text: b.text, ink: b.ink });
  return {
    name,
    priority: field(raw, "Priority", "number", 0, where, faults),
    icon: field(raw, "Icon", "string", "", where, faults),
    text,
    canBeDisabled: field(raw, "CanBeDisabled", "boolean", true, where, faults),
    runs,
  };
}

/** Reads the chat settings. StackChatTags is read from inside ChatTags, as CrossChat writes it, or else from beside it. */
export function readChatSettings(raw: unknown, where = ""): Read<ChatSettings> {
  const faults: string[] = [];
  const doc = isObject(raw) ? raw : {};
  if (!isObject(raw)) faults.push(`${where || "The chat settings"} are not an object, so they were left out.`);
  let stackTags = field(doc, "StackChatTags", "boolean", true, where, faults);
  const tags: ChatTag[] = [];
  const ct = doc.ChatTags;
  if (isObject(ct)) {
    for (const name of Object.keys(ct)) {
      if (name === "StackChatTags") stackTags = field(ct, name, "boolean", stackTags, at(where, "ChatTags"), faults);
      else {
        const tag = readTag(name, ct[name], at(at(where, "ChatTags"), name), faults);
        if (tag) tags.push(tag);
      }
    }
  } else if (ct !== undefined) faults.push(`${at(where, "ChatTags")} is not an object, so it was left out.`);
  tags.sort((a, b) => b.priority - a.priority);
  const mapColors = new Map<string, number>();
  const mc = doc.MapColors;
  if (isObject(mc)) {
    for (const map of Object.keys(mc)) {
      const c = mc[map];
      if (Array.isArray(c) && c.length === 3 && c.every((n) => typeof n === "number" && Number.isFinite(n))) {
        const byte = (n: number) => Math.round(Math.min(255, Math.max(0, n)));
        mapColors.set(map, (byte(c[0]) << 16) | (byte(c[1]) << 8) | byte(c[2]));
      } else faults.push(`${at(at(where, "MapColors"), map)} is not three numbers from 0 to 255, so it was left out.`);
    }
  } else if (mc !== undefined) faults.push(`${at(where, "MapColors")} is not an object, so it was left out.`);
  const mutedGroup = field(doc, "MutedPermissionGroup", "string", "Muted", where, faults);
  return { value: { stackTags, tags, mutedGroup, mapColors }, faults };
}

/** A CrossChat config, read whole: each group's chat block by its name as written, and the chat settings. */
export interface CrossChat {
  readonly groups: ReadonlyMap<string, ChatFormat>;
  readonly settings: ChatSettings;
}

const SETTINGS_KEYS = ["ChatTags", "StackChatTags", "MutedPermissionGroup", "MapColors"];

/**
 * Reads a whole CrossChat config, as text or as parsed JSON. Its keys may sit at the top or under `Premium`, as some
 * versions write them; a key at the top wins.
 */
export function readCrossChat(raw: unknown): Read<CrossChat> {
  const faults: string[] = [];
  let doc = raw;
  if (typeof raw === "string") {
    const json = readLooseJson(raw);
    if (!json.ok) faults.push(json.reason);
    doc = json.ok ? json.value : {};
  }
  if (!isObject(doc)) {
    if (faults.length === 0) faults.push("The config is not an object.");
    doc = {};
  }
  const top = doc as Record<string, unknown>;
  const premium = isObject(top.Premium) ? top.Premium : {};
  const pick = (key: string): unknown => (top[key] !== undefined ? top[key] : premium[key]);
  const groups = new Map<string, ChatFormat>();
  const pf = pick("PermissionsFormatting");
  if (isObject(pf)) {
    for (const name of Object.keys(pf)) {
      const read = readChatFormat(pf[name], `PermissionsFormatting.${name}`);
      faults.push(...read.faults);
      if (read.value) groups.set(name, read.value);
    }
  } else if (pf !== undefined) faults.push("PermissionsFormatting is not an object, so it was left out.");
  const settingsDoc: Record<string, unknown> = {};
  for (const key of SETTINGS_KEYS) if (pick(key) !== undefined) settingsDoc[key] = pick(key);
  const settings = readChatSettings(settingsDoc);
  faults.push(...settings.faults);
  return { value: { groups, settings: settings.value }, faults };
}

// ---- Choosing ----

/** The chat block of the speaker's group with the highest Priority, the first on a tie, or null where none has one. */
export function chooseFormat(groups: readonly { name: string; format?: ChatFormat | null }[]): ChatFormat | null {
  let best: ChatFormat | null = null;
  for (const g of groups) if (g.format && (!best || g.format.priority > best.priority)) best = g.format;
  return best;
}

/**
 * The tags a speaker shows, highest Priority first: those named for one of its groups, whatever the capitals, less the
 * ones it switched off that may be. Only the first where tags do not stack.
 */
export function chooseTags(settings: ChatSettings, groups: readonly string[], off: Iterable<string> = []): ChatTag[] {
  const mine = new Set(groups.map((g) => g.toLowerCase()));
  const hidden = new Set<string>();
  for (const name of off) hidden.add(name.toLowerCase());
  const out: ChatTag[] = [];
  for (const tag of settings.tags) {
    const key = tag.name.toLowerCase();
    if (!mine.has(key) || (tag.canBeDisabled && hidden.has(key))) continue;
    out.push(tag);
    if (!settings.stackTags) break;
  }
  return out;
}

/** A map's colour from MapColors, whatever the capitals of its name, or undefined. */
export function mapInk(settings: ChatSettings, map: string): number | undefined {
  const exact = settings.mapColors.get(map);
  if (exact !== undefined) return exact;
  const key = map.toLowerCase();
  for (const name of settings.mapColors.keys()) if (name.toLowerCase() === key) return settings.mapColors.get(name);
  return undefined;
}

// ---- A line ----

/** What one line says. An empty tribe or map shows none: a line that did not cross worlds names no map. */
export interface LineWords {
  readonly sender: string;
  readonly message: string;
  readonly tribe?: string;
  readonly map?: string;
  /** 0xRRGGBB. */
  readonly mapInk?: number;
}

const DEFAULT_FORMAT = readChatFormat({}).value!;

/** Builds runs, joining text of one ink, except that the sender's name is a run of its own. */
class Runs {
  readonly runs: TextRun[] = [];
  /** The index of the sender's first run, or -1. */
  sender = -1;
  private lastAlone = false;

  add(text: string, ink: number, alone = false): void {
    if (text === "") return;
    const last = this.runs[this.runs.length - 1];
    if (last && !alone && !this.lastAlone && (last.ink ?? -1) === ink) last.text += text;
    else {
      if (alone && this.sender < 0) this.sender = this.runs.length;
      this.runs.push(ink < 0 ? { text } : { text, ink });
    }
    this.lastAlone = alone;
  }
}

/** One run without ink of all the text of `runs` from `from` to `to`. */
function joined(runs: readonly TextRun[], from: number, to: number): TextRun {
  let text = "";
  for (let i = from; i < to; i++) text += runs[i]!.text;
  return { text };
}

/** At most CHAT_RUNS_MOST runs. The runs past it are joined into one without ink, so no text is lost and the sender keeps its own. */
function fit(runs: TextRun[], sender: number): TextRun[] {
  const most = CHAT_RUNS_MOST;
  if (runs.length <= most) return runs;
  if (sender < most - 1) return [...runs.slice(0, most - 1), joined(runs, most - 1, runs.length)];
  const head = most - 3;
  const out = [...runs.slice(0, head), joined(runs, head, sender), runs[sender]!];
  if (sender + 1 < runs.length) out.push(joined(runs, sender + 1, runs.length));
  return out;
}

/**
 * A line as runs: the speaker's format (or the built-in one, `{tags} {sender}: {message}`), the tags chosen for it, and the
 * line's words. A part with no value leaves nothing behind. Nothing in `line` is read for markup.
 */
export function formatLine(format: ChatFormat | null, tags: readonly ChatTag[], line: LineWords): TextRun[] {
  const t = (format ?? DEFAULT_FORMAT).template;
  let tagged = false;
  for (const tag of tags) if (tag.runs.length > 0) tagged = true;
  const absent =
    t.blank | (line.map ? 0 : BIT.map) | (tagged ? 0 : BIT.tags) | (line.sender ? 0 : BIT.sender) | (line.tribe ? 0 : BIT.tribe) | (line.message ? 0 : BIT.message);
  const items = (t.plans[absent] ??= plan(t, absent));
  const mapped = line.mapInk ?? -1;
  const out = new Runs();
  for (const item of items) {
    const ink = item.mapped && mapped >= 0 ? mapped : item.ink;
    switch (item.value) {
      case null:
        out.add(item.text, ink);
        break;
      case "sender":
        out.add(line.sender, ink, true);
        break;
      case "tags": {
        let first = true;
        for (const tag of tags) {
          if (tag.runs.length === 0) continue;
          if (!first) out.add(" ", ink);
          first = false;
          for (const r of tag.runs) out.add(r.text, r.ink ?? ink);
        }
        break;
      }
      case "map":
        out.add(line.map ?? "", ink);
        break;
      case "tribe":
        out.add(line.tribe ?? "", ink);
        break;
      case "message":
        out.add(line.message, ink);
        break;
    }
  }
  return fit(out.runs, out.sender);
}
